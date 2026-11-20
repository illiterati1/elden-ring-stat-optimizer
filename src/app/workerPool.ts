import type { BuildRequest, BuildResult } from "../optimizer/build.ts";
import type {
  DpsCurveRequest,
  DpsCurveResponse,
  WorkerRequest,
  WorkerResponse,
} from "../optimizer/worker.ts";
import { sortResults } from "./results.ts";
import type { SortBy } from "./useAppState.ts";

/** Only the first results by a sort column are wanted, as the table sorts them */
export interface TopN {
  count: number;
  sortBy: SortBy;
  reverse: boolean;
  /** Sort by per second values (see sortResults) */
  perSecond: boolean;
}

/** How many workers to use: one per core but one (for the page), within reason */
export function getDefaultPoolSize() {
  const cores = typeof navigator === "undefined" ? 1 : navigator.hardwareConcurrency ?? 1;
  return Math.max(1, Math.min(cores - 1, 8));
}

/** How many chunks each worker is sent ahead, so it doesn't wait between them */
const chunksAhead = 2;

/** A string hash (FNV-1a) */
function hash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * True if fast mode finds the same final allocation as optimizing every level, so it ranks
 * results the same way: fast mode only applies the level and rune limits
 */
function fastModeRanksExactly(request: BuildRequest) {
  const {
    minGainPerLevel,
    minRelativeGainPerLevel,
    targetValue,
    targetPotential,
    minPotentialPerRemainingLevel,
  } = request.limits;
  return (
    minGainPerLevel == null &&
    minRelativeGainPerLevel == null &&
    targetValue == null &&
    targetPotential == null &&
    minPotentialPerRemainingLevel == null
  );
}

/** One list of requests being optimized */
interface Batch {
  id: number;
  requests: readonly BuildRequest[];
  /** The indexes of the requests waiting for each worker, which works from the front */
  queues: number[][];
  chunkSize: number;
  /** How many chunks each worker has been sent and hasn't answered */
  inFlight: number[];
  results: BuildResult[];
  remaining: number;
  resolve: (results: BuildResult[]) => void;
}

interface PendingDps {
  shardIndexes: number[][];
  curves: (number[] | undefined)[];
  remaining: number;
  resolve: (curves: (number[] | undefined)[]) => void;
}

/**
 * Optimizer workers that share out each request list. Each weapon has a home worker that its
 * requests go to, so its curves are found in that worker's cache next time (for results or DPS
 * curves). A worker that runs out of requests takes some from the worker with the most left, and
 * becomes their weapons' home, so the slowest weapons don't hold everything up.
 */
export default class WorkerPool {
  private readonly workers: Worker[];
  /** The worker whose cache each weapon's curves are in (by weapon name) */
  private readonly homes = new Map<string, number>();
  private batch: Batch | undefined;
  /** The batch and request indexes of each chunk sent and not answered yet */
  private readonly chunks = new Map<number, { batch: Batch; indexes: number[] }>();
  private nextChunk = 0;
  private readonly pendingDps = new Map<number, PendingDps>();
  private nextDpsId = 0;

  constructor(size: number) {
    this.workers = Array.from({ length: size }, (_, shard) => {
      const worker = new Worker(new URL("../optimizer/worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (evt: MessageEvent<WorkerResponse | DpsCurveResponse>) => {
        if ("dpsId" in evt.data) {
          this.handleDpsResponse(shard, evt.data);
        } else {
          this.handleResponse(shard, evt.data);
        }
      };
      return worker;
    });
  }

  terminate() {
    this.workers.forEach((worker) => worker.terminate());
  }

  private homeOf(request: BuildRequest) {
    const { name } = request.weapon;
    let home = this.homes.get(name);
    if (home === undefined) {
      home = hash(name) % this.workers.length;
      this.homes.set(name, home);
    }
    return home;
  }

  /**
   * Optimizes the requests. A newer call abandons this one, whose promise then never settles.
   * @returns the results in the same order as the requests, or with top N, the first applicable
   * results by its sort column
   */
  async optimize(id: number, requests: readonly BuildRequest[], topN?: TopN) {
    if (!topN) return this.run(id, requests);
    // Fast mode finds the top N, then only those are optimized at every level (for the chart). If
    // fast mode wouldn't rank them the same way, or they're all in fast mode already, every
    // request is optimized and the top N taken from those.
    const twoPass =
      requests.some((request) => !request.fast) && requests.every(fastModeRanksExactly);
    if (!twoPass) return this.getTop(await this.run(id, requests), topN);
    const fastResults = await this.run(
      id,
      requests.map((request) => ({ ...request, fast: true })),
    );
    const indexes = new Map(fastResults.map((result, i) => [result, i]));
    return this.run(
      id,
      this.getTop(fastResults, topN).map((result) => requests[indexes.get(result)!]),
    );
  }

  /** @returns the first applicable results by the sort column */
  private getTop(results: BuildResult[], { count, sortBy, reverse, perSecond }: TopN) {
    return sortResults(results, sortBy, reverse, perSecond)
      .filter((result) => result.applicable)
      .slice(0, count);
  }

  /** Optimizes the requests, abandoning any batch still going */
  private run(id: number, requests: readonly BuildRequest[]) {
    return new Promise<BuildResult[]>((resolve) => {
      this.chunks.clear();
      if (requests.length === 0) {
        this.batch = undefined;
        resolve([]);
        return;
      }
      const queues: number[][] = this.workers.map(() => []);
      requests.forEach((request, i) => queues[this.homeOf(request)].push(i));
      const batch: Batch = {
        id,
        requests,
        queues,
        // Small enough to share out evenly, big enough that messages don't add much
        chunkSize: Math.max(1, Math.min(16, Math.ceil(requests.length / this.workers.length / 8))),
        inFlight: this.workers.map(() => 0),
        results: [],
        remaining: requests.length,
        resolve,
      };
      this.batch = batch;
      this.workers.forEach((_, shard) => this.sendChunks(batch, shard));
    });
  }

  /** Sends a worker chunks of requests until it has enough ahead, or there are none left */
  private sendChunks(batch: Batch, shard: number) {
    while (batch.inFlight[shard] < chunksAhead) {
      let indexes = batch.queues[shard].splice(0, batch.chunkSize);
      if (indexes.length === 0) {
        // Take from the end of the longest queue, where its own worker won't get to soon
        const longest = batch.queues.reduce(
          (best, queue, i) => (queue.length > batch.queues[best].length ? i : best),
          0,
        );
        indexes = batch.queues[longest].splice(-batch.chunkSize);
        if (indexes.length === 0) return;
        indexes.forEach((i) => this.homes.set(batch.requests[i].weapon.name, shard));
      }
      const chunk = ++this.nextChunk;
      this.chunks.set(chunk, { batch, indexes });
      batch.inFlight[shard]++;
      const message: WorkerRequest = {
        id: batch.id,
        chunk,
        requests: indexes.map((i) => batch.requests[i]),
      };
      this.workers[shard].postMessage(message);
    }
  }

  private handleResponse(shard: number, { chunk, results }: WorkerResponse) {
    const sent = this.chunks.get(chunk);
    if (!sent || sent.batch !== this.batch) return;
    this.chunks.delete(chunk);
    const { batch, indexes } = sent;
    indexes.forEach((index, i) => (batch.results[index] = results[i]));
    batch.inFlight[shard]--;
    batch.remaining -= indexes.length;
    if (batch.remaining === 0) {
      this.batch = undefined;
      batch.resolve(batch.results);
      return;
    }
    this.sendChunks(batch, shard);
  }

  /**
   * Damage per second at every level for some requests (see DpsCurveRequest), worked out by each
   * weapon's home worker between the results' chunks
   * @returns each request's curve, in the same order
   */
  dpsCurves(requests: readonly BuildRequest[]) {
    return new Promise<(number[] | undefined)[]>((resolve) => {
      const dpsId = ++this.nextDpsId;
      const shardIndexes: number[][] = this.workers.map(() => []);
      requests.forEach((request, i) => shardIndexes[this.homeOf(request)].push(i));
      const shards = shardIndexes.flatMap((indexes, shard) => (indexes.length ? [shard] : []));
      if (shards.length === 0) {
        resolve([]);
        return;
      }
      this.pendingDps.set(dpsId, { shardIndexes, curves: [], remaining: shards.length, resolve });
      for (const shard of shards) {
        const message: DpsCurveRequest = {
          dpsId,
          requests: shardIndexes[shard].map((i) => requests[i]),
        };
        this.workers[shard].postMessage(message);
      }
    });
  }

  private handleDpsResponse(shard: number, { dpsId, curves }: DpsCurveResponse) {
    const pending = this.pendingDps.get(dpsId);
    if (!pending) return;
    curves.forEach((curve, i) => (pending.curves[pending.shardIndexes[shard][i]] = curve));
    if (--pending.remaining > 0) return;
    this.pendingDps.delete(dpsId);
    pending.resolve(pending.curves);
  }
}
