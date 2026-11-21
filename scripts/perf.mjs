/**
 * Responsiveness check: builds the app with render counting on (VITE_PERF_PROBE=1), serves it,
 * and drives it in headless Chromium through a few interactions on a large results table. Each
 * interaction is timed and compared against scripts/perf-baseline.json.
 *
 * Fails (exit code 1) if:
 * - a component renders more times per interaction than in the baseline. This doesn't depend on
 *   the machine, so it's the reliable check
 * - a timing's median is over the baseline × tolerance + slack. Timings are noisy, so the limits
 *   are loose, and the baseline is only meaningful on the machine it was recorded on
 *
 * Usage: npm run perf [-- --update] [--runs N] [--only <scenario>] [--skip-build] [--tolerance X]
 *   --update      save this run's numbers as the new baseline (after an intended change)
 *   --runs N      measured interactions per scenario (even, so the settings end where they began)
 *   --only NAME   run only the scenarios whose name contains NAME
 *   --skip-build  reuse the last build (only when the app hasn't changed since)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { build, preview } from "vite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = join(root, "scripts", "perf-baseline.json");
const outDir = join(tmpdir(), "stat-calculator-perf-build");

const { values: args } = parseArgs({
  options: {
    update: { type: "boolean", default: false },
    runs: { type: "string", default: "6" },
    only: { type: "string" },
    "skip-build": { type: "boolean", default: false },
    tolerance: { type: "string", default: "1.5" },
  },
});
const runs = Math.max(2, Math.round(+args.runs / 2) * 2);
const tolerance = +args.tolerance;

/** Absolute slack added to each timing limit, so tiny baselines don't fail on noise */
const slackMs = { paintMs: 40, blockingMs: 60, longestTaskMs: 60 };
const timingLabels = {
  paintMs: "input→next frame",
  blockingMs: "total blocking",
  longestTaskMs: "longest task",
};

// --- Build and serve ---

if (!args["skip-build"] || !existsSync(join(outDir, "index.html"))) {
  console.log("Building with render counting…");
  process.env.VITE_PERF_PROBE = "1";
  await build({
    root,
    logLevel: "warn",
    build: { outDir, emptyOutDir: true },
  });
}
const server = await preview({
  root,
  logLevel: "warn",
  build: { outDir },
  preview: { port: 5180, strictPort: false, open: false },
});
const url = server.resolvedUrls.local[0];

// Chromium needs a few system libraries WSL doesn't have; they were extracted here
const extraLibs = join(homedir(), ".cache/claude-browser-check/libs/usr/lib/x86_64-linux-gnu");
const browser = await chromium.launch({
  env: existsSync(extraLibs)
    ? {
        ...process.env,
        LD_LIBRARY_PATH: [extraLibs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":"),
      }
    : process.env,
});

let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  page.on("pageerror", (error) => console.error("Page error:", error.message));

  // 4 weapon types (~170 rows), the load the table's render time was profiled with
  await page.addInitScript(() => {
    localStorage.setItem(
      "statCalculatorState",
      JSON.stringify({ weaponTypes: [13, 9, 3, 5], chartWeapons: [] }),
    );
    // Long tasks since the last reset, as [start, duration]
    window.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__longTasks.push([e.startTime, e.duration]);
    }).observe({ type: "longtask", buffered: true });
    // When the frame after the latest click was painted, from the click
    addEventListener(
      "click",
      () => {
        const start = performance.now();
        window.__paintMs = null;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => (window.__paintMs ??= performance.now() - start)),
        );
      },
      { capture: true },
    );
  });

  /**
   * Waits for the calculation to finish and the main thread to go quiet: the progress bar hidden
   * and no long task for a second
   */
  async function settle(timeoutMs = 120_000) {
    await page.waitForTimeout(500); // (past the calculation's debounce)
    await page.waitForFunction(
      () => {
        const bar = document.querySelector(".MuiLinearProgress-root");
        if (bar && getComputedStyle(bar).visibility !== "hidden") return false;
        const last = window.__longTasks.at(-1);
        return !last || performance.now() - (last[0] + last[1]) > 1000;
      },
      undefined,
      { timeout: timeoutMs, polling: 100 },
    );
  }

  console.log(`Loading ${url} …`);
  await page.goto(url);
  await settle();
  const rows = await page.locator("tbody tr").count();
  if (rows < 100) throw new Error(`Expected a large results table, but it has ${rows} rows`);
  // Chart a few weapons, so the chart renders too
  const chartBoxes = page.locator("tbody input[type=checkbox]");
  for (let i = 0; i < 3; i++) await chartBoxes.nth(i).check();
  await settle();

  /** The spin buttons of the number field labelled `label` */
  const spinButton = (label, direction) =>
    page
      .getByLabel(label)
      .first()
      .locator("xpath=ancestor::div[contains(@class,'MuiFormControl')]")
      .getByLabel(direction, { exact: true })
      .first();

  /**
   * Each scenario's act(i) is called with i = 0, 1, 2, …; odd calls undo even ones, so every
   * measured interaction after the warm-up pair uses results the workers have cached
   */
  const scenarios = [
    {
      name: "Str spin button",
      act: (i) => spinButton(/^Str$/, i % 2 ? "Decrease" : "Increase").click(),
    },
    {
      name: "Two handing checkbox",
      act: () =>
        page
          .getByLabel(/two.?hand/i)
          .first()
          .click(),
    },
    {
      name: "Chart from level",
      act: (i) => spinButton(/^From level/, i % 2 ? "Decrease" : "Increase").click(),
    },
    {
      name: "Weapon level picker",
      prepare: async () => {
        await page.getByRole("combobox", { name: "Weapon Levels" }).click();
        await page.getByRole("option").first().waitFor();
      },
      // Adds +24 beside +25, then takes it off again, closing the picker each time
      act: async () => {
        await page.getByRole("option", { name: /^\+24 / }).click();
        await page.keyboard.press("Escape");
      },
    },
    {
      // Only reorders the rows: their results stay the same
      name: "Sort by column",
      act: (i) =>
        page
          .locator("thead .MuiTableSortLabel-root", { hasText: i % 2 ? /^Weapon$/ : /^Stance$/ })
          .first()
          .click(),
    },
  ].filter((s) => !args.only || s.name.toLowerCase().includes(args.only.toLowerCase()));

  const results = {};
  for (const scenario of scenarios) {
    process.stdout.write(`${scenario.name}: `);
    const samples = [];
    for (let i = 0; i < runs + 2; i++) {
      await scenario.prepare?.();
      await page.evaluate(() => {
        window.__longTasks = [];
        window.__perfRenders = {};
        window.__start = performance.now();
      });
      await scenario.act(i);
      await settle();
      const sample = await page.evaluate(() => {
        const tasks = window.__longTasks.filter(([start]) => start >= window.__start);
        return {
          paintMs: window.__paintMs ?? NaN,
          blockingMs: tasks.reduce((sum, [, d]) => sum + Math.max(0, d - 50), 0),
          longestTaskMs: Math.max(0, ...tasks.map(([, d]) => d)),
          renders: { ...window.__perfRenders },
        };
      });
      if (i >= 2) samples.push(sample); // (the first two warm the workers' caches)
      process.stdout.write(".");
    }
    process.stdout.write("\n");
    const median = (values) => {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = sorted.length / 2;
      return Math.round(
        sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2,
      );
    };
    const components = [...new Set(samples.flatMap((s) => Object.keys(s.renders)))].sort();
    results[scenario.name] = {
      // The most renders of any interaction (they should all be the same)
      renders: Object.fromEntries(
        components.map((c) => [c, Math.max(...samples.map((s) => s.renders[c] ?? 0))]),
      ),
      ...Object.fromEntries(
        Object.keys(timingLabels).map((key) => [key, median(samples.map((s) => s[key]))]),
      ),
    };
  }

  // --- Compare and report ---

  const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : {};
  const lines = [];
  for (const [name, result] of Object.entries(results)) {
    const base = baseline.scenarios?.[name];
    lines.push(`\n${name}`);
    if (!base) lines.push("  (no baseline yet)");
    const components = new Set([
      ...Object.keys(result.renders),
      ...Object.keys(base?.renders ?? {}),
    ]);
    for (const component of [...components].sort()) {
      const now = result.renders[component] ?? 0;
      const was = base?.renders[component];
      let status = "";
      if (was != null && now > was) {
        status = "  ✗ MORE RENDERS";
        failed = true;
      } else if (was != null && now < was) status = "  (fewer: --update to keep)";
      lines.push(
        `  ${`${component} renders`.padEnd(22)} ${String(now).padStart(6)}${
          was != null ? `   baseline ${was}` : ""
        }${status}`,
      );
    }
    for (const [key, label] of Object.entries(timingLabels)) {
      const now = result[key];
      const was = base?.[key];
      let status = "";
      if (was != null) {
        const limit = Math.round(was * tolerance + slackMs[key]);
        if (!(now <= limit)) {
          status = `  ✗ SLOWER (limit ${limit})`;
          failed = true;
        }
      }
      lines.push(
        `  ${label.padEnd(22)} ${`${now} ms`.padStart(9)}${
          was != null ? `   baseline ${was} ms` : ""
        }${status}`,
      );
    }
  }
  console.log(lines.join("\n"));

  if (args.update) {
    mkdirSync(dirname(baselinePath), { recursive: true });
    const scenariosOut = { ...baseline.scenarios, ...results };
    writeFileSync(
      baselinePath,
      `${JSON.stringify(
        {
          note: "Timings are from one machine; render counts aren't machine-dependent",
          runs,
          scenarios: scenariosOut,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`\nSaved the baseline to ${baselinePath}`);
    failed = false;
  } else if (failed) {
    console.log("\n✗ Responsiveness regressed (rerun to rule out noise; --update if intended)");
  } else {
    console.log("\n✓ No regressions");
  }
} catch (error) {
  console.error(error);
  failed = true;
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
process.exit(failed ? 1 : 0);
