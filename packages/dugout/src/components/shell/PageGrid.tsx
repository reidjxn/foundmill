import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../../lib/cn";
import { GRID_SPANS, type GridSpan } from "./types";

/** Static map so Tailwind emits every span class. */
const SPAN_CLASS: Record<GridSpan, string> = {
  3: "col-span-3",
  4: "col-span-4",
  6: "col-span-6",
  8: "col-span-8",
  12: "col-span-12",
};

/** Tailwind class for a 12-column span; snaps unknown values to the nearest allowed span. */
export function spanClass(span: number): string {
  return SPAN_CLASS[snapSpan(span)];
}

/** Snap any number to one of 3, 4, 6, 8, 12 (BUILD §5.3). */
export function snapSpan(span: number): GridSpan {
  if (!Number.isFinite(span)) return 12;
  let best: GridSpan = 12;
  let dist = Infinity;
  for (const s of GRID_SPANS) {
    const d = Math.abs(s - span);
    if (d < dist) {
      dist = d;
      best = s;
    }
  }
  return best;
}

export interface PageGridProps extends HTMLAttributes<HTMLDivElement> {
  /** Remove the outer gutter padding (when the parent already pads). */
  flush?: boolean;
  /**
   * One column while the grid's container (the shell) is narrower than `page-wide`: every cell takes the full row, in
   * order. Opt in; the 12 columns return at `page-wide` and wider, so a desktop page is unchanged (package 2.1).
   */
  stack?: boolean;
}

/** The content grid: 12 columns, 16 px gutters, 16 px outer padding (BUILD §5.3, DESIGN §6). */
export const PageGrid = forwardRef<HTMLDivElement, PageGridProps>(function PageGrid({ className, flush, stack, ...rest }, ref) {
  return <div ref={ref} className={cn("grid w-full grid-cols-12 gap-gutter", !flush && "p-gutter", stack && "page-grid-stack", className)} data-stack={stack || undefined} {...rest} />;
});

export interface GridSpanProps extends HTMLAttributes<HTMLDivElement> {
  span?: GridSpan;
  /** Row span for taller tiles (1–4). */
  rows?: 1 | 2 | 3 | 4;
}

const ROW_CLASS = { 1: "", 2: "row-span-2", 3: "row-span-3", 4: "row-span-4" } as const;

/** A cell on the PageGrid. Panels take `span` directly; use this for anything else. */
export const GridCell = forwardRef<HTMLDivElement, GridSpanProps>(function GridCell({ span = 12, rows = 1, className, ...rest }, ref) {
  return <div ref={ref} className={cn("min-w-0", SPAN_CLASS[span], ROW_CLASS[rows], className)} data-span={span} {...rest} />;
});
