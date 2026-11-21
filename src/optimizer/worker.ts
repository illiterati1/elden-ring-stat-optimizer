import type { Weapon } from "../calculator/weapon.ts";
import { optimizeBuild, type BuildRequest, type BuildResult } from "./build.ts";
import { optimizeAttributes, type OptimizeOptions } from "./optimizer.ts";

/** A chunk of a list of requests to optimize (see WorkerPool) */
export interface WorkerRequest {
  /** The list's ID: a chunk is abandoned as soon as one for a newer list arrives */
  id: number;
  chunk: number;
  requests: BuildRequest[];
}

export interface WorkerResponse {
  chunk: number;
  results: BuildResult[];
}

/**
 * Damage per second at every level (ValueCurve dps) for the requests charted, asked for apart from
 * the results since it's only needed for a few weapons and takes a while for each
 */
export interface DpsCurveRequest {
  dpsId: number;
  requests: BuildRequest[];
}

export interface DpsCurveResponse {
  dpsId: number;
  /** Each request's, in order, if its attack's timing is known */
  curves: (number[] | undefined)[];
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
 * Optimizes each request, yielding to incoming messages now and then
 * @returns the results, or null if a newer request arrived meanwhile
 */
async function optimizeAll(id: number, requests: readonly BuildRequest[]) {
  const results: BuildResult[] = [];
  let lastYield = performance.now();
  for (const request of requests) {
    if (performance.now() - lastYield > yieldIntervalMs) {
      await yieldToMessages();
      lastYield = performance.now();
    }
    if (id !== latestId) return null;
    results.push(withoutRequestStepTimes(optimizeBuild(request, findCurve), request));
  }
  return results;
}

/**
 * Leaves out a result's step times when they're its request's own, since the page has those
 * already (shared between requests) and copying them into every result took a lot of memory.
 * WorkerPool puts the page's copy back.
 */
function withoutRequestStepTimes(result: BuildResult, request: BuildRequest) {
  if (
    result.attackStepTimes === undefined ||
    result.attackStepTimes !== request.attack?.stepTimes
  ) {
    return result;
  }
  const { attackStepTimes: _, ...rest } = result;
  return rest;
}

/**
 * Runs the optimizer off the main thread, since exhaustive searches can take a moment. A request
 * is abandoned as soon as a newer one arrives, since its results would be out of date.
 */
async function handleRequest({ id, chunk, requests }: WorkerRequest) {
  const results = await optimizeAll(id, requests);
  if (!results) return;
  const response: WorkerResponse = { chunk, results };
  self.postMessage(response);
}

/**
 * Works out the DPS curves between the results' batches, finding each curve in the cache when the
 * results have already used it
 */
function handleDpsRequest({ dpsId, requests }: DpsCurveRequest) {
  const curves = requests.map(
    (request) => optimizeBuild({ ...request, fast: false, dpsCurve: true }, findCurve).curve.dps,
  );
  const response: DpsCurveResponse = { dpsId, curves };
  self.postMessage(response);
}

self.onmessage = (evt: MessageEvent<WorkerRequest | DpsCurveRequest>) => {
  if ("dpsId" in evt.data) {
    handleDpsRequest(evt.data);
    return;
  }
  latestId = evt.data.id;
  void handleRequest(evt.data);
};
