import { describe, expect, it } from "vitest";
import { defaultCallSelection, callRowActionsLine, callRowState } from "../lobby-logic";

describe("defaultCallSelection", () => {
  it("ticks the Chief of Staff, then the leads, never specialists, background helpers or released agents", () => {
    const agents = [
      { id: "spec", tier: "specialist", layer: "worker", agentType: "writer" },
      { id: "lead1", tier: "lead", layer: "lead", agentType: "product_lead" },
      { id: "cos", tier: "chief", chiefOfStaff: true, layer: "assistant", agentType: "chief_of_staff" },
      { id: "bg", tier: "background", layer: "utility", agentType: "categoriser" },
      { id: "gone", tier: "lead", archivedAt: "2026-11-01T00:00:00Z", layer: "lead", agentType: "x" },
      { id: "lead2", tier: "lead", layer: "lead", agentType: "growth_lead" },
    ];
    expect(defaultCallSelection(agents)).toEqual(["cos", "lead1", "lead2"]);
  });
  it("stops at eight", () => {
    const leads = Array.from({ length: 12 }, (_, i) => ({ id: `l${i}`, tier: "lead", layer: "lead", agentType: "x" }));
    expect(defaultCallSelection(leads)).toHaveLength(8);
  });
});

describe("callRowActionsLine", () => {
  it("reads like the wrap-up's line", () => {
    expect(callRowActionsLine({ actionCount: 4, filedCount: 3, awaitingCount: 1 })).toBe("3 filed · 1 needs your go-ahead");
    expect(callRowActionsLine({ actionCount: 0, filedCount: 0, awaitingCount: 0 })).toBe("Nothing to file from this call.");
    expect(callRowActionsLine({ actionCount: 5, filedCount: 2, awaitingCount: 0 })).toBe("2 filed · 3 more");
    expect(callRowActionsLine({ actionCount: 2, filedCount: 0, awaitingCount: 0 })).toBe("2 more");
  });
});

describe("callRowState", () => {
  it("says In progress only for a live call, and a failed write-up says the call ended", () => {
    expect(callRowState("live")).toBe("In progress");
    expect(callRowState("wrapping_up")).toBe("Writing up");
    expect(callRowState("wrap_up_failed")).toBe("Ended, couldn't write up");
    expect(callRowState("ended")).toBe("No summary");
  });
});
