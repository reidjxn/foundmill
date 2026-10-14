/**
 * Trophy cabinet (BUILD §11.4): 1st / 10th / 100th / 1,000th customer; first €1K / €10K / €100K MRR;
 * first enterprise contract. Each trophy fires exactly once, when its counter crosses the threshold.
 */
import { minorToMajor, minorUnitDigits, type MilestoneKind } from "@foundmill/shared";
import { toIso } from "./time";
import { Milestone, TROPHY_KEYS, type TrophyKey } from "./types";

export interface TrophyCounters {
  /** Paying customers (first payments) so far. */
  customers: number;
  /** Monthly recurring revenue in minor units (trailing-30-day revenue for non-recurring businesses, labelled Estimate). */
  mrrMinor: number;
  /** Signed enterprise contracts so far. */
  enterpriseContracts: number;
}

export type TrophyMetric = keyof TrophyCounters;

export interface TrophyDefinition {
  key: TrophyKey;
  kind: MilestoneKind;
  metric: TrophyMetric;
  /** For `mrrMinor`: the threshold in minor units of a two-decimal currency; use `thresholdFor` for any other currency. */
  threshold: number;
  /** For `mrrMinor`: the threshold in major units of the business's currency ("1K" is 1,000 of it, whatever its decimals). */
  thresholdMajor?: number;
  label: (currency: string) => string;
}

/** The threshold in `currency`'s minor units: revenue trophies scale from major units, the rest are counts. */
export function thresholdFor(t: Pick<TrophyDefinition, "threshold" | "thresholdMajor">, currency: string): number {
  return t.thresholdMajor === undefined ? t.threshold : t.thresholdMajor * 10 ** minorUnitDigits(currency);
}

/** Below this annual contract value (10,000 in the business's currency) a contract is not "enterprise". Configurable per business later. */
export const ENTERPRISE_CONTRACT_MIN_MAJOR = 10_000;
/** `ENTERPRISE_CONTRACT_MIN_MAJOR` in minor units of a two-decimal currency (€10,000); `enterpriseContractMinMinor` for any currency. */
export const ENTERPRISE_CONTRACT_MIN_MINOR = ENTERPRISE_CONTRACT_MIN_MAJOR * 100;
export const enterpriseContractMinMinor = (currency: string): number => ENTERPRISE_CONTRACT_MIN_MAJOR * 10 ** minorUnitDigits(currency);

export const isEnterpriseContract = (amountMinor: number, thresholdMinor: number = ENTERPRISE_CONTRACT_MIN_MINOR): boolean => amountMinor >= thresholdMinor;

const ordinal = (n: number): string => `${n.toLocaleString("en-US")}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

/** "€1K", "€10K", "€100K" (minor units in). */
export function formatThreshold(amountMinor: number, currency: string): string {
  const major = minorToMajor(amountMinor, currency);
  // ICU builds differ on the compact suffix case ("€1K" vs "€1k"); pin the suffix so labels match across machines.
  return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "narrowSymbol", notation: "compact", maximumFractionDigits: 0 })
    .format(major)
    .replace(/(\d)k\b/g, "$1K");
}

export const TROPHIES: readonly TrophyDefinition[] = [
  { key: "customer_1", kind: "customer", metric: "customers", threshold: 1, label: () => "First customer" },
  { key: "customer_10", kind: "customer", metric: "customers", threshold: 10, label: () => `${ordinal(10)} customer` },
  { key: "customer_100", kind: "customer", metric: "customers", threshold: 100, label: () => `${ordinal(100)} customer` },
  { key: "customer_1000", kind: "customer", metric: "customers", threshold: 1000, label: () => `${ordinal(1000)} customer` },
  { key: "mrr_1k", kind: "revenue", metric: "mrrMinor", threshold: 100_000, thresholdMajor: 1_000, label: (c) => `First ${formatThreshold(1_000 * 10 ** minorUnitDigits(c), c)} MRR` },
  { key: "mrr_10k", kind: "revenue", metric: "mrrMinor", threshold: 1_000_000, thresholdMajor: 10_000, label: (c) => `First ${formatThreshold(10_000 * 10 ** minorUnitDigits(c), c)} MRR` },
  { key: "mrr_100k", kind: "revenue", metric: "mrrMinor", threshold: 10_000_000, thresholdMajor: 100_000, label: (c) => `First ${formatThreshold(100_000 * 10 ** minorUnitDigits(c), c)} MRR` },
  { key: "first_enterprise_contract", kind: "trophy", metric: "enterpriseContracts", threshold: 1, label: () => "First enterprise contract" },
];

export const TROPHY_BY_KEY: Record<TrophyKey, TrophyDefinition> = Object.fromEntries(TROPHIES.map((t) => [t.key, t])) as Record<TrophyKey, TrophyDefinition>;

export interface DetectTrophiesInput {
  before: TrophyCounters;
  after: TrophyCounters;
  at: string | Date;
  /** The business's own currency (0025): revenue milestone labels read in it ("First $1K MRR"). */
  currency: string;
  /** Trophies already in the cabinet; never awarded twice. */
  awarded?: Iterable<TrophyKey>;
  /** Attached to every milestone's `ref` (conversionId, entityId, contractId ...). */
  ref?: Record<string, unknown>;
  businessId?: string;
}

/** Milestones for every trophy whose counter crossed its threshold between `before` and `after`, in cabinet order. */
export function detectTrophies(input: DetectTrophiesInput): Milestone[] {
  const currency = input.currency;
  const awarded = new Set(input.awarded ?? []);
  const at = toIso(input.at);
  const out: Milestone[] = [];
  for (const t of TROPHIES) {
    if (awarded.has(t.key)) continue;
    const before = input.before[t.metric];
    const after = input.after[t.metric];
    const threshold = thresholdFor(t, currency);
    if (before < threshold && after >= threshold) {
      out.push(
        Milestone.parse({
          businessId: input.businessId,
          kind: t.kind,
          label: t.label(currency),
          achievedAt: at,
          ref: { trophyKey: t.key, metric: t.metric, threshold, value: after, ...(input.ref ?? {}) },
          trophyKey: t.key,
        }),
      );
    }
  }
  return out;
}

/** Convenience: the customer trophy that the nth paying customer earns, if any. */
export function customerTrophyFor(nthCustomer: number): TrophyDefinition | null {
  return TROPHIES.find((t) => t.metric === "customers" && t.threshold === nthCustomer) ?? null;
}

export const isTrophyKey = (s: string): s is TrophyKey => (TROPHY_KEYS as readonly string[]).includes(s);
