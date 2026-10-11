/**
 * Next-best decision (BUILD §11.3 Refresh rule 3): "next-best decision grounded in current state". When there is no
 * un-narrated event and no data-change insight, Refresh still yields exactly one item (AC-11.3.2) — a decision whose
 * options come from what the repositories say the club is doing right now. The options are handed to the model as
 * inputs (it may reword, never add facts); the mock copies them verbatim.
 */
import { stableHash } from "@foundmill/models";
import type { NamedQueryId } from "./exhibits";
import type { MetricsSnapshot } from "./metrics";

export interface DecisionOptionSeed {
  id: string;
  label: string;
  recommended: boolean;
  consequence: string;
  cost_minor: number;
  reversible: boolean;
}

export interface NextBestDecision {
  kind: "unblock_tasks" | "start_distribution" | "review_slip" | "runway_plan" | "plan_next_cycle";
  key: string;
  title: string;
  /** Why this is the next-best call, as facts from the snapshot. */
  facts: Record<string, string | number | null>;
  options: DecisionOptionSeed[];
  exhibit: { kind: "table" | "chart"; spec_ref: NamedQueryId };
}

/**
 * Picks one decision from the state. `variant` lets consecutive refreshes with unchanged state rotate through the
 * grounded decisions instead of repeating the same note (it is the number of decision notes already written for
 * this state).
 */
export function nextBestDecision(s: MetricsSnapshot, variant = 0): NextBestDecision {
  const candidates: NextBestDecision[] = [];

  if (s.tasks.blocked > 0) {
    candidates.push({
      kind: "unblock_tasks",
      key: "",
      title: "Blocked tasks need a call",
      facts: { blocked_tasks: s.tasks.blocked, running_tasks: s.tasks.running },
      options: [
        { id: "review", label: "Review the blocked tasks now", recommended: true, consequence: "The team gets answers this cycle and work resumes.", cost_minor: 0, reversible: true },
        { id: "reassign", label: "Reassign them to the department lead", recommended: false, consequence: "The lead triages and comes back only with hard gates.", cost_minor: 0, reversible: true },
        { id: "park", label: "Park them until the next cycle", recommended: false, consequence: "Nothing moves on those tasks; dependents wait.", cost_minor: 0, reversible: true },
      ],
      exhibit: { kind: "table", spec_ref: "tasks_by_status" },
    });
  }

  if (s.channelsEnabled === 0) {
    candidates.push({
      kind: "start_distribution",
      key: "",
      title: "No distribution channel is live",
      facts: { channels_enabled: s.channelsEnabled, signups_30d: s.signups30d, customers_30d: s.customers30d },
      options: [
        { id: "recommend", label: "Ask the strategist for a channel plan", recommended: true, consequence: "The Distribution Strategist scores all channels and proposes starters.", cost_minor: 0, reversible: true },
        { id: "wait", label: "Hold until the product is further along", recommended: false, consequence: "No acquisition work; the pipeline stays empty.", cost_minor: 0, reversible: true },
      ],
      exhibit: { kind: "chart", spec_ref: "channel_cpa" },
    });
  }

  if (s.roadmapSlips.length > 0) {
    const worst = s.roadmapSlips[0]!;
    candidates.push({
      kind: "review_slip",
      key: "",
      title: "Re-plan a slipped roadmap item",
      facts: { item_title: worst.title, target_end: worst.targetEnd, days_late: worst.daysLate },
      options: [
        { id: "replan", label: "Move the target date and keep scope", recommended: true, consequence: "The roadmap reflects reality; dependents are re-dated.", cost_minor: 0, reversible: true },
        { id: "cut", label: "Cut scope to ship on the original date", recommended: false, consequence: "A smaller release goes out; the rest moves to next.", cost_minor: 0, reversible: true },
        { id: "drop", label: "Drop the item", recommended: false, consequence: "The item is archived with your reason.", cost_minor: 0, reversible: true },
      ],
      exhibit: { kind: "table", spec_ref: "roadmap_status" },
    });
  }

  if (s.runwayMonths !== null && s.runwayBelow.length > 0) {
    candidates.push({
      kind: "runway_plan",
      key: "",
      title: "Choose a runway plan",
      facts: { runway_months: s.runwayMonths, cash_minor: s.cashMinor, net_burn_monthly_minor: s.netBurnMonthlyMinor, currency: s.currency, label: "Estimate" },
      options: [
        { id: "trim", label: "Trim spend to extend runway", recommended: true, consequence: "The Finance lead proposes cuts for your approval; nothing is paid or canceled by agents.", cost_minor: 0, reversible: true },
        { id: "raise", label: "Prepare an investor update", recommended: false, consequence: "A draft update is written for you to send; no outreach in your name.", cost_minor: 0, reversible: true },
        { id: "hold", label: "Hold course", recommended: false, consequence: "No change; the warning stays on the board.", cost_minor: 0, reversible: true },
      ],
      exhibit: { kind: "table", spec_ref: "cash_position" },
    });
  }

  candidates.push({
    kind: "plan_next_cycle",
    key: "",
    title: "Set the focus for the next cycle",
    facts: { planned_tasks: s.tasks.planned, running_tasks: s.tasks.running, done_tasks: s.tasks.done, customers_week: s.customersWeek, signups_week: s.signupsWeek },
    options: [
      { id: "product", label: "Lead with product work", recommended: s.customers30d === 0 && s.signups30d === 0, consequence: "The next cycle starts from the roadmap's now items.", cost_minor: 0, reversible: true },
      { id: "distribution", label: "Lead with distribution", recommended: !(s.customers30d === 0 && s.signups30d === 0), consequence: "The next cycle prioritizes enabled channels and follow-ups.", cost_minor: 0, reversible: true },
      { id: "balanced", label: "Keep the current balance", recommended: false, consequence: "The Chief of Staff plans as usual within budget and capacity.", cost_minor: 0, reversible: true },
    ],
    exhibit: { kind: "table", spec_ref: "tasks_by_status" },
  });

  const pick = candidates[variant % candidates.length]!;
  // Exactly one recommended option (BUILD §12.2).
  if (pick.options.filter((o) => o.recommended).length !== 1) pick.options = pick.options.map((o, i) => ({ ...o, recommended: i === 0 }));
  pick.key = `decision:${pick.kind}:${stableHash({ facts: pick.facts, variant })}`;
  return pick;
}
