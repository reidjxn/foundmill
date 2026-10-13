import type { HTMLAttributes } from "react";
import { FitText } from "../../foundation/FitText";
import { cn } from "../../../lib/cn";
import { clampRating, ratingBandLabel, ratingCells, ratingClass, ratingTone } from "../../../lib/rating";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../../foundation/HoverCard";
import type { ConceptEvidence } from "../types";

export interface AttributeBarProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  label: string;
  /** 1–20. */
  value: number;
  /** Evidence lines shown in a hover card (BUILD §11.1 "evidence hover"). */
  evidence?: ConceptEvidence[];
  /** Hide the label column (Compare prints labels once per row). */
  hideLabel?: boolean;
  /** Second value drawn as outlined cells (a comparison target or potential). */
  ghost?: number;
}

/** Static cell classes so Tailwind emits them. */
const CELL_FILL = { "rating-1": "cell-lit bg-rating-1 tone-rating-1", "rating-2": "cell-lit bg-rating-2 tone-rating-2", "rating-3": "cell-lit bg-rating-3 tone-rating-3", "rating-4": "cell-lit bg-rating-4 tone-rating-4" } as const;
const CELL_GHOST = { "rating-1": "border-rating-1", "rating-2": "border-rating-2", "rating-3": "border-rating-3", "rating-4": "border-rating-4" } as const;

/**
 * DESIGN §5 / §8: a 20-cell skill bar, filled cells in the ramp colour, empties bg-panel-alt, the value in display-sm
 * next to it. The number and the band word carry the meaning; colour is reinforcement.
 */
export function AttributeBar({ label, value, evidence, hideLabel, ghost, className, ...rest }: AttributeBarProps) {
  const v = clampRating(value);
  const tone = ratingTone(v);
  const cells = ratingCells(v);
  const ghostCells = ghost === undefined ? null : ratingCells(ghost);
  const ghostTone = ghost === undefined ? tone : ratingTone(ghost);
  const text = `${label}: ${v} of 20, ${ratingBandLabel(v)}${ghost !== undefined ? `, compared with ${clampRating(ghost)}` : ""}`;
  const bar = (
    <div role="meter" aria-valuemin={1} aria-valuemax={20} aria-valuenow={v} aria-valuetext={text} aria-label={label} className={cn("flex items-center gap-2", className)} data-attribute={label} {...rest}>
      {hideLabel ? null : (
        <span className="w-40 shrink-0 text-small text-secondary" title={label}>
          <FitText minPx={11}>{label}</FitText>
        </span>
      )}
      <span className="flex min-w-0 flex-1 items-center gap-0.5" aria-hidden>
        {cells.map((filled, i) => {
          const ghostOnly = !filled && ghostCells?.[i];
          return <span key={i} className={cn("h-2 min-w-0 flex-1 rounded-xs", filled ? CELL_FILL[tone] : ghostOnly ? cn("border bg-transparent", CELL_GHOST[ghostTone]) : "cell-empty")} />;
        })}
      </span>
      <span className={cn("w-6 shrink-0 text-right font-display text-display-sm font-semibold tabular-nums", ratingClass(v))}>{v}</span>
    </div>
  );
  if (!evidence || evidence.length === 0) return bar;
  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <div tabIndex={0} className="rounded-chip focus-visible:outline-2 focus-visible:outline-link" data-evidence-trigger>
          {bar}
        </div>
      </HoverCardTrigger>
      <HoverCardContent side="right" className="w-80">
        <p className="t-label mb-1">
          {label} · {v}/20 · {ratingBandLabel(v)}
        </p>
        <ul className="flex flex-col gap-1.5">
          {evidence.map((e, i) => (
            <li key={i} className="text-small">
              <span className="text-primary">{e.text}</span>
              {e.source ? (
                <span className="ml-1 text-secondary">
                  —{" "}
                  {e.url ? (
                    <a href={e.url} target="_blank" rel="noreferrer">
                      {e.source}
                    </a>
                  ) : (
                    e.source
                  )}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </HoverCardContent>
    </HoverCard>
  );
}
