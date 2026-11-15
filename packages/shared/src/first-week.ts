/**
 * "Your first week" on Today (founder's report, Phase 3 group K "A first week that explains itself"): what the team
 * does on Day 1, Days 2–3 and in Week 1, and what the founder will be asked and when. Day 1 starts with the project's
 * public page (docs/THESIS_REVIEW.md package 1.3: the first session ends on a link): the team drafts it with the
 * specification and the roadmap, and the founder is asked to publish it and to sign off the other two. A pure function
 * of facts the business already records (the page, sign-offs, goal, rounds of work, distribution), so the steps' state is read, never
 * stored: a step is done when its own facts are true, "now" is the first step not done, the rest are "next".
 *
 * Dates are the business's days in US form ("Oct 7"). A done step carries the real day it finished; a step still to
 * come carries a planned window labeled Estimate (a plan, not a fact).
 *
 * Visibility (docs/DECISIONS.md, 2026-11-09): shown while the business is under `FIRST_WEEK_DAYS` days old and has not
 * started distribution (the last milestone: from then on it is selling, not in its first week). Otherwise null.
 */
import { addDaysToDay, daysBetweenDays, goalDateWords } from "./goals";

/** The panel goes away once the business is this many days old (day 1 is the day it was created). */
export const FIRST_WEEK_DAYS = 10;

export type FirstWeekStepId = "day1" | "days2to3" | "week1";
export type FirstWeekStepState = "done" | "now" | "next";

/** Facts, all as the business's day keys ("2026-11-07") or flags. */
export interface FirstWeekFacts {
  /** The business's day today. */
  today: string;
  /** The day the business was created. */
  createdOn: string;
  /** The day the project's public page went live (`project_pages.published_at`); null before. Absent reads as null. */
  pagePublishedOn?: string | null;
  /** The day each sign-off was approved; null while it waits. */
  specSignedOffOn: string | null;
  roadmapSignedOffOn: string | null;
  /** The day the first round of work finished; null before. */
  firstRoundOn: string | null;
  /** The day the founder approved a goal; null before. */
  goalApprovedOn: string | null;
  /** Where the team's code goes; "none" (no repository to push to) never promises changes going live. Absent reads as "github". */
  destination?: "none" | "github";
  /** The day distribution started; null before. */
  distributionStartedOn: string | null;
  /** The team is stopped (Stop all agents, a revoked key, used-up credits). */
  stopped: boolean;
  /** No channel can really act for this business yet (channel-availability.ts); absent reads as false. */
  noChannelCanRun?: boolean;
}

export interface FirstWeekStep {
  id: FirstWeekStepId;
  label: "Day 1" | "Days 2–3" | "Week 1";
  state: FirstWeekStepState;
  /** "Done Oct 7" or "Oct 8 – 9 (Estimate)". */
  when: string;
  /** What the team does (done: did). */
  team: string;
  /** What the founder is asked (done: was asked), with only what is still open while a step is under way. */
  asks: string;
}

export interface FirstWeekWords {
  title: "Your first week";
  steps: FirstWeekStep[];
  /** One line when the team is stopped; null otherwise. */
  paused: string | null;
}

export const FIRST_WEEK_WORDS = {
  title: "Your first week",
  paused: "The team is stopped, so nothing moves on until you resume it.",
  states: { done: "Done", now: "Now", next: "Next" },
} as const;

/** "Oct 8 – 9", "Oct 30 – Nov 2" or one day "Oct 7" (the year only when far from today). */
export function dayRangeWords(from: string, to: string, today: string): string {
  if (from === to) return goalDateWords(from, today);
  const a = goalDateWords(from, today);
  const b = goalDateWords(to, today);
  const sameMonth = a.split(" ")[0] === b.split(" ")[0] && !a.includes(",") && !b.includes(",");
  return `${a} – ${sameMonth ? b.split(" ")[1] : b}`;
}

const list = (parts: readonly string[]): string => (parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`);

/** Whether the panel shows at all, from the same facts. */
export function firstWeekVisible(f: Pick<FirstWeekFacts, "today" | "createdOn" | "distributionStartedOn">): boolean {
  return f.distributionStartedOn === null && daysBetweenDays(f.createdOn, f.today) < FIRST_WEEK_DAYS;
}

const later = (...days: (string | null)[]): string | null => days.reduce<string | null>((a, d) => (d === null ? a : a === null || d > a ? d : a), null);

/** The three steps with their state, dates and words; null when the panel is away. */
export function firstWeekTimeline(f: FirstWeekFacts): FirstWeekWords | null {
  if (!firstWeekVisible(f)) return null;
  const at = (n: number) => addDaysToDay(f.createdOn, n);
  const dateOf = (day: string | null) => (day ? goalDateWords(day, f.today) : null);

  // Day 1 (package 1.3): the page first, then the two sign-offs; a step is done when all three are.
  const pageOn = f.pagePublishedOn ?? null;
  const signoffsOpen = [...(f.specSignedOffOn ? [] : ["the specification"]), ...(f.roadmapSignedOffOn ? [] : ["the roadmap"])];
  const day1Done = pageOn !== null && signoffsOpen.length === 0;
  const day1On = later(pageOn, f.specSignedOffOn, f.roadmapSignedOffOn);
  const day1Asks = [...(pageOn ? [] : ["publish your page"]), ...(signoffsOpen.length ? [`sign off ${list(signoffsOpen)}`] : [])];

  // Nothing goes live from a project with no repository to push to (WP-02 T5): the founder approves pieces of work.
  const firstWork = f.destination === "none" ? "the first pieces of work" : "the first changes going live";
  const days2Open = [...(f.goalApprovedOn ? [] : ["your first goal, once your Chief of Staff proposes it"]), ...(f.firstRoundOn ? [] : [firstWork])];
  const days2Done = f.firstRoundOn !== null && f.goalApprovedOn !== null;
  const days2On = later(f.firstRoundOn, f.goalApprovedOn);

  const week1Done = f.distributionStartedOn !== null;

  const done = [day1Done, days2Done, week1Done];
  const nowIndex = done.indexOf(false);
  const stateOf = (i: number): FirstWeekStepState => (done[i] ? "done" : i === nowIndex ? "now" : "next");
  const planned = (from: string, to: string) => `${dayRangeWords(from, to, f.today)} (Estimate)`;

  const steps: FirstWeekStep[] = [
    {
      id: "day1",
      label: "Day 1",
      state: stateOf(0),
      when: day1Done ? `Done ${dateOf(day1On ?? f.createdOn)}` : planned(at(0), at(0)),
      team: day1Done ? "Drafted your page, your specification and your roadmap." : "Your team drafts your page, your specification and your roadmap.",
      asks: day1Done ? "You published your page and signed off the specification and the roadmap." : `You are asked to ${list(day1Asks)}.`,
    },
    {
      id: "days2to3",
      label: "Days 2–3",
      state: stateOf(1),
      when: days2Done ? `Done ${dateOf(days2On)}` : planned(at(1), at(2)),
      team: days2Done ? "Built the first pieces of work and planned the channels." : "Your team builds the first pieces of work and plans the channels for finding customers.",
      asks: days2Done ? `You approved your first goal and ${firstWork}.` : `You are asked to approve ${list(days2Open)}.`,
    },
    {
      id: "week1",
      label: "Week 1",
      state: stateOf(2),
      when: week1Done ? `Done ${dateOf(f.distributionStartedOn)}` : planned(at(3), at(6)),
      // With no channel able to run yet the team prepares; it does not promise an approach it cannot make (founder, 2026-11-11).
      team: week1Done ? "Started approaching the first customers." : f.noChannelCanRun ? "Your team gets ready to approach the first customers; a channel starts as soon as one can run." : "Your team starts approaching the first customers.",
      asks: week1Done ? "You answered “Ready to start selling?”." : "You are asked “Ready to start selling?” and about any spend over your limit.",
    },
  ];
  return { title: FIRST_WEEK_WORDS.title, steps, paused: f.stopped ? FIRST_WEEK_WORDS.paused : null };
}
