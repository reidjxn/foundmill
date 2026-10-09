/**
 * Formatting helpers. Locale defaults to en-GB (matches @foundmill/shared money formatting).
 * Everything is pure; pass `now` where time is involved so tests and stories are deterministic.
 */
import { formatMoney as sharedFormatMoney, type Money } from "@foundmill/shared";
import { format as dfFormat, isValid } from "date-fns";

export const DEFAULT_LOCALE = "en-GB";

type DateInput = Date | string | number;

function toDate(d: DateInput): Date {
  return d instanceof Date ? d : new Date(d);
}

/** Integer or decimal with grouping. `digits` fixes the fraction digits; otherwise up to 2. */
export function formatNumber(n: number, opts: { digits?: number; maxDigits?: number; locale?: string; signed?: boolean } = {}): string {
  if (!Number.isFinite(n)) return "—";
  const f = new Intl.NumberFormat(opts.locale ?? DEFAULT_LOCALE, {
    minimumFractionDigits: opts.digits,
    maximumFractionDigits: opts.digits ?? opts.maxDigits ?? 2,
    signDisplay: opts.signed ? "exceptZero" : "auto",
  });
  return f.format(n);
}

/** 1.2K, 3.4M, 12B — one decimal under 100 of a unit, none above. */
export function formatCompact(n: number, opts: { locale?: string; signed?: boolean } = {}): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs < 1000) return formatNumber(n, { maxDigits: 0, signed: opts.signed, locale: opts.locale });
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [div, suffix] of units) {
    if (abs >= div) {
      const v = n / div;
      const digits = Math.abs(v) < 100 ? 1 : 0;
      const s = formatNumber(v, { maxDigits: digits, signed: opts.signed, locale: opts.locale });
      return `${s}${suffix}`;
    }
  }
  return formatNumber(n, { maxDigits: 0 });
}

/** Percent from a ratio (0.125 → "12.5%") or from a percentage when `ofHundred` is set. */
export function formatPercent(value: number, opts: { digits?: number; ofHundred?: boolean; signed?: boolean; locale?: string } = {}): string {
  if (!Number.isFinite(value)) return "—";
  const ratio = opts.ofHundred ? value / 100 : value;
  return new Intl.NumberFormat(opts.locale ?? DEFAULT_LOCALE, {
    style: "percent",
    minimumFractionDigits: opts.digits ?? 0,
    maximumFractionDigits: opts.digits ?? 1,
    signDisplay: opts.signed ? "exceptZero" : "auto",
  }).format(ratio);
}

/** Money from minor units via @foundmill/shared. */
export function formatMoney(m: Money, opts: { compact?: boolean; locale?: string } = {}): string {
  return sharedFormatMoney(m, opts);
}

/** Signed money delta: "+€1,200.00" / "−€300.00". */
export function formatMoneyDelta(m: Money, opts: { compact?: boolean; locale?: string } = {}): string {
  const s = sharedFormatMoney({ ...m, amountMinor: Math.abs(m.amountMinor) }, opts);
  if (m.amountMinor > 0) return `+${s}`;
  if (m.amountMinor < 0) return `−${s}`;
  return s;
}

/** date-fns `format` with Dugout defaults: "5 Oct 2026". */
export function formatDate(d: DateInput, pattern = "d MMM yyyy"): string {
  const date = toDate(d);
  return isValid(date) ? dfFormat(date, pattern) : "—";
}

/** "5 Oct 2026, 14:05" */
export function formatDateTime(d: DateInput): string {
  return formatDate(d, "d MMM yyyy, HH:mm");
}

/** "14:05" */
export function formatTime(d: DateInput): string {
  return formatDate(d, "HH:mm");
}

const REL_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/**
 * Relative time, short and plain: "just now", "3 min ago", "in 2 hr", "yesterday", "4 days ago".
 * Pass `now` for deterministic output.
 */
export function formatRelative(d: DateInput, now: DateInput = new Date(), opts: { locale?: string; style?: "long" | "short" | "narrow" } = {}): string {
  const date = toDate(d);
  const ref = toDate(now);
  if (!isValid(date) || !isValid(ref)) return "—";
  const diffSec = Math.round((date.getTime() - ref.getTime()) / 1000);
  if (Math.abs(diffSec) < 45) return "just now";
  const rtf = new Intl.RelativeTimeFormat(opts.locale ?? DEFAULT_LOCALE, { numeric: "auto", style: opts.style ?? "short" });
  for (const [unit, secs] of REL_UNITS) {
    if (Math.abs(diffSec) >= secs || unit === "minute") {
      const value = Math.round(diffSec / secs);
      return rtf.format(value, unit);
    }
  }
  return "just now";
}

/** Duration from milliseconds: "42s", "3m 12s", "1h 04m", "2d 3h". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** Token counts: "12.4K tokens" (compact). */
export function formatTokens(n: number): string {
  return `${formatCompact(n)} tokens`;
}

/** Delta with an arrow and a sign so colour is never the only signal: "▲ 12.5%", "▼ 3", "— 0". */
export function formatDelta(value: number, opts: { percent?: boolean; digits?: number } = {}): string {
  if (!Number.isFinite(value)) return "—";
  const arrow = value > 0 ? "▲" : value < 0 ? "▼" : "—";
  const body = opts.percent ? formatPercent(Math.abs(value), { digits: opts.digits ?? 1 }) : formatNumber(Math.abs(value), { maxDigits: opts.digits ?? 1 });
  return `${arrow} ${body}`;
}

/** Ordinal: 1st, 2nd, 3rd, 11th. */
export function formatOrdinal(n: number): string {
  const v = Math.abs(Math.trunc(n));
  const mod100 = v % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : (["th", "st", "nd", "rd"][v % 10] ?? "th");
  return `${n}${suffix}`;
}

/** Up to two initials from a display name: "Ada Lovelace" → "AL", "ledgerly" → "L". */
export function initials(name: string, max = 2): string {
  const parts = name
    .trim()
    .split(/[\s\-_.]+/)
    .filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return (parts[0] as string).slice(0, max).toUpperCase();
  return parts
    .slice(0, max)
    .map((p) => p.charAt(0))
    .join("")
    .toUpperCase();
}

/** Truncate with an ellipsis at a grapheme-safe boundary. */
export function truncate(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : `${chars.slice(0, Math.max(0, max - 1)).join("").trimEnd()}…`;
}

/** File sizes, 1024-based: "812 B", "3.4 KB", "34 KB", "1.2 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v < 10 ? v.toFixed(1).replace(/\.0$/, "") : Math.round(v)} ${units[u]}`;
}
