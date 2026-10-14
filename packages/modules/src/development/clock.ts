"use client";
/**
 * The clock live tiles read (VSOAK2-X1): elapsed time and ETA are derived at render time, so without a tick they freeze
 * between refetches and stream events. One shared tick per screen, every `intervalMs`, only while `enabled` (something
 * is live) and the tab is visible. A fixed time (tests, stories) wins and never ticks.
 */
import { useEffect, useState } from "react";

export const CLOCK_TICK_MS = 1_000;

export function useNow({ enabled, fixed, intervalMs = CLOCK_TICK_MS }: { enabled: boolean; fixed?: Date; intervalMs?: number }): Date {
  const [now, setNow] = useState(() => fixed ?? new Date());
  useEffect(() => {
    if (fixed || !enabled || typeof document === "undefined") return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const start = () => {
      if (timer !== null) return;
      setNow(new Date());
      timer = setInterval(() => setNow(new Date()), intervalMs);
    };
    const onVisibility = () => (document.visibilityState === "hidden" ? stop() : start());
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fixed, enabled, intervalMs]);
  return fixed ?? now;
}
