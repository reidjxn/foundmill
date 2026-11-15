import { describe, expect, it } from "vitest";
import { awayReportId, computeContinueState, firstBlockingItem, journeyHref, respondHref, unviewedWin, type ContinueInboxItem } from "../continue-state";

const item = (over: Partial<ContinueInboxItem>): ContinueInboxItem => ({ id: "i1", type: "update", state: "unread", blocksContinue: false, ...over });

describe("computeContinueState", () => {
  it("is idle with nothing pending", () => {
    expect(computeContinueState({ blocking: 0, items: [] })).toEqual({ kind: "idle" });
  });

  it("reads Respond · N while blocking items are unanswered (AC-11.3.3)", () => {
    expect(computeContinueState({ blocking: 3, items: [item({ type: "decision", blocksContinue: true })] })).toEqual({ kind: "blocked", count: 3 });
  });

  it("blocked beats processing and the win", () => {
    const items = [item({ type: "customer_won" }), item({ id: "d", type: "decision", blocksContinue: true })];
    expect(computeContinueState({ blocking: 1, items, cycle: { running: true } })).toEqual({ kind: "blocked", count: 1 });
  });

  it("never turns Continue into Go to Journey for a win: good news stays in the Inbox (Nov 7, 2026)", () => {
    expect(computeContinueState({ blocking: 0, items: [item({ type: "customer_won", state: "unread" })], cycle: { running: true } })).toEqual({ kind: "processing" });
    expect(computeContinueState({ blocking: 0, items: [item({ type: "customer_won", state: "unread" })] })).toEqual({ kind: "idle" });
    expect(computeContinueState({ blocking: 0, items: [item({ type: "customer_won", state: "read" })] })).toEqual({ kind: "idle" });
  });

  it("shows processing while a cycle runs and Continue again once it is paused", () => {
    expect(computeContinueState({ blocking: 0, items: [], cycle: { running: true } })).toEqual({ kind: "processing" });
    expect(computeContinueState({ blocking: 0, items: [], cycle: { running: true, paused: true } })).toEqual({ kind: "idle" });
  });

  it("keeps processing (Pause) for a whole run, between its cycles too; a paused cycle still shows Continue (Nov 7, 2026)", () => {
    expect(computeContinueState({ blocking: 0, items: [], cycle: { running: true, run: true } })).toEqual({ kind: "processing", run: true });
    expect(computeContinueState({ blocking: 0, items: [], cycle: { running: false, run: true } })).toEqual({ kind: "processing", run: true });
    expect(computeContinueState({ blocking: 0, items: [], cycle: { running: true, paused: true, run: true } })).toEqual({ kind: "idle" });
    expect(computeContinueState({ blocking: 0, items: [], cycle: { running: false, run: false } })).toEqual({ kind: "idle" });
    // A hard stop and a vacation still come first.
    expect(computeContinueState({ blocking: 1, items: [], cycle: { running: false, run: true } })).toEqual({ kind: "blocked", count: 1 });
    expect(computeContinueState({ blocking: 0, items: [], holiday: { untilAt: null }, cycle: { running: false, run: true } }).kind).toBe("holiday");
  });

  it("holiday wins over everything and carries the until", () => {
    const until = new Date("2026-11-01T00:00:00Z");
    expect(computeContinueState({ blocking: 2, items: [], cycle: { running: true }, holiday: { untilAt: until } })).toEqual({ kind: "holiday", until, untilLabel: undefined });
    expect(computeContinueState({ blocking: 0, holiday: { untilAt: null, untilCondition: { text: "until MRR hits 10k" } } })).toEqual({ kind: "holiday", until: null, untilLabel: "MRR hits 10k" });
    expect(computeContinueState({ blocking: 0, holiday: { untilAt: null, untilCondition: null } })).toMatchObject({ kind: "holiday", untilLabel: "you return" });
    // A stored "until I return" reads "you return" after the bar's own "until" (audit VOL-X2).
    expect(computeContinueState({ blocking: 0, holiday: { untilAt: null, untilCondition: { text: "until I return" } } })).toMatchObject({ untilLabel: "you return" });
  });

  it("finds the first red item and the first unviewed win", () => {
    const items = [item({ id: "a", state: "answered", blocksContinue: true }), item({ id: "b", type: "decision", blocksContinue: true }), item({ id: "c", type: "customer_won" })];
    expect(firstBlockingItem(items)?.id).toBe("b");
    expect(unviewedWin(items)?.id).toBe("c");
    expect(firstBlockingItem(undefined)).toBeUndefined();
  });

  it("Respond · N opens the Inbox's Respond tab on the first red item, or the tab alone before inbox.list has answered (B1)", () => {
    const items = [item({ id: "a", state: "answered", blocksContinue: true }), item({ id: "b", type: "decision", blocksContinue: true })];
    expect(respondHref("biz", items)).toBe("/b/biz/inbox/b?tab=respond");
    expect(respondHref("biz", undefined)).toBe("/b/biz/inbox?tab=respond");
    expect(respondHref("biz", [item({ id: "c", type: "customer_won" })])).toBe("/b/biz/inbox?tab=respond");
  });

  it("Go to Journey opens the won customer's journey, and the win's note only when no journey is known (audit OL-27)", () => {
    expect(journeyHref("biz", { kind: "matchday", journeyId: "j1", itemId: "i1" }, "i0")).toBe("/b/biz/journey/j1");
    expect(journeyHref("biz", { kind: "matchday", journeyId: null, itemId: "i1" }, "i0")).toBe("/b/biz/inbox/i1");
    expect(journeyHref("biz", null, "i0")).toBe("/b/biz/inbox/i0");
    expect(journeyHref("biz", { kind: "idle" }, undefined)).toBe("/b/biz/inbox");
  });

  it("Come back waits for the 'While you were away' note: only holiday.ended with its report id opens it", () => {
    expect(awayReportId({ type: "holiday.ended", payload: { reportInboxItemId: "r1" } })).toBe("r1");
    expect(awayReportId({ type: "holiday.ended", payload: {} })).toBeNull();
    expect(awayReportId({ type: "holiday.ended", payload: null })).toBeNull();
    expect(awayReportId({ type: "inbox.item_created", payload: { reportInboxItemId: "r1" } })).toBeNull();
  });
});
