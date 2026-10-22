/**
 * Data-change insights (BUILD §11.3 Refresh rule 2): "insight from a real data change (thresholds configurable, e.g.
 * channel CPA moved ≥ 20%, competitor launch, roadmap slip)". Every insight is computed from the metrics snapshot the
 * repositories produced — never invented — and carries the numbers the note may quote plus the named query that
 * exhibits them. Priority order: runway crossing, CPA move, roadmap slip.
 */
import { LIMITS } from "@foundmill/config";
import { stableHash } from "@foundmill/models";
import type { ExhibitKind } from "@foundmill/shared";
import type { NamedQueryId } from "./exhibits";
import { ESTIMATE } from "./labels";
import type { MetricsSnapshot } from "./metrics";

export interface InsightThresholds {
  /** Relative CPA move that counts as a change (default 0.2 = 20 %). */
  cpaMoveRatio: number;
  /** Days past target_end before a roadmap item counts as slipped (default 0). */
  roadmapSlipDays: number;
}

export const DEFAULT_INSIGHT_THRESHOLDS: InsightThresholds = { cpaMoveRatio: 0.2, roadmapSlipDays: 0 };

export type InsightKind = "runway_crossing" | "channel_cpa_moved" | "roadmap_slip";

export interface Insight {
  kind: InsightKind;
  /** Stable key: same data → same key, so a pre-written candidate stays valid until the data changes. */
  key: string;
  /** Short English title (digit-free; numbers live in `facts`). */
  title: string;
  /** The facts the note may quote, verbatim from the snapshot. */
  facts: Record<string, string | number | boolean | null>;
  exhibit: { kind: Exclude<ExhibitKind, "none">; spec_ref: NamedQueryId };
  /** Blocks Continue only for runway < LIMITS.runwayBlockMonths (BUILD §11.3 types). */
  blocksContinue: boolean;
  /** 0 = most urgent. */
  rank: number;
}

export function computeInsights(s: MetricsSnapshot, thresholds: InsightThresholds = DEFAULT_INSIGHT_THRESHOLDS): Insight[] {
  const out: Insight[] = [];

  if (s.runwayMonths !== null && s.runwayBelow.length > 0) {
    const threshold = Math.min(...s.runwayBelow);
    out.push({
      kind: "runway_crossing",
      key: `insight:runway:${threshold}:${stableHash({ runway: s.runwayMonths, cash: s.cashMinor, burn: s.netBurnMonthlyMinor })}`,
      title: "Months of cash left fell below a warning line",
      facts: {
        runway_months: s.runwayMonths,
        threshold_months: threshold,
        cash_minor: s.cashMinor,
        currency: s.currency,
        net_burn_monthly_minor: s.netBurnMonthlyMinor,
        label: ESTIMATE,
      },
      exhibit: { kind: "table", spec_ref: "cash_position" },
      blocksContinue: s.runwayMonths < LIMITS.runwayBlockMonths,
      rank: 0,
    });
  }

  const moved = s.channels
    .filter((c) => c.changeRatio !== null && Math.abs(c.changeRatio) >= thresholds.cpaMoveRatio)
    .sort((a, b) => Math.abs(b.changeRatio ?? 0) - Math.abs(a.changeRatio ?? 0));
  for (const c of moved) {
    const pct = Math.round((c.changeRatio ?? 0) * 100);
    out.push({
      kind: "channel_cpa_moved",
      key: `insight:cpa:${c.channelKey}:${stableHash({ recent: c.recentCpaMinor, previous: c.previousCpaMinor })}`,
      title: `${c.label} cost per customer moved`,
      facts: {
        channel_key: c.channelKey,
        channel: c.label,
        cpa_last_7d_minor: c.recentCpaMinor,
        cpa_previous_7d_minor: c.previousCpaMinor,
        change_percent: pct,
        direction: pct > 0 ? "up" : "down",
        spend_last_7d_minor: c.recentSpendMinor,
        customers_last_7d: c.recentCustomers,
        currency: s.currency,
        label: ESTIMATE,
      },
      exhibit: { kind: "chart", spec_ref: "channel_cpa" },
      blocksContinue: false,
      rank: 1,
    });
  }

  const slips = s.roadmapSlips.filter((r) => r.daysLate >= thresholds.roadmapSlipDays).sort((a, b) => b.daysLate - a.daysLate);
  if (slips.length > 0) {
    const worst = slips[0]!;
    out.push({
      kind: "roadmap_slip",
      key: `insight:roadmap:${stableHash(slips.map((r) => [r.id, r.targetEnd, r.status]))}`,
      title: "Roadmap item past its target date",
      facts: {
        item_title: worst.title,
        item_status: worst.status,
        horizon: worst.horizon,
        target_end: worst.targetEnd,
        days_late: worst.daysLate,
        slipped_items: slips.length,
      },
      exhibit: { kind: "table", spec_ref: "roadmap_status" },
      blocksContinue: false,
      rank: 2,
    });
  }

  return out.sort((a, b) => a.rank - b.rank);
}
