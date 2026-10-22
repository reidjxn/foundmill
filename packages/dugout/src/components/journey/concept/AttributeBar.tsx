import type { HTMLAttributes } from "react";
import { FitText } from "../../foundation/FitText";
import { cn } from "../../../lib/cn";
import { clampRating, ratingBandLabel, ratingCells, ratingClass, ratingTone } from "../../../lib/rating";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../../foundation/HoverCard";
import { Term } from "../../guidance/Term";
import { CONCEPT_ATTRIBUTE_KEYS, CONCEPT_ATTRIBUTE_LABELS, type ConceptAttributeKey, type ConceptEvidence } from "../types";

export interface AttributeBarProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  label: string;
  /** 1–20. */
  value: number;
  /** Evidence lines shown in a hover card (BUILD §11.1 "evidence hover"). */
  evidence?: ConceptEvidence[];
  /**
   * What the attribute measures and which way it reads ("How crowded the market is. Higher means less crowded."),
   * shown as a tooltip on the label, which becomes focusable; shown whether or not evidence is attached (A6).
   */
  hint?: string;
  /**
   * Which concept attribute this is, for its definitions id (`attr_<key>` in TERMS). Defaults to the attribute whose
   * display label equals `label`.
   */
  attributeKey?: ConceptAttributeKey;
  /** Hide the label column (Compare prints labels once per row). */
  hideLabel?: boolean;
  /** Second value drawn as outlined cells (a comparison target or potential). */
  ghost?: number;
}

/** Static cell classes so Tailwind emits them. */
const CELL_FILL = { "rating-1": "cell-lit bg-rating-1 tone-rating-1", "rating-2": "cell-lit bg-rating-2 tone-rating-2", "rating-3": "cell-lit bg-rating-3 tone-rating-3", "rating-4": "cell-lit bg-rating-4 tone-rating-4" } as const;
const CELL_GHOST = { "rating-1": "border-rating-1", "rating-2": "border-rating-2", "rating-3": "border-rating-3", "rating-4": "border-rating-4" } as const;

/** The definitions id of a concept attribute (TERMS `attr_<key>`), the same ids the Ideation Studio's Ask sheet uses. */
export function attributeTermId(key: ConceptAttributeKey): string {
  return `attr_${key}`;
}

/** The attribute whose display label is `label`, if any ("Competition" → "competition"). */
export function attributeKeyForLabel(label: string): ConceptAttributeKey | undefined {
  return CONCEPT_ATTRIBUTE_KEYS.find((k) => CONCEPT_ATTRIBUTE_LABELS[k] === label);
}

/**
 * The label of an attribute: plain when nothing defines it; with a `hint`, a dotted Term (UX plan §7.5, A6) whose
 * definition card says what the attribute measures and which way it reads. The direction is information, not tutoring,
 * so the card stays with guidance off (`always`). `hint` is the definition; the map's `attr_<key>` entry has the same
 * sentence.
 */
export function AttributeLabel({ label, hint, attributeKey, className, textClassName = "text-small text-secondary" }: { label: string; hint?: string; attributeKey?: ConceptAttributeKey; className?: string; textClassName?: string }) {
  if (!hint) {
    return (
      <span className={cn("shrink-0 text-small text-secondary", className)} title={label}>
        <FitText minPx={11}>{label}</FitText>
      </span>
    );
  }
  const key = attributeKey ?? attributeKeyForLabel(label);
  const id = key ? attributeTermId(key) : `attr_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
  return (
    <span className={cn("min-w-0 shrink-0 text-left", textClassName, className)} data-attribute-hint="">
      <Term id={id} always definition={{ id, word: label, short: hint }} side="top" align="start" className="max-w-full text-left">
        <FitText minPx={11}>{label}</FitText>
      </Term>
    </span>
  );
}

/**
 * DESIGN §5 / §8: a 20-cell skill bar, filled cells in the ramp colour, empties bg-panel-alt, the value in display-sm
 * next to it. The number and the band word carry the meaning; colour is reinforcement.
 */
export function AttributeBar({ label, value, evidence, hint, attributeKey, hideLabel, ghost, className, ...rest }: AttributeBarProps) {
  const v = clampRating(value);
  const tone = ratingTone(v);
  const cells = ratingCells(v);
  const ghostCells = ghost === undefined ? null : ratingCells(ghost);
  const ghostTone = ghost === undefined ? tone : ratingTone(ghost);
  const text = `${label}: ${v} of 20, ${ratingBandLabel(v)}${ghost !== undefined ? `, compared with ${clampRating(ghost)}` : ""}`;
  const hasEvidence = !!evidence && evidence.length > 0;
  // The meter holds only the cells and the figure: its children are presentational, so the label's Term button sits
  // beside it (not inside it) where assistive tech can reach it. With evidence, the meter itself is the hover-card
  // trigger, so the Term and the evidence card never nest or open from the same pointer.
  const meter = (
    <div
      role="meter"
      aria-valuemin={1}
      aria-valuemax={20}
      aria-valuenow={v}
      aria-valuetext={text}
      aria-label={label}
      className={cn("flex min-w-0 flex-1 items-center gap-2", hasEvidence && "rounded-chip focus-visible:outline-2 focus-visible:outline-link")}
      tabIndex={hasEvidence ? 0 : undefined}
      data-evidence-trigger={hasEvidence ? "" : undefined}
    >
      <span className="flex min-w-0 flex-1 items-center gap-0.5" aria-hidden>
        {cells.map((filled, i) => {
          const ghostOnly = !filled && ghostCells?.[i];
          return <span key={i} className={cn("h-2 min-w-0 flex-1 rounded-xs", filled ? CELL_FILL[tone] : ghostOnly ? cn("border bg-transparent", CELL_GHOST[ghostTone]) : "cell-empty")} />;
        })}
      </span>
      <span className={cn("w-6 shrink-0 text-right font-display text-display-sm font-semibold tabular-nums", ratingClass(v))}>{v}</span>
    </div>
  );
  return (
    <div className={cn("flex items-center gap-2", className)} data-attribute={label} {...rest}>
      {hideLabel ? null : <AttributeLabel label={label} hint={hint} attributeKey={attributeKey} className="w-40" />}
      {hasEvidence && evidence ? (
        <HoverCard>
          <HoverCardTrigger asChild>{meter}</HoverCardTrigger>
          <HoverCardContent side="right" className="w-80">
            <p className="t-label mb-1">
              {label} · {v}/20 · {ratingBandLabel(v)}
            </p>
            {hint ? <p className="mb-1.5 text-small text-secondary">{hint}</p> : null}
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
      ) : (
        meter
      )}
    </div>
  );
}
