/**
 * repos.recordings (0053, audit #233): a finished session's events saved from its Redis stream. One row per session,
 * replaced on a later save; written by the service role, read by members of the business only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import type { SessionRecordingEntry } from "../../schema";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("recordings");
});
afterAll(() => r?.close());

const note = (id: string, text: string): SessionRecordingEntry => ({ id, event: { kind: "note", at: "2026-10-12T09:00:00.000Z", level: "info", source: "agent", text } });

describe("repos.recordings", () => {
  it("saves the stream's entries with their count and size, and a later save replaces them", async () => {
    const first = await r.svc((tx) => repos.recordings.save(tx, r.A.businessId, r.A.sessionId, { events: [note("1-0", "Started")] }));
    expect(first).toMatchObject({ businessId: r.A.businessId, sessionId: r.A.sessionId, eventCount: 1, truncated: false });
    expect(first.bytes).toBe(Buffer.byteLength(JSON.stringify([note("1-0", "Started")]), "utf8"));

    const again = await r.svc((tx) => repos.recordings.save(tx, r.A.businessId, r.A.sessionId, { events: [note("1-0", "Started"), note("2-0", "Resumed after the pause")], truncated: true }));
    expect(again.id).toBe(first.id);
    expect(again).toMatchObject({ eventCount: 2, truncated: true });
    expect((await r.svc((tx) => repos.recordings.get(tx, r.A.businessId, r.A.sessionId)))?.events.map((e) => e.id)).toEqual(["1-0", "2-0"]);
  });

  it("is scoped to the business: B's id does not reach A's session, and B's members cannot read A's recording", async () => {
    await expect(r.svc((tx) => repos.recordings.save(tx, r.B.businessId, r.A.sessionId, { events: [note("9-0", "Overwrite")] }))).rejects.toThrow(/not found/i);
    expect(await r.svc((tx) => repos.recordings.get(tx, r.B.businessId, r.A.sessionId))).toBeNull();
    expect(await r.as(r.B.ownerId, (tx) => repos.recordings.get(tx, r.A.businessId, r.A.sessionId))).toBeNull();
    expect((await r.as(r.A.viewerId, (tx) => repos.recordings.get(tx, r.A.businessId, r.A.sessionId)))?.eventCount).toBe(2);
    // Members read; only services write.
    await expect(r.as(r.A.ownerId, (tx) => repos.recordings.save(tx, r.A.businessId, r.A.sessionId, { events: [] }))).rejects.toThrow(/row-level security|permission denied/);
  });
});
