/**
 * services/push/decide.ts: which events reach a phone, with which words (the mobile voice skill §7), for one reader's
 * view (amounts, customer names, how agents are named). Pure, no database.
 */
import { buildEvent, type PlatformEvent, type WriteEventInput } from "@foundmill/events";
import type { EventType } from "@foundmill/shared";
import { describe, expect, it } from "vitest";
import { expectedBackWords, isPushEventType, PUSH_EVENT_TYPES, pushPlanFor, type PushView } from "../services/push/decide";

const B = "b1e5e5e5-0000-4000-8000-00000000aa01";
const A = "a1e5e5e5-0000-4000-8000-00000000aa02";
const ID = "c1e5e5e5-0000-4000-8000-00000000aa03";
const NOW = new Date("2026-11-08T12:00:00Z");

const ev = <T extends EventType>(type: T, payload: WriteEventInput<T>["payload"]): PlatformEvent => buildEvent({ businessId: B, type, actor: { kind: "system", id: "test" }, payload, occurredAt: NOW }) as PlatformEvent;

const FULL: PushView = { amounts: true, names: true, anthropomorphic: false, agentStyle: "humans" };
const WALLED: PushView = { amounts: false, names: false, anthropomorphic: false, agentStyle: "humans" };
const agent = { name: "Juno", role: "Chief of Staff", personaKey: null, agentType: "chief_of_staff", layer: "assistant" };

describe("pushPlanFor", () => {
  it("looks only at the seven event types", () => {
    expect([...PUSH_EVENT_TYPES].sort()).toEqual(["agent.health_changed", "approval.requested", "customer.converted", "cycle.run_ended", "goal.achieved", "inbox.item_created", "runway.threshold_crossed"]);
    expect(isPushEventType("guidance.turned_off")).toBe(false);
    expect(pushPlanFor(ev("guidance.turned_off", { from: "settings", toursDone: 1, explainersSeen: 1 }))).toBeNull();
  });

  it("a decision note: 'Needs your answer', the agent named the reader's way, routed to the note", () => {
    const plan = pushPlanFor(ev("inbox.item_created", { inboxItemId: ID, type: "decision", fromAgentId: A, subject: "Approve batch 002 before the Ireland launch?", blocksContinue: false, sourceEventIds: [], cost: null }), { agent });
    expect(plan).toMatchObject({ kind: "decision", section: "inbox", data: { businessId: B, kind: "inbox", itemId: ID }, collapseKey: `inbox:${ID}` });
    expect(plan!.text(FULL)).toEqual({ title: "Needs your answer", body: "Juno: Approve batch 002 before the Ireland launch?" });
    // Without an agent on file the subject stands alone.
    expect(pushPlanFor(ev("inbox.item_created", { inboxItemId: ID, type: "decision", fromAgentId: null, subject: "Sign off the roadmap", blocksContinue: false, sourceEventIds: [], cost: null }))!.text(FULL).body).toBe("Sign off the roadmap");
  });

  it("a hard stop is told as a decision; other note types are not pushed (the customer and run events carry those)", () => {
    const stop = pushPlanFor(ev("inbox.item_created", { inboxItemId: ID, type: "warning", fromAgentId: null, subject: "Credits are used up", blocksContinue: true, sourceEventIds: [], cost: null }));
    expect(stop!.kind).toBe("decision");
    expect(stop!.text(FULL)).toEqual({ title: "The team has stopped", body: "Credits are used up" });
    for (const type of ["update", "report", "milestone", "customer_won", "human_message", "warning"] as const) {
      expect(pushPlanFor(ev("inbox.item_created", { inboxItemId: ID, type, fromAgentId: A, subject: "x", blocksContinue: false, sourceEventIds: [], cost: null })), type).toBeNull();
    }
  });

  it("a go-ahead: the summary, with the amount only for a reader who may see amounts", () => {
    const plan = pushPlanFor(ev("approval.requested", { approvalId: ID, planActionId: null, agentId: A, sessionId: null, connectorKey: "sendgrid", tool: "send_mail", amount: { amountMinor: 60000, currency: "GBP" }, reasons: ["spend_above_threshold"], policyIds: ["60-assisted"], decisionType: "spend_above_threshold", hardGate: false, summary: "Set the LinkedIn Ads budget to £600 a week", expiresAt: null }));
    expect(plan).toMatchObject({ kind: "approval", section: "inbox", data: { kind: "inbox", approvalId: ID }, collapseKey: `approval:${ID}` });
    expect(plan!.text(FULL)).toEqual({ title: "Needs your go-ahead", body: "Set the LinkedIn Ads budget to £600 a week · £600.00" });
    expect(plan!.text(WALLED).body).toBe("Set the LinkedIn Ads budget to £600 a week");
  });

  it("a customer won: the name and the amount follow the reader's walls; round-up wins are not pushed", () => {
    const base = { entityId: ID, conversionId: ID, journeyId: A, matchdayLevel: "cup" as const, nthOfKind: 3, fullMatchDay: true, captainChannelKey: "seo" as const, touchCount: 4, timeToConvertHours: 20, acquisitionCost: null };
    const paid = pushPlanFor(ev("customer.converted", { ...base, kind: "payment", amount: { amountMinor: 9600, currency: "GBP" } }), { customerName: "Bo Yun" });
    expect(paid).toMatchObject({ kind: "customer", section: "inbox", data: { kind: "journey", journeyId: A }, collapseKey: `journey:${A}` });
    expect(paid!.text(FULL)).toEqual({ title: "New customer", body: "Bo Yun just became a paying customer · £96.00" });
    expect(paid!.text(WALLED).body).toBe("A customer just became a paying customer");
    expect(paid!.text({ ...FULL, amounts: false }).body).toBe("Bo Yun just became a paying customer");
    expect(pushPlanFor(ev("customer.converted", { ...base, kind: "signup", amount: null }), { customerName: "Bo Yun" })!.text(FULL).body).toBe("Bo Yun just signed up");
    expect(pushPlanFor(ev("customer.converted", { ...base, kind: "activation", amount: null }), { customerName: "Bo Yun" })!.text(FULL).body).toBe("Bo Yun is now active");
    expect(pushPlanFor(ev("customer.converted", { ...base, kind: "payment", amount: null, fullMatchDay: false }), { customerName: "Bo Yun" })).toBeNull();
  });

  it("an agent down: expected back in words, or the reconnect line; other health changes are quiet", () => {
    const base = { agentId: A, from: "healthy" as const, reason: "rate_limited", signals: {}, sessionId: null };
    const down = pushPlanFor(ev("agent.health_changed", { ...base, to: "injured", expectedReturnAt: "2026-11-08T14:00:00Z" }), { agent, now: NOW });
    expect(down).toMatchObject({ kind: "agent_down", section: "team", data: { kind: "team", agentId: A } });
    expect(down!.text(FULL)).toEqual({ title: "Juno is down", body: "Expected back in 2 hr" });
    expect(pushPlanFor(ev("agent.health_changed", { ...base, to: "injured", expectedReturnAt: null }), { agent, now: NOW })!.text(FULL).body).toBe("Reconnect the integration to see an expected return");
    expect(pushPlanFor(ev("agent.health_changed", { ...base, to: "injured", expectedReturnAt: null }), { now: NOW })!.text(FULL).title).toBe("An agent is down");
    expect(pushPlanFor(ev("agent.health_changed", { ...base, to: "degraded", expectedReturnAt: null }), { agent })).toBeNull();
    expect(pushPlanFor(ev("agent.health_changed", { ...base, from: "injured", to: "healthy", expectedReturnAt: null }), { agent })).toBeNull();
  });

  it("runway below a threshold: months in words with Estimate, never an amount; crossing back up is quiet", () => {
    const base = { thresholdMonths: 6, cash: { amountMinor: 7_200_000, currency: "GBP" }, netBurnMonthly: { amountMinor: 900_000, currency: "GBP" }, scenario: "base" as const, blocksContinue: false };
    const plan = pushPlanFor(ev("runway.threshold_crossed", { ...base, runwayMonths: 5.6, direction: "below" }));
    expect(plan).toMatchObject({ kind: "runway", section: "finance", data: { kind: "today" }, collapseKey: "runway" });
    expect(plan!.text(FULL)).toEqual({ title: "Runway", body: "Cash lasts about 6 months at today's spending (Estimate)." });
    expect(plan!.text(FULL).body).not.toContain("£");
    expect(pushPlanFor(ev("runway.threshold_crossed", { ...base, runwayMonths: 1.2, direction: "below" }))!.text(FULL).body).toBe("Cash lasts about 1 month at today's spending (Estimate).");
    expect(pushPlanFor(ev("runway.threshold_crossed", { ...base, runwayMonths: 0.3, direction: "below" }))!.text(FULL).body).toBe("Cash lasts less than a month at today's spending (Estimate).");
    expect(pushPlanFor(ev("runway.threshold_crossed", { ...base, runwayMonths: 7, direction: "above" }))).toBeNull();
  });

  it("a run finished: how many notes are open; a goal reached: its sentence", () => {
    const run = (openNotes: number | null) => pushPlanFor(ev("cycle.run_ended", { runId: ID, reason: "done", rounds: 3, cost: { amountMinor: 414, currency: "USD" }, maxCyclesPerDay: null }), { openNotes })!.text(FULL);
    expect(run(4)).toEqual({ title: "The team finished a round", body: "4 notes in your Inbox" });
    expect(run(1).body).toBe("1 note in your Inbox");
    expect(run(0).body).toBe("Nothing new needs you");
    expect(run(null).body).toBe("Nothing new needs you");
    const goal = pushPlanFor(ev("goal.achieved", { goalId: ID, revision: 1, metricKind: "paying_customers", targetValue: 10, currency: null, dueOn: "2026-12-19", achievedValue: 10, inboxItemId: null }), { goalSentence: "Get the first 10 paying customers by Dec 19" });
    expect(goal).toMatchObject({ kind: "goal", section: "inbox", data: { kind: "today", goalId: ID } });
    expect(goal!.text(FULL)).toEqual({ title: "Goal reached", body: "Get the first 10 paying customers by Dec 19" });
  });

  it("expected-back words: minutes, hours, then a US date", () => {
    const at = (ms: number) => new Date(NOW.getTime() + ms);
    expect(expectedBackWords(at(-60_000), NOW)).toBe("any minute now");
    expect(expectedBackWords(at(5 * 60_000), NOW)).toBe("in 5 min");
    expect(expectedBackWords(at(3 * 3_600_000), NOW)).toBe("in 3 hr");
    expect(expectedBackWords(at(3 * 86_400_000), NOW)).toBe("on Nov 11");
  });
});
