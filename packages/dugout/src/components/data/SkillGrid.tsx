"use client";
import { useMemo } from "react";
import { Crosshair, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { SKILL_GROUPS, type SkillGroup } from "@foundmill/shared/constants";
import { cn } from "../../lib/cn";
import { formatNumber } from "../../lib/format";
import { RATING_MAX, ratingBandLabel } from "../../lib/rating";
import { Chip } from "../foundation/Chip";
import { Icon } from "../foundation/Icon";
import { Tooltip } from "../foundation/Tooltip";
import { useBuilderView } from "../guidance/BuilderView";
import { ScaleLabel } from "../guidance/ScaleLabel";
import { RatingBar, RatingFigure } from "./RatingBar";
import type { SkillRow } from "./types";

export const SKILL_GROUP_LABELS: Record<SkillGroup, string> = {
  craft: "Craft",
  judgement: "Judgment",
  execution: "Execution",
};
export const MAX_FOCUS_SKILLS = 3;

/** What the grid's figures mean, in one line for a panel footer (UX plan §7.15). */
export const SKILL_GRID_FOOTER = `Scores 1–${RATING_MAX}. 'Tested' is the result on practice tests, 'Proven' the result on real work; more real work makes Proven count for more. Potential is how good the agent could become with training.`;
/** Why the scores matter, for guided mode. */
export const SKILL_GRID_WHY = "Higher skills mean fewer failed tasks and fewer questions to you.";

export type SkillGridDensity = "comfortable" | "compact";

export interface SkillGridProps {
  skills: readonly SkillRow[];
  /** Focus mode (BUILD §11.10 Training "Focus: up to 3 skills"). */
  focus?: {
    selected: readonly string[];
    onChange: (ids: string[]) => void;
    max?: number;
  };
  /** Show potential as outlined cells beyond the value. */
  showPotential?: boolean;
  /** Dim rows outside the selection in focus mode. */
  dimUnselected?: boolean;
  /**
   * Comfortable (default) shows the band word as a ScaleLabel pill beside each figure; compact, for a narrow column,
   * keeps the word in the figure's tooltip and accessible name instead (UX plan §6.2: density folds the pill into the
   * tooltip).
   */
  density?: SkillGridDensity;
  className?: string;
}

/** "Tested 15 · Proven 13 · 42 tasks" (BUILD §11.10). */
export function skillHoverText(s: SkillRow): string {
  const parts: string[] = [];
  if (s.tested !== undefined) parts.push(`Tested ${s.tested}`);
  if (s.proven !== undefined) parts.push(`Proven ${s.proven}`);
  if (s.tasks !== undefined)
    parts.push(`${formatNumber(s.tasks, { maxDigits: 0 })} ${s.tasks === 1 ? "task" : "tasks"}`);
  if (s.potential !== undefined) parts.push(`Potential ${s.potential}`);
  return parts.join(" · ");
}

/** Toggle an id in the focus set, respecting the max. Returns the same array when the change is not allowed. */
export function toggleFocus(
  selected: readonly string[],
  id: string,
  max = MAX_FOCUS_SKILLS,
): string[] {
  if (selected.includes(id)) return selected.filter((x) => x !== id);
  if (selected.length >= max) return [...selected];
  return [...selected, id];
}

/**
 * The change in a skill since the last test. The words are screen-reader text beside the glyphs (an aria-label on a
 * role-less span is ignored by assistive tech), so the no-value state is announced too.
 */
function DeltaArrow({ delta }: { delta: number | undefined }) {
  if (delta === undefined || delta === 0 || !Number.isFinite(delta)) {
    return (
      <span className="inline-flex w-10 items-center justify-end gap-0.5 text-small text-secondary tabular-nums" data-skill-delta>
        <Icon icon={Minus} size={12} />
        <span className="sr-only">{delta === 0 ? "No change" : "No previous value"}</span>
        {delta === 0 ? <span aria-hidden>0</span> : null}
      </span>
    );
  }
  const up = delta > 0;
  return (
    <span
      className={cn(
        "inline-flex w-10 items-center justify-end gap-0.5 text-small tabular-nums",
        up ? "text-status-good" : "text-status-bad",
      )}
      data-skill-delta
    >
      <Icon icon={up ? TrendingUp : TrendingDown} size={12} />
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      <span className="sr-only">{up ? "Up" : "Down"} </span>
      {Math.abs(delta)}
    </span>
  );
}

/**
 * Three columns (Craft, Judgment, Execution); each row: skill name, value in the ramp color with its band word, 20-cell
 * bar, delta arrow. Hover reveals "Tested X · Proven Y · N tasks". Focus mode lets the founder pick up to three skills
 * (DESIGN §8, BUILD §5.4/§11.10). Drops larger than one point are flagged.
 */
export function SkillGrid({
  skills,
  focus,
  showPotential,
  dimUnselected = true,
  density = "comfortable",
  className,
}: SkillGridProps) {
  const builder = useBuilderView();
  const groups = useMemo(
    () => SKILL_GROUPS.map((g) => ({ group: g, rows: skills.filter((s) => s.group === g) })),
    [skills],
  );
  const max = focus?.max ?? MAX_FOCUS_SKILLS;
  const selected = focus?.selected ?? [];
  const full = selected.length >= max;
  const compact = density === "compact";
  return (
    <div
      className={cn("grid grid-cols-3 gap-gutter", className)}
      data-skill-grid
      data-density={density}
      data-focus-mode={focus ? "on" : undefined}
    >
      {groups.map(({ group, rows }) => (
        <section key={group} aria-labelledby={`skills-${group}`} className="min-w-0">
          <header className="mb-2 flex h-control-sm items-center justify-between rule-fade">
            <h3 id={`skills-${group}`} className="t-data">
              {SKILL_GROUP_LABELS[group]}
            </h3>
            {rows.length > 0 ? (
              <span className="font-mono text-micro text-tertiary tabular-nums">
                avg{" "}
                {formatNumber(rows.reduce((a, r) => a + r.value, 0) / rows.length, {
                  maxDigits: 1,
                })}
              </span>
            ) : null}
          </header>
          {rows.length === 0 ? (
            <p className="text-small text-secondary">
              No {SKILL_GROUP_LABELS[group].toLowerCase()} skills yet.
            </p>
          ) : null}
          <ul className="flex flex-col gap-1">
            {rows.map((s) => {
              const isSelected = selected.includes(s.id);
              const disabled = !!focus && !isSelected && full;
              const band = ratingBandLabel(s.value);
              // Compact rows keep the band word in the hover text, so it is never lost, only folded.
              // Builder view off: the figures (tested, proven, potential) stay out of the hover too.
              const hover = [compact ? `${band}` : "", builder ? skillHoverText(s) : ""].filter(Boolean).join(" · ");
              const drop = s.delta !== undefined && s.delta < -1;
              const row = (
                <li
                  key={s.id}
                  data-skill={s.id}
                  data-selected={isSelected || undefined}
                  className={cn(
                    "flex min-h-row-comfortable items-center gap-2 rounded-sm px-1.5 transition-colors duration-hover ease-out hover:bg-white/4",
                    focus && dimUnselected && selected.length > 0 && !isSelected && "opacity-60",
                    isSelected && "row-selected",
                  )}
                >
                  {focus ? (
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={isSelected}
                      aria-label={`Focus on ${s.name}`}
                      disabled={disabled}
                      onClick={() => focus.onChange(toggleFocus(selected, s.id, max))}
                      className={cn(
                        "inline-flex size-4 shrink-0 items-center justify-center rounded-xs border border-line-strong bg-black/30 text-kit-on-primary transition-colors focus-visible:shadow-ring",
                        isSelected && "border-transparent bg-kit-primary",
                        disabled && "cursor-not-allowed opacity-40",
                      )}
                    >
                      {isSelected ? <Icon icon={Crosshair} size={12} strokeWidth={2.25} /> : null}
                    </button>
                  ) : null}
                  <span className="min-w-0 flex-1 break-words text-body text-primary">
                    {s.name}
                    {s.note ? (
                      <Chip tone="neutral" className="ml-1.5">
                        {s.note}
                      </Chip>
                    ) : null}
                    {drop ? (
                      <Chip tone="bad" className="ml-1.5" title="Dropped more than one point">
                        Drop
                      </Chip>
                    ) : null}
                  </span>
                  {builder ? (
                    <>
                      <RatingFigure value={s.value} className="w-6 text-right" title={compact ? `${s.value} of ${RATING_MAX} · ${band}` : undefined} aria-label={`${s.value} of ${RATING_MAX}, ${band}`} />
                      {compact ? null : <ScaleLabel value={s.value} scale={RATING_MAX} className="shrink-0" data-skill-band={band} />}
                      <span className="w-28 shrink-0">
                        <RatingBar
                          value={s.value}
                          compare={showPotential ? s.potential : undefined}
                          name={s.name}
                        />
                      </span>
                    </>
                  ) : (
                    // Builder view off: the band word alone, no figure out of 20 and no cells.
                    <ScaleLabel value={s.value} scale={RATING_MAX} compact={compact} className="shrink-0" data-skill-band={band} aria-label={`${s.name}: ${band}`} />
                  )}
                  <DeltaArrow delta={s.delta} />
                </li>
              );
              return hover ? (
                <Tooltip key={s.id} content={hover} side="top" align="end">
                  {row}
                </Tooltip>
              ) : (
                row
              );
            })}
          </ul>
        </section>
      ))}
      {focus ? (
        <p className="col-span-3 text-small text-secondary" aria-live="polite">
          Focus: {selected.length} of {max} skills{full ? " (deselect one to choose another)" : ""}
        </p>
      ) : null}
    </div>
  );
}
