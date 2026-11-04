import type { Weapon } from "../calculator/weapon.ts";
import { optimizeBuild, type BuildRequest, type BuildResult } from "./build.ts";
import { optimizeAttributes, type OptimizeOptions } from "./optimizer.ts";

export interface WorkerRequest {
  id: number;
  requests: BuildRequest[];
}

export interface WorkerResponse {
  id: number;
  results: BuildResult[];
}

/** How many curves to keep. Each is a few hundred allocations, so this bounds memory use. */
const maxCachedCurves = 4000;

/** Yield to incoming messages at least this often, so a newer request can cancel this one */
const yieldIntervalMs = 15;

/**
 * Curves only depend on these options, not on the limits, so changing a limit or adding a weapon
 * doesn't recalculate the curves already found. Least recently used curves are dropped first.
 */
const curveCache = new Map<string, ReturnType<typeof optimizeAttributes>>();

function getCacheKey({ weapon, spellBuffWeapon, ...options }: OptimizeOptions) {
  return JSON.stringify({
    weapon: (weapon as Weapon).name,
    spellBuffWeapon: spellBuffWeapon?.name,
    ...options,
  });
}

function findCurve(options: OptimizeOptions) {
  const key = getCacheKey(options);
  let curve = curveCache.get(key);
  if (curve !== undefined) {
    curveCache.delete(key);
  } else {
    curve = optimizeAttributes(options);
    if (curveCache.size >= maxCachedCurves) {
      curveCache.delete(curveCache.keys().next().value!);
    }
  }
  curveCache.set(key, curve);
  return curve;
}

/** Lets queued messages run without the minimum delay setTimeout has */
function yieldToMessages() {
  return new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
}

let latestId = -1;

/**
 * Runs the optimizer off the main thread, since exhaustive searches can take a moment. A request
 * is abandoned as soon as a newer one arrives, since its results would be out of date.
 */
async function handleRequest({ id, requests }: WorkerRequest) {
  const results: BuildResult[] = [];
  let lastYield = performance.now();
  for (const request of requests) {
    if (performance.now() - lastYield > yieldIntervalMs) {
      await yieldToMessages();
      lastYield = performance.now();
    }
    if (id !== latestId) return;
    results.push(optimizeBuild(request, findCurve));
  }
  const response: WorkerResponse = { id, results };
  self.postMessage(response);
}

self.onmessage = (evt: MessageEvent<WorkerRequest>) => {
  latestId = evt.data.id;
  void handleRequest(evt.data);
};
