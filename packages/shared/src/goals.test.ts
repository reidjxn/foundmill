/** The goal's words (founder, 2026-11-07): US dates, the business's own money, no jargon, a deterministic reader. */
import { describe, expect, it } from "vitest";
import { founderJargonHits } from "./founder-words";
import {
  GOAL_SAY_A_NUMBER,
  addDaysToDay,
  defaultGoalFor,
  goalDateWords,
  goalOptions,
  goalPaceSentence,
  goalProposalBody,
  goalProposalSubject,
  goalReachedBody,
  goalReachedSubject,
  goalSentence,
  nextGoalAfter,
  nextRoundAbove,
  parseGoalWords,
  retryGoalAfterMiss,
  validGoalDay,
  validGoalTarget,
  type GoalShape,
} from "./goals";

const TODAY = "2026-11-07";
const first = defaultGoalFor({ payingCustomers: 0, today: TODAY });

/** Day-first dates, ISO dates and British spellings never reach a founder. */
function expectUsWords(text: string) {
  expect(text, text).not.toMatch(/\b\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/);
  expect(text, text).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
  expect(text, text).not.toMatch(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/);
  expect(founderJargonHits(text), text).toEqual([]);
}

describe("the default goal", () => {
  it("is the first 10 paying customers in six weeks, or the next round number above 1.5 times the customers", () => {
    expect(first).toEqual({ kind: "paying_customers", target: 10, currency: null, dueOn: "2026-12-19", text: null });
    expect(defaultGoalFor({ payingCustomers: 4, today: TODAY }).target).toBe(10);
    expect(defaultGoalFor({ payingCustomers: 10, today: TODAY }).target).toBe(20);
    expect(defaultGoalFor({ payingCustomers: 13, today: TODAY }).target).toBe(20);
    expect(defaultGoalFor({ payingCustomers: 40, today: TODAY }).target).toBe(75);
    expect(defaultGoalFor({ payingCustomers: 210, today: TODAY }).target).toBe(400);
    expect([9, 10, 14, 15, 99, 100, 149, 1234].map(nextRoundAbove)).toEqual([10, 15, 15, 20, 100, 150, 150, 1500]);
  });

  it("the next goal after one is reached keeps its kind; a missed goal keeps its aim with a new date", () => {
    expect(nextGoalAfter({ kind: "paying_customers", currency: null }, { current: 12, today: TODAY })).toMatchObject({ kind: "paying_customers", target: 20, dueOn: "2026-12-19" });
    expect(nextGoalAfter({ kind: "revenue_month", currency: "GBP" }, { current: 500_000, today: TODAY })).toMatchObject({ kind: "revenue_month", target: 1_000_000, currency: "GBP" });
    const missed: GoalShape = { kind: "signups", target: 50, currency: null, dueOn: "2026-11-01" };
    expect(retryGoalAfterMiss(missed, TODAY)).toEqual({ ...missed, dueOn: "2026-12-19" });
  });
});

describe("the words", () => {
  it("writes the sentence and the subject with US dates (the year only when it is not implied)", () => {
    expect(goalSentence(first, { today: TODAY, startValue: 0 })).toBe("Get the first 10 paying customers by Dec 19");
    expect(goalProposalSubject(first, "first", TODAY)).toBe("Your first goal: get 10 paying customers by Dec 19");
    expect(goalSentence({ ...first, target: 30 }, { today: TODAY, startValue: 12 })).toBe("Reach 30 paying customers by Dec 19");
    expect(goalSentence({ kind: "revenue_month", target: 500_000, currency: "GBP", dueOn: "2027-03-31" }, { today: TODAY, startValue: 120_000 })).toBe("Reach £5,000 of revenue in a month by Mar 31");
    expect(goalSentence({ kind: "signups", target: 1, currency: null, dueOn: "2028-01-31" }, { today: TODAY, startValue: 0 })).toBe("Get the first 1 signup by Jan 31, 2028");
    expect(goalSentence({ kind: "custom", target: null, currency: null, dueOn: "2026-12-01", text: "launch the booking page." }, { today: TODAY })).toBe("Launch the booking page by Dec 1");
    expect(goalDateWords("2027-01-31", TODAY)).toBe("Jan 31");
    expect(goalDateWords("2027-11-30", TODAY)).toBe("Nov 30, 2027");
    expect(goalProposalSubject({ kind: "custom", target: null, currency: null, dueOn: "2026-12-01", text: "x".repeat(200) }, "revised", TODAY).length).toBeLessThanOrEqual(80);
  });

  it("every note, option and progress line reads plainly (no jargon, US dates)", () => {
    const sentence = goalSentence(first, { today: TODAY, startValue: 0 });
    const texts = [
      sentence,
      goalProposalSubject(first, "first", TODAY),
      goalProposalSubject(first, "revised", TODAY),
      goalProposalSubject(first, "next", TODAY),
      goalProposalSubject(first, "missed", TODAY),
      goalProposalBody({ reason: "first", sentence, today: TODAY }),
      goalProposalBody({ reason: "revised", sentence, changeWords: "20 customers by Jan 31", today: TODAY }),
      goalProposalBody({ reason: "next", sentence, previous: { sentence: "Get the first 10 paying customers by Dec 19", dueOn: "2026-12-19", current: 10, target: 10, kind: "paying_customers", currency: null }, today: TODAY }),
      goalProposalBody({ reason: "missed", sentence, previous: { sentence: "Get the first 10 paying customers by Nov 1", dueOn: "2026-11-01", current: 7, target: 10, kind: "paying_customers", currency: null }, today: TODAY }),
      ...goalOptions(first, "first").flatMap((o) => [o.label, o.consequence, o.because ?? ""]),
      goalOptions(first, "missed")[0]!.because ?? "",
      goalReachedSubject(first),
      goalReachedBody({ sentence, reachedOn: "2026-12-02", dueOn: "2026-12-19", today: "2026-12-02" }),
      GOAL_SAY_A_NUMBER,
    ];
    for (const t of texts) expectUsWords(t);
    expect(goalProposalBody({ reason: "first", sentence, today: TODAY })).toBe("**Get the first 10 paying customers by Dec 19.**\n\nI suggest we aim for this next, so every round of work moves one thing. Approve it, or tell me what to change.");
    expect(goalProposalBody({ reason: "missed", sentence, previous: { sentence: "x", dueOn: "2026-11-01", current: 7, target: 10, kind: "paying_customers", currency: null }, today: TODAY })).toContain("Nov 1 passed at 7 of 10. ");
    expect(goalOptions(first, "first")[0]).toMatchObject({ id: "approve", label: "Approve this goal", recommended: true, because: "Recommended because the first customers tell us what to build next." });
    expect(goalOptions(first, "first")[1]).toMatchObject({ id: "change", label: "Change it", recommended: false });
    expect(goalReachedSubject(first)).toBe("Goal reached: 10 paying customers");
  });

  it("the progress line: on pace, behind, overdue, reached, custom (projections labeled Forecast)", () => {
    const base = { kind: "paying_customers" as const, target: 10, startValue: 0, startedOn: "2026-11-01", dueOn: "2026-12-15", currency: null };
    expect(goalPaceSentence({ ...base, current: 4, today: "2026-11-07" })).toBe("4 of 10 so far, 38 days left: on pace (Forecast).");
    expect(goalPaceSentence({ ...base, current: 1, today: "2026-11-07" })).toBe("1 of 10 so far, 38 days left: at this pace about 7 by Dec 15 (Forecast).");
    expect(goalPaceSentence({ ...base, current: 7, today: "2026-12-16" })).toBe("Dec 15 passed at 7 of 10.");
    expect(goalPaceSentence({ ...base, current: 10, today: "2026-12-02", achievedOn: "2026-12-02" })).toBe("Reached on Dec 2, 13 days early.");
    expect(goalPaceSentence({ ...base, kind: "custom", current: null, target: null, today: TODAY })).toBe("No number to track yet.");
    expect(goalPaceSentence({ kind: "revenue_month", target: 500_000, currency: "GBP", startValue: 0, startedOn: "2026-11-01", dueOn: "2026-11-30", current: 120_000, today: "2026-11-10" })).toBe("£1,200 of £5,000 so far, 20 days left: at this pace about £3,600 by Nov 30 (Forecast).");
  });
});

describe("parseGoalWords", () => {
  const read = (words: string, base: GoalShape = first) => parseGoalWords(words, { base, today: TODAY, currency: "GBP" });

  it("reads a number with what it counts and a date", () => {
    expect(read("20 customers by Jan 31")).toEqual({ kind: "paying_customers", target: 20, currency: null, dueOn: "2027-01-31", text: null });
    expect(read("Make it 50 sign-ups by the end of January")).toMatchObject({ kind: "signups", target: 50, dueOn: "2027-01-31" });
    expect(read("£5,000 a month by March")).toMatchObject({ kind: "revenue_month", target: 500_000, currency: "GBP", dueOn: "2027-03-31" });
    expect(read("5k revenue")).toMatchObject({ kind: "paying_customers", target: 5000 });
    expect(read("30 paying customers in 8 weeks")).toMatchObject({ kind: "paying_customers", target: 30, dueOn: "2027-01-02" });
    expect(read("31 December")).toMatchObject({ target: 10, dueOn: "2026-12-31" });
    expect(read("Dec 1, 2027")).toMatchObject({ dueOn: "2027-12-01" });
  });

  it("a number alone changes the target, a date alone the date; nothing readable, or no change, is null", () => {
    expect(read("make it 15")).toMatchObject({ kind: "paying_customers", target: 15, dueOn: "2026-12-19" });
    expect(read("by the end of the month")).toMatchObject({ target: 10, dueOn: "2026-11-30" });
    expect(read("that is too ambitious")).toBeNull();
    expect(read("10 customers by Dec 19")).toBeNull();
    expect(read("")).toBeNull();
    // A date in the past or more than two years out keeps the proposal's date.
    expect(read("20 customers by 2020-01-01")).toMatchObject({ target: 20, dueOn: "2026-12-19" });
  });

  it("validates days and targets", () => {
    expect(validGoalDay(addDaysToDay(TODAY, 1), TODAY)).toBe(true);
    expect(validGoalDay(TODAY, TODAY)).toBe(false);
    expect(validGoalDay("2026-02-30", TODAY)).toBe(false);
    expect(validGoalDay(addDaysToDay(TODAY, 800), TODAY)).toBe(false);
    expect(validGoalTarget("custom", null)).toBe(true);
    expect(validGoalTarget("signups", 0)).toBe(false);
    expect(validGoalTarget("signups", 2.5)).toBe(false);
  });
});
