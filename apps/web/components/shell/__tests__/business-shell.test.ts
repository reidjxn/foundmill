import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { EVENT_TYPES } from "@foundmill/shared/constants";
import { EMPTY_CYCLE, cycleFromSnapshot } from "@/lib/cycle";
import { trpcPathPrefix, trpcQueryKey } from "@/lib/trpc";
import { SAFETY_POLL_MS } from "@/lib/stream-status";
import { FIRST_CONTINUE_CALLOUT, INVALIDATE_ON_EVENT, cycleReducer, describeContinue, shellPollIntervals, wantsFirstContinueCallout } from "../BusinessShell";

type ContinueResult = Parameters<typeof describeContinue>[0];

const status = (over: Partial<ContinueResult["status"]> = {}): ContinueResult["status"] => ({
  running: false,
  queued: false,
  paused: false,
  cycleId: null,
  cycleNumber: null,
  workflowId: null,
  startedAt: null,
  trigger: null,
  activeDepartmentIds: [],
  activeAgentIds: [],
  activeTaskIds: [],
  plannedTaskIds: [],
  pausedTaskIds: [],
  completedCount: 0,
  lastCompletedAt: null,
  lastOutcome: null,
  nextCycleNumber: 1,
  mode: null,
  ...over,
});

const result = (over: Partial<ContinueResult>): ContinueResult => ({ action: "started", mode: "temporal", workflow: null, item: null, status: status(), continueState: { kind: "processing" }, ...over });

describe("one press of Continue (BUILD §9.4)", () => {
  it("names what happened: started on Temporal, one local note, resumed, already running", () => {
    expect(describeContinue(result({}))).toMatchObject({ title: "Cycle started", itemId: null });
    const item = { id: "11111111-1111-4111-8111-111111111111", subject: "Three decisions for the Board" } as unknown as NonNullable<ContinueResult["item"]>;
    expect(describeContinue(result({ mode: "local", item }))).toMatchObject({ title: "One new note", description: "Three decisions for the Board", itemId: item.id });
    expect(describeContinue(result({ action: "resumed" }))).toMatchObject({ title: "Cycle resumed", tone: "good" });
    expect(describeContinue(result({ action: "already_running" }))).toMatchObject({ title: "A cycle is already running" });
  });
});

describe("shell cycle reducer", () => {
  it("adopts cycle.status snapshots without letting the pulse key go backwards, and applies pause locally", () => {
    const pulsed = { ...EMPTY_CYCLE, completedCount: 3 };
    const adopted = cycleReducer(pulsed, { type: "snapshot", status: cycleFromSnapshot({ running: true, cycleId: "c4", completedCount: 1 }) });
    expect(adopted).toMatchObject({ running: true, cycleId: "c4", completedCount: 3 });
    const paused = cycleReducer(adopted, { type: "paused", paused: true });
    expect(paused.paused).toBe(true);
    const done = cycleReducer(paused, { type: "event", event: { type: "cycle.completed", payload: { outcome: "completed" } }, agentDepartment: () => null });
    expect(done).toMatchObject({ running: false, paused: false, completedCount: 4 });
  });
});

describe("the first-Continue callout (UX plan §7.7)", () => {
  it("shows until the first cycle the founder starts has completed (commit runs cycle 1 itself), never for a read-only role", () => {
    expect(wantsFirstContinueCallout({ completedCount: 0 }, true)).toBe(true);
    expect(wantsFirstContinueCallout({ completedCount: 1 }, true)).toBe(true);
    expect(wantsFirstContinueCallout({ completedCount: 2 }, true)).toBe(false);
    expect(wantsFirstContinueCallout({ completedCount: 0 }, false)).toBe(false);
  });

  it("is anchored to the top bar's Continue and says the loop in one sentence", () => {
    expect(FIRST_CONTINUE_CALLOUT).toEqual({ tourId: "first-continue", targetId: "continue", title: "This is how you move forward", body: "Press it when you have answered what needs you." });
  });
});

describe("payments on the stream (audit JM-02)", () => {
  it("a renewal, which writes payment.received and no customer.converted, still refetches revenue", () => {
    expect(INVALIDATE_ON_EVENT["payment.received"]).toEqual(expect.arrayContaining(["finance", "journey"]));
    expect(INVALIDATE_ON_EVENT["payment.received"]).not.toContain("inbox");
  });
});

describe("staff changes on the stream (security review S1)", () => {
  it("membership.changed refetches the business (the reader's own role and walls) and the staff list", () => {
    expect(INVALIDATE_ON_EVENT["membership.changed"]).toEqual(["business", "team"]);
  });
});

describe("the first days on the stream (founder, 2026-10-18)", () => {
  it("a sign-off decision refetches the business, the Product tabs' sign-offs, the Inbox and the Plan; a distribution start the Board", () => {
    expect(INVALIDATE_ON_EVENT["product.signoff_decided"]).toEqual(["business", "product.signoff", "inbox", "dev"]);
    expect(INVALIDATE_ON_EVENT["distribution.started"]).toEqual(["business", "distribution", "inbox"]);
  });
});

describe("foundations progress on the stream (audit P3)", () => {
  it("foundations.progressed refetches the foundations query only, which the dotted prefix reaches", async () => {
    expect(INVALIDATE_ON_EVENT["foundations.progressed"]).toEqual(["product.foundations"]);
    const qc = new QueryClient();
    const BID = "00000000-0000-4000-8000-000000000001";
    qc.setQueryData(trpcQueryKey("product.foundations.get", { businessId: BID }) as unknown[], { status: "drafting" });
    qc.setQueryData(trpcQueryKey("product.spec.get", { businessId: BID }) as unknown[], { blocks: [] });
    await qc.invalidateQueries({ queryKey: trpcPathPrefix(INVALIDATE_ON_EVENT["foundations.progressed"]![0]!) as unknown[] });
    expect(qc.getQueryState(trpcQueryKey("product.foundations.get", { businessId: BID }) as unknown[])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(trpcQueryKey("product.spec.get", { businessId: BID }) as unknown[])?.isInvalidated).toBe(false);
  });
});

describe("changes another member makes reach an open Inbox (audit RUI-09)", () => {
  it("an archive or a plan confirmation (inbox.item_updated) refetches the list, the reading pane and the plan", async () => {
    expect(INVALIDATE_ON_EVENT["inbox.item_updated"]).toEqual(["inbox", "plan"]);
    const qc = new QueryClient();
    const BID = "00000000-0000-4000-8000-000000000001";
    const pane = trpcQueryKey("inbox.get", { businessId: BID, itemId: "00000000-0000-4000-8000-000000000002" }) as unknown[];
    qc.setQueryData(pane, { item: { state: "unread" } });
    await Promise.all(INVALIDATE_ON_EVENT["inbox.item_updated"]!.map((r) => qc.invalidateQueries({ queryKey: trpcPathPrefix(r) as unknown[] })));
    expect(qc.getQueryState(pane)?.isInvalidated).toBe(true);
  });

  it("maps only events the catalogue declares (a typo would never fire)", () => {
    for (const type of Object.keys(INVALIDATE_ON_EVENT)) expect(EVENT_TYPES as readonly string[], type).toContain(type);
  });

  it("polls the inbox and cycle every 30 s while the channel is not live and as a safety net while it is; the departments always at the safety pace", () => {
    expect(shellPollIntervals(false)).toEqual({ inbox: 30_000, cycle: 30_000, departments: SAFETY_POLL_MS });
    // A live channel never turns polling off (a read, a department edit or a hire by another member publishes no event).
    expect(shellPollIntervals(true)).toEqual({ inbox: SAFETY_POLL_MS, cycle: SAFETY_POLL_MS, departments: SAFETY_POLL_MS });
    expect(SAFETY_POLL_MS).toBe(60_000);
  });
});

describe("the Autopilot chip stays fresh on the stream", () => {
  it("refetches business.autopilot when Autopilot changes, a cycle starts or ends, or an Inbox item that can block Continue arrives or is decided", async () => {
    expect(INVALIDATE_ON_EVENT["autopilot.changed"]).toContain("business");
    for (const type of ["autopilot.cycle_started", "cycle.started", "cycle.completed", "inbox.item_created", "decision.made"]) {
      expect(INVALIDATE_ON_EVENT[type]!.some((p) => p === "business" || p === "business.autopilot")).toBe(true);
    }
    const qc = new QueryClient();
    const BID = "00000000-0000-4000-8000-000000000001";
    qc.setQueryData(trpcQueryKey("business.autopilot.get", { businessId: BID }) as unknown[], { state: "on" });
    qc.setQueryData(trpcQueryKey("business.get", { businessId: BID }) as unknown[], { business: {} });
    await qc.invalidateQueries({ queryKey: trpcPathPrefix("business.autopilot") as unknown[] });
    expect(qc.getQueryState(trpcQueryKey("business.autopilot.get", { businessId: BID }) as unknown[])?.isInvalidated).toBe(true);
    // The path is narrow: the business record itself is not refetched on every cycle.
    expect(qc.getQueryState(trpcQueryKey("business.get", { businessId: BID }) as unknown[])?.isInvalidated).toBe(false);
  });
});
