import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuildRequest, BuildResult } from "../optimizer/build.ts";
import type {
  DpsCurveRequest,
  DpsCurveResponse,
  WorkerRequest,
  WorkerResponse,
} from "../optimizer/worker.ts";
import WorkerPool, { type RunProgress, type TopN } from "./workerPool.ts";

/** What each fake worker was sent */
let sent: { shard: number; requests: BuildRequest[] }[];

/**
 * A stand-in for the optimizer worker: a request's result has the value in its weapon's name
 * ("w300" is 300), is applicable unless the request has a reason, and says whether it was fast
 */
class FakeWorker {
  static count = 0;
  readonly shard = FakeWorker.count++;
  onmessage: ((evt: MessageEvent<WorkerResponse | DpsCurveResponse>) => void) | undefined;

  postMessage(message: WorkerRequest | DpsCurveRequest) {
    const reply = (data: WorkerResponse | DpsCurveResponse) =>
      setTimeout(() => this.onmessage?.({ data } as MessageEvent));
    sent.push({ shard: this.shard, requests: message.requests });
    if ("dpsId" in message) {
      reply({ dpsId: message.dpsId, curves: message.requests.map((r) => [value(r)]) });
      return;
    }
    reply({
      chunk: message.chunk,
      results: message.requests.map(
        (request) =>
          ({
            weaponName: request.weapon.name,
            applicable: !request.unavailableReason,
            finalValue: value(request),
            fast: !!request.fast,
          } as BuildResult & { fast: boolean }),
      ),
    });
  }

  terminate() {}
}

const value = (request: BuildRequest) => +request.weapon.name.replace(/\D/g, "");

const noLimits = {
  maxLevels: null,
  minGainPerLevel: null,
  minRelativeGainPerLevel: null,
  runeBudget: null,
  targetValue: null,
  targetPotential: null,
  minPotentialPerRemainingLevel: null,
};

function request(name: string, extra: Partial<BuildRequest> = {}) {
  return { weapon: { name }, limits: noLimits, ...extra } as BuildRequest;
}

const names = (results: BuildResult[]) => results.map((result) => result.weaponName);
const topN = (count: number): TopN => ({
  count,
  sortBy: "total",
  reverse: false,
  perSecond: false,
});

let pool: WorkerPool;

beforeEach(() => {
  sent = [];
  FakeWorker.count = 0;
  vi.stubGlobal("Worker", FakeWorker);
  pool = new WorkerPool(3);
});

afterEach(() => {
  pool.terminate();
  vi.unstubAllGlobals();
});

describe("WorkerPool", () => {
  it("returns the results in the requests' order, shared out between the workers", async () => {
    const requests = Array.from({ length: 50 }, (_, i) => request(`w${i}`));
    const results = await pool.optimize(1, requests);
    expect(names(results)).toEqual(requests.map((r) => r.weapon.name));
    expect(new Set(sent.map(({ shard }) => shard)).size).toBe(3);
  });

  it("sends each weapon to the same worker next time", async () => {
    const requests = Array.from({ length: 6 }, (_, i) => request(`w${i}`));
    await pool.optimize(1, requests);
    const shardOf = (list: typeof sent) =>
      new Map(list.flatMap(({ shard, requests }) => requests.map((r) => [r.weapon.name, shard])));
    const first = shardOf(sent);
    sent = [];
    await pool.optimize(2, requests);
    expect(shardOf(sent)).toEqual(first);
  });

  it("resolves an empty list at once", async () => {
    expect(await pool.optimize(1, [])).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("abandons a run when a newer one starts", async () => {
    let settled = false;
    void pool.optimize(1, [request("w1"), request("w2")]).then(() => (settled = true));
    const results = await pool.optimize(2, [request("w3")]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(names(results)).toEqual(["w3"]);
    expect(settled).toBe(false);
  });

  it("puts back step times the worker leaves out", async () => {
    const stepTimes = [{ hits: [10] }] as unknown as NonNullable<
      BuildRequest["attack"]
    >["stepTimes"];
    const attack = { stepTimes } as BuildRequest["attack"];
    const [applicable, notApplicable] = await pool.optimize(1, [
      request("w1", { attack }),
      request("w2", { attack, unavailableReason: "No R1" }),
    ]);
    expect(applicable.attackStepTimes).toBe(stepTimes);
    expect(notApplicable.attackStepTimes).toBeUndefined();
  });

  describe("top N", () => {
    const requests = [
      request("w100"),
      request("w500"),
      request("w900", { unavailableReason: "No R1" }),
      request("w300"),
      request("w400"),
    ];

    it("ranks every request in fast mode, then calculates only the top ones", async () => {
      const progress: RunProgress[] = [];
      pool.onProgress = (p) => progress.push(p);
      const results = await pool.optimize(1, requests, topN(2));
      expect(names(results)).toEqual(["w500", "w400"]);
      expect(results.every((result) => !(result as BuildResult & { fast: boolean }).fast)).toBe(
        true,
      );
      const sentNames = (fast: boolean) =>
        sent
          .flatMap(({ requests }) => requests)
          .filter((r) => !!r.fast === fast)
          .map((r) => r.weapon.name)
          .sort();
      expect(sentNames(true)).toEqual(["w100", "w300", "w400", "w500", "w900"]);
      expect(sentNames(false)).toEqual(["w400", "w500"]);
      expect(progress.at(0)?.phase).toBe("ranking");
      expect(progress.at(-1)).toEqual({ phase: "calculating", done: 2, total: 2 });
    });

    it("leaves out results that aren't applicable, even with room for them", async () => {
      const results = await pool.optimize(1, requests, topN(10));
      expect(names(results)).toEqual(["w500", "w400", "w300", "w100"]);
    });

    it("sorts by the column asked for", async () => {
      const results = await pool.optimize(1, requests, { ...topN(2), reverse: true });
      expect(names(results)).toEqual(["w100", "w300"]);
    });

    it("calculates every request in one pass when fast mode wouldn't rank them the same", async () => {
      const limited = requests.map((r) => ({ ...r, limits: { ...noLimits, minGainPerLevel: 2 } }));
      const results = await pool.optimize(1, limited, topN(2));
      expect(names(results)).toEqual(["w500", "w400"]);
      expect(sent.flatMap(({ requests }) => requests)).toHaveLength(5);
      expect(sent.every(({ requests }) => requests.every((r) => !r.fast))).toBe(true);
    });

    it("calculates every request in one pass when they're all in fast mode", async () => {
      const fast = requests.map((r) => ({ ...r, fast: true }));
      const results = await pool.optimize(1, fast, topN(2));
      expect(names(results)).toEqual(["w500", "w400"]);
      expect(sent.flatMap(({ requests }) => requests)).toHaveLength(5);
    });
  });

  it("works out DPS curves on each weapon's home worker, in the requests' order", async () => {
    const requests = Array.from({ length: 10 }, (_, i) => request(`w${i}`));
    await pool.optimize(1, requests);
    const homes = new Map(
      sent.flatMap(({ shard, requests }) => requests.map((r) => [r.weapon.name, shard])),
    );
    sent = [];
    const curves = await pool.dpsCurves(requests);
    expect(curves).toEqual(requests.map((r) => [value(r)]));
    for (const { shard, requests } of sent) {
      for (const r of requests) expect(homes.get(r.weapon.name)).toBe(shard);
    }
    expect(await pool.dpsCurves([])).toEqual([]);
  });
});
