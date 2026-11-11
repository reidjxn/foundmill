/**
 * business.firstWeek.get (docs/UX_AUDIT_AND_PLAN.md §6.2 FirstWeekChecklist, §7.8): one read-only flag per
 * first-week item, answered to every member under their RLS and refused to anyone else, flipping as the business
 * records what it did (the page published, a note opened, a reply to an agent, a finished cycle). A bank or Stripe is
 * not an item (docs/THESIS_REVIEW.md §5.7).
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "firstweek" });
}, 120_000);
afterAll(() => hz.close());

const FLAGS = ["conversationReplySent", "cycleCompleted", "distributionStarted", "noteRead", "pagePublished", "roadmapSignedOff", "specificationSignedOff"] as const;

describe("business.firstWeek.get", () => {
  it("answers every member with the seven flags, read from what the business records, and refuses anyone outside it", async () => {
    const { businessId } = hz.A;
    const flags = await hz.caller({ userId: hz.A.ownerId }).business.firstWeek.get({ businessId });
    expect(Object.keys(flags).sort()).toEqual([...FLAGS]);
    for (const key of FLAGS) expect(typeof flags[key], key).toBe("boolean");
    // Each flag is what the records say: the fixture started distribution on Jan 1 and has no public page; its
    // sign-off rounds, if any, are not approved; nobody has written to an agent.
    expect(flags.distributionStarted).toBe(true);
    expect(flags.pagePublished).toBe(false);
    expect(flags.cycleCompleted).toBe((await repos.events.list(hz.db, businessId, { type: "cycle.completed", limit: 1 })).items.length > 0);
    expect(flags.specificationSignedOff).toBe(false);
    expect(flags.roadmapSignedOff).toBe(false);
    expect(flags.conversationReplySent).toBe(false);
    // A viewer reads the same answer (read-only, no role wall).
    expect(await hz.caller({ userId: hz.A.viewerId }).business.firstWeek.get({ businessId })).toEqual(flags);
    // Another business's owner and a stranger learn nothing.
    await expect(hz.caller({ userId: hz.B.ownerId }).business.firstWeek.get({ businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const stranger = await hz.h.createUser("first-week-stranger@test.local");
    await expect(hz.caller({ userId: stranger }).business.firstWeek.get({ businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("flips as a note from an agent is opened, the founder writes to an agent, a cycle completes and the page is published", async () => {
    const { businessId } = hz.B;
    const owner = hz.caller({ userId: hz.B.ownerId });
    const before = await owner.business.firstWeek.get({ businessId });
    // The fixture's note is unread and nobody has opened it: a read receipt (0048) counts as "read a note".
    expect(before.noteRead).toBe(false);
    await repos.inbox.markRead(hz.db, businessId, hz.B.inboxItemId, hz.B.ownerId);
    expect((await owner.business.firstWeek.get({ businessId })).noteRead).toBe(true);
    // The founder's first message to an agent, on the fixture's own thread.
    expect(before.conversationReplySent).toBe(false);
    await repos.conversations.appendMessage(hz.db, businessId, { threadId: hz.B.agentThreadId, authorKind: "founder", authorUserId: hz.B.ownerId, bubbles: ["What should I look at first?"] });
    expect((await owner.business.firstWeek.get({ businessId })).conversationReplySent).toBe(true);
    // A finished cycle is a `cycle.completed` event.
    if (!before.cycleCompleted) {
      await repos.events.write(hz.db, businessId, { type: "cycle.completed", actor: { kind: "system", id: "orchestrator" }, payload: { cycleId: "00000000-0000-4000-8000-00000000c1c1", cycleNumber: 1, workflowId: `cycle:${businessId}:1`, outcome: "completed", tasksDispatched: 1, tasksCompleted: 1, tasksBlocked: 0, agentHours: 1, cost: { amountMinor: 10, currency: "USD" }, inboxItemIds: [], durationMs: 1000 } });
    }
    expect((await owner.business.firstWeek.get({ businessId })).cycleCompleted).toBe(true);
    // The page goes live: the first item ticks, and stays ticked once it is taken down (it was published).
    expect(before.pagePublished).toBe(false);
    const content = { pitch: "Same-day cafe shifts for students", about: "Cafes post a shift in the morning; a student picks it up by lunch.", forWhom: "", stage: "idea" as const, showFounders: false };
    await repos.pages.publish(hz.db, businessId, { content, slug: `first-week-${businessId.slice(0, 8)}`, userId: hz.B.ownerId });
    expect((await owner.business.firstWeek.get({ businessId })).pagePublished).toBe(true);
    await repos.pages.unpublish(hz.db, businessId, { userId: hz.B.ownerId });
    const after = await owner.business.firstWeek.get({ businessId });
    expect(after).toMatchObject({ noteRead: true, conversationReplySent: true, cycleCompleted: true, pagePublished: true });
    // Both sign-off rounds approved (read as the latest round of each kind, no specification versions involved).
    expect(after).toMatchObject({ specificationSignedOff: false, roadmapSignedOff: false });
    await repos.productSignoffs.seedApproved(hz.db, businessId, { spec: { at: new Date() }, roadmap: { at: new Date() } });
    expect(await owner.business.firstWeek.get({ businessId })).toMatchObject({ specificationSignedOff: true, roadmapSignedOff: true });
    // Another business's flags did not move with B's.
    const other = await hz.caller({ userId: hz.A.ownerId }).business.firstWeek.get({ businessId: hz.A.businessId });
    expect(other.conversationReplySent).toBe(false);
  });
});
