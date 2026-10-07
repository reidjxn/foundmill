/** Helpers shared by the distribution screens: layout, mutations with pending/error state, vocabulary, formatting. */
import { useCallback, useRef, useState, type ReactNode } from "react";
import { PageGrid, cn } from "@foundmill/dugout";
import { CHANNEL_META, type ChannelKey, type ChannelLine } from "@foundmill/shared";
import { useWidgetData } from "@foundmill/widgets";

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

/** Label + value pair for compact fact rows. */
export function Fact({ label, children, numeric }: { label: ReactNode; children: ReactNode; numeric?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="t-label truncate">{label}</p>
      <p className={cn("truncate text-body text-primary", numeric && "tabular-nums")}>{children}</p>
    </div>
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
