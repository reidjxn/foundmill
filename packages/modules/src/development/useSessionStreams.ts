"use client";
/**
 * Live tile state for the Training Ground: one `AgentTileSession` per visible task, fed by `subscribe("as:<id>")`
 * through the host data source, with focus-aware throttling (the focused tile gets every event at once; the others
 * get at most four bursts a second). The focus also reaches the host's stream (`subscribe(…, { focused })`,
 * `setFocus`), so under backpressure the server sheds the tiles nobody is watching first. Events are kept per session
 * so the scrubber can replay them; what a session streamed before the tab subscribed is `ingest`ed from its replay
 * (the stream only carries what is published after the subscription), and a live session whose stream is still empty
 * after that is `queued`: no worker has picked it up yet.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applySessionEvent, eventsUntil, type AgentSessionEvent, type AgentTileSession, type SessionSeed } from "@foundmill/dugout";
import { useWidgetData } from "@foundmill/widgets/data";
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
  /**
   * Seed extra events (a replay response, a recording) for a session. `streamEmpty`: the replay read the session's
   * stream and found nothing, so until an event arrives the running session is queued for a worker.
   */
  ingest: (sessionId: string, events: readonly unknown[], opts?: { streamEmpty?: boolean }) => void;
}

/** One key per distinct event: the same event from the replay and the live stream is kept once. */
const eventKey = (e: AgentSessionEvent) => JSON.stringify(e);

/**
 * The task row's stored state is the floor and the stream is applied on top: a tab that opens mid-session (or a
 * replay scrubbed before the first progress tick) still shows the stored progress, phase and ETA rather than zero.
 */
function rebuild(source: TileSource, events: readonly AgentSessionEvent[], queued = false): AgentTileSession {
  const state = events.reduce(applySessionEvent, baseSession(source.seed, source.task, source.session));
  return queued && events.length === 0 && state.status === "running" ? { ...state, queued: true } : state;
}

export function useSessionStreams(sources: readonly TileSource[], focusedId: string | null, opts: { flushMs?: number } = {}): SessionStreams {
  const { subscribe, setFocus } = useWidgetData();
  const eventsRef = useRef(new Map<string, AgentSessionEvent[]>());
  /** The keys of every event kept per session, so a burst is de-duplicated without re-reading the whole history. */
  const keysRef = useRef(new Map<string, Set<string>>());
  const sourcesRef = useRef(new Map<string, TileSource>());
  /** Sessions whose replay found an empty stream (queued until their first event). */
  const emptyRef = useRef(new Set<string>());
  const focusedRef = useRef(focusedId);
  focusedRef.current = focusedId;
  const [byId, setById] = useState<Map<string, AgentTileSession>>(() => new Map());

  const sourceKey = sources
    .map((s) => `${s.seed.id}|${s.task.status}|${s.task.progress ?? ""}|${s.task.phase ?? ""}|${s.seed.agent.id}|${s.seed.agent.name}|${s.seed.agent.model}|${s.seed.tokens ?? 0}|${s.seed.cost?.amountMinor ?? 0}|${s.task.title}`)
    .join("\n");

  // Rebuild every tile when the rows change (refetch, agent names arriving), keeping the events seen so far.
  useEffect(() => {
    sourcesRef.current = new Map(sources.map((s) => [s.seed.id, s]));
    setById(new Map(sources.map((s) => [s.seed.id, rebuild(s, eventsRef.current.get(s.seed.id) ?? [], emptyRef.current.has(s.seed.id))])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  /** The events not kept yet for a session (the replay and the live stream overlap), recorded as kept. */
  const keep = useCallback((sessionId: string, events: readonly AgentSessionEvent[]): AgentSessionEvent[] => {
    let keys = keysRef.current.get(sessionId);
    if (!keys) keysRef.current.set(sessionId, (keys = new Set()));
    const fresh: AgentSessionEvent[] = [];
    for (const e of events) {
      const key = eventKey(e);
      if (keys.has(key)) continue;
      keys.add(key);
      fresh.push(e);
    }
    return fresh;
  }, []);

  const deliver = useCallback((sessionId: string, events: AgentSessionEvent[]) => {
    const fresh = keep(sessionId, events);
    if (!fresh.length) return;
    const list = eventsRef.current.get(sessionId) ?? [];
    list.push(...fresh);
    eventsRef.current.set(sessionId, list);
    emptyRef.current.delete(sessionId);
    setById((prev) => {
      const source = sourcesRef.current.get(sessionId);
      const current = prev.get(sessionId) ?? (source ? baseSession(source.seed, source.task, source.session) : null);
      if (!current) return prev;
      const next = new Map(prev);
      // The first event means a worker has the session: it is no longer queued.
      next.set(sessionId, fresh.reduce(applySessionEvent, { ...current, queued: false }));
      return next;
    });
  }, [keep]);

  const throttle = useMemo(() => new SessionThrottle(deliver, { flushMs: opts.flushMs }), [deliver, opts.flushMs]);
  useEffect(() => () => throttle.dispose(), [throttle]);
  useEffect(() => {
    throttle.focus(focusedId);
  }, [throttle, focusedId]);

  // One subscription per real session id on screen, marked focused only for the focused tile.
  const subscribedIds = sources.map((s) => s.seed.id).filter((id) => !isPlaceholderSessionId(id));
  const subKey = subscribedIds.join("|");
  useEffect(() => {
    const unsubs = subKey
      ? subKey.split("|").map((id) =>
          subscribe(
            `as:${id}`,
            (raw) => {
              const event = readSessionEvent(raw);
              if (event) throttle.push(id, event);
            },
            { focused: id === focusedRef.current },
          ),
        )
      : [];
    return () => {
      for (const u of unsubs) u();
    };
  }, [subscribe, subKey, throttle]);
  // Focus moves without resubscribing: the stream is told which tile is watched now.
  useEffect(() => {
    if (!setFocus || !subKey) return;
    for (const id of subKey.split("|")) setFocus(`as:${id}`, id === focusedId);
  }, [setFocus, subKey, focusedId]);

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
    (sessionId: string, raw: readonly unknown[], o: { streamEmpty?: boolean } = {}) => {
      const events = raw.map(readSessionEvent).filter((e): e is AgentSessionEvent => e !== null);
      const before = eventsRef.current.get(sessionId) ?? [];
      const fresh = keep(sessionId, events);
      const wasEmpty = emptyRef.current.has(sessionId);
      if (o.streamEmpty && before.length === 0 && fresh.length === 0) emptyRef.current.add(sessionId);
      else emptyRef.current.delete(sessionId);
      if (!fresh.length && wasEmpty === emptyRef.current.has(sessionId)) return;
      const list = [...before, ...fresh].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      eventsRef.current.set(sessionId, list);
      const source = sourcesRef.current.get(sessionId);
      if (source) setById((prev) => new Map(prev).set(sessionId, rebuild(source, list, emptyRef.current.has(sessionId))));
    },
    [keep],
  );

  const sessions = useMemo(() => sources.map((s) => byId.get(s.seed.id)).filter((s): s is AgentTileSession => !!s), [sources, byId]);

  return { sessions, byId, eventsFor, replayAt, ingest };
}
