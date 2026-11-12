import { describe, expect, it } from "vitest";
import { FIRST_WEEK_DAYS, dayRangeWords, firstWeekTimeline, firstWeekVisible, type FirstWeekFacts } from "./first-week";

const fresh: FirstWeekFacts = { today: "2026-10-07", createdOn: "2026-10-07", specSignedOffOn: null, roadmapSignedOffOn: null, firstRoundOn: null, goalApprovedOn: null, distributionStartedOn: null, stopped: false };
const steps = (f: FirstWeekFacts) => firstWeekTimeline(f)!.steps;

describe("dayRangeWords", () => {
  it("writes US ranges with an en dash and drops a repeated month", () => {
    expect(dayRangeWords("2026-10-08", "2026-10-09", "2026-10-07")).toBe("Oct 8 – 9");
    expect(dayRangeWords("2026-10-30", "2026-11-02", "2026-10-30")).toBe("Oct 30 – Nov 2");
    expect(dayRangeWords("2026-10-07", "2026-10-07", "2026-10-07")).toBe("Oct 7");
  });
});

describe("firstWeekTimeline", () => {
  it("day one of a new business: Day 1 is now, the rest are next with Estimate windows", () => {
    const t = firstWeekTimeline(fresh)!;
    expect(t.title).toBe("Your first week");
    expect(steps(fresh).map((s) => [s.label, s.state])).toEqual([["Day 1", "now"], ["Days 2–3", "next"], ["Week 1", "next"]]);
    expect(steps(fresh).map((s) => s.when)).toEqual(["Oct 7 (Estimate)", "Oct 8 – 9 (Estimate)", "Oct 10 – 13 (Estimate)"]);
    expect(steps(fresh)[0]!.asks).toBe("You are asked to publish your page and sign off the specification and the roadmap.");
    expect(steps(fresh)[0]!.team).toBe("Your team drafts your page, your specification and your roadmap.");
    expect(steps(fresh)[2]!.asks).toContain("“Ready to start selling?”");
    expect(t.paused).toBeNull();
  });

  it("asks only for what is still open", () => {
    expect(steps({ ...fresh, specSignedOffOn: "2026-10-07" })[0]!.asks).toBe("You are asked to publish your page and sign off the roadmap.");
    expect(steps({ ...fresh, pagePublishedOn: "2026-10-07", specSignedOffOn: "2026-10-07" })[0]!.asks).toBe("You are asked to sign off the roadmap.");
    expect(steps({ ...fresh, specSignedOffOn: "2026-10-07", roadmapSignedOffOn: "2026-10-07" })[0]).toMatchObject({ state: "now", asks: "You are asked to publish your page." });
    const mid = steps({ ...fresh, today: "2026-10-08", pagePublishedOn: "2026-10-07", specSignedOffOn: "2026-10-07", roadmapSignedOffOn: "2026-10-07", firstRoundOn: "2026-10-08" });
    expect(mid[1]!.state).toBe("now");
    expect(mid[1]!.asks).toBe("You are asked to approve your first goal, once your Chief of Staff proposes it.");
  });

  it("mid-week: Day 1 and Days 2–3 are done with their real US dates, Week 1 is now", () => {
    const s = steps({ ...fresh, today: "2026-10-10", pagePublishedOn: "2026-10-07", specSignedOffOn: "2026-10-07", roadmapSignedOffOn: "2026-10-08", firstRoundOn: "2026-10-08", goalApprovedOn: "2026-10-09" });
    expect(s.map((x) => x.state)).toEqual(["done", "done", "now"]);
    expect(s[0]!.when).toBe("Done Oct 8");
    expect(s[1]!.when).toBe("Done Oct 9");
    expect(s[2]!.when).toBe("Oct 10 – 13 (Estimate)");
    expect(s[0]!.team).toBe("Drafted your page, your specification and your roadmap.");
    expect(s[0]!.asks).toBe("You published your page and signed off the specification and the roadmap.");
  });

  it("Day 1 is done on the latest of the page going live and the two sign-offs", () => {
    const s = steps({ ...fresh, today: "2026-10-09", pagePublishedOn: "2026-10-09", specSignedOffOn: "2026-10-07", roadmapSignedOffOn: "2026-10-07" });
    expect(s[0]).toMatchObject({ state: "done", when: "Done Oct 9" });
    expect(s[1]!.state).toBe("now");
  });

  it("Week 1 promises an approach only when a channel can run; otherwise the team gets ready", () => {
    expect(steps(fresh)[2]!.team).toBe("Your team starts approaching the first customers.");
    expect(steps({ ...fresh, noChannelCanRun: false })[2]!.team).toBe("Your team starts approaching the first customers.");
    expect(steps({ ...fresh, noChannelCanRun: true })[2]!.team).toBe("Your team gets ready to approach the first customers; a channel starts as soon as one can run.");
  });

  it("reads the state from the facts, not from the calendar: a slow business stays on Day 1 on day 4", () => {
    const s = steps({ ...fresh, today: "2026-10-10" });
    expect(s.map((x) => x.state)).toEqual(["now", "next", "next"]);
  });

  it("is away after the first days, once distribution started, and for a past-it sample business", () => {
    expect(firstWeekTimeline({ ...fresh, today: "2026-10-17" })).toBeNull();
    expect(firstWeekTimeline({ ...fresh, today: "2026-10-16" })).not.toBeNull();
    expect(firstWeekTimeline({ ...fresh, distributionStartedOn: "2026-10-07" })).toBeNull();
    // A seeded sample: created today by the seed, signed off, selling.
    expect(firstWeekVisible({ today: "2026-11-09", createdOn: "2026-11-09", distributionStartedOn: "2026-10-26" })).toBe(false);
    expect(FIRST_WEEK_DAYS).toBe(10);
  });

  it("says when the team is stopped and keeps the steps", () => {
    const t = firstWeekTimeline({ ...fresh, stopped: true })!;
    expect(t.paused).toBe("The team is stopped, so nothing moves on until you resume it.");
    expect(t.steps).toHaveLength(3);
  });

  it("writes dates across a year end in US form, never day-first", () => {
    const text = JSON.stringify(steps({ ...fresh, createdOn: "2026-12-30", today: "2026-12-30" }));
    expect(text).toContain("Dec 31 – Jan 1");
    expect(text).not.toMatch(/\d{1,2}\/\d{1,2}/);
  });
});
