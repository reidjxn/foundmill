"use client";
import type { CSSProperties, HTMLAttributes } from "react";
import type { DeptColourToken } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { Tooltip } from "../foundation/Tooltip";
import { useGuided, useTerm } from "../guidance/GuidanceProvider";
import type { ProcessingSegment } from "./types";

export interface ProcessingStripProps extends HTMLAttributes<HTMLDivElement> {
  segments: ProcessingSegment[];
  /** True while a business cycle runs. When false every segment is at rest. */
  active: boolean;
  /** The running cycle's number, for the sentence ("… are working on cycle 3"). */
  cycleNumber?: number | null;
  /** Accessible wording. Default: `processingStatusText`. */
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

/** "Product", "Product and Finance", "Product, Finance and Legal". Exported for tests. */
export function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * The one sentence the strip says (docs/UX_AUDIT_AND_PLAN.md §7.7, B2), as its tooltip, its accessible name and, in
 * guided mode, a line at the right end of the tab bar: "Product and Finance are working on cycle 3", "The team is
 * working on cycle 3" (a cycle with no department busy yet), "No cycle running". Exported for tests.
 */
export function processingStatusText(segments: readonly ProcessingSegment[], active: boolean, cycleNumber?: number | null): string {
  if (!active) return "No cycle running";
  const working = segments.filter((s) => s.active).map((s) => s.label);
  const who = working.length ? listWords(working) : "The team";
  const verb = working.length > 1 ? "are" : "is";
  const on = typeof cycleNumber === "number" && cycleNumber > 0 ? ` on cycle ${cycleNumber}` : "";
  return `${who} ${verb} working${on}`;
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
 * information is identical. The strip says its sentence as a tooltip and as its accessible name; the AppShell repeats
 * it in words in the tab bar while guidance is on. The motion is CSS.
 */
export function ProcessingStrip({ segments, active, cycleNumber, label, className, ...rest }: ProcessingStripProps) {
  const text = label ?? processingStatusText(segments, active, cycleNumber);
  // The sentence names a cycle, so the tooltip says what one is while guidance is on (UX plan §8.3: define on first use).
  const cycle = useTerm("cycle");
  const guided = useGuided();
  const tip = guided && cycle ? (
    <span className="flex max-w-72 flex-col gap-0.5">
      <span>{text}</span>
      <span className="text-secondary">
        {cycle.word}: {cycle.short}
      </span>
    </span>
  ) : (
    text
  );
  return (
    <Tooltip content={tip} side="bottom">
      {/* The Home tour (Coachmark) rings the strip: "A light here means the team is working". */}
      <div role="status" aria-live="polite" aria-label={text} data-active={active || undefined} data-coachmark="processing-strip" className={cn("processing-strip", className)} {...rest}>
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
    </Tooltip>
  );
}
