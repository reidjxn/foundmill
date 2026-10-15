/**
 * Leaderboards in words, shared by the LIVE screens (apps/web lib/live.ts re-exports these) and the Leaderboard widget,
 * so a board reads the same everywhere: "Customers won · B2B SaaS · EU", "Q4 2026", never a stored key such as
 * "2026-Q4 · b2b_saas". Pure and server-safe.
 */
import { ARCHETYPE_LABELS, type Archetype } from "@foundmill/shared/constants";
import { formatNumber } from "@foundmill/dugout/lib/format";

const WORDS: Record<string, string> = { b2b: "B2B", b2c: "B2C", saas: "SaaS", mrr: "MRR", arr: "ARR", eu: "EU", us: "US", ai: "AI", pct: "%", dtc: "DTC" };

/** "customers_won" → "Customers won", "b2b_saas" → "B2B SaaS". */
export function humanise(key: string): string {
  const words = key.split(/[_\s-]+/).filter(Boolean);
  return words
    .map((w, i) => (Object.hasOwn(WORDS, w.toLowerCase()) ? WORDS[w.toLowerCase()] : undefined) ?? (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join(" ");
}

export interface BoardLike {
  id: string;
  boardKind: string;
  division: string;
  period: string;
  metric: string;
  archetype: string | null;
  region: string | null;
  computedAt: Date | string | null;
}

export function boardKindLabel(kind: string): string {
  return humanise(kind);
}

/** "Q4 2026", "Oct 2026", "All time". Anything else is shown as written. */
export function periodLabel(period: string): string {
  const q = /^(\d{4})-Q([1-4])$/.exec(period);
  if (q) return `Q${q[2]} ${q[1]}`;
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (m) return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m[2]) - 1]} ${m[1]}`;
  if (period === "all-time") return "All time";
  return period;
}

/** Who a board compares: its division, archetype and region, e.g. "B2B SaaS · EU". "open" divisions read "Open". */
export function boardScope(board: Pick<BoardLike, "division" | "archetype" | "region">): string {
  const archetype = board.archetype ? (ARCHETYPE_LABELS[board.archetype as Archetype] ?? humanise(board.archetype)) : null;
  const division = board.division === board.archetype ? null : humanise(board.division);
  return [archetype ?? division ?? "Open", archetype ? division : null, board.region ? board.region.toUpperCase() : null].filter(Boolean).join(" · ");
}

export type MetricFormat = "percent" | "integer" | "number";

/** How a board's ranked metric reads: its name, and whether the value is a percentage, a count or a plain figure. */
export function describeMetric(metric: string): { label: string; format: MetricFormat } {
  if (/_pct$/.test(metric)) return { label: humanise(metric.replace(/_pct$/, "")), format: "percent" };
  if (/^customers?(_won)?$/.test(metric)) return { label: "Customers won", format: "integer" };
  return { label: humanise(metric), format: "number" };
}

/** A ranked value as its metric reads: "12.5%", "494", "1,204.5"; "—" for anything that is not a number. */
export function metricValueText(value: string | number, format: MetricFormat): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  if (format === "percent") return `${formatNumber(n, { digits: 1 })}%`;
  return formatNumber(n, { maxDigits: format === "integer" ? 0 : 2 });
}

/** A board's title: its kind and who it compares ("Growth · B2B SaaS · EU"). */
export function boardTitle(board: Pick<BoardLike, "boardKind" | "division" | "archetype" | "region">): string {
  return `${boardKindLabel(board.boardKind)} · ${boardScope(board)}`;
}
