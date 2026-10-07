/**
 * Matchday round-up (BUILD §11.4 volume rules): after the 100th conversion of a kind, the ones that do not earn a
 * full Match Day roll into a daily results table.
 */
import { quantile } from "d3-array";
import { CONVERSION_KINDS, formatMoney, type ChannelKey, type ConversionKind, type MatchdayLevel } from "@foundmill/shared";
import { matchdayLevelFor, shouldPlayFullMatchDay } from "./builder";
import { compareByTimeThenId, dayKeyUtc } from "./time";
import type { Conversion, DayKey, Journey } from "./types";

/** 75th percentile (d3 quantile, linear interpolation); null for an empty set. */
export function percentile75(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const q = quantile(values, 0.75);
  return q === undefined ? null : q;
}

export interface MatchDayDecision {
  conversion: Conversion;
  nthOfKind: number;
  matchdayLevel: MatchdayLevel;
  fullMatchDay: boolean;
  /** The payment-value percentile the rule compared against (payments only). */
  valuePercentile75Minor: number | null;
}

export interface ApplyVolumeRulesOptions {
  /** How many of each kind the business already had before `conversions`. */
  countsBefore?: Partial<Record<ConversionKind, number>>;
  /** Payment values (minor) already seen, for the running 75th percentile. */
  paymentValuesBefore?: readonly number[];
  /** Entities flagged high-value. */
  flaggedEntityIds?: Iterable<string>;
}

/** Walks conversions in time order, numbering each within its kind and deciding full Match Day vs round-up. */
export function applyVolumeRules(conversions: readonly Conversion[], opts: ApplyVolumeRulesOptions = {}): MatchDayDecision[] {
  const counts: Record<ConversionKind, number> = { signup: 0, activation: 0, payment: 0 };
  for (const k of CONVERSION_KINDS) counts[k] = opts.countsBefore?.[k] ?? 0;
  const payments = [...(opts.paymentValuesBefore ?? [])];
  const flagged = new Set(opts.flaggedEntityIds ?? []);
  const out: MatchDayDecision[] = [];
  for (const c of [...conversions].sort(compareByTimeThenId)) {
    counts[c.kind] += 1;
    const p75 = c.kind === "payment" ? percentile75(payments) : null;
    const full = shouldPlayFullMatchDay(c.kind, counts[c.kind], c.amountMinor, p75, c.entityId !== null && flagged.has(c.entityId));
    out.push({ conversion: c, nthOfKind: counts[c.kind], matchdayLevel: matchdayLevelFor(c.kind), fullMatchDay: full, valuePercentile75Minor: p75 });
    if (c.kind === "payment") payments.push(c.amountMinor);
  }
  return out;
}

export interface RoundupEntry {
  conversion: Conversion;
  journey?: Pick<Journey, "captain" | "stats" | "matchdayLevel"> | null;
  entityName?: string | null;
}

export interface RoundupRow {
  conversionId: string;
  entityId: string | null;
  entityName: string | null;
  kind: ConversionKind;
  matchdayLevel: MatchdayLevel;
  occurredAt: string;
  amountMinor: number;
  currency: string;
  captainChannelKey: ChannelKey | null;
  touchCount: number | null;
  timeToConvertHours: number | null;
}

export interface RoundupTable {
  day: DayKey;
  rows: RoundupRow[];
  kinds: Record<ConversionKind, number>;
  totals: { signups: number; activations: number; payments: number; revenueByCurrency: Record<string, number> };
  /** "3 signups · 2 activations · 1 payment (€120.00)" */
  headline: string;
}

/** The daily results table for conversions that did not get a full Match Day. Entries outside `day` (UTC) are ignored. */
export function buildDailyRoundup(input: { day: DayKey; entries: readonly RoundupEntry[] }): RoundupTable {
  const rows: RoundupRow[] = input.entries
    .filter((e) => dayKeyUtc(e.conversion.occurredAt) === input.day)
    .sort((a, b) => compareByTimeThenId(a.conversion, b.conversion))
    .map((e) => ({
      conversionId: e.conversion.id,
      entityId: e.conversion.entityId,
      entityName: e.entityName ?? null,
      kind: e.conversion.kind,
      matchdayLevel: e.journey?.matchdayLevel ?? matchdayLevelFor(e.conversion.kind),
      occurredAt: e.conversion.occurredAt,
      amountMinor: e.conversion.amountMinor,
      currency: e.conversion.currency,
      captainChannelKey: e.journey?.captain?.channelKey ?? null,
      touchCount: e.journey?.stats.touchCount ?? null,
      timeToConvertHours: e.journey?.stats.timeToConvertHours ?? null,
    }));
  const kinds: Record<ConversionKind, number> = { signup: 0, activation: 0, payment: 0 };
  const revenueByCurrency: Record<string, number> = {};
  for (const r of rows) {
    kinds[r.kind] += 1;
    if (r.kind === "payment") revenueByCurrency[r.currency] = (revenueByCurrency[r.currency] ?? 0) + r.amountMinor;
  }
  const parts: string[] = [];
  if (kinds.signup) parts.push(plural(kinds.signup, "signup"));
  if (kinds.activation) parts.push(plural(kinds.activation, "activation"));
  if (kinds.payment) {
    const money = Object.entries(revenueByCurrency).map(([currency, amountMinor]) => formatMoney({ amountMinor, currency })).join(" + ");
    parts.push(`${plural(kinds.payment, "payment")} (${money})`);
  }
  return {
    day: input.day,
    rows,
    kinds,
    totals: { signups: kinds.signup, activations: kinds.activation, payments: kinds.payment, revenueByCurrency },
    headline: parts.length ? parts.join(" · ") : "No results",
  };
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
