import { describe, expect, it } from "vitest";
import { confirmPlanDescription } from "../ConfirmPlanDialog";
import {
  REFRESH_DEBOUNCE_MS,
  agentIndex,
  answerLabel,
  answeredFrom,
  askChip,
  confirmationLines,
  decisionDeadline,
  decisionExpired,
  followUpLinks,
  freeTextAllowed,
  goAheadState,
  hasAgentDesk,
  hiddenNotice,
  headerDates,
  inboxTabs,
  itemIdFromPath,
  journeyForItem,
  neighbourId,
  parseInboxTab,
  planConfirmationLines,
  planStatusLine,
  previewLine,
  refreshGate,
  rowModel,
  headerTag,
  noteOpener,
  metricKey,
  parseFreeMetric,
  plainSource,
  statusStripTiles,
  stripSources,
  toDecisionOptions,
  totalCost,
} from "../logic";

const BID = "00000000-0000-4000-8000-000000000001";

describe("tabs", () => {
  it("Messages is LIVE-only and the Respond tab carries the count", () => {
    expect(inboxTabs(BID, false, { respond: 3 }).map((t) => t.id)).toEqual(["all", "respond", "customers", "updates", "archive"]);
    expect(inboxTabs(BID, true, {}).map((t) => t.id)).toContain("messages");
    expect(inboxTabs(BID, false, { respond: 3 }).find((t) => t.id === "respond")?.badge).toBe(3);
    expect(inboxTabs(BID, false, {})[0]!.href).toBe(`/b/${BID}/inbox`);
    expect(inboxTabs(BID, false, {})[1]!.href).toBe(`/b/${BID}/inbox?tab=respond`);
  });
  it("parses the tab from the query, falling back to All (and off Messages when not LIVE)", () => {
    expect(parseInboxTab("respond", false)).toBe("respond");
    expect(parseInboxTab("messages", false)).toBe("all");
    expect(parseInboxTab("messages", true)).toBe("messages");
    expect(parseInboxTab("nope", false)).toBe("all");
    expect(parseInboxTab(null, false)).toBe("all");
  });
  it("reads the selected item from the pathname", () => {
    expect(itemIdFromPath(`/b/${BID}/inbox/abc-1`)).toBe("abc-1");
    expect(itemIdFromPath(`/b/${BID}/inbox`)).toBeNull();
    expect(itemIdFromPath(`/b/${BID}/inbox/abc-1?tab=respond`)).toBe("abc-1");
    expect(itemIdFromPath(null)).toBeNull();
  });
});

describe("rows (DESIGN §9)", () => {
  const base = { id: "i1", subject: "Approve the launch budget", bodyMd: "We need **€500** for [[ent:00000000-0000-4000-8000-00000000aaaa|LinkedIn]] ads. Why: CPA is low.", fromAgentId: "a1", createdAt: "2026-10-07T10:00:00.000Z" };
  it("strips entity markup and markdown for the preview and stops at the first sentence", () => {
    expect(previewLine(base.bodyMd)).toBe("We need €500 for LinkedIn ads.");
    expect(previewLine("x".repeat(200))).toHaveLength(120);
  });
  it("red dot for unanswered decisions, gold edge for won customers, nothing once answered", () => {
    expect(rowModel({ ...base, type: "decision", state: "unread", blocksContinue: true })).toMatchObject({ needsAnswer: true, won: false, unread: true, tone: "bad" });
    expect(rowModel({ ...base, type: "customer_won", state: "read", blocksContinue: true })).toMatchObject({ needsAnswer: true, won: true, unread: false });
    expect(rowModel({ ...base, type: "decision", state: "answered", blocksContinue: true }).needsAnswer).toBe(false);
    expect(rowModel({ ...base, type: "update", state: "unread", blocksContinue: false })).toMatchObject({ needsAnswer: false, tone: "info", typeWord: "Update" });
  });
  it("tags every row with an icon and a word: a won customer reads Customer, open calls say Respond (DIRECTION #8)", () => {
    expect(rowModel({ ...base, type: "customer_won", state: "unread", blocksContinue: true }).tag).toEqual({ word: "Customer", tone: "gold", icon: "win" });
    expect(rowModel({ ...base, type: "decision", state: "unread", blocksContinue: true }).tag).toMatchObject({ word: "Respond", tone: "bad" });
    expect(rowModel({ ...base, type: "decision", state: "answered", blocksContinue: true }).tag).toMatchObject({ word: "Decided", tone: "neutral" });
    expect(rowModel({ ...base, type: "milestone", state: "read", blocksContinue: false }).tag).toMatchObject({ word: "Milestone", icon: "milestone" });
    expect(rowModel({ ...base, type: "warning", state: "read", blocksContinue: true }).tag.word).toBe("Respond");
    expect(headerTag("customer_won", false, true)).toMatchObject({ word: "Customer won", tone: "gold" });
    expect(headerTag("decision", false, true)).toMatchObject({ word: "Needs your call", tone: "bad" });
    expect(headerTag("decision", true, true)).toMatchObject({ word: "Decided" });
    expect(headerTag("update", false, false)).toMatchObject({ word: "Update" });
  });
  it("an answered note whose plan waits for the go-ahead still asks: Respond in the list, Needs your go-ahead on the note", () => {
    const waiting = rowModel({ ...base, type: "decision", state: "answered", blocksContinue: false, awaitingConfirmation: true });
    expect(waiting).toMatchObject({ needsAnswer: true, tag: { word: "Respond", tone: "bad" } });
    expect(rowModel({ ...base, type: "decision", state: "answered", blocksContinue: false, awaitingConfirmation: false }).tag.word).toBe("Decided");
    expect(headerTag("decision", true, false, true)).toEqual({ word: "Needs your go-ahead", tone: "warn", icon: "respond" });
  });
  it("J/K moves through the visible rows and clamps at the ends", () => {
    const ids = ["a", "b", "c"];
    expect(neighbourId(ids, null, "next")).toBe("a");
    expect(neighbourId(ids, "a", "next")).toBe("b");
    expect(neighbourId(ids, "c", "next")).toBe("c");
    expect(neighbourId(ids, "a", "prev")).toBe("a");
    expect(neighbourId(ids, "zz", "prev")).toBe("a");
    expect(neighbourId([], "a", "next")).toBeNull();
  });
  it("indexes agents by id from the departments' teams", () => {
    const idx = agentIndex([
      { id: "d1", name: "Distribution", colourToken: "dept-1", squad: [{ id: "a1", name: "Mara", role: "Lifecycle", avatarSeed: "s1" }] },
      { id: "d2", name: "Finance", colourToken: "dept-2", squad: [{ id: "a1", name: "Mara", role: "Lifecycle", avatarSeed: "s1" }, { id: "a2", name: "Finn", role: "Analyst", avatarSeed: "" }] },
    ]);
    expect(idx.get("a1")).toMatchObject({ departmentName: "Distribution", dept: "dept-1" });
    expect(idx.get("a2")?.seed).toBe("a2");
  });
});

describe("refresh gate (BUILD §11.3 debounce 3 s)", () => {
  it("allows the first refresh, then waits out the debounce", () => {
    expect(refreshGate(null, 1000)).toEqual({ allowed: true, waitMs: 0 });
    expect(refreshGate(1000, 2000)).toEqual({ allowed: false, waitMs: REFRESH_DEBOUNCE_MS - 1000 });
    expect(refreshGate(1000, 1000 + REFRESH_DEBOUNCE_MS)).toEqual({ allowed: true, waitMs: 0 });
  });
});

describe("decisions", () => {
  const decision = {
    options: [
      { id: "a", label: "Approve", recommended: true, consequence: "Spends €500", cost_minor: 50_000, reversible: true },
      { id: "b", label: "Decline", recommended: false, consequence: "Nothing happens", cost_minor: 0, reversible: true },
      { id: "c", label: "Ask", recommended: false },
      { id: "d", label: "Later" },
      { id: "e", label: "Fifth is dropped" },
      { bad: true },
    ],
    free_text: true,
    expires_at: "2026-10-01T00:00:00.000Z",
  };
  it("maps composer options to DecisionBar options with costs in the business currency, four at most", () => {
    const opts = toDecisionOptions(decision, "EUR");
    expect(opts).toHaveLength(4);
    expect(opts[0]).toMatchObject({ id: "a", recommended: true, cost: { amountMinor: 50_000, currency: "EUR" }, reversible: true });
    expect(opts[1]!.cost).toBeNull();
    expect(opts[2]!.cost).toBeNull();
    expect(toDecisionOptions(null, "EUR")).toEqual([]);
    expect(toDecisionOptions({ options: "nope" }, "EUR")).toEqual([]);
  });
  it("free text defaults on; expiry is read from expires_at", () => {
    expect(freeTextAllowed(decision)).toBe(true);
    expect(freeTextAllowed({ free_text: false })).toBe(false);
    expect(freeTextAllowed(null)).toBe(true);
    expect(decisionExpired(decision, new Date("2026-10-07T00:00:00Z"))).toBe(true);
    expect(decisionExpired(decision, new Date("2026-09-01T00:00:00Z"))).toBe(false);
    expect(decisionExpired({ expires_at: null })).toBe(false);
  });
  it("the newest decision gives the answered state", () => {
    expect(answeredFrom([])).toBeUndefined();
    expect(answeredFrom([{ chosenOption: "a", freeText: null, decidedAt: "2026-10-01T00:00:00Z" }, { chosenOption: null, freeText: "do it", decidedAt: "2026-10-02T00:00:00Z" }])).toEqual({ text: "do it" });
    expect(answeredFrom([{ chosenOption: "a", freeText: null, decidedAt: "2026-10-03T00:00:00Z" }, { chosenOption: null, freeText: "do it", decidedAt: "2026-10-02T00:00:00Z" }])).toEqual({ optionId: "a" });
  });
  it("header dates: decided only once answered", () => {
    expect(headerDates({ createdAt: "2026-10-01T00:00:00Z", state: "read" }, "2026-10-02T00:00:00Z").decided).toBeNull();
    expect(headerDates({ createdAt: "2026-10-01T00:00:00Z", state: "answered" }, "2026-10-02T00:00:00Z").decided?.toISOString()).toBe("2026-10-02T00:00:00.000Z");
  });
});

describe("status strip (AC-11.3.6: numbers come from live queries, never the note)", () => {
  const finance = { cash: { amountMinor: 1_250_000, currency: "EUR", asOf: "2026-10-07T00:00:00Z" }, burn: { netBurnMinor: 100_000, grossBurnMinor: 150_000 }, runway: { months: 12.5 }, revenue: { monthly: [{ month: "2026-08", inflowMinor: 1, netMinor: 1 }, { month: "2026-09", inflowMinor: 42_000, netMinor: 40_000 }] }, customers30d: 9 };
  const now = new Date("2026-10-07T12:00:00Z");
  const conversions = [
    { kind: "payment", occurredAt: "2026-10-06T12:00:00Z" },
    { kind: "payment", occurredAt: "2026-09-20T12:00:00Z" },
    { kind: "signup", occurredAt: "2026-10-05T12:00:00Z" },
  ];
  it("resolves known metrics with provenance and labels estimates", () => {
    const tiles = statusStripTiles(
      [
        { metric: "cash", source: "Bank" },
        { metric: "runway", source: "Finance" },
        { metric: "customers_week", source: "Stripe" },
        { metric: "mrr", source: "Stripe" },
        { metric: "tasks_running", source: "ignored, fifth" },
      ],
      { finance, conversions, now },
    );
    expect(tiles).toHaveLength(4);
    expect(tiles[0]).toMatchObject({ label: "Cash", value: { amountMinor: 1_250_000, currency: "EUR" }, provenance: { source: "Bank accounts" } });
    // Provenance is in plain words: never a query or table name.
    expect(tiles.every((t) => !("query" in (t.provenance ?? {})))).toBe(true);
    expect(tiles[1]).toMatchObject({ label: "Runway", value: 12.5, unit: "months", estimate: "estimate" });
    expect(tiles[2]).toMatchObject({ label: "Customers this week", value: 1 });
    expect(tiles[3]).toMatchObject({ label: "MRR", value: { amountMinor: 42_000, currency: "EUR" }, caption: "2026-09" });
  });
  it("unknown metrics render honestly empty; missing sources give null values", () => {
    const tiles = statusStripTiles([{ metric: "made_up", source: "x" }, { metric: "cash" }], { finance: null, conversions: null, now });
    expect(tiles[0]).toMatchObject({ label: "Made up", value: null, provenance: { source: "x" } });
    expect(tiles[1]).toMatchObject({ value: null, provenance: { source: "Bank balances" } });
    expect(statusStripTiles("garbage", {})).toEqual([]);
  });
  it("free-form metrics show their figure as the figure, and known families read the live value (logic.ts free-form)", () => {
    const tiles = statusStripTiles(
      [
        { metric: "Cash £72,318.22", source: "accounts" },
        { metric: "Runway n/a mo (Estimate)", source: "forecasts" },
        { metric: "Customers 1101", source: "conversions" },
        { metric: "Due in 9 days", source: "filings" },
      ],
      { finance: { ...finance, runway: { months: null }, burn: { netBurnMinor: -1_000, grossBurnMinor: 5_000 } }, now },
    );
    expect(tiles[0]).toMatchObject({ label: "Cash", value: { amountMinor: 1_250_000, currency: "EUR" }, provenance: { source: "Bank accounts" } });
    expect(tiles[1]).toMatchObject({ label: "Runway", value: "No limit", provenance: { source: "The cash forecast" } });
    expect(tiles[2]).toMatchObject({ label: "Customers", value: "1,101", provenance: { source: "Customer conversions" } });
    expect(tiles[3]).toMatchObject({ label: "Due in", value: "9 days", provenance: { source: "The filing calendar" } });
    expect(tiles.some((t) => t.value === null)).toBe(false);
  });
  it("parses free-form metrics: money before other figures, estimates flagged, grouping added", () => {
    expect(parseFreeMetric("Revenue 30d £57,552.75")).toEqual({ label: "Revenue 30 days", value: "£57,552.75", estimate: undefined });
    expect(parseFreeMetric("Activation 35%")).toMatchObject({ label: "Activation", value: "35%" });
    expect(parseFreeMetric("Runway 4.2 mo (Estimate)")).toMatchObject({ label: "Runway", value: "4.2 mo", estimate: "estimate" });
    expect(parseFreeMetric("Vacation spend £324.00")).toMatchObject({ label: "Vacation spend", value: "£324.00" });
    expect(parseFreeMetric("made_up")).toMatchObject({ label: "Made up", value: null });
    expect(metricKey("Cash £1")).toBe("cash");
    expect(metricKey("Cash after deposit £1")).toBeNull();
    expect(metricKey("MRR £1")).toBe("mrr");
    expect(metricKey("toString")).toBeNull();
    expect([...stripSources([{ metric: "Cash £72,318.22" }, { metric: "Customers 1101" }])]).toEqual(["finance"]);
  });
  it("names sources in plain words", () => {
    expect(plainSource("journey_daily")).toBe("Journey daily");
    expect(plainSource("usage_ledger")).toBe("Model and tool usage");
    expect(plainSource("Stripe, invoices paid")).toBe("Stripe, invoices paid");
    expect(plainSource("")).toBeUndefined();
  });
  it("lists only the sources a strip needs", () => {
    expect([...stripSources([{ metric: "cash" }, { metric: "customers_week" }])]).toEqual(["finance", "conversions"]);
    expect([...stripSources([{ metric: "tasks_running" }, { metric: "channels_enabled" }, { metric: "nope" }])]).toEqual(["tasks", "channels"]);
    expect(stripSources(null).size).toBe(0);
  });
});

describe("plans", () => {
  const evaluations = [
    { action: { type: "enable_channel", params: { channel: "paid_ads" } }, outcome: "allow", reasons: [] },
    { action: { type: "set_budget", params: { channel: "paid_ads", amount_minor: 50_000, currency: "EUR" } }, outcome: "ask", reasons: ["above threshold"] },
    { action: { type: "request_human_action", params: { request: "Pay the supplier invoice" } }, outcome: "allow", hardGate: true },
    { action: { type: "create_task", params: { title: "Draft the ads" } }, outcome: "deny" },
  ];
  it("'Here is what will happen' lines carry outcome, hard gate and cost; total sums the costs", () => {
    const lines = confirmationLines(evaluations, "EUR");
    expect(lines.map((l) => l.label)).toEqual(["Enable channel paid ads", "Set budget for paid ads", "Founder action: Pay the supplier invoice", "Create task: Draft the ads"]);
    expect(lines[1]).toMatchObject({ outcome: "ask", cost: { amountMinor: 50_000, currency: "EUR" }, reasons: ["above threshold"] });
    expect(lines[2]!.hardGate).toBe(true);
    expect(lines[0]!.hardGate).toBe(false);
    expect(totalCost(lines, "EUR")).toEqual({ amountMinor: 50_000, currency: "EUR" });
    expect(totalCost([], "EUR")).toBeNull();
  });
  it("follow-up links point at the screens that hold the artefacts, de-duplicated", () => {
    const departments = [
      { slug: "growth", moduleKeys: ["distribution"], tabs: [{ slug: "channels", position: 2 }, { slug: "formation", position: 1 }] },
      { slug: "build", moduleKeys: ["development", "product"], tabs: [{ slug: "training-ground", position: 1 }, { slug: "plan", position: 2 }] },
    ];
    const links = followUpLinks(
      [
        { id: "1", type: "enable_channel", params: { channel: "paid_ads" } },
        { id: "2", type: "set_budget", params: {} },
        { id: "3", type: "create_task", params: {} },
        { id: "4", type: "set_agent_model", params: { agent_id: "ag-1" } },
        { id: "5", type: "update_spec", params: {} },
        { id: "6", type: "reply_only", params: {} },
      ],
      BID,
      departments,
    );
    expect(links.map((l) => l.href)).toEqual([`/b/${BID}/d/growth/formation`, `/b/${BID}/d/build/plan`, `/b/${BID}/agents/ag-1/overview`, `/b/${BID}/d/build/training-ground`]);
    expect(links[0]!.label).toBe("Open the Board");
    // A task is a task: never "Open the plan" (the decision's own plan is the Decided panel; audit FR-08).
    expect(links[1]!.label).toBe("Open the task list");
    // One task that ran opens on that task; several open the list.
    const one = followUpLinks([{ id: "t", type: "create_task", params: {}, status: "done", result: { taskId: "task-7" } }], BID, departments);
    expect(one).toEqual([{ id: "t", label: "Open the task", href: `/b/${BID}/d/build/plan?task=task-7` }]);
    const two = followUpLinks([{ id: "t1", type: "create_task", params: {}, result: { taskId: "task-7" } }, { id: "t2", type: "create_task", params: {}, result: { taskId: "task-8" } }], BID, departments);
    expect(two).toEqual([{ id: "t1", label: "Open the tasks", href: `/b/${BID}/d/build/plan` }]);
  });
  it("a stored plan's lines come from its actions' recorded outcomes (after a reload, no evaluation in memory)", () => {
    const lines = planConfirmationLines(
      [
        { type: "enable_channel", params: { channel: "paid_ads" }, policyOutcome: "allow" },
        { type: "set_budget", params: { channel: "paid_ads", amount_minor: 50_000, currency: "GBP" }, policyOutcome: "ask" },
        { type: "request_human_action", params: { request: "Pay the supplier invoice" }, policyOutcome: null },
      ],
      "GBP",
    );
    expect(lines.map((l) => [l.label, l.outcome, l.hardGate])).toEqual([
      ["Enable channel paid ads", "allow", false],
      ["Set budget for paid ads", "ask", false],
      ["Founder action: Pay the supplier invoice", "allow", true],
    ]);
    expect(totalCost(lines, "GBP")).toEqual({ amountMinor: 50_000, currency: "GBP" });
  });
  it("an action policy asked about waits for the go-ahead until the plan is confirmed (audit VOL-X1)", () => {
    expect(askChip({ status: "pending_confirmation", confirmedAt: null }, { policyOutcome: "ask" })).toEqual({ word: "Needs your go-ahead", tone: "warn" });
    expect(askChip({ status: "done", confirmedAt: "2026-10-07T15:45:00Z" }, { policyOutcome: "ask" })).toEqual({ word: "Confirmed", tone: "neutral" });
    expect(askChip({ status: "executing", confirmedAt: null }, { policyOutcome: "ask" })).toBeNull();
    expect(askChip({ status: "pending_confirmation", confirmedAt: null }, { policyOutcome: "allow" })).toBeNull();
  });
  it("Review what will happen follows the stored plan, not the page that decided it (audit OL-01, FR-08)", () => {
    const waiting = { id: "plan-1", status: "pending_confirmation" };
    // After a reload: only inbox.get's record, and it says this reader may give the go-ahead.
    expect(goAheadState(waiting, { planId: "plan-1", canConfirm: true, blockedReason: null })).toEqual({ waiting: true, canConfirm: true, blockedReason: null });
    // Just decided here, before inbox.get has caught up: the decider may confirm.
    expect(goAheadState(waiting, null)).toEqual({ waiting: true, canConfirm: true, blockedReason: null });
    expect(goAheadState(waiting, { planId: "plan-0", canConfirm: false, blockedReason: "Older plan" })).toMatchObject({ canConfirm: true, blockedReason: null });
    // Someone walled from a section the plan changes, or a viewer: no button, and the reason in words.
    expect(goAheadState(waiting, { planId: "plan-1", canConfirm: false, blockedReason: "Your access to the Inbox is read-only." })).toEqual({ waiting: true, canConfirm: false, blockedReason: "Your access to the Inbox is read-only." });
    // Confirmed (here or elsewhere), running or done: nothing waits.
    for (const status of ["executing", "done", "failed"]) expect(goAheadState({ id: "plan-1", status }, { planId: "plan-1", canConfirm: true, blockedReason: null })).toEqual({ waiting: false, canConfirm: false, blockedReason: null });
    expect(goAheadState(null, null).waiting).toBe(false);
  });
  it("the answer reads as the Chief of Staff's when they decided on vacation (audit O-16)", () => {
    expect(answerLabel([{ decidedByKind: "user", decidedAt: "2026-10-07T15:45:00Z" }])).toBe("Your answer");
    expect(answerLabel([{ decidedByKind: "chief_of_staff", decidedAt: "2026-10-07T15:45:00Z" }])).toBe("Chief of Staff's answer");
    // The latest decision speaks.
    expect(answerLabel([{ decidedByKind: "chief_of_staff", decidedAt: "2026-10-07T15:45:00Z" }, { decidedByKind: "user", decidedAt: "2026-10-08T09:00:00Z" }])).toBe("Your answer");
    expect(answerLabel(undefined)).toBe("Your answer");
  });
  it("summarises plan status for the answered strip", () => {
    expect(planStatusLine(null)).toBeNull();
    expect(planStatusLine({ status: "pending_confirmation", actions: [{ type: "set_budget", params: null }] })).toMatchObject({ word: "Awaiting your confirmation", tone: "warn" });
    expect(planStatusLine({ status: "executing", actions: [{ type: "a", params: null, status: "done" }, { type: "b", params: null, status: "running" }] })).toMatchObject({ word: "Running", detail: "1 of 2 actions done" });
    expect(planStatusLine({ status: "done", actions: [{ type: "a", params: null, status: "done" }, { type: "b", params: null, status: "failed" }] })).toMatchObject({ word: "Done with issues", tone: "warn" });
    expect(planStatusLine({ status: "done", actions: [] })).toMatchObject({ word: "Done", tone: "good", detail: "no actions" });
  });
});

describe("won customers open their replay", () => {
  const journeys = [
    { id: "j-old", conversion: { entityId: "e1", kind: "payment", occurredAt: "2026-09-01T00:00:00Z" } },
    { id: "j-new", conversion: { entityId: "e1", kind: "payment", occurredAt: "2026-10-01T00:00:00Z" } },
    { id: "j-other", conversion: { entityId: "e2", kind: "payment", occurredAt: "2026-10-06T23:00:00Z" } },
  ];
  it("prefers the newest journey of one of the item's entities, else a payment within a day of the note", () => {
    expect(journeyForItem({ type: "customer_won", entityIds: ["e1"], createdAt: "2026-10-07T00:00:00Z" }, journeys)).toBe("j-new");
    expect(journeyForItem({ type: "customer_won", entityIds: [], createdAt: "2026-10-07T00:00:00Z" }, journeys)).toBe("j-other");
    expect(journeyForItem({ type: "customer_won", entityIds: [], createdAt: "2026-12-07T00:00:00Z" }, journeys)).toBeNull();
    expect(journeyForItem({ type: "update", entityIds: ["e1"], createdAt: "2026-10-07T00:00:00Z" }, journeys)).toBeNull();
  });
});

describe("the decision's deadline and the agent's desk", () => {
  const now = new Date(2026, 9, 9, 14, 0, 0);
  it("says when the decision expires, in days, under 'Your call'", () => {
    expect(decisionDeadline({ expires_at: new Date(2026, 9, 14, 9, 0, 0).toISOString() }, now)).toBe("Expires in 5 days");
    expect(decisionDeadline({ expires_at: new Date(2026, 9, 10, 9, 0, 0).toISOString() }, now)).toBe("Expires tomorrow");
    expect(decisionDeadline({ expires_at: new Date(2026, 9, 9, 18, 0, 0).toISOString() }, now)).toBe("Expires today");
    expect(decisionDeadline({ expires_at: new Date(2026, 9, 8).toISOString() }, now)).toBeNull();
    expect(decisionDeadline(null, now)).toBeNull();
  });

  it("gives every agent's note a desk, never a message from another founder", () => {
    for (const t of ["decision", "update", "warning", "report", "milestone", "customer_won"] as const) expect(hasAgentDesk(t)).toBe(true);
    expect(hasAgentDesk("human_message")).toBe(false);
  });

  it("describes a plan with nothing outside policy without a '0 actions' sentence", () => {
    expect(confirmPlanDescription([{ label: "Create a task", outcome: "allow", hardGate: false, cost: null, reasons: [] }])).toBe("Everything here is within the current policy. Nothing runs until you say go.");
    expect(confirmPlanDescription([{ label: "Set budget", outcome: "ask", hardGate: false, cost: null, reasons: [] }, { label: "Pay", outcome: "allow", hardGate: true, cost: null, reasons: [] }])).toBe("1 action sits outside the current policy and needs your go-ahead. 1 is hard-gated: the team prepares everything and you act.");
  });
});

describe("the agent's opener under a note (DESIGN §8 Conversation)", () => {
  it("picks up the note instead of a generic greeting, and names the recommendation while the call is open", () => {
    const options = [{ label: "Approve", recommended: true }, { label: "Wait", recommended: false }];
    expect(noteOpener("decision", options, false)).toBe("I'd go with “Approve”. Ask me anything before you decide.");
    expect(noteOpener("decision", options, true)).toMatch(/decided/);
    expect(noteOpener("update", [], false)).toMatch(/what's blocking it/);
    expect(noteOpener("customer_won", [], false)).toMatch(/new customer/);
    expect(noteOpener("human_message", [], false)).toBeNull();
  });
});

describe("section walls (inbox.get item.redacted)", () => {
  it("says which parts of the note the reader's access hides, and nothing when none", () => {
    expect(hiddenNotice([])).toBeNull();
    expect(hiddenNotice(undefined)).toBeNull();
    expect(hiddenNotice(["finance"])).toBe("Figures from Finance are hidden: your access does not include Finance.");
    expect(hiddenNotice(["crm"])).toBe("Customer details from the CRM are hidden: your access does not include the CRM.");
    expect(hiddenNotice(["crm", "finance"])).toMatch(/^Figures from Finance and customer details from the CRM are hidden/);
  });
});
