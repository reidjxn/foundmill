"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STOREFRONT_SESSION_SCRIPT, type MockSessionScript } from "./mock";
import { advanceLane, initialLanes, laneSession, type ReplayConfig, type ReplayLane } from "./replay";
import type { AgentSessionEvent, AgentTileSession } from "./types";

export interface LiveMockOptions {
  /** Tick interval in ms (default 400). */
  intervalMs?: number;
  /** Story clock start; elapsed and ETA labels are computed against it. */
  startClock?: Date;
  /** Story milliseconds that pass per real millisecond (default 6): the replay runs faster than the work did. */
  speed?: number;
  /** False: one static frame (reduced motion, tests). */
  running?: boolean;
  seed?: string;
  /**
   * Fraction (0–1) of each tile's first session already played when the replay starts or resets, staggered per tile, so
   * the tiles open mid-session (terminal lines, plan progress) and in different phases instead of empty. Default 0.
   */
  prefill?: number;
  /** What the sessions work on. Default: the storefront script. */
  script?: MockSessionScript;
  /** Keep replaying (default true): when a session ends, its agent picks up the next task. False: tiles stop at their session's end. */
  loop?: boolean;
  /** Real ms a finished session stays on its done state before the agent picks up its next task (default 5000). */
  settleMs?: number;
  /** Real ms a session waiting for a founder decision stays before the agent parks it and moves on (default 12000). */
  waitMs?: number;
}

export interface LiveMockState {
  sessions: AgentTileSession[];
  /** The story clock (advances with the ticks). */
  now: Date;
  /** Each tile's current session script, for the scrubber. */
  scripts: Array<{ events: AgentSessionEvent[]; startedAt: string }>;
  reset: () => void;
}

interface ReplayState {
  lanes: ReplayLane[];
  now: number;
}

/**
 * Drives `n` live mock tiles for the landing page, stories and the dev-only Simulate panel (AC-11.6.1 rehearsal: 16
 * tiles streaming). Each tile is one agent working through its tasks on a story clock (see `replay.ts`): its own task's
 * terminal, diff, plan, notes and preview, through realistic phases, a done state that settles for a few seconds, then
 * the next task, indefinitely; the ETA counts down against the same clock, so it is never overdue. Deterministic for a
 * given seed; with `running: false` the tiles hold one static frame.
 */
export function useLiveMockSessions(n: number, opts: LiveMockOptions = {}): LiveMockState {
  const { intervalMs = 400, speed = 6, running = true, seed = "live", prefill = 0, script = STOREFRONT_SESSION_SCRIPT, loop = true, settleMs = 5000, waitMs = 12_000 } = opts;
  const startMs = (opts.startClock ?? new Date("2026-10-07T09:30:00Z")).getTime();
  const cfg = useMemo<ReplayConfig>(
    () => ({ n, script, startMs, prefill, settleMs: settleMs * speed, waitMs: waitMs * speed, loop, seed }),
    [n, script, startMs, prefill, settleMs, waitMs, speed, loop, seed],
  );
  const [state, setState] = useState<ReplayState>(() => ({ lanes: initialLanes(cfg), now: cfg.startMs }));
  const reset = useCallback(() => setState({ lanes: initialLanes(cfg), now: cfg.startMs }), [cfg]);

  // A new script (another example business) or tile count starts the replay over.
  const mountedCfg = useRef(cfg);
  useEffect(() => {
    if (mountedCfg.current === cfg) return;
    mountedCfg.current = cfg;
    reset();
  }, [cfg, reset]);

  useEffect(() => {
    if (!running) return;
    const step = intervalMs * speed;
    const id = setInterval(() => {
      setState((prev) => {
        const now = prev.now + step;
        return { now, lanes: prev.lanes.map((lane) => advanceLane(cfg, lane, now)) };
      });
    }, intervalMs);
    return () => clearInterval(id);
  }, [running, intervalMs, speed, cfg]);

  const sessions = useMemo(() => state.lanes.map((lane) => laneSession(lane, state.now)), [state]);
  const now = useMemo(() => new Date(state.now), [state.now]);
  const scripts = useMemo(() => state.lanes.map((lane) => ({ events: lane.events, startedAt: lane.seed.startedAt })), [state.lanes]);
  return { sessions, now, scripts, reset };
}
