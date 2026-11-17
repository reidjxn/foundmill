/** Today's mapping (founder, 2026-11-07): the goal's pill and bar words, the proposer, and Needs you's links. */
import { describe, expect, it } from "vitest";
import { createAgentPersonaApi } from "@foundmill/dugout";
import { goalPaceState, goalValueText, needsYouHref, toNeedsYouRows, toPanelGoal, toPanelProposal, todaySections, type GoalViewLike } from "../today-view";

const TODAY = "2026-11-07";
const goal: GoalViewLike = {
  id: "g1",
  sentence: "Get the first 10 paying customers by Dec 19",
  kind: "paying_customers",
  target: 10,
  currency: null,
  dueOn: "2026-12-19",
  reason: "first",
  achievedAt: null,
  proposedBy: { id: "a1", name: "Ines Park" },
  progress: { current: 4, pace: "4 of 10 so far, 42 days left: on pace (Forecast)." },
};

describe("the goal on Today", () => {
  it("reads the bar's value in words, money in the business's own currency", () => {
    expect(goalValueText(goal)).toBe("4 of 10 paying customers");
    expect(goalValueText({ kind: "revenue_month", currency: "GBP", target: 500_000, progress: { current: 120_000, pace: "" } })).toBe("£1,200 of £5,000");
    expect(goalValueText({ ...goal, progress: null })).toBe("No number to track yet");
  });

  it("names where the goal stands", () => {
    expect(goalPaceState(goal, TODAY)).toBe("on_pace");
    expect(goalPaceState({ ...goal, progress: { current: 1, pace: "1 of 10 so far, 42 days left: at this pace about 3 by Dec 19 (Forecast)." } }, TODAY)).toBe("behind");
    expect(goalPaceState({ ...goal, dueOn: "2026-11-01" }, TODAY)).toBe("overdue");
    expect(goalPaceState({ ...goal, achievedAt: "2026-11-06T10:00:00Z" }, TODAY)).toBe("reached");
    expect(goalPaceState({ ...goal, progress: null }, TODAY)).toBe("untracked");
  });

  it("maps the active goal and the proposal, the proposer by its stored name", () => {
    expect(toPanelGoal(goal, TODAY)).toMatchObject({ id: "g1", state: "on_pace", progress: { current: 4, target: 10, valueText: "4 of 10 paying customers" } });
    expect(toPanelProposal(goal, "Someone Else")).toEqual({ id: "g1", sentence: goal.sentence, proposedBy: "Ines Park", because: "Recommended because the first customers tell us what to build next." });
    expect(toPanelProposal({ ...goal, proposedBy: null }, "Mara Quinn").proposedBy).toBe("Mara Quinn");
  });
});

describe("Needs you on Today", () => {
  it("opens each note in the Inbox's Needs you tab and keeps its one tap", () => {
    expect(needsYouHref("b1")).toBe("/b/b1/inbox?tab=respond");
    const rows = toNeedsYouRows("b1", [
      { id: "n1", subject: "Your first goal", blocksContinue: false, kind: "goal", fromAgent: { id: "a1", name: "Ines Park" }, quickOption: { id: "approve", label: "Approve this goal" } },
      { id: "n2", subject: "Credits used up", blocksContinue: true, kind: "warning", fromAgent: null, quickOption: null },
    ]);
    expect(rows[0]).toEqual({ id: "n1", subject: "Your first goal", from: "Ines Park", kindLabel: "Goal", href: "/b/b1/inbox/n1?tab=respond", quickOption: { id: "approve", label: "Approve this goal" }, holdsContinue: false });
    expect(rows[1]).toMatchObject({ from: null, kindLabel: "Your decision", quickOption: null, holdsContinue: true });
  });

  it("names the sender and the agents in the subject under the reader's preference (One name everywhere)", () => {
    const lead = { id: "a1", name: "Engineering Lead", role: "Head of Engineering", personaKey: "malik" };
    const items = [{ id: "n1", subject: "Engineering Lead needs your OK: GitHub › open pull request", blocksContinue: false, kind: "approval" as const, fromAgent: lead, quickOption: null }];
    const on = createAgentPersonaApi({ anthropomorphic: true });
    const rows = toNeedsYouRows("b1", items, { labelFor: on.labelFor, withNames: on.withNames, roster: [] });
    expect(rows[0]).toMatchObject({ subject: "Malik (Head of Engineering) needs your OK: GitHub › open pull request", from: "Malik (Head of Engineering)" });
    const off = createAgentPersonaApi({ anthropomorphic: false });
    expect(toNeedsYouRows("b1", items, { labelFor: off.labelFor, withNames: off.withNames, roster: [] })[0]).toMatchObject({ subject: "Engineering Lead needs your OK: GitHub › open pull request", from: "Engineering Lead" });
  });
});

describe("Today's order (WP-04 T7)", () => {
  it("on a phone Needs you leads, then the page line, the first week, the goal, the week, Since you were last here, the streak and health", () => {
    expect(todaySections({ phone: true, pageFirst: false, firstDay: false })).toEqual(["needs-you", "public-page", "post-ready", "first-week", "goal", "week", "since", "streak", "health"]);
  });

  it("on a computer Needs you leads only while the page waits to be checked; otherwise the first week and the goal come first", () => {
    expect(todaySections({ phone: false, pageFirst: true, firstDay: true }).slice(0, 5)).toEqual(["needs-you", "public-page", "post-ready", "first-week", "goal"]);
    expect(todaySections({ phone: false, pageFirst: false, firstDay: false })).toEqual(["first-week", "goal", "needs-you", "public-page", "post-ready", "week", "since", "streak", "health"]);
  });

  it("hides the streak and the health figures on the project's first day, and until it is known (WP-04 D5)", () => {
    for (const phone of [true, false]) {
      expect(todaySections({ phone, pageFirst: false, firstDay: true })).not.toEqual(expect.arrayContaining(["streak"]));
      expect(todaySections({ phone, pageFirst: false, firstDay: true })).not.toContain("health");
      expect(todaySections({ phone, pageFirst: false, firstDay: null })).not.toContain("streak");
      const day2 = todaySections({ phone, pageFirst: false, firstDay: false });
      // The streak sits low: after the goal, the week plan and Since you were last here.
      expect(day2.indexOf("streak")).toBeGreaterThan(Math.max(day2.indexOf("goal"), day2.indexOf("week"), day2.indexOf("since")));
      expect(day2.at(-1)).toBe("health");
    }
  });
});
