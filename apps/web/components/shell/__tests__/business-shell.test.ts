import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { EVENT_TYPES } from "@foundmill/shared/constants";
import { EMPTY_CYCLE, cycleFromSnapshot } from "@/lib/cycle";
import { trpcPathPrefix, trpcQueryKey } from "@/lib/trpc";
import { SAFETY_POLL_MS } from "@/lib/stream-status";
import { EXAMPLE_CHIP_TOOLTIP, EXAMPLE_READ_ONLY_REASON, FULL_ACCESS, SAMPLE_BUSINESS_LINE, accessFor, readOnlyReason, sampleMarker } from "@/lib/access";
import { makeBusinessContext } from "../business-context";
import { CONTINUE_PRESSED_NOTICE, continuePressedNotice, EXAMPLE_START_CALLOUT, FIRST_CONTINUE_CALLOUT, ORCHESTRATOR_DOWN_CAVEAT, RUN_UNTIL_DONE, START_YOUR_OWN_HREF, INVALIDATE_ON_EVENT, cycleReducer, describeContinue, describePause, describeRunEnded, exampleFrame, lastCycleCostLine, orchestratorDown, shellConnection, shellPollIntervals, wantsFirstContinueCallout } from "../BusinessShell";

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
  lastFailure: null,
  lastCost: null,
  nextCycleNumber: 1,
  mode: null,
  run: null,
  ...over,
});

type Summary = ContinueResult["summary"];
const summary = (over: Partial<Summary> = {}): Summary => ({ kind: "started", headline: "Cycle 2 started: 6 tasks ready to build", plainHeadline: "The next round of work started: 6 tasks ready to build", detail: `The team is at work. What they finish and what they need from you come back as notes in the Inbox. ${RUN_UNTIL_DONE}`, readyTasks: 6, stage: "building", orchestrator: true, ...over });
// A cast: the answer is a union (the note of an in-process step comes back as the person may read it), and a Partial of a union spreads into neither member.
const result = (over: Partial<ContinueResult>): ContinueResult => ({ action: "started", mode: "temporal", workflow: null, item: null, status: status(), continueState: { kind: "processing" }, run: null, summary: summary(), ...over }) as ContinueResult;
const RUN = { id: "22222222-2222-4222-8222-222222222222", startedAt: "2026-11-07T10:00:00.000Z", rounds: 0 };

describe("one press of Continue (BUILD §9.4; first-time founder report, Nov 8, 2026: the api's one sentence is the toast)", () => {
  it("the toast is the api's sentence: the cycle and what is ready, nothing ready and why, resumed, already running; cycle numbers only in Builder view", () => {
    // Builder view off (the founder's default): the plain line, no cycle number.
    expect(describeContinue(result({}))).toEqual({ title: "The next round of work started: 6 tasks ready to build", description: summary().detail, tone: "info", itemId: null });
    expect(describeContinue(result({}), true).title).toBe("Cycle 2 started: 6 tasks ready to build");
    expect(describeContinue(result({ summary: summary({ kind: "nothing_ready", headline: "Cycle 1 started: nothing is ready to build yet", plainHeadline: "The next round of work started: nothing is ready to build yet", detail: "The specification and the roadmap are waiting for your sign-off in the Inbox.", readyTasks: 0, stage: "awaiting_signoff" }) }), true)).toMatchObject({ title: "Cycle 1 started: nothing is ready to build yet", tone: "info" });
    expect(describeContinue(result({ action: "resumed", summary: summary({ kind: "resumed", headline: "Cycle 4 resumed", plainHeadline: "The round of work resumed", detail: "2 tasks pick up where they stopped." }) }))).toMatchObject({ title: "The round of work resumed", tone: "good", itemId: null });
    expect(describeContinue(result({ action: "already_running", summary: summary({ kind: "already_running", headline: "Cycle 5 is already running", plainHeadline: "A round of work is already running", detail: "The team is still working." }) }), true)).toMatchObject({ title: "Cycle 5 is already running", tone: "info" });
  });

  it("no orchestrator: a warning that says no agent worked, with the note that stood in to open", () => {
    const item = { id: "11111111-1111-4111-8111-111111111111", subject: "Three decisions for the Board" } as unknown as NonNullable<ContinueResult["item"]>;
    const local = result({ mode: "local", item: item as never, summary: summary({ kind: "orchestrator_unreachable", headline: "The team cannot run right now: the orchestrator is not reachable", plainHeadline: "The team cannot run right now: the orchestrator is not reachable", detail: "No agent worked. One note was written from what the business already knows: “Three decisions for the Board”.", orchestrator: false }) });
    expect(describeContinue(local)).toEqual({ title: "The team cannot run right now: the orchestrator is not reachable", description: "No agent worked. One note was written from what the business already knows: “Three decisions for the Board”.", tone: "warn", itemId: item.id });
    // The e2e specs' toast regex matches every headline the api writes, Builder view on or off.
    for (const t of ["Cycle 2 started: 6 tasks ready to build", "The next round of work started: 6 tasks ready to build", "The next round of work started: nothing is ready to build yet", "The team cannot run right now: the orchestrator is not reachable", "Cycle 4 resumed", "The round of work resumed", "A round of work is already running"]) expect(t).toMatch(/(cycle \d+|round of work) started|cannot run right now|(cycle \d+|round of work) resumed|already running/i);
    expect(RUN_UNTIL_DONE).toBe("New rounds of work start on their own until nothing is left to do, or until you pause.");
    expect(RUN).toBeTruthy();
  });

  it("the orchestrator's caveat shows only on a known 'not reachable', never on unknown", () => {
    expect(orchestratorDown({ orchestrator: { reachable: false } })).toBe(true);
    expect(orchestratorDown({ orchestrator: { reachable: null } })).toBe(false);
    expect(orchestratorDown({ orchestrator: { reachable: true } })).toBe(false);
    expect(orchestratorDown(undefined)).toBe(false);
    expect(ORCHESTRATOR_DOWN_CAVEAT).toBe("The team cannot start right now. Pressing Continue will only write a short note.");
    expect(CONTINUE_PRESSED_NOTICE).toBe("Starting the next cycle…");
    expect(continuePressedNotice(false)).toBe("Starting the next round of work…");
    expect(continuePressedNotice(true)).toBe(CONTINUE_PRESSED_NOTICE);
  });

  it("the last cycle's cost rides under Continue's tooltip as an Estimate; none before the first cycle", () => {
    expect(lastCycleCostLine({ amountMinor: 52, currency: "USD" })).toBe("The last round of work cost $0.52 · Estimate");
    expect(lastCycleCostLine({ amountMinor: 0, currency: "USD" })).toBe("The last round of work cost $0.00 · Estimate");
    expect(lastCycleCostLine(null)).toBeNull();
  });

  it("the connection chip reads 'Live updates off' for everyone when the stream was never live this page", () => {
    expect(shellConnection("off", false)).toMatchObject({ state: "off" });
    expect(shellConnection("off", true)).toMatchObject({ state: "off" });
    expect(shellConnection("reconnecting", false)).toMatchObject({ state: "late" });
    expect(shellConnection("reconnecting", true)).toMatchObject({ state: "reconnecting" });
    expect(shellConnection(null, true)).toBeNull();
  });
});

describe("Pause and the end of a run (Nov 7, 2026)", () => {
  it("Pause says what stopped and that Continue picks up again", () => {
    expect(describePause({ paused: true, pausedTasks: 2, runEnded: true })).toEqual({ title: "Paused", description: "2 running tasks paused. Press Continue to pick up where the team stopped.", tone: "warn" });
    expect(describePause({ paused: true, pausedTasks: 1, runEnded: false }).description).toBe("1 running task paused. Press Continue to pick up where the team stopped.");
    expect(describePause({ paused: false, pausedTasks: 0, runEnded: true, reason: "no cycle is running; no new cycle starts on its own" })).toEqual({ title: "Paused", description: "No new round of work starts. Press Continue to pick up where the team stopped.", tone: "warn" });
    expect(describePause({ paused: false, pausedTasks: 0, runEnded: false, reason: "no cycle is running" })).toEqual({ title: "Nothing to pause", description: "no cycle is running", tone: "info" });
  });

  it("a run's end on the stream: the team is done, a day's limit with its number; nothing for Pause, a stop or another event", () => {
    const ended = (payload: Record<string, unknown>) => ({ type: "cycle.run_ended", payload });
    expect(describeRunEnded(ended({ reason: "done" }))).toEqual({ title: "The team has done all it can for now", description: "Anything waiting for you is in the Inbox's Needs you tab.", tone: "good" });
    expect(describeRunEnded(ended({ reason: "daily_cycles", maxCyclesPerDay: 6 }))).toMatchObject({ title: "Today's limit of 6 cycles is reached", description: "No more cycles start on their own today. Raise the limit in Settings › What the team can do, or press Continue for one more." });
    expect(describeRunEnded(ended({ reason: "daily_spend" }))!.title).toBe("Today's spend ceiling is reached (Estimate)");
    expect(describeRunEnded(ended({ reason: "paused" }))).toBeNull();
    expect(describeRunEnded(ended({ reason: "stopped" }))).toBeNull();
    expect(describeRunEnded(ended({ reason: "nonsense" }))).toBeNull();
    expect(describeRunEnded({ type: "cycle.completed", payload: { reason: "done" } })).toBeNull();
  });

  it("the run's events refresh the cycle status and the Autopilot chip", () => {
    expect(INVALIDATE_ON_EVENT["cycle.run_started"]).toEqual(["cycle", "business.autopilot"]);
    expect(INVALIDATE_ON_EVENT["cycle.run_ended"]).toEqual(["cycle", "business.autopilot"]);
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
    expect(FIRST_CONTINUE_CALLOUT).toEqual({ tourId: "first-continue", targetId: "continue", title: "This is how you move forward", body: "One press and your team works until nothing is left to do. Anything that needs you shows in Needs you." });
  });
});

describe("the Example frame (UX plan §12 item 5)", () => {
  const example = accessFor({ role: "viewer", sectionPermissions: {}, source: "example" }, { isDemo: true });
  const owner = accessFor({ role: "owner", sectionPermissions: {}, source: "founder" }, { isDemo: true });
  const viewer = accessFor({ role: "viewer", sectionPermissions: {}, source: "invite" }, { isDemo: true });

  it("for an example viewer: the chip, Stop all agents hidden, and the Start-your-own callout in place of the first-Continue one", () => {
    expect(exampleFrame(example, { completedCount: 0 })).toEqual({ chip: true, stopAllHidden: true, callout: EXAMPLE_START_CALLOUT });
    // Never the first-Continue callout for a read-only role, and never the frame for the demo's own owner or an invited viewer.
    expect(exampleFrame(owner, { completedCount: 0 })).toEqual({ chip: false, stopAllHidden: false, callout: FIRST_CONTINUE_CALLOUT });
    expect(exampleFrame(owner, { completedCount: 5 })).toEqual({ chip: false, stopAllHidden: false, callout: null });
    expect(exampleFrame(viewer, { completedCount: 0 })).toEqual({ chip: false, stopAllHidden: false, callout: null });
  });

  it("the callout targets Start your own with its own tour id, and the chip says nothing is saved", () => {
    expect(EXAMPLE_START_CALLOUT).toEqual({ tourId: "example-start", targetId: "start-your-own", title: "This is an example", body: "When you are ready, start your own business here." });
    expect(EXAMPLE_START_CALLOUT.tourId).not.toBe(FIRST_CONTINUE_CALLOUT.tourId);
    // "Start your own" (in Continue's slot) opens the three doors.
    expect(START_YOUR_OWN_HREF).toBe("/new");
    expect(EXAMPLE_CHIP_TOOLTIP).toBe("Its figures are made up for the example: nothing here is real money or real customers. Nothing you do here is saved.");
  });

  it("the Sample project marker: only for a visitor exploring the example; never for the demo's own members or on a founder's own business", () => {
    expect(sampleMarker({ isDemo: true }, example)).toEqual({ label: "Sample project", tooltip: EXAMPLE_CHIP_TOOLTIP });
    // The demo's own owner (the seeded founder) and an invited viewer don't see it (founder, Nov 12, 2026).
    expect(sampleMarker({ isDemo: true }, owner)).toBeNull();
    expect(sampleMarker({ isDemo: true }, viewer)).toBeNull();
    expect(SAMPLE_BUSINESS_LINE).toBe("Its figures are made up for the example: nothing here is real money or real customers.");
    // A founder's own business, before or after the membership loads.
    const own = accessFor({ role: "owner", sectionPermissions: {}, source: "founder" }, { isDemo: false });
    expect(sampleMarker({ isDemo: false }, own)).toBeNull();
    expect(sampleMarker({ isDemo: false }, FULL_ACCESS)).toBeNull();
    expect(sampleMarker({}, FULL_ACCESS)).toBeNull();
    expect(sampleMarker(null, FULL_ACCESS)).toBeNull();
    // An example-source viewer row on a business that is not a demo (or not loaded yet): never the marker.
    const stray = { role: "viewer", sectionPermissions: {}, source: "example" } as const;
    for (const business of [{ isDemo: false }, {}, null]) {
      expect(sampleMarker(business, accessFor(stray, business)), JSON.stringify(business)).toBeNull();
      expect(sampleMarker(business, { isExample: true }), JSON.stringify(business)).toBeNull();
    }
    // The shell's own context reads the business with the membership: such a row is not an example there either.
    const data = { role: "viewer", membership: stray, business: { isDemo: false, currency: "GBP" } } as unknown as Parameters<typeof makeBusinessContext>[1];
    const ctx = makeBusinessContext("b1", data, []);
    expect(ctx.access.isExample).toBe(false);
    expect(sampleMarker(data.business, ctx.access)).toBeNull();
  });

  it("every refused write keeps the viewer wording, extended for the example", () => {
    expect(readOnlyReason(example)).toBe(EXAMPLE_READ_ONLY_REASON);
    expect(readOnlyReason(viewer)).toMatch(/^As a viewer/);
    expect(example.canChange).toBe(false);
    expect(example.isAdmin).toBe(false);
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
    expect(INVALIDATE_ON_EVENT["product.signoff_decided"]).toEqual(["business", "product.signoff", "inbox", "dev", "today"]);
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
    expect(INVALIDATE_ON_EVENT["inbox.item_updated"]).toEqual(["inbox", "plan", "today"]);
    const qc = new QueryClient();
    const BID = "00000000-0000-4000-8000-000000000001";
    const pane = trpcQueryKey("inbox.get", { businessId: BID, itemId: "00000000-0000-4000-8000-000000000002" }) as unknown[];
    qc.setQueryData(pane, { item: { state: "unread" } });
    await Promise.all(INVALIDATE_ON_EVENT["inbox.item_updated"]!.map((r) => qc.invalidateQueries({ queryKey: trpcPathPrefix(r) as unknown[] })));
    expect(qc.getQueryState(pane)?.isInvalidated).toBe(true);
  });

  it("Today refetches on what changes it: a note, an answer, a round of work, a customer and the goal (founder, 2026-11-07)", () => {
    for (const type of ["inbox.item_created", "inbox.item_updated", "decision.made", "cycle.completed", "customer.converted", "goal.proposed", "goal.approved", "goal.change_requested", "goal.achieved"]) expect(INVALIDATE_ON_EVENT[type], type).toContain("today");
  });

  it("a team call started or ended refetches the calls list; an ended one has filed actions, so the Inbox, plans, tasks, roadmap and Today follow", () => {
    expect(INVALIDATE_ON_EVENT["team_call.started"]).toEqual(["teamCall"]);
    expect(INVALIDATE_ON_EVENT["team_call.ended"]).toEqual(expect.arrayContaining(["teamCall", "inbox", "plan", "dev", "product", "today"]));
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
