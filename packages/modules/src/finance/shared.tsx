"use client";
/** Helpers shared by the finance screens: layout, clock, money, mutations with pending/error state, downloads. */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import type { Money } from "@foundmill/shared";
import { PageGrid, cn, formatMoney } from "@foundmill/dugout";
import { useWidgetData } from "@foundmill/widgets/data";

/* ---------- Options (host or tests) ---------- */

export interface FinanceScreenOptions {
  /** Fixed "now" for deterministic periods in stories and tests. */
  now?: Date;
}

const OptionsCtx = createContext<FinanceScreenOptions>({});

export function FinanceScreenOptionsProvider({ value, children }: { value: FinanceScreenOptions; children: ReactNode }) {
  return <OptionsCtx.Provider value={value}>{children}</OptionsCtx.Provider>;
}

/** The clock a screen reads once per mount (so query inputs stay stable between renders). */
export function useNow(): Date {
  const opts = useContext(OptionsCtx);
  const [now] = useState(() => opts.now ?? new Date());
  return now;
}

/* ---------- Layout ---------- */

/** A module screen fills the content region: a 12-column PageGrid with the content gutter. */
export function Screen({ name, children, className }: { name: string; children: ReactNode; className?: string }) {
  return (
    <PageGrid data-module-screen={name} className={cn("p-gutter", className)}>
      {children}
    </PageGrid>
  );
}

/** Label + value pair for compact fact rows. */
export function Fact({ label, children, numeric, className }: { label: ReactNode; children: ReactNode; numeric?: boolean; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="t-label truncate">{label}</p>
      <p className={cn("truncate text-body text-primary", numeric && "tabular-nums")}>{children}</p>
    </div>
  );
}

/* ---------- Money ---------- */

export function useCurrency(): string {
  return useWidgetData().currency ?? "EUR";
}

export const money = (amountMinor: number, currency: string): Money => ({ amountMinor: Math.round(amountMinor), currency });

/** Money text; `compact` drops the cents and shortens large figures (tiles and charts). */
export function fmtMoney(amountMinor: number | null | undefined, currency: string, opts: { compact?: boolean } = {}): string {
  if (amountMinor === null || amountMinor === undefined || !Number.isFinite(amountMinor)) return "—";
  return formatMoney(money(amountMinor, currency), opts);
}

/** Signed money: "+€1,200" / "−€300" (the sign is always a glyph, never only a colour). */
export function fmtSigned(amountMinor: number | null | undefined, currency: string, opts: { compact?: boolean } = {}): string {
  if (amountMinor === null || amountMinor === undefined || !Number.isFinite(amountMinor)) return "—";
  const s = formatMoney(money(Math.abs(amountMinor), currency), opts);
  return amountMinor < 0 ? `−${s}` : amountMinor > 0 ? `+${s}` : s;
}

/**
 * Chart axis money: always compact, one decimal where it matters ("£1.5M", "£5K", "−£5K"), so neighbouring ticks never
 * read the same and the sign is a real minus with the business's symbol.
 */
export function fmtAxisMoney(amountMinor: number | null | undefined, currency: string): string {
  if (amountMinor === null || amountMinor === undefined || !Number.isFinite(amountMinor)) return "—";
  const major = amountMinor / 100;
  try {
    const text = new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "narrowSymbol", notation: "compact", maximumFractionDigits: Math.abs(major) >= 1000 ? 1 : 0 }).format(Math.abs(major));
    return major < 0 ? `−${text}` : text;
  } catch {
    return fmtSigned(amountMinor, currency, { compact: true });
  }
}

/** "72,318", "25k", "1.2m", "£4,000" → major units (null when it is not a number). The inverse of the grouped display. */
export function parseAmount(raw: string): number | null {
  const m = /^([+-]?)(\d+(?:\.\d+)?)([kmb])?$/i.exec(raw.trim().replace(/[,\s'£$€¥]/g, ""));
  if (!m) return null;
  const mult = m[3] ? { k: 1e3, m: 1e6, b: 1e9 }[m[3].toLowerCase() as "k" | "m" | "b"] : 1;
  const n = Number(`${m[1]}${m[2]}`) * mult;
  return Number.isFinite(n) ? n : null;
}

export function fmtMonths(months: number | null | undefined): string {
  if (months === null || months === undefined || !Number.isFinite(months)) return "—";
  return `${Math.round(months * 10) / 10} mo`;
}

export function fmtQuantity(q: number | string | null | undefined): string {
  if (q === null || q === undefined) return "—";
  const n = Number(q);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(n);
}

/* ---------- Tables ---------- */

/** DataTable body height that shows `rows` compact rows under the sticky header (no dead space under short tables). */
export function fitTableHeight(rows: number, opts: { minRows?: number; maxRows?: number; rowHeight?: number } = {}): number {
  const { minRows = 4, maxRows = 18, rowHeight = 28 } = opts;
  return 41 + Math.min(maxRows, Math.max(minRows, rows)) * rowHeight;
}

/* ---------- Mutations ---------- */

export interface ActionState {
  pending: string | null;
  error: Error | null;
  clearError: () => void;
  /** Run a mutation; resolves to the result or undefined when it failed (the error is kept in state). */
  run: <T = unknown>(path: string, input: Record<string, unknown>, opts?: { key?: string; then?: (result: T) => void }) => Promise<T | undefined>;
}

/** Mutations through the host data source with one pending key and the last error, for buttons and inline errors. */
export function useAction(): ActionState {
  const { mutate } = useWidgetData();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const alive = useRef(true);
  const run = useCallback(
    async <T,>(path: string, input: Record<string, unknown>, opts?: { key?: string; then?: (result: T) => void }): Promise<T | undefined> => {
      const key = opts?.key ?? path;
      setPending(key);
      setError(null);
      try {
        const result = await mutate<T>(path, input);
        opts?.then?.(result);
        return result;
      } catch (e) {
        if (alive.current) setError(e instanceof Error ? e : new Error(String(e)));
        return undefined;
      } finally {
        if (alive.current) setPending((p) => (p === key ? null : p));
      }
    },
    [mutate],
  );
  return { pending, error, clearError: () => setError(null), run };
}

export function errorMessage(e: Error | string | null | undefined): string {
  if (!e) return "";
  const m = typeof e === "string" ? e : e.message;
  return m && m.length < 200 ? m : "Something went wrong. Try again.";
}

/** One line of status-bad text under a control (never the only signal: the control also stays enabled). */
export function InlineError({ error, className }: { error: Error | string | null | undefined; className?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className={cn("text-small text-status-bad", className)}>
      {errorMessage(error)}
    </p>
  );
}

/* ---------- Downloads ---------- */

/**
 * Offer a text file to the browser. Returns false where object URLs are unavailable (tests, SSR, sandboxed viewers)
 * so the caller can fall back to showing the text.
 */
export function downloadText(fileName: string, text: string, mime = "text/csv;charset=utf-8"): boolean {
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function" || typeof Blob === "undefined") return false;
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

export function toDate(d: string | Date | null | undefined): Date | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
}
