import { describe, expect, it } from "vitest";
import { computeContinueState, firstBlockingItem, respondHref, unviewedWin, type ContinueInboxItem } from "../continue-state";

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

  it("shows Go to Journey for an unviewed win", () => {
    expect(computeContinueState({ blocking: 0, items: [item({ type: "customer_won", state: "unread" })], cycle: { running: true } })).toEqual({ kind: "matchday" });
    expect(computeContinueState({ blocking: 0, items: [item({ type: "customer_won", state: "read" })] })).toEqual({ kind: "idle" });
  });

  it("shows processing while a cycle runs and Continue again once it is paused", () => {
    expect(computeContinueState({ blocking: 0, items: [], cycle: { running: true } })).toEqual({ kind: "processing" });
    expect(computeContinueState({ blocking: 0, items: [], cycle: { running: true, paused: true } })).toEqual({ kind: "idle" });
  });

  it("holiday wins over everything and carries the until", () => {
    const until = new Date("2026-11-01T00:00:00Z");
    expect(computeContinueState({ blocking: 2, items: [], cycle: { running: true }, holiday: { untilAt: until } })).toEqual({ kind: "holiday", until, untilLabel: undefined });
    expect(computeContinueState({ blocking: 0, holiday: { untilAt: null, untilCondition: { text: "until MRR hits 10k" } } })).toEqual({ kind: "holiday", until: null, untilLabel: "MRR hits 10k" });
    expect(computeContinueState({ blocking: 0, holiday: { untilAt: null, untilCondition: null } })).toMatchObject({ kind: "holiday", untilLabel: "you return" });
  });

  it("finds the first red item and the first unviewed win", () => {
    const items = [item({ id: "a", state: "answered", blocksContinue: true }), item({ id: "b", type: "decision", blocksContinue: true }), item({ id: "c", type: "customer_won" })];
    expect(firstBlockingItem(items)?.id).toBe("b");
    expect(unviewedWin(items)?.id).toBe("c");
    expect(firstBlockingItem(undefined)).toBeUndefined();
  });

  it("Respond · N opens the first red item, or the Respond tab before inbox.list has answered", () => {
    const items = [item({ id: "a", state: "answered", blocksContinue: true }), item({ id: "b", type: "decision", blocksContinue: true })];
    expect(respondHref("biz", items)).toBe("/b/biz/inbox/b");
    expect(respondHref("biz", undefined)).toBe("/b/biz/inbox?tab=respond");
    expect(respondHref("biz", [item({ id: "c", type: "customer_won" })])).toBe("/b/biz/inbox?tab=respond");
  });
});
