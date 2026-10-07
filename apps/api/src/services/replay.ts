/**
 * Session replays for `dev.sessions.replay` (BUILD §11.6 session scrubber).
 *
 * The recording of a session is its `as:{sessionId}` stream: the orchestrator publishes every event there while the
 * agent works (ARCHITECTURE §5), so with Redis the API replays the stream in order. Without Redis (local stack, tests)
 * the events come from the mock sandbox recording the session was played from (`agent_sessions.recording_ref`) through
 * an optional `RecordingResolver`, with `at` stamps placed on the session's own timeline. A session with neither
 * answers with an empty list and says why.
 */
import { readSessionEvents, type SessionEvent, type StreamRedis } from "@foundmill/events";
import type { AgentSession } from "@foundmill/db";
import { parseSessionEvent } from "@foundmill/events";

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

export interface ReplayResult {
  events: SessionEvent[];
  total: number;
  source: "stream" | "recording" | "none";
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

export async function replaySession(deps: { redis: StreamRedis | null; recordings?: RecordingResolver | null }, session: AgentSession, opts: ReplayOptions = {}): Promise<ReplayResult> {
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
