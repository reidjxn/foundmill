import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Round (avatars) or chip-radius (text bars). */
  shape?: "bar" | "circle";
}

/** A shimmering bg-panel-alt bar (1.6 s). Never a spinner inside a panel (DESIGN §7). Decorative: aria-hidden. */
export function Skeleton({ className, shape = "bar", ...props }: SkeletonProps) {
  return <div aria-hidden className={cn("shimmer", shape === "circle" ? "rounded-full" : "rounded-chip", shape === "bar" && "h-3", className)} {...props} />;
}

export interface SkeletonTextProps {
  lines?: number;
  className?: string;
  /** Last line shorter, as real paragraphs end. */
  ragged?: boolean;
}

export function SkeletonText({ lines = 3, className, ragged = true }: SkeletonTextProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3", ragged && i === lines - 1 && lines > 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

/** Loading placeholder for a 28 px table: a few rows of cells. */
export function SkeletonRows({ rows = 5, cols = 4, className }: { rows?: number; cols?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col", className)} aria-hidden role="presentation">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-row-compact items-center gap-3 border-b hairline-50 px-2 last:border-b-0">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className={cn("h-2.5", c === 0 ? "w-1/3" : "flex-1")} />
          ))}
        </div>
      ))}
    </div>
  );
}
