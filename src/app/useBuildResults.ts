import { useEffect, useRef, useState } from "react";
import type { BuildRequest, BuildResult } from "../optimizer/build.ts";
import type {
  DpsCurveRequest,
  DpsCurveResponse,
  TopN,
  WorkerRequest,
  WorkerResponse,
} from "../optimizer/worker.ts";

/** Wait for the user to stop typing before starting a calculation */
const debounceMs = 150;

/**
 * Runs the optimizer in a web worker whenever the requests change. The worker caches the
 * expensive part of each calculation, and abandons a request as soon as a newer one arrives.
 * @returns the results, and the requests they're for (without top N, in the same order), which
 * are behind the latest requests until they're worked out
 */
export default function useBuildResults(requests: BuildRequest[], topN?: TopN) {
  const workerRef = useRef<Worker>();
  const latestIdRef = useRef(0);
  // The requests sent with the latest ID, which the results are for
  const latestRequestsRef = useRef<BuildRequest[]>([]);
  const [{ results, resultRequests }, setResults] = useState<{
    results: BuildResult[];
    resultRequests: BuildRequest[];
  }>({ results: [], resultRequests: [] });
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const worker = new Worker(new URL("../optimizer/worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (evt: MessageEvent<WorkerResponse | DpsCurveResponse>) => {
      if ("id" in evt.data && evt.data.id === latestIdRef.current) {
        setResults({ results: evt.data.results, resultRequests: latestRequestsRef.current });
        setPending(false);
      }
    };
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  useEffect(() => {
    const id = ++latestIdRef.current;
    latestRequestsRef.current = requests;
    setPending(true);
    const timeout = setTimeout(() => {
      const message: WorkerRequest = { id, requests, ...(topN && { topN }) };
      workerRef.current?.postMessage(message);
    }, debounceMs);
    return () => clearTimeout(timeout);
  }, [requests, topN]);

  return { results, resultRequests, pending, workerRef };
}

/**
 * Asks the build results' worker for the damage per second at every level of some requests (the
 * charted weapons', with DPS shown), since it takes a while for each. Their curves are usually
 * cached already, from the results.
 * @returns each request's DPS by level in the same order (once worked out), if its attack's timing
 * is known
 */
export function useDpsCurves(
  workerRef: ReturnType<typeof useBuildResults>["workerRef"],
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
    const worker = workerRef.current;
    if (!worker) return;
    const handleMessage = (evt: MessageEvent<WorkerResponse | DpsCurveResponse>) => {
      if ("dpsId" in evt.data && evt.data.dpsId === dpsId) {
        setDpsCurves({ requests, curves: evt.data.curves });
      }
    };
    worker.addEventListener("message", handleMessage);
    const message: DpsCurveRequest = { dpsId, requests };
    worker.postMessage(message);
    return () => worker.removeEventListener("message", handleMessage);
  }, [workerRef, requests]);

  return dpsCurves;
}
