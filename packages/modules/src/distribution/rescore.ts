"use client";
/**
 * Re-scoring the Board after channel toggles (BUILD §11.7, AC-11.7.2; audit P7).
 *
 * `distribution.recommend` is a model call (the Distribution Strategist scores all 15 channels), tens of seconds live.
 * Calling it after every toggle made each drag wait on it and ran one call per toggle. Instead:
 * - the Board shows deterministic local scores at once (`localScores`): the stored fit and potential, with the starters
 *   following the Board (channels on it first, then the best fits, 3 to 6 in all, as the API normalises them);
 * - the Strategist re-scores once, `RESCORE_DEBOUNCE_MS` after the last toggle (`useDebouncedRun`), and its answer
 *   replaces the local scores. A pending re-score still runs if the screen is left first.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChannelView } from "./channel-data";

/** How long after the last toggle the Strategist re-scores. */
export const RESCORE_DEBOUNCE_MS = 2_000;
/** Starters on a scored Board (the API's `normaliseRecommendation` keeps the same bounds). */
export const MIN_STARTERS = 3;
export const MAX_STARTERS = 6;

type Scored = Pick<ChannelView, "channelKey" | "enabled" | "fit" | "recommended" | "scored">;

/**
 * The starters right after a toggle, without a model call: every scored channel keeps its fit and potential, and the
 * recommended starters follow the Board — channels on it first (by fit), topped up to three with the best fits off it,
 * at most six. Channels never scored are left as they are. Deterministic in its input.
 */
export function localScores<V extends Scored>(views: readonly V[]): V[] {
  const ranked = views.filter((v) => v.scored).sort((a, b) => Number(b.enabled) - Number(a.enabled) || b.fit - a.fit || a.channelKey.localeCompare(b.channelKey));
  if (ranked.length === 0) return [...views];
  const onBoard = ranked.filter((v) => v.enabled).length;
  const starters = Math.max(MIN_STARTERS, Math.min(MAX_STARTERS, onBoard));
  const picked = new Set(ranked.slice(0, starters).map((v) => v.channelKey));
  return views.map((v) => (v.scored ? { ...v, recommended: picked.has(v.channelKey) } : v));
}

export interface DebouncedRun {
  /** (Re)starts the wait: the run happens `delayMs` after the last call. */
  schedule: () => void;
  /** Runs now if a run is waiting. */
  flush: () => void;
  /** Drops a waiting run. */
  cancel: () => void;
  /** True while a run is waiting. */
  pending: boolean;
}

/** Runs `fn` once, `delayMs` after the last `schedule()`. A run still waiting when the component unmounts runs then. */
export function useDebouncedRun(fn: () => unknown, delayMs: number): DebouncedRun {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(fn);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    latest.current = fn;
  });

  const clear = useCallback((): boolean => {
    const waiting = timer.current !== null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    return waiting;
  }, []);

  const cancel = useCallback(() => {
    clear();
    setPending(false);
  }, [clear]);

  const flush = useCallback(() => {
    const waiting = clear();
    setPending(false);
    if (waiting) void latest.current();
  }, [clear]);

  const schedule = useCallback(() => {
    clear();
    setPending(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setPending(false);
      void latest.current();
    }, Math.max(0, delayMs));
  }, [clear, delayMs]);

  useEffect(
    () => () => {
      if (clear()) void latest.current();
    },
    [clear],
  );

  return { schedule, flush, cancel, pending };
}
