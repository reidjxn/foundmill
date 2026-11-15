/** Today's "This week and next" (founder, 2026-11-07): three to five plain sentences from data, US dates, no jargon. */
import { describe, expect, it } from "vitest";
import { founderJargonHits } from "./founder-words";
import { WEEK_PRESS_CONTINUE, weekDoneSentence, weekNextSentence, weekPlanWords, weekRoadmapSentence, weekRoundSentence, weekWaitingSentence, type WeekFacts } from "./today-words";

const TODAY = "2026-11-07";
const base: WeekFacts = {
  today: TODAY,
  done: { count: 6, topItem: { title: "Online booking", count: 4 } },
  running: null,
  next: { title: "Set up card payments" },
  waiting: 0,
  roadmapDue: null,
  rounds: { completed: 3, running: false, runOpen: false, autopilotNextOn: null },
};

function expectPlain(text: string) {
  expect(text, text).not.toMatch(/\b\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/);
  expect(text, text).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
  expect(text, text).not.toMatch(/\b(task|cycle|sprint|backlog)s?\b/i);
  expect(founderJargonHits(text), text).toEqual([]);
  expect(text.trim().endsWith(".")).toBe(true);
}

describe("weekPlanWords", () => {
  it("reads the plan's example: done with its roadmap item, next this round, the press-Continue line", () => {
    const words = weekPlanWords({ ...base, rounds: { ...base.rounds, runOpen: true } });
    expect(words.done).toEqual(["This week the team finished 6 pieces of work, 4 of them for “Online booking”."]);
    expect(words.next).toEqual(["Next: Set up card payments, starting this round.", "The next round starts on its own in a moment."]);
    expect(weekPlanWords(base).next).toEqual(["Next: Set up card payments.", WEEK_PRESS_CONTINUE]);
  });

  it("is always three to five sentences, every one plain", () => {
    const variants: WeekFacts[] = [
      base,
      { ...base, done: { count: 0, topItem: null }, next: null, rounds: { completed: 0, running: false, runOpen: false, autopilotNextOn: null } },
      { ...base, waiting: 3, roadmapDue: { title: "Online booking", dueOn: "2026-12-04" }, running: { title: "Write the booking page" }, rounds: { completed: 4, running: true, runOpen: true, autopilotNextOn: null } },
      { ...base, roadmapDue: { title: "Card payments", dueOn: "2027-12-04" }, rounds: { ...base.rounds, autopilotNextOn: "2026-11-09" } },
    ];
    for (const facts of variants) {
      const w = weekPlanWords(facts);
      const all = [...w.done, ...w.next];
      expect(all.length).toBeGreaterThanOrEqual(3);
      expect(all.length).toBeLessThanOrEqual(5);
      all.forEach(expectPlain);
    }
  });
});

describe("the sentences", () => {
  it("say what finished, never zero work as a count", () => {
    expect(weekDoneSentence({ count: 1, topItem: { title: "Online booking", count: 1 } }, 1)).toBe("This week the team finished 1 piece of work, for “Online booking”.");
    expect(weekDoneSentence({ count: 3, topItem: { title: "Online booking.", count: 3 } }, 1)).toBe("This week the team finished 3 pieces of work, all of them for “Online booking”.");
    expect(weekDoneSentence({ count: 1250, topItem: null }, 1)).toBe("This week the team finished 1,250 pieces of work.");
    expect(weekDoneSentence({ count: 4, topItem: { title: "X", count: 1 } }, 1)).toBe("This week the team finished 4 pieces of work.");
    expect(weekDoneSentence({ count: 0, topItem: null }, 2)).toBe("The team has not finished a piece of work this week yet.");
    expect(weekDoneSentence({ count: 0, topItem: null }, 0)).toMatch(/press Continue/);
  });

  it("count what waits in words", () => {
    expect(weekWaitingSentence(0)).toBeNull();
    expect(weekWaitingSentence(1)).toBe("1 piece of work is waiting on something before it can go on.");
    expect(weekWaitingSentence(2)).toBe("2 pieces of work are waiting on something before they can go on.");
  });

  it("name the work in hand first, then the next, then nothing queued", () => {
    expect(weekNextSentence({ ...base, running: { title: "Write the booking page" } })).toBe("Now: Write the booking page.");
    expect(weekNextSentence({ ...base, next: null })).toBe("Nothing is queued yet: the next round of work plans what comes after.");
  });

  it("date the roadmap in US words, labeled Estimate, and never a date already past", () => {
    expect(weekRoadmapSentence({ title: "Online booking", dueOn: "2026-12-04" }, TODAY)).toBe("“Online booking” is planned for Dec 4 (Estimate).");
    expect(weekRoadmapSentence({ title: "Online booking", dueOn: TODAY }, TODAY)).toBe("“Online booking” is planned today (Estimate).");
    expect(weekRoadmapSentence({ title: "Online booking", dueOn: "2027-12-04" }, TODAY)).toBe("“Online booking” is planned for Dec 4, 2027 (Estimate).");
    expect(weekRoadmapSentence({ title: "Online booking", dueOn: "2026-11-01" }, TODAY)).toBeNull();
    expect(weekRoadmapSentence(null, TODAY)).toBeNull();
  });

  it("say when the next round starts", () => {
    const r = base.rounds;
    expect(weekRoundSentence({ ...r, running: true }, TODAY)).toBe("The team is working now.");
    expect(weekRoundSentence({ ...r, running: true, runOpen: true }, TODAY)).toMatch(/starts on its own when this one ends/);
    expect(weekRoundSentence({ ...r, autopilotNextOn: TODAY }, TODAY)).toBe("Autopilot starts the next round later today (Estimate).");
    expect(weekRoundSentence({ ...r, autopilotNextOn: "2026-11-08" }, TODAY)).toBe("Autopilot starts the next round tomorrow (Estimate).");
    expect(weekRoundSentence({ ...r, autopilotNextOn: "2026-11-12" }, TODAY)).toBe("Autopilot starts the next round on Nov 12 (Estimate).");
    expect(weekRoundSentence(r, TODAY)).toBe(WEEK_PRESS_CONTINUE);
  });
});
