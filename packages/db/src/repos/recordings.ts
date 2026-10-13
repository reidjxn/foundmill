/**
 * session_recordings (0053): a finished agent session's events, saved from its `as:{sessionId}` stream by the
 * orchestrator (`finishSession`) so the stream can expire and replays outlive Redis (audit 2026-10-12 #233).
 *
 * One row per session. `save` replaces the row (a session parked and resumed is saved again with every event when it
 * finishes); rows are written with the service role, members read them (`dev.sessions.replay`).
 */
import { and, eq } from "drizzle-orm";
import { sessionRecordings, type SessionRecording, type SessionRecordingEntry } from "../schema";
import { maybeOne, one, type Executor } from "./_shared";

export interface SaveRecordingInput {
  /** The stream's entries in order. */
  events: SessionRecordingEntry[];
  /** Some long output was cut to keep the row under the size cap. */
  truncated?: boolean;
}

export const recordingsRepo = {
  async save(db: Executor, businessId: string, sessionId: string, input: SaveRecordingInput): Promise<SessionRecording> {
    const bytes = Buffer.byteLength(JSON.stringify(input.events), "utf8");
    const values = { events: input.events, eventCount: input.events.length, bytes, truncated: input.truncated ?? false };
    const rows = await db
      .insert(sessionRecordings)
      .values({ businessId, sessionId, ...values })
      .onConflictDoUpdate({ target: sessionRecordings.sessionId, set: { ...values, updatedAt: new Date() }, setWhere: eq(sessionRecordings.businessId, businessId) })
      .returning();
    return one(rows, "session recording", sessionId);
  },

  async get(db: Executor, businessId: string, sessionId: string): Promise<SessionRecording | null> {
    return maybeOne(await db.select().from(sessionRecordings).where(and(eq(sessionRecordings.businessId, businessId), eq(sessionRecordings.sessionId, sessionId))).limit(1));
  },
};
