import type { CSSProperties, HTMLAttributes } from "react";
import type { DeptColourToken } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import type { ProcessingSegment } from "./types";

export interface ProcessingStripProps extends HTMLAttributes<HTMLDivElement> {
  segments: ProcessingSegment[];
  /** True while a business cycle runs. When false every segment is at rest. */
  active: boolean;
  /** Accessible wording. Default: "Cycle running: Product, Finance" / "No cycle running". */
  label?: string;
}

/** Static class map so Tailwind emits every tone. */
const TONE: Record<DeptColourToken, string> = {
  "dept-1": "tone-dept-1",
  "dept-2": "tone-dept-2",
  "dept-3": "tone-dept-3",
  "dept-4": "tone-dept-4",
  "dept-5": "tone-dept-5",
  "dept-6": "tone-dept-6",
  "dept-7": "tone-dept-7",
  "dept-8": "tone-dept-8",
};

/** Screen-reader text for the strip. Exported for tests. */
export function processingStatusText(segments: ProcessingSegment[], active: boolean): string {
  if (!active) return "No cycle running";
  const working = segments.filter((s) => s.active).map((s) => s.label);
  return working.length ? `Cycle running: ${working.join(", ")}` : "Cycle running";
}

/** A segment's state: working (a bright head travels it), waiting (dim: the cycle runs, this department is idle) or rest. */
export function segmentState(segment: ProcessingSegment, active: boolean): "working" | "waiting" | "rest" {
  if (!active) return "rest";
  return segment.active ? "working" : "waiting";
}

/**
 * The 3 px strip under the top bar (BUILD §5.3, DESIGN §7): one segment per department on ink with 2 px gaps, its width
 * its share of agent-minutes. A working department carries a bright head that travels its segment every 1600 ms with an
 * 8 px glow in its colour (heads are staggered so they never march in step); a department idle during a running cycle
 * is dim; at rest every segment holds its colour quietly. Reduced motion: the head rests mid-segment, so the
 * information is identical. Server-safe: the motion is CSS.
 */
export function ProcessingStrip({ segments, active, label, className, ...rest }: ProcessingStripProps) {
  const text = label ?? processingStatusText(segments, active);
  return (
    <div role="status" aria-live="polite" aria-label={text} data-active={active || undefined} className={cn("processing-strip", className)} {...rest}>
      <span className="sr-only">{text}</span>
      {segments.map((seg, i) => {
        const state = segmentState(seg, active);
        const style = { flexGrow: seg.weight ?? 1, "--i": i } as CSSProperties;
        return (
          <span
            key={seg.id}
            aria-hidden
            data-segment={seg.id}
            data-state={state}
            data-working={state === "working" || undefined}
            title={seg.label}
            className={cn("strip-segment", TONE[seg.dept])}
            style={style}
          />
        );
      })}
    </div>
  );
}
