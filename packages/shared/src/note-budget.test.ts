/** The first week's note budget (WP-04 T8): which notes reach the Inbox and which are folded into the day's digest. */
import { describe, expect, it } from "vitest";
import { DIGEST_SUBJECT, digestBody, noteVerdict, type NoteFacts } from "./note-budget";

const DAYS = 7;
const committedAt = new Date("2026-11-10T09:00:00Z");
const day = (n: number) => new Date(committedAt.getTime() + (n - 1) * 24 * 60 * 60 * 1000 + 60_000);
const update = (over: Partial<NoteFacts> = {}): NoteFacts => ({ type: "update", hasDecision: false, blocksContinue: false, fromChiefOfStaff: false, committedAt, isDemo: false, now: day(1), ...over });

describe("noteVerdict", () => {
  it.each<[string, Partial<NoteFacts>, "deliver" | "fold"]>([
    ["a decision delivers", { type: "decision", hasDecision: true }, "deliver"],
    ["an update carrying a decision delivers", { hasDecision: true }, "deliver"],
    ["a lead's update on day 2 folds", { now: day(2) }, "fold"],
    ["a lead's report on day 1 folds", { type: "report" }, "fold"],
    ["a lead's update on day 7 folds", { now: day(7) }, "fold"],
    ["the same update on day 9 delivers", { now: day(9) }, "deliver"],
    ["a demo business always delivers", { isDemo: true, now: day(2) }, "deliver"],
    ["a warning delivers", { type: "warning" }, "deliver"],
    ["a win delivers", { type: "customer_won" }, "deliver"],
    ["a milestone delivers", { type: "milestone" }, "deliver"],
    ["a person's message delivers", { type: "human_message" }, "deliver"],
    ["an update holding Continue delivers", { blocksContinue: true }, "deliver"],
    ["the Chief of Staff's own update delivers", { fromChiefOfStaff: true }, "deliver"],
    ["a project not committed yet delivers", { committedAt: null }, "deliver"],
  ])("%s", (_name, over, verdict) => {
    expect(noteVerdict(update(over), DAYS)).toBe(verdict);
  });

  it("follows the number of first-week days it is given", () => {
    expect(noteVerdict(update({ now: day(4) }), 3)).toBe("deliver");
    expect(noteVerdict(update({ now: day(3) }), 3)).toBe("fold");
  });
});

describe("digestBody", () => {
  it("lists each agent's note on its own line", () => {
    const body = digestBody([
      { agentName: "Maya", subject: "Drafted the page" },
      { agentName: "Leo", subject: "Read three competitors" },
    ]);
    expect(body).toContain("- Maya: Drafted the page");
    expect(body).toContain("- Leo: Read three competitors");
    expect(body).not.toMatch(/more in the Inbox/);
  });

  it("shows at most 8 lines, then how many more are in the Inbox", () => {
    const lines = Array.from({ length: 11 }, (_, i) => ({ agentName: `Agent ${i + 1}`, subject: `Note ${i + 1}` }));
    const body = digestBody(lines);
    expect(body.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(8);
    expect(body).toContain("And 3 more in the Inbox");
    expect(body).not.toContain("Note 9");
  });

  it("has a subject that fits a note", () => {
    expect(DIGEST_SUBJECT).toBe("What your team did today");
    expect(DIGEST_SUBJECT.length).toBeLessThanOrEqual(80);
  });
});
