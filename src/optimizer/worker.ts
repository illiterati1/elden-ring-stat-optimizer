import type { Weapon } from "../calculator/weapon.ts";
import { optimizeBuild, type BuildRequest, type BuildResult } from "./build.ts";
import { optimizeAttributes, type OptimizeOptions } from "./optimizer.ts";
import { sortResults } from "../app/results.ts";
import type { SortBy } from "../app/useAppState.ts";

/** Only the first results by a sort column are wanted, as the table sorts them */
export interface TopN {
  count: number;
  sortBy: SortBy;
  reverse: boolean;
  /** Sort by per second values (see sortResults) */
  perSecond: boolean;
}

export interface WorkerRequest {
  id: number;
  requests: BuildRequest[];
  /** If set, only the first applicable results by the sort column are returned */
  topN?: TopN;
}

export interface WorkerResponse {
  id: number;
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
    results.push(optimizeBuild(request, findCurve));
  }
  return results;
}

/** @returns the indexes of the first applicable results by the sort column */
function getTopIndexes(results: BuildResult[], { count, sortBy, reverse, perSecond }: TopN) {
  const indexes = new Map(results.map((result, i) => [result, i]));
  return sortResults(results, sortBy, reverse, perSecond)
    .filter((result) => result.applicable)
    .slice(0, count)
    .map((result) => indexes.get(result)!);
}

/**
 * True if fast mode finds the same final allocation as optimizing every level, so it ranks
 * results the same way: fast mode only applies the level and rune limits
 */
function fastModeRanksExactly(request: BuildRequest) {
  const { minGainPerLevel, minRelativeGainPerLevel, targetValue } = request.limits;
  return minGainPerLevel == null && minRelativeGainPerLevel == null && targetValue == null;
}

/**
 * The results for a request with top N: fast mode finds the top N, then only those are optimized
 * at every level (for the chart). If fast mode wouldn't rank them the same way, or they're all in
 * fast mode already, every request is optimized and the top N taken from those.
 */
async function optimizeTopN(id: number, requests: readonly BuildRequest[], topN: TopN) {
  const twoPass = requests.some((request) => !request.fast) && requests.every(fastModeRanksExactly);
  if (!twoPass) {
    const results = await optimizeAll(id, requests);
    return results && getTopIndexes(results, topN).map((i) => results[i]);
  }
  const fastResults = await optimizeAll(
    id,
    requests.map((request) => ({ ...request, fast: true })),
  );
  if (!fastResults) return null;
  return optimizeAll(
    id,
    getTopIndexes(fastResults, topN).map((i) => requests[i]),
  );
}

/**
 * Runs the optimizer off the main thread, since exhaustive searches can take a moment. A request
 * is abandoned as soon as a newer one arrives, since its results would be out of date.
 */
async function handleRequest({ id, requests, topN }: WorkerRequest) {
  const results = topN ? await optimizeTopN(id, requests, topN) : await optimizeAll(id, requests);
  if (!results) return;
  const response: WorkerResponse = { id, results };
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
