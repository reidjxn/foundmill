/**
 * Today's pure mapping (founder, 2026-11-07): `goal.current` and `today.get` as the design system's GoalPanel and
 * NeedsYouList read them. Every sentence is the API's (packages/shared goals.ts, today-words.ts); this file only picks
 * the pill, the bar's words and the links.
 */
import type { GoalPaceState, GoalPanelGoal, GoalPanelProposal, NeedsYouRow } from "@foundmill/dugout";
import { goalOptions, goalValueWords, type GoalMetricKind, type GoalProposalReason } from "@foundmill/shared";
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
  fromAgent: { id: string; name: string } | null;
  quickOption: { id: string; label: string } | null;
}

/** "4 of 10 paying customers", "£1,200 of £5,000": the bar's value in words. */
export function goalValueText(view: Pick<GoalViewLike, "kind" | "currency" | "target" | "progress">): string {
  if (!view.progress || view.target === null) return "No number to track yet";
  const v = (n: number) => goalValueWords(view.kind, n, view.currency);
  const unit = view.kind === "paying_customers" ? " paying customers" : view.kind === "signups" ? " signups" : "";
  return `${v(view.progress.current)} of ${v(view.target)}${unit}`;
}

/** Where an active goal stands: reached, its date passed, on pace, behind, or nothing to track. */
export function goalPaceState(view: Pick<GoalViewLike, "achievedAt" | "progress" | "target" | "dueOn">, today: string): GoalPaceState {
  if (view.achievedAt) return "reached";
  if (!view.progress || view.target === null) return "untracked";
  if (view.dueOn < today) return "overdue";
  if (view.progress.current >= view.target || /\bon pace\b|: reached\./.test(view.progress.pace)) return "on_pace";
  return "behind";
}

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

export function toNeedsYouRows(businessId: string, items: readonly NeedsYouItemLike[]): NeedsYouRow[] {
  return items.map((i) => ({
    id: i.id,
    subject: i.subject,
    from: i.fromAgent?.name ?? null,
    kindLabel: KIND_LABEL[i.kind],
    href: `${routes.inbox(businessId, i.id)}?tab=respond`,
    quickOption: i.quickOption,
    holdsContinue: i.blocksContinue,
  }));
}
