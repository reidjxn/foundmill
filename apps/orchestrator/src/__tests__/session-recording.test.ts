/**
 * A finished session's recording outlives its Redis stream (audit 2026-10-12 #233): `finishSession` copies the
 * `as:{sessionId}` stream into `session_recordings` and leaves the stream an hour to live, so Redis (noeviction) no
 * longer grows with every session. Oversized recordings are cut, never dropped whole.
 */
import { repos } from "@foundmill/db";
import { publishSessionEvent, readSessionEvents, SESSION_STREAM_ARCHIVED_TTL_SECONDS, sessionStreamKey, type SessionEvent } from "@foundmill/events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { archiveSessionRecording, capRecording } from "../activities/recording";
import { createSessionActivities } from "../activities/session";
import type { SessionResult } from "../activities/types";
import { openSessionRow, setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "recording" });
});
afterAll(async () => {
  await t?.close();
});

const at = "2026-10-12T09:00:00.000Z";
const stdout = (text: string): SessionEvent => ({ kind: "stdout", at, channel: "stdout", text, command: null });
const note = (text: string): SessionEvent => ({ kind: "note", at, level: "info", source: "agent", text });

describe("capRecording", () => {
  it("keeps a recording under the cap as it is", () => {
    const records = [{ id: "1-0", event: note("Started") }, { id: "2-0", event: stdout("ok") }];
    expect(capRecording(records, 10_000)).toEqual({ entries: records, truncated: false });
  });

  it("cuts long output from the end backwards and keeps every event; drops the latest only when cutting is not enough", () => {
    const big = "x".repeat(20_000);
    const records = [{ id: "1-0", event: stdout(big) }, { id: "2-0", event: note("Middle") }, { id: "3-0", event: stdout(big) }];
    const cut = capRecording(records, 25_000);
    expect(cut.truncated).toBe(true);
    expect(cut.entries.map((e) => e.id)).toEqual(["1-0", "2-0", "3-0"]);
    expect(cut.entries[0]!.event.text).toBe(big); // the start of the session is kept whole
    expect(String(cut.entries[2]!.event.text)).toMatch(/^x{2000}\n\[cut: /);
    const tiny = capRecording(records, 2_000);
    expect(tiny.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(tiny.entries))).toBeLessThanOrEqual(2_000);
    expect(tiny.entries.map((e) => e.id)).toEqual(["1-0", "2-0"].slice(0, tiny.entries.length));
  });
});

describe("archiveSessionRecording", () => {
  it("saves the stream to Postgres and leaves the stream an hour; a later call with the stream gone keeps the saved copy", async () => {
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    for (const text of ["Reading the spec", "Writing the handler", "Tests pass"]) await publishSessionEvent(t.redis, sessionId, { kind: "note", text });
    const ids = (await readSessionEvents(t.redis, sessionId)).map((r) => r.id);

    expect(await archiveSessionRecording({ db: t.db, redis: t.redis }, { businessId: t.businessId, sessionId })).toEqual({ saved: 3, truncated: false, expired: true });
    const saved = await repos.recordings.get(t.db, t.businessId, sessionId);
    expect(saved?.events.map((e) => e.id)).toEqual(ids);
    expect(saved?.events.map((e) => (e.event as { text?: string }).text)).toEqual(["Reading the spec", "Writing the handler", "Tests pass"]);
    expect(await t.redis.ttl(sessionStreamKey(sessionId))).toBe(SESSION_STREAM_ARCHIVED_TTL_SECONDS);

    await t.redis.del(sessionStreamKey(sessionId));
    expect(await archiveSessionRecording({ db: t.db, redis: t.redis }, { businessId: t.businessId, sessionId })).toBeNull();
    expect((await repos.recordings.get(t.db, t.businessId, sessionId))?.eventCount).toBe(3);
  });

  it("never fails the session: a database error leaves the stream to its backstop TTL and logs why", async () => {
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    await publishSessionEvent(t.redis, sessionId, { kind: "note", text: "Started" });
    const warned: string[] = [];
    const outcome = await archiveSessionRecording({ db: t.db, redis: t.redis, log: { warn: (_o, msg) => void warned.push(msg ?? "") } }, { businessId: crypto.randomUUID(), sessionId });
    expect(outcome).toBeNull();
    expect(warned[0]).toMatch(/saving the session recording failed/);
    expect(await t.redis.ttl(sessionStreamKey(sessionId))).toBeGreaterThan(SESSION_STREAM_ARCHIVED_TTL_SECONDS);
  });
});

describe("finishSession", () => {
  it("saves the recording of the session it settles", async () => {
    const acts = createSessionActivities(t.deps);
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const input = { businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId };
    const launch = await acts.prepareSession(input);
    await publishSessionEvent(t.redis, sessionId, { kind: "phase_changed", from: null, to: "planning" });
    await publishSessionEvent(t.redis, sessionId, { kind: "note", text: "Plan written" });
    const result: SessionResult = { outcome: "stopped", reason: "stopped by the founder", blockedReason: "stopped", approvalId: null, progress: { planStepsDone: 1, planSteps: 2, acceptanceTestsPassing: 0, acceptanceTests: 1, reviewPassed: false, merged: false, phase: "planning", progress: 0.1, etaAt: null, at: null }, eventsEmitted: 2, toolCalls: 0, toolFailures: 0, tokensIn: 0, tokensOut: 0, costMinor: 0, durationMs: 60_000, prNumber: null, summary: "stopped", providerSessionId: null };
    await acts.finishSession(input, launch, result);
    const saved = await repos.recordings.get(t.db, t.businessId, sessionId);
    expect(saved?.events.map((e) => e.event.kind)).toEqual(["phase_changed", "note"]);
    expect(await t.redis.ttl(sessionStreamKey(sessionId))).toBe(SESSION_STREAM_ARCHIVED_TTL_SECONDS);
  });
});
