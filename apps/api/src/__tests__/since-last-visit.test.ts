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
    // The owner's previous session ended three hours ago; a decision arrived since; they come back now.
    const earlier = new Date(Date.now() - 3 * 3_600_000);
    await repos.presence.ping(hz.db, hz.A.businessId, hz.A.ownerId, { now: earlier });
    await repos.inbox.createItem(hz.db, hz.A.businessId, { type: "decision", blocks_continue: false, from_agent_id: hz.A.agentId, subject: "Pick a name", body_md: "Two options.", status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: { options: [{ id: "a", label: "Call it Brightside", recommended: true, consequence: "The team uses the name everywhere.", cost_minor: 0, reversible: true }, { id: "b", label: "Keep looking", recommended: false, consequence: "The team suggests more names.", cost_minor: 0, reversible: true }], free_text: true, expires_at: null }, source_event_ids: [], entity_ids: [] });
    expect(await owner.founder.presence.ping({ businessId: hz.A.businessId })).toMatchObject({ newSession: true, previousSeenAt: earlier.toISOString() });
    const since = await owner.today.sinceLastVisit({ businessId: hz.A.businessId });
    expect(since).toMatchObject({ since: earlier.toISOString(), wins: 0 });
    // The fixture's own open decision arrived after the earlier session too.
    expect(since!.newDecisions).toBeGreaterThanOrEqual(1);
  });
});
