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

/** The StreakStrip's props: the shared words and a short weekday under each dot ("Mon"). */
export function streakStripProps(s: StreakLike): { headline: string; line: string; atRisk: boolean; milestone: boolean; week: { day: string; label: string; state: StreakLike["week"][number]["state"] }[] } {
  const words = streakWords(s);
  return { ...words, atRisk: s.atRisk, milestone: s.milestone !== null, week: s.week.map((d) => ({ ...d, label: WEEKDAY.format(new Date(`${d.day}T12:00:00Z`)) })) };
}
