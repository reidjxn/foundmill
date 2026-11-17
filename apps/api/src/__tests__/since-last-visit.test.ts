/** today.sinceLastVisit (retention plan, 2026-11-11): what happened between the founder's previous session and now. */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "since-last-visit" });
}, 120_000);
afterAll(() => hz.close());

describe("today.sinceLastVisit", () => {
  it("is null on a first session, then counts what arrived since the previous one", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const member = hz.caller({ userId: hz.A.memberId });
    await member.founder.presence.ping({ businessId: hz.A.businessId });
    expect(await member.today.sinceLastVisit({ businessId: hz.A.businessId })).toBeNull();
    // Today's tour waits for a second session (WP-04 T7): not on the first.
    expect((await member.today.visit({ businessId: hz.A.businessId })).returning).toBe(false);
    // The owner's previous session ended three hours ago; a decision arrived since; they come back now.
    const earlier = new Date(Date.now() - 3 * 3_600_000);
    await repos.presence.ping(hz.db, hz.A.businessId, hz.A.ownerId, { now: earlier });
    await repos.inbox.createItem(hz.db, hz.A.businessId, { type: "decision", blocks_continue: false, from_agent_id: hz.A.agentId, subject: "Pick a name", body_md: "Two options.", status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: { options: [{ id: "a", label: "Call it Brightside", recommended: true, consequence: "The team uses the name everywhere.", cost_minor: 0, reversible: true }, { id: "b", label: "Keep looking", recommended: false, consequence: "The team suggests more names.", cost_minor: 0, reversible: true }], free_text: true, expires_at: null }, source_event_ids: [], entity_ids: [] });
    expect(await owner.founder.presence.ping({ businessId: hz.A.businessId })).toMatchObject({ newSession: true, previousSeenAt: earlier.toISOString() });
    const since = await owner.today.sinceLastVisit({ businessId: hz.A.businessId });
    expect((await owner.today.visit({ businessId: hz.A.businessId })).returning).toBe(true);
    expect(since).toMatchObject({ since: earlier.toISOString(), wins: 0 });
    // The fixture's own open decision arrived after the earlier session too.
    expect(since!.newDecisions).toBeGreaterThanOrEqual(1);
  });

  it("counts the accounts that arrived through this project's page for the founder credited, and only them (WP-12 T3, D1)", async () => {
    const earlier = new Date(Date.now() - 3 * 3_600_000);
    await repos.presence.ping(hz.db, hz.A.businessId, hz.A.adminId, { now: earlier });
    await repos.presence.ping(hz.db, hz.A.businessId, hz.A.ownerId, { now: earlier });
    await repos.presence.ping(hz.db, hz.B.businessId, hz.B.ownerId, { now: earlier });
    const arrive = async (tag: string, referrerUserId: string, businessId: string, slug: string) =>
      repos.attributions.record(hz.db, await hz.h.createUser(`arrived-${tag}@test.local`), { kind: "project_page", ref: slug, businessId, referrerUserId });
    await arrive("one", hz.A.adminId, hz.A.businessId, "page-a");
    await arrive("two", hz.A.adminId, hz.A.businessId, "page-a");
    await arrive("other-founder", hz.A.ownerId, hz.A.businessId, "page-a");
    await arrive("other-project", hz.A.adminId, hz.B.businessId, "page-b");

    const admin = hz.caller({ userId: hz.A.adminId });
    // Each of them comes back now: the earlier session becomes the previous one.
    await admin.founder.presence.ping({ businessId: hz.A.businessId });
    await hz.caller({ userId: hz.A.ownerId }).founder.presence.ping({ businessId: hz.A.businessId });
    await hz.caller({ userId: hz.B.ownerId }).founder.presence.ping({ businessId: hz.B.businessId });
    expect(await admin.today.sinceLastVisit({ businessId: hz.A.businessId })).toMatchObject({ arrived: 2 });
    // The other founder of the same project is credited for one; a member of another project reads nothing of it.
    expect(await hz.caller({ userId: hz.A.ownerId }).today.sinceLastVisit({ businessId: hz.A.businessId })).toMatchObject({ arrived: 1 });
    expect((await hz.caller({ userId: hz.B.ownerId }).today.sinceLastVisit({ businessId: hz.B.businessId }))?.arrived ?? 0).toBe(0);
  });

  it("a count since the previous visit leaves earlier arrivals out", async () => {
    const earlier = new Date(Date.now() + 60_000);
    const count = (since: Date) => repos.attributions.countArrivedSince(hz.db, { referrerUserId: hz.A.adminId, businessId: hz.A.businessId, since });
    expect(await count(new Date(0))).toBeGreaterThanOrEqual(2);
    expect(await count(earlier)).toBe(0);
  });
});
