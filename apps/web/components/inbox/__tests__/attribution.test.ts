/**
 * Inbox attribution for co-founders (RUI-11): a decision says who made it (You only for the person who did), and a plan
 * awaiting confirmation names who it waits for.
 */
import { describe, expect, it } from "vitest";
import { decisionAttribution, planStatusLine } from "../logic";

const names: Record<string, string> = { u1: "Reid", u2: "Ada Lovelace" };
const nameOf = (id: string) => names[id] ?? null;

describe("decisionAttribution (RUI-11)", () => {
  it("is 'You' only for the viewer's own decision", () => {
    const decisions = [{ decidedBy: "u1", decidedByKind: "user", decidedAt: "2026-10-08T10:00:00Z" }];
    expect(decisionAttribution(decisions, "u1", nameOf)).toMatchObject({ label: "Your answer", by: "You", mine: true });
    expect(decisionAttribution(decisions, "u2", nameOf)).toMatchObject({ label: "Answer", by: "Reid", mine: false });
  });
  it("uses the latest decision, names an unknown member plainly and credits the Chief of Staff", () => {
    const decisions = [
      { decidedBy: "u1", decidedByKind: "user", decidedAt: "2026-10-08T10:00:00Z" },
      { decidedBy: "u9", decidedByKind: "user", decidedAt: "2026-10-08T11:00:00Z" },
    ];
    expect(decisionAttribution(decisions, "u1", nameOf)).toMatchObject({ by: "another member", mine: false });
    expect(decisionAttribution([{ decidedBy: null, decidedByKind: "chief_of_staff", decidedAt: "2026-10-08T10:00:00Z" }], "u1")).toMatchObject({ by: "the Chief of Staff", mine: false });
    expect(decisionAttribution([], "u1")).toBeNull();
  });
});

describe("planStatusLine names who confirms (RUI-11)", () => {
  it("says 'your' to the person it waits for and names them to everyone else", () => {
    const plan = { status: "pending_confirmation", actions: [{ type: "set_budget", params: null }] };
    expect(planStatusLine(plan)?.word).toBe("Awaiting your confirmation");
    expect(planStatusLine(plan, "Ada Lovelace")?.word).toBe("Awaiting confirmation from Ada Lovelace");
  });
});
