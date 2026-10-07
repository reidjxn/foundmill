"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRng } from "../../lib/seed";
import { mockSessions } from "./mock";
import { applySessionEvent, emptySession } from "./progress";
import type { AgentSessionEvent, AgentTileSession } from "./types";

export interface LiveMockOptions {
  /** Tick interval in ms (default 400). */
  intervalMs?: number;
  /** Story clock start; elapsed and ETA labels are computed against it. */
  startClock?: Date;
  /** Probability that a given session advances on a tick (default 0.55), so tiles stream at different rates. */
  advanceChance?: number;
  running?: boolean;
  seed?: string;
}

export interface LiveMockState {
  sessions: AgentTileSession[];
  /** The story clock (advances with the ticks). */
  now: Date;
  /** Full scripts, for the scrubber. */
  scripts: Array<{ events: AgentSessionEvent[]; startedAt: string }>;
  reset: () => void;
}

/**
 * Drives `n` mock sessions from their recorded scripts with a `setInterval`, for stories and the dev-only Simulate
 * panel (AC-11.6.1 rehearsal: 16 tiles streaming). Deterministic for a given seed.
 */
export function useLiveMockSessions(n: number, opts: LiveMockOptions = {}): LiveMockState {
  const { intervalMs = 400, advanceChance = 0.55, running = true, seed = "live" } = opts;
  const startClock = useMemo(() => opts.startClock ?? new Date("2026-10-07T09:30:00Z"), [opts.startClock]);
  const scripts = useMemo(() => mockSessions(n, startClock), [n, startClock]);
  const cursors = useRef<number[]>([]);
  const rng = useRef(createRng(seed));
  const build = useCallback(() => scripts.map(({ seed: s }) => emptySession(s)), [scripts]);
  const [sessions, setSessions] = useState<AgentTileSession[]>(build);
  const [now, setNow] = useState(startClock);

  const reset = useCallback(() => {
    cursors.current = scripts.map(() => 0);
    rng.current = createRng(seed);
    setSessions(build());
    setNow(startClock);
  }, [scripts, seed, build, startClock]);

  useEffect(() => {
    reset();
  }, [reset]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setSessions((prev) =>
        prev.map((session, i) => {
          const script = scripts[i];
          const cursor = cursors.current[i] ?? 0;
          if (!script || cursor >= script.events.length) return session;
          if (rng.current.next() > advanceChance) return session;
          // Burst: stdout lines arrive a few at a time.
          let next = session;
          let c = cursor;
          let steps = 1;
          while (steps > 0 && c < script.events.length) {
            const e = script.events[c] as AgentSessionEvent;
            next = applySessionEvent(next, e);
            c++;
            steps = e.kind === "stdout" && rng.current.bool(0.6) ? steps : steps - 1;
          }
          cursors.current[i] = c;
          return next;
        }),
      );
      setNow((d) => new Date(d.getTime() + intervalMs * 6));
    }, intervalMs);
    return () => clearInterval(id);
  }, [running, intervalMs, advanceChance, scripts]);

  return { sessions, now, scripts: scripts.map((s) => ({ events: s.events, startedAt: s.seed.startedAt })), reset };
}
