/**
 * Next-best decision (BUILD §11.3 Refresh rule 3): "next-best decision grounded in current state". When there is no
 * un-narrated event and no data-change insight, Refresh still yields exactly one item (AC-11.3.2) — a decision whose
 * options come from what the repositories say the business is doing right now. The options are handed to the model as
 * inputs (it may reword, never add facts); the mock copies them verbatim. Every consequence is written from the
 * founder's seat (what changes for them, who does the work, what comes back to them) and the recommended option says
 * why it is recommended (UX plan §7.19, voice guide §8.1).
 */
import { stableHash } from "@foundmill/models";
import type { NamedQueryId } from "./exhibits";
import { ESTIMATE } from "./labels";
import type { MetricsSnapshot } from "./metrics";

export interface DecisionOptionSeed {
  id: string;
  label: string;
  recommended: boolean;
  consequence: string;
  cost_minor: number;
  reversible: boolean;
  /** One sentence on why this option is recommended; on the recommended option only. */
  because?: string;
}

export interface NextBestDecision {
  kind: "unblock_tasks" | "start_distribution" | "review_slip" | "runway_plan" | "plan_next_cycle";
  /** The buffer slot: the kind, the facts and the rotation, so consecutive refreshes serve a decision not served before. */
  key: string;
  /**
   * What the decision is about: the kind and the facts, without the rotation. It is stored on the note (`decision.key`),
   * so a decision the founder has not answered yet is not written again (audit CML-02).
   */
  identity: string;
  title: string;
  /** Why this is the next-best call, as facts from the snapshot. */
  facts: Record<string, string | number | null>;
  options: DecisionOptionSeed[];
  exhibit: { kind: "table" | "chart"; spec_ref: NamedQueryId };
}

/** The option's "because" when it is recommended; absent otherwise, so the reason sits on one option only. */
function option(seed: Omit<DecisionOptionSeed, "because"> & { because: string }): DecisionOptionSeed {
  const { because, ...rest } = seed;
  return seed.recommended ? { ...rest, because } : rest;
}

/** The decisions the state calls for, in the order they rotate (the first is the most pressing). */
export function groundedDecisions(s: MetricsSnapshot): NextBestDecision[] {
  const candidates: NextBestDecision[] = [];

  if (s.tasks.blocked > 0) {
    candidates.push({
      kind: "unblock_tasks",
      key: "",
      identity: "",
      title: "Blocked tasks need a call",
      facts: { blocked_tasks: s.tasks.blocked, running_tasks: s.tasks.running },
      options: [
        option({ id: "review", label: "Review the blocked tasks now", recommended: true, consequence: "You answer each stuck task now and the team picks the work back up this cycle.", cost_minor: 0, reversible: true, because: "Recommended because a few answers from you unblock the most work, and nothing is spent." }),
        option({ id: "reassign", label: "Reassign them to the department lead", recommended: false, consequence: "The lead sorts them out and only brings you the ones that need your signature or money.", cost_minor: 0, reversible: true, because: "Recommended because it keeps the small calls off your desk." }),
        option({ id: "park", label: "Park them until the next cycle", recommended: false, consequence: "Those tasks wait until the next cycle, and so does anything that depends on them.", cost_minor: 0, reversible: true, because: "Recommended because nothing is lost by waiting one cycle." }),
      ],
      exhibit: { kind: "table", spec_ref: "tasks_by_status" },
    });
  }

  if (s.channelsEnabled === 0) {
    candidates.push({
      kind: "start_distribution",
      key: "",
      identity: "",
      title: "No distribution channel is live",
      facts: { channels_enabled: s.channelsEnabled, signups_30d: s.signups30d, customers_30d: s.customers30d },
      options: [
        option({ id: "recommend", label: "Ask the strategist for a channel plan", recommended: true, consequence: "The Distribution strategist scores every channel and proposes where to start; nothing is spent until you pick.", cost_minor: 0, reversible: true, because: "Recommended because it costs nothing and gives you a ranked list to choose from." }),
        option({ id: "wait", label: "Hold until the product is further along", recommended: false, consequence: "No work on finding customers yet; nobody new hears about the product until you say so.", cost_minor: 0, reversible: true, because: "Recommended because the product is not ready for strangers yet." }),
      ],
      exhibit: { kind: "chart", spec_ref: "channel_cpa" },
    });
  }

  if (s.roadmapSlips.length > 0) {
    const worst = s.roadmapSlips[0]!;
    candidates.push({
      kind: "review_slip",
      key: "",
      identity: "",
      title: "Re-plan a slipped roadmap item",
      facts: { item_title: worst.title, target_end: worst.targetEnd, days_late: worst.daysLate },
      options: [
        option({ id: "replan", label: "Move the target date and keep scope", recommended: true, consequence: "The dates move to match reality, and the items that depend on it move with them.", cost_minor: 0, reversible: true, because: "Recommended because the roadmap stays honest and nothing is cut." }),
        option({ id: "cut", label: "Cut scope to ship on the original date", recommended: false, consequence: "A smaller version ships on the original date; the rest moves to Next.", cost_minor: 0, reversible: true, because: "Recommended because the date matters more than the full scope." }),
        option({ id: "drop", label: "Drop the item", recommended: false, consequence: "The item is archived with your reason.", cost_minor: 0, reversible: true, because: "Recommended because the item no longer earns its place." }),
      ],
      exhibit: { kind: "table", spec_ref: "roadmap_status" },
    });
  }

  if (s.runwayMonths !== null && s.runwayBelow.length > 0) {
    candidates.push({
      kind: "runway_plan",
      key: "",
      identity: "",
      title: "Choose a runway plan",
      facts: { runway_months: s.runwayMonths, cash_minor: s.cashMinor, net_burn_monthly_minor: s.netBurnMonthlyMinor, currency: s.currency, label: ESTIMATE },
      options: [
        option({ id: "trim", label: "Trim spend to extend runway", recommended: true, consequence: "The Finance lead proposes cuts for you to approve; agents never pay or cancel anything themselves.", cost_minor: 0, reversible: true, because: "Recommended because runway is how many months your cash lasts at today's spending, and trimming adds months without a single step you cannot take back." }),
        option({ id: "raise", label: "Prepare an investor update", recommended: false, consequence: "A draft investor update is written for you to send; nobody reaches out in your name.", cost_minor: 0, reversible: true, because: "Recommended because investors need to hear from you before the cash gets tight." }),
        option({ id: "hold", label: "Hold course", recommended: false, consequence: "Nothing changes; the runway warning stays on Home.", cost_minor: 0, reversible: true, because: "Recommended because the plan already accounts for this." }),
      ],
      exhibit: { kind: "table", spec_ref: "cash_position" },
    });
  }

  const quiet = s.customers30d === 0 && s.signups30d === 0;
  candidates.push({
    kind: "plan_next_cycle",
    key: "",
    identity: "",
    title: "Set the focus for the next cycle",
    facts: { planned_tasks: s.tasks.planned, running_tasks: s.tasks.running, done_tasks: s.tasks.done, customers_week: s.customersWeek, signups_week: s.signupsWeek },
    options: [
      option({ id: "product", label: "Lead with product work", recommended: quiet, consequence: "The next cycle starts from the roadmap's Now items.", cost_minor: 0, reversible: true, because: "Recommended because nobody has signed up yet, so there is nothing for distribution to amplify." }),
      option({ id: "distribution", label: "Lead with distribution", recommended: !quiet, consequence: "The next cycle puts the live channels and customer follow-ups first.", cost_minor: 0, reversible: true, because: "Recommended because customers are arriving, and following up on them is the cheapest growth there is." }),
      option({ id: "balanced", label: "Keep the current balance", recommended: false, consequence: "I plan the next cycle as usual, within the budget and the limit on agents working at once. A cycle is one round of work that ends with notes in your Inbox.", cost_minor: 0, reversible: true, because: "Recommended because the current mix is working." }),
    ],
    exhibit: { kind: "table", spec_ref: "tasks_by_status" },
  });

  for (const c of candidates) {
    // Exactly one recommended option (BUILD §12.2).
    if (c.options.filter((o) => o.recommended).length !== 1) c.options = c.options.map((o, i) => ({ ...o, recommended: i === 0 }));
    c.identity = `decision:${c.kind}:${stableHash({ facts: c.facts })}`;
  }
  return candidates;
}

/**
 * Picks one decision from the state. `variant` lets consecutive refreshes with unchanged state rotate through the
 * grounded decisions instead of repeating the same note (it is the number of decision notes already written for
 * this state).
 */
export function nextBestDecision(s: MetricsSnapshot, variant = 0): NextBestDecision {
  const candidates = groundedDecisions(s);
  const pick = candidates[variant % candidates.length]!;
  pick.key = `decision:${pick.kind}:${stableHash({ facts: pick.facts, variant })}`;
  return pick;
}
