/**
 * Cloudflare Pages Function (POST /api/report-issue): files a GitHub issue from the site's bug
 * report form as a bot account, so visitors don't need a GitHub account.
 *
 * Environment variables (set as encrypted secrets in the Cloudflare Pages project's settings):
 * - GITHUB_TOKEN: a token for the bot account that can create issues in GITHUB_REPO
 * - TURNSTILE_SECRET_KEY: the secret key for the Turnstile widget the form shows
 * - GITHUB_REPO (optional): "owner/name", by default this project's repo
 */

export interface Env {
  GITHUB_TOKEN?: string;
  TURNSTILE_SECRET_KEY?: string;
  GITHUB_REPO?: string;
}

export interface ReportRequest {
  title: string;
  description: string;
  /** The reporter's saved settings, to reproduce the issue with, if they chose to include them */
  settings?: unknown;
  /** Turnstile's response token, proving a person filled in the form */
  turnstileToken: string;
  /** A field hidden from people: anything in it means a bot filled in the form */
  website?: string;
}

const defaultRepo = "illiterati1/elden-ring-stat-optimizer";
export const maxTitleLength = 120;
export const maxDescriptionLength = 5000;
/** Settings bigger than this are left out (GitHub's limit for a whole issue is 65,536 characters) */
const maxSettingsLength = 50000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Breaks @mentions and #references, so a report can't notify people or link other issues */
function neutralize(text: string) {
  return text.replace(/([@#])(?=[\w-])/g, "$1​");
}

/** A code fence longer than any run of backticks in the text, so the text can't close it early */
function fenceFor(text: string) {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longest + 1));
}

export function formatIssueBody(description: string, settings: unknown) {
  let body = `${neutralize(
    description.trim(),
  )}\n\n---\n_Filed from the website's bug report form._`;
  if (settings !== undefined) {
    const settingsJson = JSON.stringify(settings, null, 2);
    if (settingsJson.length <= maxSettingsLength) {
      const fence = fenceFor(settingsJson);
      body += `\n\n<details>\n<summary>Reporter's settings</summary>\n\n${fence}json\n${settingsJson}\n${fence}\n\n</details>`;
    } else {
      body += "\n\n_(The reporter's settings were too large to include.)_";
    }
  }
  return body;
}

async function verifyTurnstile(token: string, secret: string, ip: string | null) {
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  const outcome = (await res.json()) as { success: boolean };
  return outcome.success;
}

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  if (!env.GITHUB_TOKEN || !env.TURNSTILE_SECRET_KEY) {
    return json({ error: "Bug reports aren't set up on this site yet." }, 503);
  }

  let report: ReportRequest;
  try {
    report = (await request.json()) as ReportRequest;
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const title = typeof report.title === "string" ? report.title.trim() : "";
  const description = typeof report.description === "string" ? report.description.trim() : "";
  if (!title || title.length > maxTitleLength) {
    return json({ error: `The title must be 1 to ${maxTitleLength} characters.` }, 400);
  }
  if (!description || description.length > maxDescriptionLength) {
    return json({ error: `The description must be 1 to ${maxDescriptionLength} characters.` }, 400);
  }
  if (typeof report.turnstileToken !== "string" || !report.turnstileToken) {
    return json({ error: "Please complete the verification." }, 400);
  }

  const verified = await verifyTurnstile(
    report.turnstileToken,
    env.TURNSTILE_SECRET_KEY,
    request.headers.get("CF-Connecting-IP"),
  );
  if (!verified) {
    return json({ error: "Verification failed. Please try again." }, 403);
  }
  // Pretend a bot's report worked, so it doesn't learn to leave the hidden field empty
  if (report.website) {
    return json({ url: null });
  }

  const repo = env.GITHUB_REPO ?? defaultRepo;
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "stat-optimizer-bug-reports",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      title: neutralize(title),
      body: formatIssueBody(description, report.settings),
    }),
  });
  if (!res.ok) {
    console.error("GitHub issue creation failed", res.status, await res.text());
    return json({ error: "Couldn't file the report. Please try again later." }, 502);
  }
  const issue = (await res.json()) as { html_url: string };
  return json({ url: issue.html_url });
}
