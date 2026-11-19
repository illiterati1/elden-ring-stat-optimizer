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
 */
export default function useBuildResults(requests: BuildRequest[], topN?: TopN) {
  const workerRef = useRef<Worker>();
  const latestIdRef = useRef(0);
  const [results, setResults] = useState<BuildResult[]>([]);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const worker = new Worker(new URL("../optimizer/worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (evt: MessageEvent<WorkerResponse | DpsCurveResponse>) => {
      if ("id" in evt.data && evt.data.id === latestIdRef.current) {
        setResults(evt.data.results);
        setPending(false);
      }
    };
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  useEffect(() => {
    const id = ++latestIdRef.current;
    setPending(true);
    const timeout = setTimeout(() => {
      const message: WorkerRequest = { id, requests, ...(topN && { topN }) };
      workerRef.current?.postMessage(message);
    }, debounceMs);
    return () => clearTimeout(timeout);
  }, [requests, topN]);

  return { results, pending, workerRef };
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
