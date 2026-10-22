import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Round (avatars) or a 3 px-radius bar (text). */
  shape?: "bar" | "circle";
  /**
   * Position in its group: the light band reaches this bar `index × 60 ms` after the first, so a card shimmers top to
   * bottom instead of all at once. Sets the `--i` custom property (`skeleton-bar` reads it).
   */
  index?: number;
  /**
   * Names the queue under the bar, as DESIGN §7 promises ("Queued for Teodor", "Loading cash from Stripe"): a small
   * tertiary line that is announced politely, so the wait is never a bare shimmer.
   */
  label?: ReactNode;
}

function hasLabel(label: ReactNode): boolean {
  return label !== undefined && label !== null && label !== false && label !== "";
}

/** The small tertiary line under a skeleton, announced politely when it appears or changes. */
export function SkeletonLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-small text-tertiary text-pretty", className)} aria-live="polite" data-skeleton-label="">
      {children}
    </p>
  );
}

/**
 * A surface-2 bar with a 100° light band (1.6 s), staggered by `index`. Never a spinner inside a panel (DESIGN §7).
 * Decorative: aria-hidden, unless it carries a `label`, which is read. Reduced motion: a flat bar. Server-safe (pure
 * CSS).
 */
export function Skeleton({ className, shape = "bar", index, style, label, ...props }: SkeletonProps) {
  const vars = index === undefined ? style : ({ "--i": index, ...style } as CSSProperties);
  const bar = (
    <div
      aria-hidden
      data-skeleton={shape}
      className={cn("skeleton-bar", shape === "circle" ? "rounded-pill" : "rounded-xs", shape === "bar" && "h-3", className)}
      style={vars}
      {...props}
    />
  );
  if (!hasLabel(label)) return bar;
  return (
    <div className="flex flex-col gap-1.5" data-skeleton-labeled="">
      {bar}
      <SkeletonLabel>{label}</SkeletonLabel>
    </div>
  );
}

export interface SkeletonTextProps {
  lines?: number;
  className?: string;
  /** Last line shorter, as real paragraphs end. */
  ragged?: boolean;
  /** Index of the first line in a larger group, so a block of text continues the stagger above it. */
  start?: number;
  /** Names the queue under the lines ("Queued for Teodor"). */
  label?: ReactNode;
}

export function SkeletonText({ lines = 3, className, ragged = true, start = 0, label }: SkeletonTextProps) {
  const labeled = hasLabel(label);
  return (
    <div className={cn("flex flex-col gap-2", className)} aria-hidden={labeled ? undefined : true} data-skeleton-labeled={labeled ? "" : undefined}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} index={start + i} className={cn("h-3", ragged && i === lines - 1 && lines > 1 ? "w-2/3" : "w-full")} />
      ))}
      {labeled ? <SkeletonLabel className="mt-0.5">{label}</SkeletonLabel> : null}
    </div>
  );
}

/** Loading placeholder for a 28 px table: a few rows of cells; the band runs down the rows. */
export function SkeletonRows({ rows = 5, cols = 4, className }: { rows?: number; cols?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col", className)} aria-hidden role="presentation">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-row-compact items-center gap-3 border-b hairline-50 px-2 last:border-b-0">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} index={r} className={cn("h-2.5", c === 0 ? "w-1/3" : "flex-1")} />
          ))}
        </div>
      ))}
    </div>
  );
}
