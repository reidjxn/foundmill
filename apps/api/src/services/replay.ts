/**
 * Session replays for `dev.sessions.replay` (BUILD §11.6 session scrubber).
 *
 * While a session runs, its recording is its `as:{sessionId}` stream: the orchestrator publishes every event there
 * while the agent works (ARCHITECTURE §5), so with Redis the API replays the stream in order. When the session
 * finishes the orchestrator saves the events to Postgres (`session_recordings`) and the stream expires an hour later
 * (#233), so a finished session replays from the saved copy (`saved`) first. Without either (local stack, tests) the
 * events come from the mock sandbox recording the session was played from (`agent_sessions.recording_ref`) through an
 * optional `RecordingResolver`, with `at` stamps placed on the session's own timeline. A session with none of these
 * answers with an empty list and says why.
 */
import { compareStreamIds, parseSessionEvent, readSessionEvents, type SessionEvent, type StreamRedis } from "@foundmill/events";
import type { AgentSession, SessionRecording } from "@foundmill/db";

/** One recorded event: milliseconds since session start plus a `SessionEvent` without `at` (the sandbox's `RecordedEvent`). */
export interface RecordedEventLike {
  tMs: number;
  event: Record<string, unknown> & { kind: string };
}

export interface RecordingLike {
  key: string;
  title: string;
  summary: string;
  outcome: string;
  events: readonly RecordedEventLike[];
}

/** Looks a recording up by `recording_ref`; null when unknown. Wired by `createApiDeps` when the sandbox package is resolvable. */
export type RecordingResolver = (ref: string) => Promise<RecordingLike | null>;

/** Loads the saved recording of the session (`repos.recordings.get` under the caller's RLS); null when none. */
export type SavedRecordingLoader = () => Promise<Pick<SessionRecording, "events" | "eventCount" | "truncated"> | null>;

export interface ReplayResult {
  events: SessionEvent[];
  total: number;
  source: "saved" | "stream" | "recording" | "none";
  recording: { key: string; title: string; summary: string; outcome: string } | null;
  reason: string | null;
}

export interface ReplayOptions {
  limit?: number;
  after?: string;
  kinds?: readonly SessionEvent["kind"][];
}

/** Events of a recording placed on the session's timeline (`startedAt + tMs`), invalid entries skipped. */
export function eventsFromRecording(rec: RecordingLike, startedAt: Date, opts: ReplayOptions = {}): SessionEvent[] {
  const out: SessionEvent[] = [];
  const kinds = opts.kinds ? new Set<string>(opts.kinds) : null;
  for (const r of rec.events) {
    if (kinds && !kinds.has(r.event.kind)) continue;
    try {
      out.push(parseSessionEvent({ ...r.event, at: new Date(startedAt.getTime() + r.tMs).toISOString() }));
    } catch {
      /* a recording written for an older schema keeps replaying the events that still parse */
    }
    if (opts.limit !== undefined && out.length >= opts.limit) break;
  }
  return out;
}

/** The saved entries after `opts.after` (a stream id), of `opts.kinds`, up to `opts.limit`; invalid entries skipped. */
export function eventsFromSaved(entries: readonly { id: string; event: unknown }[], opts: ReplayOptions = {}): SessionEvent[] {
  const out: SessionEvent[] = [];
  const kinds = opts.kinds ? new Set<string>(opts.kinds) : null;
  for (const entry of entries) {
    if (opts.after && compareStreamIds(entry.id, opts.after) <= 0) continue;
    if (kinds && !kinds.has((entry.event as { kind?: string } | null)?.kind ?? "")) continue;
    try {
      out.push(parseSessionEvent(entry.event));
    } catch {
      /* saved for an older schema: replay the events that still parse */
    }
    if (opts.limit !== undefined && out.length >= opts.limit) break;
  }
  return out;
}

export async function replaySession(deps: { redis: StreamRedis | null; recordings?: RecordingResolver | null; saved?: SavedRecordingLoader | null }, session: AgentSession, opts: ReplayOptions = {}): Promise<ReplayResult> {
  const saved = deps.saved ? await deps.saved() : null;
  if (saved && saved.events.length > 0) {
    return { events: eventsFromSaved(saved.events, opts), total: saved.eventCount, source: "saved", recording: null, reason: saved.truncated ? "long terminal output and diffs were cut when the session was saved" : null };
  }
  if (deps.redis) {
    try {
      const records = await readSessionEvents(deps.redis, session.id, { limit: opts.limit, after: opts.after, kinds: opts.kinds });
      if (records.length > 0 || !session.recordingRef) {
        return { events: records.map((r) => r.event), total: records.length, source: "stream", recording: null, reason: records.length === 0 ? "no events published for this session yet" : null };
      }
    } catch (err) {
      if (!session.recordingRef) return { events: [], total: 0, source: "none", recording: null, reason: `stream unavailable: ${(err as Error).message}` };
    }
  }
  if (session.recordingRef && deps.recordings) {
    const rec = await deps.recordings(session.recordingRef);
    if (rec) {
      const events = eventsFromRecording(rec, session.startedAt, opts);
      return { events, total: rec.events.length, source: "recording", recording: { key: rec.key, title: rec.title, summary: rec.summary, outcome: rec.outcome }, reason: null };
    }
    return { events: [], total: 0, source: "none", recording: null, reason: `recording ${session.recordingRef} is not bundled with this API build` };
  }
  return { events: [], total: 0, source: "none", recording: null, reason: deps.redis ? "no events published for this session" : session.recordingRef ? "no recording resolver configured (install @foundmill/sandbox for apps/api)" : "no stream and no recording for this session" };
}

/**
 * Resolve recordings from `@foundmill/sandbox` when the package is linked for the API (see docs/NEEDED_DEPS.md).
 * The specifier is a variable on purpose: the dependency is optional and must not break typecheck or boot.
 */
export function createSandboxRecordingResolver(): RecordingResolver {
  let loaded: Promise<readonly RecordingLike[] | null> | null = null;
  const load = () => {
    if (!loaded) {
      const specifier = "@foundmill/sandbox";
      loaded = import(/* @vite-ignore */ specifier)
        .then((mod: { RECORDINGS?: unknown }) => (Array.isArray(mod.RECORDINGS) ? (mod.RECORDINGS as RecordingLike[]) : null))
        .catch(() => null);
    }
    return loaded;
  };
  return async (ref) => {
    const all = await load();
    return all?.find((r) => r.key === ref) ?? null;
  };
}
