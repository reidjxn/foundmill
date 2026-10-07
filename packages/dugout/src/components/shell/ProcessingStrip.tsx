import type { CSSProperties, HTMLAttributes } from "react";
import { cn } from "../../lib/cn";
import { alpha, deptColourVar } from "../../lib/colour";
import type { ProcessingSegment } from "./types";

export interface ProcessingStripProps extends HTMLAttributes<HTMLDivElement> {
  segments: ProcessingSegment[];
  /** True while a business cycle runs. When false every segment is at rest. */
  active: boolean;
  /** Accessible wording. Default: "Cycle running: Product, Finance" / "No cycle running". */
  label?: string;
}

/** Screen-reader text for the strip. Exported for tests. */
export function processingStatusText(segments: ProcessingSegment[], active: boolean): string {
  if (!active) return "No cycle running";
  const working = segments.filter((s) => s.active).map((s) => s.label);
  return working.length ? `Cycle running: ${working.join(", ")}` : "Cycle running";
}

/**
 * The 3 px strip under the top bar (BUILD §5.3): one segment per department in its colour.
 * Active segments shimmer with a 1.6 s sweep (DESIGN §7); at rest they sit at 25 % tint. Reduced motion stops the
 * sweep and leaves the active segments at full colour, so the information is identical.
 */
export function ProcessingStrip({ segments, active, label, className, ...rest }: ProcessingStripProps) {
  const text = label ?? processingStatusText(segments, active);
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={text}
      data-active={active || undefined}
      className={cn("flex w-full overflow-hidden bg-panel", className)}
      style={{ height: "var(--processing-strip-height)" }}
      {...rest}
    >
      <span className="sr-only">{text}</span>
      {segments.map((seg) => {
        const colour = deptColourVar(seg.dept);
        const working = active && seg.active;
        const style: CSSProperties = working
          ? {
              flexGrow: seg.weight ?? 1,
              backgroundColor: colour,
              backgroundImage: `linear-gradient(90deg, ${alpha(colour, 55)} 0%, ${colour} 50%, ${alpha(colour, 55)} 100%)`,
              backgroundSize: "200% 100%",
            }
          : { flexGrow: seg.weight ?? 1, backgroundColor: alpha(colour, active ? 25 : 12) };
        return (
          <span
            key={seg.id}
            aria-hidden
            data-segment={seg.id}
            data-working={working || undefined}
            title={seg.label}
            className={cn("block h-full min-w-2 transition-colors duration-panel ease-dugout", working && "animate-shimmer")}
            style={style}
          />
        );
      })}
    </div>
  );
}
