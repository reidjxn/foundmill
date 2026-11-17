/**
 * "Your first week" on Today (founder's report, Phase 3 group K "A first week that explains itself"): what the team
 * does on Day 1, Days 2–3 and in Week 1, and what the founder will be asked and when. Day 1 starts with the project's
 * public page (docs/THESIS_REVIEW.md package 1.3: the first session ends on a link): the team drafts it first, then the
 * plan, and the founder is asked to publish it and to approve the plan (one note for the specification and the roadmap
 * since WP-04 T5). A pure function
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

/**
 * The one place the first day is told (WP-02 T6; WP-04 T7 "one first-day story"): Commit's "What happens next" lists
 * these lines and the welcome note repeats them, so the two cannot drift. The page comes first, then one plan note.
 */
export const FIRST_DAY_PROMISE: readonly string[] = Object.freeze([
  "Your page is drafted first, from your own words. About a minute.",
  "You check it and publish it. Then you have a link to send.",
  "Your plan arrives as one note to approve.",
  "Nothing costs money or goes out in your name unless you say so.",
]);

/** Commit's toast once the project has started (WP-04 T7). */
export const FIRST_DAY_TOAST = "Your page is being drafted now. You will check it first.";

/** Words a first-day surface never uses (WP-04 T7): the old story of two documents to sign off. */
export const OLD_FIRST_DAY_WORDS = /specification|roadmap|two notes|sign (them )?off|foundations/i;

/**
 * The Product lead's one plan note (WP-04 T5; founder, 2026-11-16 D3): it replaces the two sign-off notes. Both
 * `product_signoffs` rounds (the specification and the roadmap) point at it, so one Approve approves both and starts the
 * build. `key` marks its decision block (`decision.key`); the option ids stay `approve` and `request_changes`.
 */
export const PLAN_READY_NOTE = {
  key: "product.plan_ready",
  subject: "Your plan is ready",
  approveLabel: "Approve the plan",
  changeLabel: "Ask for changes",
} as const;

/** Whether a note's decision block is the plan note's (its `decision.key`). */
export function isPlanReadyDecision(decision: unknown): boolean {
  return !!decision && typeof decision === "object" && (decision as { key?: unknown }).key === PLAN_READY_NOTE.key;
}

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

  // Day 1 (package 1.3): the page first, then the plan (one note for both rounds, WP-04 T5); done when all three are.
  const pageOn = f.pagePublishedOn ?? null;
  const planOpen = !f.specSignedOffOn || !f.roadmapSignedOffOn;
  const day1Done = pageOn !== null && !planOpen;
  const day1On = later(pageOn, f.specSignedOffOn, f.roadmapSignedOffOn);
  const day1Asks = [...(pageOn ? [] : ["publish your page"]), ...(planOpen ? ["approve your plan"] : [])];

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
      // The page first, then the plan (WP-04 T7): the plan holds the specification and the roadmap.
      team: day1Done ? "Drafted your page and your plan." : "Your team drafts your page first, then your plan.",
      asks: day1Done ? "You published your page and approved your plan." : `You are asked to ${list(day1Asks)}.`,
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
