/** The Chief of Staff's three answers: plain sentences from Today's facts, valid entity markup, honest labels. */
import { describe, expect, it } from "vitest";
import { CHIEF_PURPOSE_MAX, CHIEF_QUESTIONS, CHIEF_QUESTION_LABELS, chiefAnswer, chiefPageKind, chiefPagePurpose, type ChiefFacts, type ChiefPage, type ChiefQuestion } from "./chief-answers";
import { ENTITY_MARKUP_RE } from "./constants";
import { founderJargonHits } from "./founder-words";
import type { WeekFacts } from "./today-words";

const TODAY = "2026-11-09";
const AGENT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const week: WeekFacts = { today: TODAY, done: { count: 6, topItem: { title: "Online booking", count: 4 } }, running: null, next: { title: "Set up card payments" }, waiting: 0, roadmapDue: null, rounds: { completed: 3, running: false, runOpen: false, autopilotNextOn: null } };
const goal = { sentence: "Get the first 10 paying customers by Dec 19", kind: "paying_customers" as const, target: 10, currency: null, dueOn: "2026-12-19", achievedAt: null, progress: { current: 4, pace: "4 of 10 so far, 40 days left: on pace (Forecast)." } };

/** A quiet business: a team that has not started, no goal, nothing waiting. */
const quiet: ChiefFacts = { today: TODAY, work: { week: { ...week, done: { count: 0, topItem: null }, next: null, rounds: { ...week.rounds, completed: 0 } }, running: [], blocked: [] }, goal: null, needsYou: { total: 0, holding: 0, top: null }, stopped: null, vacation: null, paused: false, failure: null, agentsWorking: 0 };
const busy: ChiefFacts = { ...quiet, work: { week, running: [{ title: "Set up card payments", agent: { id: AGENT, name: "Juno Reyes" } }], blocked: [] }, goal, agentsWorking: 1 };
const page: ChiefPage = { path: "/b/b1/today" };
const ask = (q: ChiefQuestion, f: ChiefFacts, p: ChiefPage = page) => chiefAnswer(q, f, p).text;

function expectPlain(text: string) {
  expect(text, text).not.toMatch(/\b\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/);
  expect(text, text).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
  expect(text, text).not.toMatch(/\b(task|cycle|sprint|backlog|squad)s?\b/i);
  expect(founderJargonHits(text.replace(ENTITY_MARKUP_RE, "$2")), text).toEqual([]);
  expect(text.trim()).toMatch(/[.!?]$/);
  // Two to four sentences, never more.
  expect(text.replace(ENTITY_MARKUP_RE, "$2").split(/(?<=[.!?”])\s+(?=[A-Z“])/).length, text).toBeLessThanOrEqual(5);
}

/** Every entity mention is a real `[[ent:<uuid>|Name]]` and no markup is left half open. */
function expectValidMarkup(text: string) {
  expect(text.replace(ENTITY_MARKUP_RE, "")).not.toMatch(/\[\[|\]\]/);
}

describe("the starter questions", () => {
  it("are the three of the report, in order", () => {
    expect(CHIEF_QUESTIONS.map((q) => CHIEF_QUESTION_LABELS[q])).toEqual(["What's happening?", "What's blocking us?", "Why am I seeing this?"]);
  });
});

describe("What's happening?", () => {
  it("names the agent at work, what finished this week and where the goal stands, labeling the pace Forecast", () => {
    const text = ask("happening", busy);
    expect(text).toContain(`[[ent:${AGENT}|Juno Reyes]] is working on “Set up card payments”.`);
    expect(text).toContain("This week the team finished 6 pieces of work, 4 of them for “Online booking”.");
    expect(text).toContain("Your goal is “Get the first 10 paying customers by Dec 19”. 4 of 10 so far, 40 days left: on pace (Forecast).");
    expectValidMarkup(text);
    expectPlain(text);
  });

  it("on a quiet business says what comes next and how work starts, and never invents a goal", () => {
    const text = ask("happening", quiet);
    expect(text).toContain("Nothing is queued yet");
    expect(text).toContain("Press Continue and the team keeps going until nothing is left.");
    expect(text).not.toContain("Your goal");
    expectPlain(text);
  });

  it("with two pieces of work names up to two agents and counts the rest", () => {
    const text = ask("happening", { ...busy, work: { ...busy.work!, running: [{ title: "A", agent: { id: AGENT, name: "Juno Reyes" } }, { title: "B", agent: { id: OTHER, name: "Kit Moreau" } }, { title: "C", agent: null }] } });
    expect(text).toContain(`[[ent:${AGENT}|Juno Reyes]] and [[ent:${OTHER}|Kit Moreau]] are working on “A”, and 2 other pieces of work are in hand.`);
    expectValidMarkup(text);
  });

  it("says the team is stopped, and why, ahead of everything else", () => {
    const text = ask("happening", { ...busy, stopped: { reason: "Stop all agents was pressed" } });
    expect(text.startsWith("The team is stopped because Stop all agents was pressed.")).toBe(true);
    expect(text).not.toContain("is working on");
    expectPlain(text);
  });

  it("on vacation says until when, in a US date, and the team keeps going", () => {
    const text = ask("happening", { ...busy, vacation: { untilLabel: "Nov 21" } });
    expect(text).toContain("You are on vacation until Nov 21; the team keeps working on its own.");
    expect(text).toContain("is working on");
  });

  it("when paused says so and how to go on", () => {
    expect(ask("happening", { ...busy, paused: true })).toContain("The round of work is paused. Press Continue");
  });

  it("without Development read leaves the work out and keeps the goal", () => {
    const text = ask("happening", { ...busy, work: null });
    expect(text).toBe("Your goal is “Get the first 10 paying customers by Dec 19”. 4 of 10 so far, 40 days left: on pace (Forecast).");
  });

  it("with nothing readable says there is nothing to report", () => {
    expect(ask("happening", { ...quiet, work: null })).toBe("There is nothing to report yet: the team has not started, and no goal is set.");
  });
});

describe("What's blocking us?", () => {
  it("says so plainly when nothing blocks", () => {
    expect(ask("blocking", quiet)).toBe("Nothing is blocking the team.");
    expect(ask("blocking", busy)).toBe("Nothing is blocking the team.");
  });

  it("counts what waits on the founder, names the top note and its sender, and which hold Continue", () => {
    const text = ask("blocking", { ...quiet, needsYou: { total: 3, holding: 1, top: { subject: "Approve the card payments plan", from: { id: AGENT, name: "Juno Reyes" } } } });
    expect(text).toBe(`3 notes wait for you in Needs you. The first is “Approve the card payments plan”, from [[ent:${AGENT}|Juno Reyes]]. One holds Continue until you answer.`);
    expectValidMarkup(text);
    expectPlain(text);
  });

  it("uses the singular for one note and none of the holding line when nothing holds", () => {
    expect(ask("blocking", { ...quiet, needsYou: { total: 1, holding: 0, top: { subject: "Pick a name", from: null } } })).toBe("1 note waits for you in Needs you. The first is “Pick a name”.");
  });

  it("says which piece of work waits for which", () => {
    const text = ask("blocking", { ...quiet, work: { ...quiet.work!, week: { ...week, waiting: 1 }, blocked: [{ title: "Account page: refill schedule", waitingOn: ["Subscription pause and skip"] }] } });
    expect(text).toContain("1 piece of work is waiting on something before it can go on.");
    expect(text).toContain("“Account page: refill schedule” is waiting for “Subscription pause and skip” to finish first.");
    expectPlain(text);
  });

  it("a stopped team is the first blocker and the only one named with its reason", () => {
    const text = ask("blocking", { ...quiet, stopped: { reason: "this month's credits ran out" }, needsYou: { total: 2, holding: 0, top: null } });
    expect(text.startsWith("The team is stopped because this month's credits ran out.")).toBe(true);
    expect(text).toContain("2 notes wait for you in Needs you.");
  });

  it("reports a round that did not finish, and a paused one", () => {
    expect(ask("blocking", { ...quiet, failure: "This month's credits ran out." })).toBe("The last round of work did not finish: This month's credits ran out.");
    expect(ask("blocking", { ...quiet, paused: true })).toContain("The round of work is paused.");
  });

  it("never lets a vacation count as a blocker", () => {
    expect(ask("blocking", { ...quiet, vacation: { untilLabel: "Nov 21" } })).toBe("Nothing is blocking the team.");
  });

  it("is at most four sentences however much is wrong", () => {
    const text = ask("blocking", { ...quiet, stopped: { reason: "Stop all agents was pressed" }, failure: "Something broke.", paused: true, needsYou: { total: 4, holding: 2, top: { subject: "X", from: null } }, work: { ...quiet.work!, week: { ...week, waiting: 2 }, blocked: [{ title: "A", waitingOn: ["B"] }] } });
    expect(text.replace(ENTITY_MARKUP_RE, "$2").split(/(?<=[.!?”])\s+(?=[A-Z“])/).length).toBeLessThanOrEqual(5);
  });
});

describe("Why am I seeing this?", () => {
  it("uses the screen's own purpose line when the client sends one, then why it matters now", () => {
    const text = ask("why", { ...quiet, needsYou: { total: 2, holding: 0, top: null } }, { path: "/b/b1/d/finance/overview", area: "money", purpose: "How many months your cash lasts at today's spending" });
    expect(text).toBe("How many months your cash lasts at today's spending. 2 notes wait for you in Needs you.");
  });

  it("falls back to the area's words for a tab without a registered purpose", () => {
    const text = ask("why", quiet, { path: "/b/b1/d/product/roadmap", area: "plan" });
    expect(text).toContain("Plan is where the goal, the roadmap and your milestones live");
    expectPlain(text);
  });

  it("strips entity markup out of a purpose line the browser sent", () => {
    expect(chiefPagePurpose({ path: "/b/b1/today", purpose: `See [[ent:${AGENT}|Juno]] now` })).toBe(`See ent:${AGENT}|Juno now.`);
  });

  it("ignores a purpose line that is too long", () => {
    const long = "x".repeat(CHIEF_PURPOSE_MAX + 1);
    expect(chiefPagePurpose({ path: "/b/b1/today", purpose: long })).toBe("Today is the front door: your goal, what needs you, the week's plan and the business's health in one place.");
  });

  it("on Today ties the page to the count and the goal", () => {
    const text = ask("why", { ...busy, needsYou: { total: 1, holding: 0, top: null } });
    expect(text).toContain("Today is the front door");
    expect(text).toContain("1 note waits for you in Needs you.");
    expect(text).toContain("(Forecast)");
    expectPlain(text);
  });

  it("on Needs you says how many wait and how many hold Continue, or that the list is empty", () => {
    expect(ask("why", { ...quiet, needsYou: { total: 3, holding: 2, top: null } }, { path: "/b/b1/inbox" })).toContain("3 notes wait for you in Needs you. 2 hold Continue.");
    expect(ask("why", quiet, { path: "/b/b1/inbox/abc" })).toContain("Nothing waits for you right now, so this list is empty.");
  });

  it("on a Team tab says how many agents are working now", () => {
    expect(ask("why", busy, { path: "/b/b1/d/team/agents", area: "team" })).toContain("1 agent is working now.");
    expect(ask("why", quiet, { path: "/b/b1/d/team/agents", area: "team" })).toContain("No agent is working right now.");
  });

  it("on an agent profile, settings and other pages has a purpose and a reason", () => {
    for (const path of ["/b/b1/agents/a1/overview", "/b/b1/settings/keys", "/b/b1/crm", "/b/b1/milestones", "/b/b1/journey/j1", "/b/b1/something-new"]) {
      const text = ask("why", quiet, { path });
      expect(text.length, path).toBeGreaterThan(40);
      expectPlain(text);
    }
  });

  it("while stopped says so instead of a count", () => {
    expect(ask("why", { ...quiet, stopped: { reason: "Stop all agents was pressed" } })).toContain("The team is stopped because Stop all agents was pressed.");
  });
});

describe("chiefPageKind", () => {
  it("reads the business paths", () => {
    expect(chiefPageKind("/b/x/today")).toBe("today");
    expect(chiefPageKind("/b/x")).toBe("details");
    expect(chiefPageKind("/b/x/home/d1")).toBe("details");
    expect(chiefPageKind("/b/x/inbox?tab=respond")).toBe("needs_you");
    expect(chiefPageKind("/b/x/d/finance/overview")).toBe("area");
    expect(chiefPageKind("/b/x/agents/a/overview")).toBe("agent");
    expect(chiefPageKind("/b/x/settings/mode")).toBe("settings");
    expect(chiefPageKind("/b/x/trophies")).toBe("milestones");
    expect(chiefPageKind("/b/x/unknown")).toBe("other");
  });
});
