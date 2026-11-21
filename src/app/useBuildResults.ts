import { useEffect, useRef, useState } from "react";
import type { BuildRequest, BuildResult } from "../optimizer/build.ts";
import { afterPickersClose, isLatestChangeFromPicker } from "./pickerChange.ts";
import WorkerPool, { getDefaultPoolSize, type RunProgress, type TopN } from "./workerPool.ts";

/**
 * Wait for the user to stop typing, spinning or ticking boxes before starting a calculation (after
 * picking from a picker, only until it's closed)
 */
const debounceMs = 300;
/**
 * The longest to wait for a picker to close, for one that stays open while several options are
 * picked (rather than holding up the page while they're picked)
 */
const pickerTimeoutMs = 1000;

/** How often the progress shown is updated, at most */
const progressIntervalMs = 200;

/**
 * The latest run's progress, for a component of its own to show (so the page doesn't render again
 * whenever some requests are answered). Updates are throttled, but the first and the last aren't.
 */
export class ProgressStore {
  private progress: RunProgress | undefined;
  private readonly listeners = new Set<() => void>();
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private lastNotified = 0;

  readonly get = () => this.progress;

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  /** @param progress none while waiting to start */
  readonly set = (progress: RunProgress | undefined) => {
    this.progress = progress;
    const now = Date.now();
    const immediate = !progress || progress.done === 0 || progress.done === progress.total;
    if (immediate || now - this.lastNotified >= progressIntervalMs) {
      this.notify();
    } else {
      this.timeout ??= setTimeout(
        () => this.notify(),
        progressIntervalMs - (now - this.lastNotified),
      );
    }
  };

  private notify() {
    clearTimeout(this.timeout);
    this.timeout = undefined;
    this.lastNotified = Date.now();
    this.listeners.forEach((listener) => listener());
  }
}

/**
 * Runs the optimizer in a pool of web workers whenever the requests change. The workers cache the
 * expensive part of each calculation, and abandon a request as soon as a newer one arrives.
 * @param poolSize how many workers to split the requests between
 * @param context anything the results are shown with that comes from the same settings as the
 * requests (e.g. the starting stats), returned with the results so it changes when they do
 * @returns the results, the requests they're for (without top N, in the same order), and the
 * context to show them with, which are behind the latest ones until they're worked out, and the
 * latest run's progress
 */
export default function useBuildResults<Context = undefined>(
  requests: BuildRequest[],
  topN?: TopN,
  poolSize = getDefaultPoolSize(),
  context?: Context,
) {
  const poolRef = useRef<WorkerPool>();
  const latestIdRef = useRef(0);
  const [{ results, resultRequests, resultContext }, setResults] = useState<{
    results: BuildResult[];
    resultRequests: BuildRequest[];
    resultContext?: Context;
  }>({ results: [], resultRequests: [] });
  const contextRef = useRef(context);
  contextRef.current = context;
  const [pending, setPending] = useState(false);
  const [progress] = useState(() => new ProgressStore());

  useEffect(
    () => () => {
      poolRef.current?.terminate();
      poolRef.current = undefined;
    },
    [poolSize, progress],
  );

  useEffect(() => {
    const id = ++latestIdRef.current;
    // No requests have no results straight away, and don't render again if there were none already
    // (e.g. the assumed stats' while there are none)
    if (!requests.length) {
      setPending(false);
      setResults((previous) =>
        !previous.results.length && previous.resultContext === contextRef.current
          ? previous
          : { results: [], resultRequests: requests, resultContext: contextRef.current },
      );
      return;
    }
    setPending(true);
    progress.set(undefined);
    const start = () => {
      // The workers start with the first requests, so a pool that's only sometimes used (the
      // assumed stats') costs nothing until then
      if (!poolRef.current) {
        poolRef.current = new WorkerPool(poolSize);
        poolRef.current.onProgress = progress.set;
      }
      void poolRef.current.optimize(id, requests, topN).then((newResults) => {
        if (id !== latestIdRef.current) return;
        // (the latest context: the requests are still the latest, so it's for the same settings)
        setResults({
          results: newResults,
          resultRequests: requests,
          resultContext: contextRef.current,
        });
        setPending(false);
      });
    };
    if (isLatestChangeFromPicker()) return afterPickersClose(start, pickerTimeoutMs);
    const timeout = setTimeout(start, debounceMs);
    return () => clearTimeout(timeout);
  }, [requests, topN, poolSize, progress]);

  // A context that changes without the requests changing applies to the results straight away
  useEffect(() => {
    setResults((previous) =>
      previous.resultRequests === requests && previous.resultContext !== context
        ? { ...previous, resultContext: context }
        : previous,
    );
    // (not the requests: new ones get the context with their results)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context]);

  return { results, resultRequests, resultContext, pending, poolRef, progress };
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
