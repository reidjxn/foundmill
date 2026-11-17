/**
 * Today's pure mapping (founder, 2026-11-07): `goal.current` and `today.get` as the design system's GoalPanel and
 * NeedsYouList read them. Every sentence is the API's (packages/shared goals.ts, today-words.ts); this file only picks
 * the pill, the bar's words and the links.
 */
import type { GoalPanelGoal, GoalPanelProposal, NeedsYouRow, SinceLastVisitLine } from "@foundmill/dugout";
import { countOf, goalOptions, streakWords, goalPaceState, goalValueText, type GoalMetricKind, type GoalProposalReason } from "@foundmill/shared";
import { routes } from "@foundmill/widgets/shared/routes";

export interface GoalViewLike {
  id: string;
  sentence: string;
  kind: GoalMetricKind;
  target: number | null;
  currency: string | null;
  dueOn: string;
  reason: GoalProposalReason;
  achievedAt: Date | string | null;
  proposedBy: { id: string; name: string } | null;
  progress: { current: number; pace: string } | null;
}

export interface NeedsYouItemLike {
  id: string;
  subject: string;
  blocksContinue: boolean;
  kind: "approval" | "signoff" | "goal" | "decision" | "warning" | "go_ahead";
  fromAgent: { id: string; name: string; role?: string | null; personaKey?: string | null; layer?: string | null } | null;
  quickOption: { id: string; label: string } | null;
}

/** How Today names agents: the persona display functions in force (`useAgentPersona()`) and the business's roster. */
export interface NeedsYouNames {
  labelFor: (agent: { name: string; role?: string | null; personaKey?: string | null; layer?: string | null }) => string;
  withNames: (text: string, roster: readonly { name: string; role?: string | null; personaKey?: string | null; layer?: string | null }[]) => string;
  roster: readonly { name: string; role?: string | null; personaKey?: string | null; layer?: string | null }[];
}

// The bar's value words and the pace state live in packages/shared (goals.ts): the Chief of Staff's answers read the
// goal exactly as Today does.
export { goalPaceState, goalValueText };

export function toPanelGoal(view: GoalViewLike, today: string): GoalPanelGoal {
  return {
    id: view.id,
    sentence: view.sentence,
    state: goalPaceState(view, today),
    progress: view.progress && view.target !== null ? { current: view.progress.current, target: view.target, valueText: goalValueText(view), pace: view.progress.pace } : null,
  };
}

/** The proposal with its proposer (the Chief of Staff by its stored name) and the recommendation's reason. */
export function toPanelProposal(view: GoalViewLike, chiefOfStaff: string | null): GoalPanelProposal {
  const because = goalOptions({ kind: view.kind }, view.reason).find((o) => o.recommended)?.because ?? null;
  return { id: view.id, sentence: view.sentence, proposedBy: view.proposedBy?.name ?? chiefOfStaff, because };
}

const KIND_LABEL: Record<NeedsYouItemLike["kind"], string> = {
  approval: "Request",
  signoff: "Your approval",
  goal: "Goal",
  decision: "Your decision",
  warning: "Your decision",
  go_ahead: "Needs your go-ahead",
};

/** The Inbox's Needs you tab, where "See all in the Inbox" goes. */
export const needsYouHref = (businessId: string): string => `${routes.inbox(businessId)}?tab=respond`;

/**
 * The Needs you rows. With `names`, the sender and the plain stored subject name agents under the reader's preference
 * (One name everywhere, Nov 8, 2026), as the Inbox list does; without it, as stored.
 */
export function toNeedsYouRows(businessId: string, items: readonly NeedsYouItemLike[], names?: NeedsYouNames): NeedsYouRow[] {
  const roster = names ? [...names.roster, ...items.flatMap((i) => (i.fromAgent ? [i.fromAgent] : []))] : [];
  return items.map((i) => ({
    id: i.id,
    subject: names ? names.withNames(i.subject, roster) : i.subject,
    from: i.fromAgent ? (names ? names.labelFor(i.fromAgent) : i.fromAgent.name) : null,
    kindLabel: KIND_LABEL[i.kind],
    href: `${routes.inbox(businessId, i.id)}?tab=respond`,
    quickOption: i.quickOption,
    holdsContinue: i.blocksContinue,
  }));
}

/** What `today.sinceLastVisit` answers (apps/api services/today.ts `SinceLastVisit`). */
export interface SinceLastVisitLike {
  since: string;
  rounds: number;
  tasksDone: number;
  wins: number;
  newDecisions: number;
  milestones: readonly string[];
  spend: { amountMinor: number; currency: string } | null;
}

/**
 * "Since you were last here" in plain lines (retention plan, 2026-11-11): the work, the wins, the new decisions with a
 * link to answer them, the milestones, and spend marked Estimate. Lines with nothing to say are left out.
 */
export function sinceLastVisitLines(view: SinceLastVisitLike, businessId: string, money: (m: { amountMinor: number; currency: string }) => string): SinceLastVisitLine[] {
  const lines: SinceLastVisitLine[] = [];
  if (view.rounds > 0 || view.tasksDone > 0) lines.push({ id: "work", text: `${countOf(view.rounds, "round")} of work, ${countOf(view.tasksDone, "task")} done.` });
  if (view.wins > 0) lines.push({ id: "wins", text: `${countOf(view.wins, "customer")} won.`, tone: "gold", link: { href: routes.inbox(businessId), label: "Open" } });
  if (view.newDecisions > 0) lines.push({ id: "decisions", text: `${countOf(view.newDecisions, "new decision")} ${view.newDecisions === 1 ? "needs" : "need"} you.`, link: { href: needsYouHref(businessId), label: "Answer" } });
  view.milestones.forEach((m, i) => lines.push({ id: `milestone-${i}`, text: `Milestone: ${m}.`, tone: "gold", link: { href: `/b/${businessId}/milestones`, label: "See" } }));
  if (view.spend) lines.push({ id: "spend", text: `Team spend ${money(view.spend)} (Estimate).` });
  return lines;
}

/** What `today.streak` answers (packages/shared streak.ts `Streak`). */
export interface StreakLike {
  current: number;
  best: number;
  visitedToday: boolean;
  atRisk: boolean;
  milestone: number | null;
  week: readonly { day: string; state: "visited" | "vacation" | "missed" | "today" }[];
}

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

/**
 * The StreakStrip's props (WP-04 D5: quieter): the shared words, never the at-risk line (the founder is here now), and
 * only the days of the last seven the founder opened the business, each with its short weekday ("Mon").
 */
export function streakStripProps(s: StreakLike): { headline: string; line: string; milestone: boolean; opened: { day: string; label: string }[] } {
  const words = streakWords({ ...s, atRisk: false });
  return { ...words, milestone: s.milestone !== null, opened: s.week.filter((d) => d.state === "visited").map((d) => ({ day: d.day, label: WEEKDAY.format(new Date(`${d.day}T12:00:00Z`)) })) };
}

/** Today's sections, by the test id each one draws. */
export type TodaySection = "needs-you" | "founder-task" | "public-page" | "post-ready" | "first-week" | "goal" | "week" | "since" | "streak" | "health";

/**
 * Today's reading order (WP-04 T7): one thing to do first. On a phone, and on a computer while the page waits to be
 * checked and published, Needs you leads, then the page line, the first week and the goal; otherwise the first week,
 * the goal beside Needs you. The week plan, Since you were last here, the streak and the health figures always come
 * after, in that order, and the streak and health only after the project's first day (`today.get` › `firstDay`, WP-04
 * D5; s1 §3.8: four empty figures on day one). Not known yet (`null`): not yet. The founder's one thing today (WP-04
 * T9) comes right after Needs you in both orders, so it never pushes Needs you down.
 */
export function todaySections(f: { phone: boolean; pageFirst: boolean; firstDay: boolean | null }): TodaySection[] {
  const lead: TodaySection[] = f.phone || f.pageFirst ? ["needs-you", "founder-task", "public-page", "post-ready", "first-week", "goal"] : ["first-week", "goal", "needs-you", "founder-task", "public-page", "post-ready"];
  const later: TodaySection[] = f.firstDay === false ? ["week", "since", "streak", "health"] : ["week", "since"];
  return [...lead, ...later];
}
