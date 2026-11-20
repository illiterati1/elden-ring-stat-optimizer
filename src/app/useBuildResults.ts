import { useEffect, useRef, useState } from "react";
import type { BuildRequest, BuildResult } from "../optimizer/build.ts";
import WorkerPool, { getDefaultPoolSize, type TopN } from "./workerPool.ts";

/** Wait for the user to stop typing before starting a calculation */
const debounceMs = 300;

/**
 * Runs the optimizer in a pool of web workers whenever the requests change. The workers cache the
 * expensive part of each calculation, and abandon a request as soon as a newer one arrives.
 * @param poolSize how many workers to split the requests between
 * @returns the results, and the requests they're for (without top N, in the same order), which
 * are behind the latest requests until they're worked out
 */
export default function useBuildResults(
  requests: BuildRequest[],
  topN?: TopN,
  poolSize = getDefaultPoolSize(),
) {
  const poolRef = useRef<WorkerPool>();
  const latestIdRef = useRef(0);
  const [{ results, resultRequests }, setResults] = useState<{
    results: BuildResult[];
    resultRequests: BuildRequest[];
  }>({ results: [], resultRequests: [] });
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const pool = new WorkerPool(poolSize);
    poolRef.current = pool;
    return () => pool.terminate();
  }, [poolSize]);

  useEffect(() => {
    const id = ++latestIdRef.current;
    setPending(true);
    const timeout = setTimeout(() => {
      void poolRef.current?.optimize(id, requests, topN).then((newResults) => {
        if (id !== latestIdRef.current) return;
        setResults({ results: newResults, resultRequests: requests });
        setPending(false);
      });
    }, debounceMs);
    return () => clearTimeout(timeout);
  }, [requests, topN, poolSize]);

  return { results, resultRequests, pending, poolRef };
}

/**
 * Asks the build results' workers for the damage per second at every level of some requests (the
 * charted weapons', with DPS shown), since it takes a while for each. Their curves are usually
 * cached already, from the results.
 * @returns each request's DPS by level in the same order (once worked out), if its attack's timing
 * is known
 */
export function useDpsCurves(
  poolRef: ReturnType<typeof useBuildResults>["poolRef"],
  requests: BuildRequest[],
) {
  const latestIdRef = useRef(0);
  const [dpsCurves, setDpsCurves] = useState<{
    requests: BuildRequest[];
    curves: (number[] | undefined)[];
  }>({ requests: [], curves: [] });

  useEffect(() => {
    const dpsId = ++latestIdRef.current;
    if (requests.length === 0) return;
    void poolRef.current?.dpsCurves(requests).then((curves) => {
      if (dpsId === latestIdRef.current) setDpsCurves({ requests, curves });
    });
  }, [poolRef, requests]);

  return dpsCurves;
}
