/**
 * Saving a finished session's recording (audit 2026-10-12 #233). The `as:{sessionId}` stream is the session's live
 * feed and, until now, its only recording: Redis runs `noeviction` and nothing removed a stream, so memory grew with
 * every session. When the session finishes, its events are copied to Postgres (`session_recordings`, read by
 * `dev.sessions.replay`) and the stream is left to expire an hour later.
 *
 * A row stays under `RECORDING_MAX_BYTES`: past the cap, terminal output and diffs are cut (the event stays, so the
 * timeline and the counts are whole) and the row says `truncated`.
 */
import { repos, type Db, type SessionRecordingEntry } from "@foundmill/db";
import { expireSessionStream, readSessionEvents, type SessionEvent, type StreamRedis } from "@foundmill/events";

/** The largest recording kept in one row (a long live session's terminal output can run to many MB). */
export const RECORDING_MAX_BYTES = 8 * 1024 * 1024;
const CUT_NOTE = "[cut: the saved recording keeps the first part of long output only]";
/** What a cut stdout chunk or diff keeps. */
const CUT_KEEP_CHARS = 2_000;

const sizeOf = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");

function cut(event: SessionEvent): SessionEvent {
  if (event.kind === "stdout" && event.text.length > CUT_KEEP_CHARS) return { ...event, text: `${event.text.slice(0, CUT_KEEP_CHARS)}\n${CUT_NOTE}` };
  if (event.kind === "file_changed" && event.diff !== null && event.diff.length > CUT_KEEP_CHARS) return { ...event, diff: `${event.diff.slice(0, CUT_KEEP_CHARS)}\n${CUT_NOTE}` };
  return event;
}

/**
 * The entries to save. Under the cap everything is kept as is; over it, long output is cut from the end of the
 * session backwards (the start of a session explains the rest) until it fits, and only if that is not enough are the
 * latest entries dropped.
 */
export function capRecording(records: readonly { id: string; event: SessionEvent }[], maxBytes = RECORDING_MAX_BYTES): { entries: SessionRecordingEntry[]; truncated: boolean } {
  const entries: SessionRecordingEntry[] = records.map((r) => ({ id: r.id, event: r.event as SessionRecordingEntry["event"] }));
  let total = sizeOf(entries);
  if (total <= maxBytes) return { entries, truncated: false };
  for (let i = entries.length - 1; i >= 0 && total > maxBytes; i--) {
    const before = sizeOf(entries[i]);
    const next = cut(records[i]!.event);
    if (next === records[i]!.event) continue;
    entries[i] = { id: records[i]!.id, event: next as SessionRecordingEntry["event"] };
    total -= before - sizeOf(entries[i]);
  }
  while (total > maxBytes && entries.length > 0) total -= sizeOf(entries.pop()) + 1;
  return { entries, truncated: true };
}

export interface ArchiveOutcome {
  saved: number;
  truncated: boolean;
  expired: boolean;
}

/**
 * Copies the stream into `session_recordings` and shortens the stream's life. Never throws: a failure leaves the
 * stream with its 14-day backstop TTL (keys.ts) and the replay keeps reading it.
 */
export async function archiveSessionRecording(deps: { db: Db; redis: StreamRedis; log?: { warn(obj: object, msg?: string): void } }, input: { businessId: string; sessionId: string }): Promise<ArchiveOutcome | null> {
  try {
    const records = await readSessionEvents(deps.redis, input.sessionId);
    // Nothing published (the stream already expired, or the session never started): keep whatever was saved before.
    if (records.length === 0) return null;
    const { entries, truncated } = capRecording(records);
    await repos.recordings.save(deps.db, input.businessId, input.sessionId, { events: entries, truncated });
    const expired = await expireSessionStream(deps.redis, input.sessionId);
    return { saved: entries.length, truncated, expired };
  } catch (err) {
    deps.log?.warn({ err: (err as Error).message, sessionId: input.sessionId }, "saving the session recording failed; the stream keeps it until its backstop TTL");
    return null;
  }
}
