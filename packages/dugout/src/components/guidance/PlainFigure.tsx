"use client";
/**
 * A figure with its plain-words line (docs/UX_AUDIT_AND_PLAN.md §6.2 `PlainFigure`, principle 4): "Runway 7 mo" and
 * under it, small and secondary, "How many months your cash lasts at today's spending." The line comes from the
 * definitions map (`metricId`, through `useTerm`) or an explicit `plain`. Guidance off, or nothing to say: the figure
 * alone, unwrapped, so the tile's structure is the same either way.
 */
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";
import { useGuided, useTerm } from "./GuidanceProvider";

export interface PlainFigureProps extends HTMLAttributes<HTMLDivElement> {
  /** The definition whose `short` is the line ("runway", "mrr"). */
  metricId?: string;
  /** An explicit line; wins over `metricId`. */
  plain?: ReactNode;
  /** The figure. */
  children: ReactNode;
}

export function PlainFigure({ metricId, plain, children, className, ...rest }: PlainFigureProps) {
  const guided = useGuided();
  const term = useTerm(metricId ?? "");
  const line = plain ?? term?.short;
  if (!guided || line === undefined || line === null || line === false || line === "") return <>{children}</>;
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)} data-plain-figure={metricId ?? ""} {...rest}>
      {children}
      <p className="min-w-0 text-small text-secondary text-pretty" data-plain-line="">
        {line}
      </p>
    </div>
  );
}
