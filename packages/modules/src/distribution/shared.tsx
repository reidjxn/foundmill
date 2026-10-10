"use client";
/** Helpers shared by the distribution screens: layout, mutations with pending/error state, vocabulary, formatting. */
import { useCallback, useMemo, useRef, useState, type ReactNode, type RefCallback } from "react";
import { PageGrid, ProvenanceChip, cn, formatMoney, type SavedView } from "@foundmill/dugout";
import { CHANNEL_META, type ChannelKey, type ChannelLine } from "@foundmill/shared/constants";
import { useWidgetData } from "@foundmill/widgets/data";
import { fitColumns, useTableWidth, type ColumnFit } from "../fit";

/* ---------- Vocabulary (CLAUDE.md: channel lines read Acquisition / Engagement / Organic / Offline) ---------- */

export const LINE_LABELS: Record<ChannelLine, string> = { attack: "Acquisition", midfield: "Engagement", defence: "Organic", wings: "Offline" };
export const LINE_ORDER: readonly ChannelLine[] = ["attack", "midfield", "defence", "wings"];

export function lineLabel(line: ChannelLine): string {
  return LINE_LABELS[line];
}

export function channelLabel(key: ChannelKey): string {
  return CHANNEL_META[key].label;
}

/** "Offline tracking" is the user-facing name for kit mode (bookings go through a founder task, never an API). */
export const OFFLINE_TRACKING_LABEL = "Offline tracking";

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

/* ---------- Layout ---------- */

/** A module screen fills the content region: a 12-column PageGrid with the content gutter. */
export function Screen({ name, children, className }: { name: string; children: ReactNode; className?: string }) {
  return (
    <PageGrid data-module-screen={name} className={cn("p-gutter", className)}>
      {children}
    </PageGrid>
  );
}

/** Label + value pair for compact fact rows. Values wrap; numbers never break. */
export function Fact({ label, children, numeric }: { label: ReactNode; children: ReactNode; numeric?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="t-label">{label}</p>
      <p className={cn("text-body text-primary", numeric ? "whitespace-nowrap tabular-nums" : "break-words")}>{children}</p>
    </div>
  );
}

/** DataTable body height that shows `rows` compact rows under the sticky header (no dead space under short tables). */
export function fitTableHeight(rows: number, opts: { minRows?: number; maxRows?: number; rowHeight?: number } = {}): number {
  const { minRows = 4, maxRows = 18, rowHeight = 28 } = opts;
  return 41 + Math.min(maxRows, Math.max(minRows, rows)) * rowHeight;
}

/**
 * Column widths that fill the table's real width for the saved view on screen (DESIGN §2 "never clip"): every column
 * at the width its content needs, the spare width shared by grow weight, so the default view fits at 1280 with no
 * column cut at the panel edge and figures do not drift apart at 1440. Put `ref` on a wrapper around the DataTable and
 * pass `onActiveViewChange` to it.
 */
export function useFittedColumns<K extends string>(
  specs: Record<K, ColumnFit>,
  views: readonly SavedView[],
  defaultViewId: string,
  /** Columns the screen actually renders, when it leaves some out (an unmeasured count, say). */
  present?: readonly string[],
): { ref: RefCallback<HTMLElement>; sizes: Record<K, number>; onActiveViewChange: (id: string | null) => void } {
  const [ref, width] = useTableWidth();
  const [viewId, setViewId] = useState<string | null>(defaultViewId);
  const inView = (views.find((v) => v.id === viewId) ?? views.find((v) => v.id === defaultViewId))?.columns ?? [];
  const columns = present ? inView.filter((c) => present.includes(c)) : inView;
  const key = columns.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for the visible column list
  const sizes = useMemo(() => fitColumns(width, specs, columns as K[]), [width, specs, key]);
  return { ref, sizes, onActiveViewChange: setViewId };
}

/** "1,250", "25k", "£4,000" → major units (null when it is not a number). The inverse of MoneyInput's grouped display. */
export function parseMajor(raw: string): number | null {
  const m = /^([+-]?)(\d+(?:\.\d+)?)([kmb])?$/i.exec(raw.trim().replace(/[,\s'£$€¥]/g, ""));
  if (!m) return null;
  const mult = m[3] ? { k: 1e3, m: 1e6, b: 1e9 }[m[3].toLowerCase() as "k" | "m" | "b"] : 1;
  const n = Number(`${m[1]}${m[2]}`) * mult;
  return Number.isFinite(n) ? n : null;
}

/** "lead_generation" / "web-form" → "Lead generation" / "Web form": stored keys read as words. */
export function plainWords(key: string | null | undefined): string {
  if (!key) return "";
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A source key as words: a channel key reads as its channel's name ("paid_ads" → "Paid advertising"). */
export function sourceLabel(source: string | null | undefined): string {
  if (!source) return "";
  const meta = (CHANNEL_META as Record<string, { label: string } | undefined>)[source];
  return meta ? meta.label : plainWords(source);
}

/**
 * An estimated amount with its Estimate chip. A channel that spent nothing has no cost to estimate, so it reads
 * "No spend" (never "£0.00 Estimate").
 */
export function EstimatedMoney({ amountMinor, currency, spendMinor }: { amountMinor: number | null; currency: string; spendMinor?: number | null }) {
  if (amountMinor === null || amountMinor === undefined) return <span className="text-secondary">No customers yet</span>;
  if (amountMinor === 0 && !spendMinor) return <span className="text-secondary">No spend</span>;
  return (
    <span className="inline-flex items-center gap-1.5 tabular-nums">
      {formatMoney({ amountMinor, currency })} <ProvenanceChip kind="estimate" />
    </span>
  );
}

/* ---------- Small utilities ---------- */

export function toDate(d: string | Date | null | undefined): Date | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toNumber(v: number | string | null | undefined, fallback = 0): number {
  if (v === null || v === undefined) return fallback;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** The `?key=` of the current location (screens deep-link through the host router). */
export function searchParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search).get(key);
  } catch {
    return null;
  }
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}
