import { describe, expect, it } from "vitest";
import { EVENT_TYPES, isAccountEventType } from "./constants";
import { EVENT_WALLS, eventAsSeenBy, eventWallOf, redactEventPayload } from "./event-walls";
import type { SectionMembership } from "./permissions";

const COLLABORATOR: SectionMembership = { role: "collaborator", sectionPermissions: {} };
const OWNER: SectionMembership = { role: "owner", sectionPermissions: {} };
const MEMBER: SectionMembership = { role: "member", sectionPermissions: {} };
const FINANCE_WALLED_MEMBER: SectionMembership = { role: "member", sectionPermissions: { finance: "none" } };

/** The Finance fields of the event types a collaborator reads (the follow-up list of the events walls, Nov 14, 2026). */
const FINANCE_FIELDS: { type: string; payload: Record<string, unknown>; gone: string[]; kept: string[] }[] = [
  { type: "customer.converted", payload: { conversionId: "c", amount: { amountMinor: 4900, currency: "EUR" }, acquisitionCost: { amountMinor: 1200, currency: "EUR" } }, gone: ["amount", "acquisitionCost"], kept: ["conversionId"] },
  { type: "cycle.started", payload: { cycleId: "c", cycleNumber: 3, budget: { amountMinor: 500, currency: "USD" } }, gone: ["budget"], kept: ["cycleId", "cycleNumber"] },
  { type: "cycle.completed", payload: { cycleId: "c", outcome: "completed", cost: { amountMinor: 120, currency: "USD" } }, gone: ["cost"], kept: ["cycleId", "outcome"] },
  { type: "cycle.run_ended", payload: { runId: "r", reason: "done", rounds: 2, cost: { amountMinor: 40, currency: "USD" } }, gone: ["cost"], kept: ["runId", "rounds"] },
  { type: "task.completed", payload: { taskId: "t", cost: { amountMinor: 30, currency: "USD" }, summary: "Spent $30" }, gone: ["cost", "summary"], kept: ["taskId"] },
  { type: "approval.requested", payload: { approvalId: "a", amount: { amountMinor: 9900, currency: "EUR" }, summary: "Pay €99" }, gone: ["amount", "summary"], kept: ["approvalId"] },
  { type: "goal.proposed", payload: { goalId: "g", metricKind: "revenue_month", targetValue: 100000 }, gone: ["targetValue"], kept: ["goalId", "metricKind"] },
  { type: "goal.approved", payload: { goalId: "g", targetValue: 100000, startValue: 2000 }, gone: ["targetValue", "startValue"], kept: ["goalId"] },
  { type: "goal.achieved", payload: { goalId: "g", targetValue: 100000, achievedValue: 120000 }, gone: ["targetValue", "achievedValue"], kept: ["goalId"] },
  { type: "inbox.item_created", payload: { inboxItemId: "i", subject: "Cash is €2,000", cost: { amountMinor: 3, currency: "USD" } }, gone: ["subject", "cost"], kept: ["inboxItemId"] },
];

describe("event walls (one table for the stream and the api)", () => {
  it("files every business event type, and no account event", () => {
    const business = EVENT_TYPES.filter((t) => !isAccountEventType(t)).sort();
    expect(Object.keys(EVENT_WALLS).sort()).toEqual(business);
    expect(eventWallOf("cycle.completed")).toBe(EVENT_WALLS["cycle.completed"]);
    expect(eventWallOf("no.such_type")).toBeUndefined();
    expect(eventWallOf(null)).toBeUndefined();
  });

  it("takes every Finance field of the events a collaborator reads out for a collaborator, and nothing else", () => {
    for (const { type, payload, gone, kept } of FINANCE_FIELDS) {
      const seen = eventAsSeenBy(COLLABORATOR, { id: "e", type, payload });
      for (const f of gone) expect(seen.payload, `${type}.${f}`).not.toHaveProperty(f);
      for (const f of kept) expect(seen.payload, `${type}.${f}`).toHaveProperty(f, payload[f]);
      expect(seen.redacted, type).toContain("finance");
      expect(seen.id).toBe("e");
    }
  });

  it("an owner and a member with Finance read get every event as it was; a member walled off Finance does not", () => {
    for (const { type, payload, gone } of FINANCE_FIELDS) {
      for (const m of [OWNER, MEMBER]) {
        const seen = eventAsSeenBy(m, { type, payload });
        expect(seen.payload, type).toBe(payload);
        expect(seen.redacted).toEqual([]);
      }
      const walled = eventAsSeenBy(FINANCE_WALLED_MEMBER, { type, payload });
      for (const f of gone) expect(walled.payload, `${type}.${f}`).not.toHaveProperty(f);
    }
  });

  it("removes a nested path and keeps its siblings, without touching the stored payload", () => {
    const payload = { agentId: "a", to: "paused", signals: { budgetRemaining: 0, loopDetected: false } };
    const out = redactEventPayload("agent.health_changed", payload, ["finance"]);
    expect(out.payload).toEqual({ agentId: "a", to: "paused", signals: { loopDetected: false } });
    expect(out.redacted).toEqual(["finance"]);
    expect(payload.signals).toHaveProperty("budgetRemaining", 0);
  });

  it("answers the payload itself when nothing was there to hide, or the type is unknown", () => {
    const payload = { cycleId: "c", outcome: "completed" };
    expect(redactEventPayload("cycle.completed", payload, new Set(["finance"] as const))).toEqual({ payload, redacted: [] });
    expect(redactEventPayload("cycle.completed", payload, new Set(["finance"] as const)).payload).toBe(payload);
    expect(redactEventPayload("no.such_type", { amount: 1 }, ["finance"]).payload).toEqual({ amount: 1 });
    // Free text behind both walls: gone once, under the wall that came first.
    expect(redactEventPayload("task.blocked", { detail: "x" }, ["finance", "crm"])).toEqual({ payload: {}, redacted: ["finance"] });
    expect(redactEventPayload("task.blocked", { detail: "x" }, ["crm"])).toEqual({ payload: {}, redacted: ["crm"] });
  });
});
