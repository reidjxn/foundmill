/**
 * Today's "This week and next" (founder, 2026-11-07): three to five plain sentences built from data the business already
 * holds, with no model call. What the team finished in the last 7 days (by the founder-facing titles, grouped under the
 * roadmap item most of it was for), what waits, what comes next, the nearest roadmap date (an Estimate: a plan, not a
 * fact) and when the next round of work starts. US dates, en-US numbers, no jargon (packages/shared founder-words).
 *
 * `today.get` (apps/api services/today.ts) gathers the facts; the Today page shows the sentences as they are.
 */
import { formatCount } from "./copy";
import { daysBetweenDays, goalDateWords } from "./goals";

/** The facts behind the sentences, all read in the business's own time zone. */
export interface WeekFacts {
  /** "2026-11-07": the business's day. */
  today: string;
  /** Work finished in the last 7 days, and the roadmap item most of it was for (when one was). */
  done: { count: number; topItem: { title: string; count: number } | null };
  /** The first piece of work in hand right now, by its founder-facing title. */
  running: { title: string } | null;
  /** The first piece of work waiting to start, by its founder-facing title. */
  next: { title: string } | null;
  /** Pieces of work waiting on something before they can go on. */
  waiting: number;
  /** The nearest Now or Next roadmap item with a target date today or later. */
  roadmapDue: { title: string; dueOn: string } | null;
  /** Rounds of work so far, whether one is running, whether one press's run is still going, and Autopilot's next start (a day key). */
  rounds: { completed: number; running: boolean; runOpen: boolean; autopilotNextOn: string | null };
}

export interface WeekPlanWords {
  /** What happened this week (one or two sentences). */
  done: string[];
  /** What comes next (two or three sentences). */
  next: string[];
}

/** The press-Continue line: the run one press starts keeps going until nothing is left. */
export const WEEK_PRESS_CONTINUE = "Press Continue and the team keeps going until nothing is left.";

const pieces = (n: number): string => `${formatCount(n)} ${n === 1 ? "piece" : "pieces"} of work`;
const quoted = (title: string): string => `“${title.trim().replace(/[.!?]+$/, "")}”`;
const sentenceTitle = (title: string): string => title.trim().replace(/[.!?]+$/, "");

/** "This week the team finished 6 pieces of work, 4 of them for “Online booking”." */
export function weekDoneSentence(done: WeekFacts["done"], roundsCompleted: number): string {
  if (done.count <= 0) return roundsCompleted > 0 ? "The team has not finished a piece of work this week yet." : "Nothing is finished yet: the first round of work starts when you press Continue.";
  const head = `This week the team finished ${pieces(done.count)}`;
  const top = done.topItem;
  if (!top || top.count <= 0) return `${head}.`;
  if (top.count >= done.count) return done.count === 1 ? `${head}, for ${quoted(top.title)}.` : `${head}, all of them for ${quoted(top.title)}.`;
  if (top.count === 1) return `${head}.`;
  return `${head}, ${formatCount(top.count)} of them for ${quoted(top.title)}.`;
}

/** "2 pieces of work are waiting on something before they can go on." Null when nothing waits. */
export function weekWaitingSentence(waiting: number): string | null {
  if (waiting <= 0) return null;
  return `${pieces(waiting)} ${waiting === 1 ? "is" : "are"} waiting on something before ${waiting === 1 ? "it" : "they"} can go on.`;
}

/** "Now: Set up card payments." / "Next: Set up card payments, starting this round." / the nothing-queued line. */
export function weekNextSentence(facts: Pick<WeekFacts, "running" | "next" | "rounds">): string {
  if (facts.running) return `Now: ${sentenceTitle(facts.running.title)}.`;
  if (facts.next) return facts.rounds.running || facts.rounds.runOpen ? `Next: ${sentenceTitle(facts.next.title)}, starting this round.` : `Next: ${sentenceTitle(facts.next.title)}.`;
  return "Nothing is queued yet: the next round of work plans what comes after.";
}

/** "“Online booking” is planned for Dec 4 (Estimate)." Null without a date ahead. */
export function weekRoadmapSentence(due: WeekFacts["roadmapDue"], today: string): string | null {
  if (!due || daysBetweenDays(today, due.dueOn) < 0) return null;
  const when = due.dueOn === today ? "today" : `for ${goalDateWords(due.dueOn, today)}`;
  return `${quoted(due.title)} is planned ${when} (Estimate).`;
}

/** When the next round starts: running now, Autopilot's next start, or the press-Continue line. */
export function weekRoundSentence(rounds: WeekFacts["rounds"], today: string): string {
  if (rounds.running) return rounds.runOpen ? "The team is working now, and the next round starts on its own when this one ends." : "The team is working now.";
  if (rounds.runOpen) return "The next round starts on its own in a moment.";
  if (rounds.autopilotNextOn && daysBetweenDays(today, rounds.autopilotNextOn) >= 0) {
    const day = rounds.autopilotNextOn === today ? "later today" : daysBetweenDays(today, rounds.autopilotNextOn) === 1 ? "tomorrow" : `on ${goalDateWords(rounds.autopilotNextOn, today)}`;
    return `Autopilot starts the next round ${day} (Estimate).`;
  }
  return WEEK_PRESS_CONTINUE;
}

/** The three to five sentences, in order: done (and waiting), then next, the roadmap date and the next round. */
export function weekPlanWords(facts: WeekFacts): WeekPlanWords {
  const done = [weekDoneSentence(facts.done, facts.rounds.completed)];
  const waiting = weekWaitingSentence(facts.waiting);
  if (waiting) done.push(waiting);
  const next = [weekNextSentence(facts)];
  const roadmap = weekRoadmapSentence(facts.roadmapDue, facts.today);
  if (roadmap) next.push(roadmap);
  next.push(weekRoundSentence(facts.rounds, facts.today));
  return { done, next };
}
