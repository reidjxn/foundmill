"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Tooltip } from "./Tooltip";

/**
 * FitText (DESIGN §2 "Never clip"): text in a fixed or squeezed slot steps its font down to a floor, then (lines={2})
 * wraps to two lines, then truncates with a tooltip as the last resort. Numbers never truncate (`truncate={false}`):
 * they show a `fallback` ("£1.2m") instead.
 *
 * How it works (audit-overflow §2, option B):
 *   - A hidden ghost copy at the base size gives the box its intrinsic width, so fitting never moves the layout and
 *     the observer never feeds back on itself. Content-sized buttons keep their natural width; squeezed slots shrink.
 *   - One ResizeObserver serves every instance. Its callback reads every box first, then writes every scale
 *     (`--fit` on the box and `data-fit="fits|scaled|truncated"`), so a page of chips costs one layout.
 *   - Nothing is measured during render: server and client markup match. Before hydration the text shows at full size
 *     with an ellipsis (it never spills); it fits before the first paint after hydration.
 *   - Re-measures when the text changes and when web fonts finish loading.
 */
export type FitState = "fits" | "scaled" | "truncated";

export interface FitTextProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  children: ReactNode;
  /** The plain text: the ghost's copy and the tooltip. Defaults to `children` when it is a string or number. */
  text?: string;
  /** The smallest font size in px. Default by base size: 11 up to 14 px, 75 % up to 20 px, 60 % above (30 → 18). */
  minPx?: number;
  /** 2: wrap to two lines (line-clamped) before shrinking; for two-line decision options. */
  lines?: 1 | 2;
  /** The last resort: "end" (ellipsis), "middle" (ids, emails: "inv_8f…2041"), or false for numbers. */
  truncate?: "end" | "middle" | false;
  /** With truncate={false}: the copy shown when even the floor does not fit (compact money "£1.2m"). */
  fallback?: string;
  /** Show the full text in a tooltip while it is truncated. Default true; a control that owns its own tooltip (Button) passes false. */
  tooltip?: boolean;
  /** Called when the state changes (and once after the first measure if it is not "fits"). */
  onFitChange?: (state: FitState) => void;
}

/** The default floor for a base size (DESIGN §2: nothing below 11 px except kbd glyphs). */
export function fitTextFloor(basePx: number): number {
  if (basePx <= 14) return Math.min(basePx, 11);
  if (basePx <= 20) return Math.round(basePx * 0.75);
  return Math.round(basePx * 0.6);
}

/**
 * The scale for one line: the largest font size, in 0.5 px steps, at which `naturalPx` (the width at `basePx`) fits
 * `availPx`, never below `floorPx`. Pure, for tests and for callers that measure themselves.
 */
export function fitScale(naturalPx: number, availPx: number, basePx: number, floorPx: number): { px: number; state: FitState } {
  if (naturalPx <= availPx + 0.5 || naturalPx <= 0) return { px: basePx, state: "fits" };
  const ideal = (basePx * availPx) / naturalPx;
  const px = Math.max(Math.min(floorPx, basePx), Math.floor(ideal * 2) / 2);
  const state: FitState = (naturalPx * px) / basePx > availPx + 0.5 ? "truncated" : "scaled";
  return { px, state };
}

/** "inv_8f2c41d9_2041" in 9 characters → "inv_…2041" (keeps both ends, which is where ids and emails differ). */
export function middleTruncate(text: string, keep: number): string {
  if (keep >= text.length) return text;
  const k = Math.max(2, keep - 1);
  const head = Math.ceil(k / 2);
  const tail = Math.floor(k / 2);
  return `${text.slice(0, head)}…${tail > 0 ? text.slice(text.length - tail) : ""}`;
}

/* ---------- One shared observer for every instance ---------- */
type Measure = () => (() => void) | null;
const registry = new Map<Element, Measure>();
let observer: ResizeObserver | null = null;
let fontsHooked = false;

function runBatch(targets: Iterable<Element>): void {
  const writes: Array<() => void> = [];
  for (const t of targets) {
    const w = registry.get(t)?.();
    if (w) writes.push(w);
  }
  for (const w of writes) w();
}

function sharedObserver(): ResizeObserver | null {
  if (typeof ResizeObserver === "undefined") return null;
  observer ??= new ResizeObserver((entries) => runBatch(entries.map((e) => e.target)));
  if (!fontsHooked && typeof document !== "undefined" && document.fonts && typeof document.fonts.addEventListener === "function") {
    fontsHooked = true;
    document.fonts.addEventListener("loadingdone", () => runBatch([...registry.keys()]));
  }
  return observer;
}

/** Measure every mounted FitText again (after a change the observer cannot see, e.g. a class toggled on an ancestor). */
export function refitAll(): void {
  runBatch([...registry.keys()]);
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function FitText({ children, text, minPx, lines = 1, truncate = "end", fallback, tooltip = true, onFitChange, className, style, ...rest }: FitTextProps) {
  const plain = text ?? (typeof children === "string" || typeof children === "number" ? String(children) : undefined);
  const box = useRef<HTMLSpanElement | null>(null);
  const ghost = useRef<HTMLSpanElement | null>(null);
  const body = useRef<HTMLSpanElement | null>(null);
  const alt = useRef<HTMLSpanElement | null>(null);
  const base = useRef<number | null>(null);
  const state = useRef<FitState | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  // The latest props for the observer's closure.
  const opts = useRef({ minPx, lines, truncate, fallback, plain, tooltip, onFitChange });
  opts.current = { minPx, lines, truncate, fallback, plain, tooltip, onFitChange };

  const apply = useCallback((scale: number, next: FitState, altText: string | null) => {
    const el = box.current;
    if (!el) return;
    if (scale >= 1) el.style.removeProperty("--fit");
    else el.style.setProperty("--fit", String(Number(scale.toFixed(4))));
    if (alt.current) alt.current.textContent = altText ?? "";
    if (altText) el.setAttribute("data-fit-alt", "");
    else el.removeAttribute("data-fit-alt");
    el.setAttribute("data-fit", next);
    if (state.current !== next) {
      const first = state.current === null;
      state.current = next;
      if (opts.current.tooltip) setTruncated(next === "truncated");
      if (!first || next !== "fits") opts.current.onFitChange?.(next);
    }
  }, []);

  const measure = useCallback((): (() => void) | null => {
    const el = box.current;
    const g = ghost.current;
    const t = body.current;
    if (!el || !g || !t) return null;
    const avail = el.clientWidth;
    if (avail <= 0) return null; // hidden (display:none, a closed tab): measure again when it shows
    const natural = g.scrollWidth;
    const basePx = (base.current ??= Number.parseFloat(getComputedStyle(g).fontSize) || 13);
    const o = opts.current;
    const floor = Math.min(basePx, o.minPx ?? fitTextFloor(basePx));
    if (o.lines === 2) {
      // Wrapping comes first; shrink only when two lines are not enough. Line-clamped text reports its overflow in
      // scrollHeight, so step down in 0.5 px until it fits or reaches the floor (bounded; rare: decision options).
      return () => {
        let px = basePx;
        el.style.removeProperty("--fit");
        const overflows = () => t.scrollHeight > t.clientHeight + 1;
        while (overflows() && px - 0.5 >= floor) {
          px -= 0.5;
          el.style.setProperty("--fit", String(px / basePx));
        }
        const next: FitState = overflows() ? "truncated" : px < basePx ? "scaled" : "fits";
        apply(px / basePx, next, null);
      };
    }
    const { px, state: next } = fitScale(natural, avail, basePx, floor);
    let altText: string | null = null;
    let scale = px / basePx;
    let final = next;
    if (next === "truncated" && o.plain) {
      if (o.truncate === "middle") {
        const keep = Math.floor((o.plain.length * avail) / ((natural * px) / basePx)) - 1;
        altText = middleTruncate(o.plain, Math.max(3, keep));
      } else if (o.truncate === false && o.fallback) {
        altText = o.fallback;
        // The fallback is shorter: give it back as much size as its estimated width allows.
        const estimate = (natural * o.fallback.length) / Math.max(1, o.plain.length);
        scale = Math.min(1, Math.max(floor / basePx, (0.92 * avail) / Math.max(1, estimate)));
        final = "truncated";
      }
    }
    if (altText && o.truncate === false) {
      // The fallback's width was estimated: check it once written and step down further if it still overflows.
      return () => {
        apply(scale, final, altText);
        const a = alt.current;
        const w = a?.scrollWidth ?? 0;
        if (a && w > avail + 0.5) {
          const fitted = Math.max(floor / basePx, Math.floor(((scale * basePx * avail) / w) * 2) / 2 / basePx);
          if (fitted < scale) apply(fitted, final, altText);
        }
      };
    }
    return () => apply(scale, final, altText);
  }, [apply]);

  // Register with the shared observer for the life of the element.
  useIsoLayoutEffect(() => {
    const el = box.current;
    const ro = sharedObserver();
    if (!el || !ro) return;
    registry.set(el, measure);
    ro.observe(el);
    return () => {
      ro.unobserve(el);
      registry.delete(el);
    };
  }, [measure]);

  // A new text in the same box does not resize it, so the observer would not fire: measure now, before paint.
  useIsoLayoutEffect(() => {
    base.current = null;
    if (box.current && registry.has(box.current)) measure()?.();
  }, [plain, lines, truncate, fallback, minPx, measure]);

  const span = (
    <span
      ref={box}
      data-fit-box=""
      data-lines={lines}
      className={cn("fit-box", className)}
      style={style as CSSProperties | undefined}
      {...rest}
    >
      <span ref={ghost} aria-hidden className="fit-ghost" data-text={plain} data-flat={lines === 2 ? "" : undefined}>
        {plain === undefined ? children : null}
      </span>
      <span ref={body} className="fit-text" data-lines={lines} data-truncate={truncate === false ? "false" : undefined}>
        {children}
      </span>
      <span ref={alt} aria-hidden className="fit-alt" />
    </span>
  );

  if (!tooltip || !plain) return span;
  return (
    <Tooltip content={plain} open={truncated && tipOpen} onOpenChange={setTipOpen}>
      {span}
    </Tooltip>
  );
}

/** Wrap a control in a tooltip that only opens while its FitText label is truncated (the tooltip goes on the control). */
export function FitTooltip({ content, enabled, children }: { content: string | undefined; enabled: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!content) return <>{children}</>;
  return (
    <Tooltip content={content} open={enabled && open} onOpenChange={setOpen}>
      {children}
    </Tooltip>
  );
}
