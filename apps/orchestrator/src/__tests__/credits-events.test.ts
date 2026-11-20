/**
 * The "Credits used up" pause tells the open screens (audit BILL-21): the stop writes `agent.health_changed` for every
 * agent it paused and `inbox.item_created` for the Chief of Staff's note, through the outbox in the same transaction.
 * packages/db writes the payloads by hand (it cannot depend on packages/events), so this test checks the stored rows against
 * the events catalogue (`buildEvent`) as the stream, the composer and the metrics will read them.
 */
import { bookUsage, CREDITS_EXHAUSTED_SUBJECT, repos } from "@foundmill/db";
import { buildEvent } from "@foundmill/events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "cred-ev" });
});
afterAll(async () => {
  await t?.close();
});

describe("credits used up, through the outbox", () => {
  it("writes agent.health_changed per paused agent and inbox.item_created for the note, each valid in the catalogue", async () => {
    const before = (await repos.events.list(t.db, t.businessId, { limit: 500 })).items.map((e) => e.id);
    const booked = await bookUsage(t.db, t.businessId, { agentId: t.workerId, kind: "tokens", modelKey: "sonnet", quantity: 1, costMinor: 100_000, currency: "USD", billedTo: "credits" });
    expect(booked.credits).toMatchObject({ exhausted: "now" });
    expect(booked.credits!.pausedAgents).toBeGreaterThan(0);
    expect(booked.credits!.noteId).not.toBeNull();

    const written = (await repos.events.list(t.db, t.businessId, { limit: 500 })).items.filter((e) => !before.includes(e.id));
    const health = written.filter((e) => e.type === "agent.health_changed");
    expect(health).toHaveLength(booked.credits!.pausedAgents);
    for (const e of health) expect(e.payload).toMatchObject({ to: "paused", reason: "Resting: this month's budget is used" });
    const note = written.filter((e) => e.type === "inbox.item_created");
    expect(note).toHaveLength(1);
    expect(note[0]!.payload).toMatchObject({ inboxItemId: booked.credits!.noteId, subject: CREDITS_EXHAUSTED_SUBJECT, blocksContinue: true });

    // Each stored row is a valid event of its type, and went to the outbox with it.
    for (const e of [...health, ...note]) {
      expect(() => buildEvent({ businessId: t.businessId, type: e.type as "agent.health_changed", actor: e.actor as never, entityIds: e.entityIds, payload: e.payload as never })).not.toThrow();
    }
    const pending = await repos.events.outboxPending(t.db, t.businessId, 500);
    const queued = new Set(pending.map((p) => p.eventId));
    for (const e of [...health, ...note]) expect(queued.has(e.id)).toBe(true);

    // A later charge on the empty balance repeats neither the pause nor the events.
    const again = await bookUsage(t.db, t.businessId, { agentId: t.workerId, kind: "tokens", modelKey: "sonnet", quantity: 1, costMinor: 5, currency: "USD", billedTo: "credits" });
    expect(again.credits).toMatchObject({ exhausted: "already", pausedAgents: 0 });
    const after = (await repos.events.list(t.db, t.businessId, { limit: 500 })).items.filter((e) => !before.includes(e.id) && (e.type === "agent.health_changed" || e.type === "inbox.item_created"));
    expect(after).toHaveLength(health.length + 1);
  });
});
