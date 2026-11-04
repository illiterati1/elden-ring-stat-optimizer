import { useEffect, useRef, useState } from "react";
import type { BuildRequest, BuildResult } from "../optimizer/build.ts";
import type { WorkerRequest, WorkerResponse } from "../optimizer/worker.ts";

/** Wait for the user to stop typing before starting a calculation */
const debounceMs = 150;

/**
 * Runs the optimizer in a web worker whenever the requests change. The worker caches the
 * expensive part of each calculation, and abandons a request as soon as a newer one arrives.
 */
export default function useBuildResults(requests: BuildRequest[]) {
  const workerRef = useRef<Worker>();
  const latestIdRef = useRef(0);
  const [results, setResults] = useState<BuildResult[]>([]);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const worker = new Worker(new URL("../optimizer/worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (evt: MessageEvent<WorkerResponse>) => {
      if (evt.data.id === latestIdRef.current) {
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
      const message: WorkerRequest = { id, requests };
      workerRef.current?.postMessage(message);
    }, debounceMs);
    return () => clearTimeout(timeout);
  }, [requests]);

  return { results, pending };
}
