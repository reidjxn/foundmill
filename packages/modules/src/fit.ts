"use client";
/**
 * Small layout and wording helpers the module screens share (team, development).
 *
 * - `fitToGrow`: size DataTable columns from fit specs: each column has a minimum (what its content needs) and a grow
 *   weight for the extra width, which the DataTable shares itself (`meta.grow`), so a view fills the panel at 1280 and
 *   1440 without a column cut at the edge (DESIGN §2 "never clip"); below the sum of the minimums the table scrolls
 *   sideways with its fade cue instead of squeezing a column. `useTableWidth` + `fitColumns` are the measured form
 *   (kept for callers that need the numbers).
 * - `humanise` and `plural`: never show raw identifiers or "1 agents" to the founder.
 */
import { useCallback, useLayoutEffect, useRef, useState, type RefCallback } from "react";
import type { DataTableColumn } from "@foundmill/dugout";

export interface ColumnFit {
  /** The width its content needs (px, including the cell padding). */
  min: number;
  /** Share of the extra width (0 or omitted: stays at `min`). */
  grow?: number;
}

/**
 * Column sizes for the visible columns: every column at its minimum, the remaining width shared by grow weight (the
 * rounding remainder goes to the heaviest grower). Columns not in `visible` keep their minimum.
 */
export function fitColumns<K extends string>(width: number | null | undefined, specs: Record<K, ColumnFit>, visible: readonly K[]): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const id of Object.keys(specs) as K[]) out[id] = specs[id].min;
  const shown = visible.filter((id) => id in specs);
  const sumMin = shown.reduce((s, id) => s + specs[id].min, 0);
  const extra = Math.floor((width ?? 0) - sumMin);
  const growers = shown.filter((id) => (specs[id].grow ?? 0) > 0);
  const weight = growers.reduce((s, id) => s + (specs[id].grow ?? 0), 0);
  if (extra <= 0 || weight <= 0) return out;
  let given = 0;
  for (const id of growers) {
    const add = Math.floor((extra * (specs[id].grow ?? 0)) / weight);
    out[id] += add;
    given += add;
  }
  const heaviest = growers.reduce((a, b) => ((specs[b].grow ?? 0) > (specs[a].grow ?? 0) ? b : a));
  out[heaviest] += extra - given;
  return out;
}

/**
 * DataTable columns sized from fit specs, for the table to fit itself: each column at its minimum with its grow weight
 * as `meta.grow`, so the DataTable shares the spare width by weight in the header and the body alike, at whatever width
 * it has and for whichever columns the view shows (no measuring here). Columns without a spec are left as they are.
 */
export function fitToGrow<T>(columns: DataTableColumn<T>[], specs: Readonly<Record<string, ColumnFit>>): DataTableColumn<T>[] {
  return columns.map((c) => {
    const id = c.id ?? (c as { accessorKey?: string }).accessorKey;
    const spec = id ? specs[id] : undefined;
    if (!spec) return c;
    return { ...c, size: spec.min, meta: { ...c.meta, grow: spec.grow ?? 0 } };
  });
}

/**
 * The inner width of the DataTable inside the returned ref's element: the body's client width (borders and the
 * vertical scrollbar already taken off), re-read when the element resizes and after every render (rows arriving can
 * add the scrollbar). Null until measured (server render, tests), so callers fall back to the minimums.
 */
export function useTableWidth(): [RefCallback<HTMLElement>, number | null] {
  const [width, setWidth] = useState<number | null>(null);
  const node = useRef<HTMLElement | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const measure = useCallback(() => {
    const el = node.current;
    if (!el) return;
    const body = el.querySelector<HTMLElement>("[data-density]");
    const w = body ? body.clientWidth : el.clientWidth;
    if (w > 0) setWidth((prev) => (prev === w ? prev : w));
  }, []);
  const ref = useCallback<RefCallback<HTMLElement>>(
    (el) => {
      observer.current?.disconnect();
      node.current = el;
      if (!el || typeof ResizeObserver === "undefined") return;
      observer.current = new ResizeObserver(() => measure());
      observer.current.observe(el);
      measure();
    },
    [measure],
  );
  // Rows arriving can add a vertical scrollbar without resizing the wrapper: measure again after each render.
  useLayoutEffect(() => measure());
  return [ref, width];
}

/** Initialisms that read in capitals inside a humanised key ("api_design" → "API design"). */
const INITIALISMS = new Set(["api", "ab", "b2b", "b2c", "cac", "cd", "ci", "cpa", "crm", "css", "dtc", "gdpr", "html", "ip", "kpi", "llm", "ltv", "moq", "pr", "ppc", "qa", "rfq", "roas", "roi", "seo", "sku", "sql", "ui", "url", "ux", "vat"]);

/** "cycle_planning" → "Cycle planning"; "api_design" → "API design"; "ci_cd" → "CI/CD". Empty for null. */
export function humanise(s: string | null | undefined): string {
  if (!s) return "";
  const words = s
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (INITIALISMS.has(w) ? w.toUpperCase() : w))
    .join(" ")
    .replace(/\bCI CD\b/, "CI/CD");
  return words ? words[0]!.toUpperCase() + words.slice(1) : "";
}

/** "1 agent", "3 agents"; pass `many` for irregular nouns ("1 person", "2 people"). */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
