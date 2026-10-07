/**
 * Live tile state for the Training Ground: one `AgentTileSession` per visible task, fed by `subscribe("as:<id>")`
 * through the host data source, with focus-aware throttling (the focused tile gets every event at once; the others
 * get at most four bursts a second). Events are kept per session so the scrubber can replay them.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applySessionEvent, eventsUntil, type AgentSessionEvent, type AgentTileSession, type SessionSeed } from "@foundmill/dugout";
import { useWidgetData } from "@foundmill/widgets";
import { SessionThrottle, baseSession, isPlaceholderSessionId, readSessionEvent } from "./session-store";
import type { SessionRow, TaskRow } from "./types";

export interface TileSource {
  seed: SessionSeed;
  task: TaskRow;
  session: SessionRow | null;
}

export interface SessionStreams {
  /** Tile state keyed by seed id, in the order of `sources`. */
  sessions: AgentTileSession[];
  byId: Map<string, AgentTileSession>;
  /** Every event seen for a session in this tab (the replay source). */
  eventsFor: (sessionId: string) => readonly AgentSessionEvent[];
  /** The tile state at `positionMs` after the session start (scrubber replay). */
  replayAt: (sessionId: string, positionMs: number) => AgentTileSession | null;
  /** Seed extra events (a replay response, a recording) for a session. */
  ingest: (sessionId: string, events: readonly unknown[]) => void;
}

/**
 * The task row's stored state is the floor and the stream is applied on top: a tab that opens mid-session (or a
 * replay scrubbed before the first progress tick) still shows the stored progress, phase and ETA rather than zero.
 */
function rebuild(source: TileSource, events: readonly AgentSessionEvent[]): AgentTileSession {
  return events.reduce(applySessionEvent, baseSession(source.seed, source.task, source.session));
}

export function useSessionStreams(sources: readonly TileSource[], focusedId: string | null, opts: { flushMs?: number } = {}): SessionStreams {
  const { subscribe } = useWidgetData();
  const eventsRef = useRef(new Map<string, AgentSessionEvent[]>());
  const sourcesRef = useRef(new Map<string, TileSource>());
  const [byId, setById] = useState<Map<string, AgentTileSession>>(() => new Map());

  const sourceKey = sources
    .map((s) => `${s.seed.id}|${s.task.status}|${s.task.progress ?? ""}|${s.task.phase ?? ""}|${s.seed.agent.id}|${s.seed.agent.name}|${s.seed.agent.model}|${s.seed.tokens ?? 0}|${s.seed.cost?.amountMinor ?? 0}|${s.task.title}`)
    .join("\n");

  // Rebuild every tile when the rows change (refetch, agent names arriving), keeping the events seen so far.
  useEffect(() => {
    sourcesRef.current = new Map(sources.map((s) => [s.seed.id, s]));
    setById(new Map(sources.map((s) => [s.seed.id, rebuild(s, eventsRef.current.get(s.seed.id) ?? [])])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  const deliver = useCallback((sessionId: string, events: AgentSessionEvent[]) => {
    const list = eventsRef.current.get(sessionId) ?? [];
    list.push(...events);
    eventsRef.current.set(sessionId, list);
    setById((prev) => {
      const source = sourcesRef.current.get(sessionId);
      const current = prev.get(sessionId) ?? (source ? baseSession(source.seed, source.task, source.session) : null);
      if (!current) return prev;
      const next = new Map(prev);
      next.set(sessionId, events.reduce(applySessionEvent, current));
      return next;
    });
  }, []);

  const throttle = useMemo(() => new SessionThrottle(deliver, { flushMs: opts.flushMs }), [deliver, opts.flushMs]);
  useEffect(() => () => throttle.dispose(), [throttle]);
  useEffect(() => {
    throttle.focus(focusedId);
  }, [throttle, focusedId]);

  // One subscription per real session id on screen.
  const subscribedIds = sources.map((s) => s.seed.id).filter((id) => !isPlaceholderSessionId(id));
  const subKey = subscribedIds.join("|");
  useEffect(() => {
    const unsubs = subKey
      ? subKey.split("|").map((id) =>
          subscribe(`as:${id}`, (raw) => {
            const event = readSessionEvent(raw);
            if (event) throttle.push(id, event);
          }),
        )
      : [];
    return () => {
      for (const u of unsubs) u();
    };
  }, [subscribe, subKey, throttle]);

  const eventsFor = useCallback((sessionId: string): readonly AgentSessionEvent[] => eventsRef.current.get(sessionId) ?? [], []);

  const replayAt = useCallback(
    (sessionId: string, positionMs: number): AgentTileSession | null => {
      const source = sourcesRef.current.get(sessionId);
      if (!source) return null;
      const events = eventsRef.current.get(sessionId) ?? [];
      return rebuild(source, eventsUntil(events, source.seed.startedAt, positionMs));
    },
    [],
  );

  const ingest = useCallback(
    (sessionId: string, raw: readonly unknown[]) => {
      const events = raw.map(readSessionEvent).filter((e): e is AgentSessionEvent => e !== null);
      if (!events.length) return;
      const seen = new Set((eventsRef.current.get(sessionId) ?? []).map((e) => `${e.at}|${e.kind}`));
      const fresh = events.filter((e) => !seen.has(`${e.at}|${e.kind}`));
      if (!fresh.length) return;
      const list = [...(eventsRef.current.get(sessionId) ?? []), ...fresh].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      eventsRef.current.set(sessionId, list);
      const source = sourcesRef.current.get(sessionId);
      if (source) setById((prev) => new Map(prev).set(sessionId, rebuild(source, list)));
    },
    [],
  );

  const sessions = useMemo(() => sources.map((s) => byId.get(s.seed.id)).filter((s): s is AgentTileSession => !!s), [sources, byId]);

  return { sessions, byId, eventsFor, replayAt, ingest };
}
