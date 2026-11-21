/**
 * Counts renders for the responsiveness check (scripts/perf.mjs), which builds the app with
 * VITE_PERF_PROBE=1. In any other build this is a no-op.
 */
const enabled = import.meta.env.VITE_PERF_PROBE === "1";

declare global {
  interface Window {
    __perfRenders?: Record<string, number>;
  }
}

/** Counts one render of a component, by name */
export function countRender(name: string) {
  if (!enabled) return;
  const renders = (window.__perfRenders ??= {});
  renders[name] = (renders[name] ?? 0) + 1;
}
