"use client";
/**
 * One call at a time for a button that starts a mutation (Take charge). A guard on the mutation's `isPending` lets the
 * second click of a double click through: TanStack Query publishes the new state after the click handlers have run,
 * and httpBatchLink then sends both calls in one request. This guard is a ref, closed before the first call returns.
 * Errors are the caller's to report (the mutation's `onError`); a failed call opens the guard again.
 */
import { useCallback, useRef } from "react";

export interface SingleFlightOptions {
  /** Keep the guard closed once a call succeeded (the screen is moving on, e.g. to the new business). */
  closeOnSuccess?: boolean;
}

export function useSingleFlight<A extends unknown[]>(run: (...args: A) => Promise<unknown>, options: SingleFlightOptions = {}): (...args: A) => void {
  const inFlight = useRef(false);
  const latest = useRef(run);
  latest.current = run;
  const closeOnSuccess = options.closeOnSuccess ?? false;
  return useCallback(
    (...args: A) => {
      if (inFlight.current) return;
      inFlight.current = true;
      void (async () => {
        let succeeded = false;
        try {
          await latest.current(...args);
          succeeded = true;
        } catch {
          /* reported by the caller */
        } finally {
          if (!succeeded || !closeOnSuccess) inFlight.current = false;
        }
      })();
    },
    [closeOnSuccess],
  );
}
