/**
 * The tool scout's memory (0154; founder, Nov 22, 2026): a need is raised once per project per category, never when
 * the project already has a tool for it, never again while the founder holds the recommendation or has accepted one,
 * and never before the day a "Not now" names. Needs are raised at their stage, not before.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { raiseStageToolNeeds } from "../../tool-needs";
import { createBusinessFixture, type BusinessFixture } from "../rls/fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
const NOW = new Date("2026-11-22T12:00:00Z");
const covers = (category: string) => (category === "payments" ? ["stripe"] : []);
const toolTasks = async (businessId: string) => (await h.db.select().from(s.tasks).where(eq(s.tasks.businessId, businessId))).filter((t) => t.kind === "tool_need");

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "scout-a");
  B = await createBusinessFixture(h, "scout-b");
});
afterAll(async () => h.close());

describe("raising a tool need", () => {
  it("creates one task for the Chief of Staff, and a second raise of the same category creates none", async () => {
    const first = await repos.toolNeeds.raise(h.db, A.businessId, { category: "sms", reason: "I could not text the customer a reminder.", raisedByAgentId: A.agentId, now: NOW });
    expect(first.raised).toBe(true);
    if (!first.raised) return;
    expect(first.task).toMatchObject({ kind: "tool_need", status: "ready", assigneeAgentId: A.agentId });
    expect(first.task.title).toBe("Find the right tool for text messages");
    const again = await repos.toolNeeds.raise(h.db, A.businessId, { category: "sms", reason: "Still no way to text.", now: NOW });
    expect(again).toMatchObject({ raised: false, why: "already_open" });
    expect(await toolTasks(A.businessId)).toHaveLength(1);
    // Another project raising the same category is its own need.
    expect((await repos.toolNeeds.raise(h.db, B.businessId, { category: "sms", reason: "No way to text.", now: NOW })).raised).toBe(true);
  });

  it("raises again once the scout's task ended without a recommendation", async () => {
    const need = await repos.toolNeeds.get(h.db, A.businessId, "sms");
    await h.db.update(s.tasks).set({ status: "failed" }).where(eq(s.tasks.id, need!.taskId!));
    expect((await repos.toolNeeds.raise(h.db, A.businessId, { category: "sms", reason: "Still no way to text.", now: NOW })).raised).toBe(true);
  });

  it("recommends nothing for a project that already has a tool for the need", async () => {
    await h.db.insert(s.integrations).values({ businessId: A.businessId, connectorKey: "stripe", status: "connected" }).onConflictDoUpdate({ target: [s.integrations.businessId, s.integrations.connectorKey], set: { status: "connected", archivedAt: null } });
    const out = await repos.toolNeeds.raise(h.db, A.businessId, { category: "payments", reason: "Customers need a way to pay.", coveredBy: covers("payments"), now: NOW });
    expect(out).toMatchObject({ raised: false, why: "has_tool", need: null });
    expect(await repos.toolNeeds.get(h.db, A.businessId, "payments")).toBeNull();
  });

  it("keeps the pick, the alternatives and the sources, and does not ask again while the founder holds it or said yes", async () => {
    const item = await repos.inbox.createItem(h.db, A.businessId, { type: "update", from_agent_id: A.agentId, subject: "A tool for text messages: Twilio", body_md: "…", status_strip: [], exhibit: { kind: "none", spec_ref: null }, source_event_ids: [], entity_ids: [] });
    const need = await repos.toolNeeds.recommend(h.db, A.businessId, "sms", {
      pick: { name: "Twilio", catalogKey: "twilio", route: "api_key", why: "It texts US numbers.", whyNow: "Reminders start this week.", cost: "About $0.01 a message (Estimate).", founderSteps: "You sign up." },
      alternatives: [{ name: "Vonage", line: "Similar price, fewer countries." }],
      sources: [{ url: "https://www.twilio.com/pricing", title: "Twilio pricing" }],
      inboxItemId: item.id,
    });
    expect(need).toMatchObject({ status: "recommended", pick: { name: "Twilio" }, alternatives: [{ name: "Vonage" }] });
    expect(await repos.toolNeeds.raise(h.db, A.businessId, { category: "sms", reason: "x", now: NOW })).toMatchObject({ raised: false, why: "recommended" });
    await repos.toolNeeds.decide(h.db, A.businessId, "sms", "accepted", { now: NOW });
    expect(await repos.toolNeeds.raise(h.db, A.businessId, { category: "sms", reason: "x", now: NOW })).toMatchObject({ raised: false, why: "accepted", need: { pick: { name: "Twilio" } } });
  });

  it("after Not now, raises nothing until the day to ask again, and raises on that day", async () => {
    await repos.toolNeeds.raise(h.db, A.businessId, { category: "analytics", reason: "No way to see who comes back.", now: NOW });
    const decided = await repos.toolNeeds.decide(h.db, A.businessId, "analytics", "not_now", { now: NOW });
    expect(decided?.askAgainAt?.toISOString()).toBe("2026-12-22T12:00:00.000Z");
    const before = await toolTasks(A.businessId);
    expect(await repos.toolNeeds.raise(h.db, A.businessId, { category: "analytics", reason: "x", now: new Date("2026-12-21T12:00:00Z") })).toMatchObject({ raised: false, why: "not_now" });
    expect(await toolTasks(A.businessId)).toHaveLength(before.length);
    expect((await repos.toolNeeds.raise(h.db, A.businessId, { category: "analytics", reason: "x", now: new Date("2026-12-23T12:00:00Z") })).raised).toBe(true);
  });
});

describe("needs by stage", () => {
  it("a cleaning business is offered booking when its page is drafted, not at take charge", async () => {
    const C = await createBusinessFixture(h, "scout-cleaning");
    await h.db.execute(sql`update businesses set archetype = 'services' where id = ${C.businessId}`);
    expect(await raiseStageToolNeeds(h.db, C.businessId, "take_charge", covers, { now: NOW })).toEqual([]);
    const drafted = await raiseStageToolNeeds(h.db, C.businessId, "page_drafted", covers, { now: NOW });
    expect(drafted.map((r) => r.raised && r.need.category)).toEqual(["booking"]);
    // A second draft of the page raises nothing new.
    expect((await raiseStageToolNeeds(h.db, C.businessId, "page_drafted", covers, { now: NOW })).map((r) => r.raised)).toEqual([false]);
  });

  it("a money product's identity checks and screening wait for the first real users", async () => {
    const F = await createBusinessFixture(h, "scout-fintech");
    await repos.toolNeeds.plan(h.db, F.businessId, [
      { category: "kyc_identity", stage: "first_customers", reason: "The first real users are about to arrive." },
      { category: "aml_screening", stage: "first_customers", reason: "The first real users are about to arrive." },
    ]);
    expect(await raiseStageToolNeeds(h.db, F.businessId, "take_charge", covers, { regulated: ["payments"], now: NOW })).toEqual([]);
    expect(await raiseStageToolNeeds(h.db, F.businessId, "page_drafted", covers, { now: NOW })).toEqual([]);
    expect(await toolTasks(F.businessId)).toHaveLength(0);
    const raised = await raiseStageToolNeeds(h.db, F.businessId, "first_customers", covers, { now: NOW });
    expect(raised.filter((r) => r.raised).map((r) => r.raised && r.need.category).sort()).toEqual(["aml_screening", "kyc_identity", "payments"]);
  });
});
