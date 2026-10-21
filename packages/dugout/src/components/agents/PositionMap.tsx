"use client";
import { cn } from "../../lib/cn";
import { ScaleLabel } from "../guidance/ScaleLabel";
import type { PositionLevel, PositionRole } from "./types";

export const POSITION_LEVELS: readonly PositionLevel[] = ["natural", "accomplished", "competent", "unconvincing"];
/**
 * The four levels read as the product's band words (founder, Oct 20, 2026: the same words a 1–20 skill shows), so a
 * role cell and a skill figure speak one language. The enum keys keep their names.
 */
export const POSITION_LEVEL_LABELS: Record<PositionLevel, string> = { natural: "Excellent", accomplished: "Good", competent: "Average", unconvincing: "Poor" };
/** The panel title the profile gives this map. */
export const POSITION_MAP_TITLE = "Other roles it could take";
/** What the map is based on, for the panel footer. */
export const POSITION_MAP_BASIS = "Based on the skills each role needs. Estimate: worked out, not measured.";

/** Tint per level in the rating ramp (DESIGN §9 Agent profile). */
const LEVEL_CLASS: Record<PositionLevel, string> = {
  natural: "chip-tone tone-rating-4 text-rating-4",
  accomplished: "chip-tone tone-rating-3 text-rating-3",
  competent: "chip-tone tone-rating-2 text-rating-2",
  unconvincing: "chip-tone tone-rating-1 text-rating-1",
};

/** Level from a 1–20 rating when the app has not classified the role (the same cut-offs as the rating ramp's bands). */
export function positionLevelFor(rating: number): PositionLevel {
  if (rating >= 16) return "natural";
  if (rating >= 11) return "accomplished";
  if (rating >= 6) return "competent";
  return "unconvincing";
}

/** The middle of each level's band on the 1–20 scale, for a role classified without a fit figure. */
const LEVEL_MID: Record<PositionLevel, number> = { natural: 18, accomplished: 13, competent: 8, unconvincing: 3 };

/** The 1–20 figure the band word is read from: the role's fit when it agrees with its level, else the level's own band. */
export function positionLevelValue(role: Pick<PositionRole, "level" | "rating">): number {
  return role.rating !== undefined && positionLevelFor(role.rating) === role.level ? role.rating : LEVEL_MID[role.level];
}

export interface PositionMapProps {
  roles: readonly PositionRole[];
  /** Highlight the agent's current role. */
  currentRoleId?: string;
  onSelect?: (role: PositionRole) => void;
  columns?: 2 | 3 | 4;
  className?: string;
}

/** Role cells tinted Excellent / Good / Average / Poor, each with the word (never color alone) and the 1–20 fit. */
export function PositionMap({ roles, currentRoleId, onSelect, columns = 4, className }: PositionMapProps) {
  const ordered = roles.slice().sort((a, b) => POSITION_LEVELS.indexOf(a.level) - POSITION_LEVELS.indexOf(b.level) || (b.rating ?? 0) - (a.rating ?? 0));
  return (
    <div className={cn("flex flex-col gap-2", className)} data-position-map>
      <ul role="list" aria-label={POSITION_MAP_TITLE} className={cn("grid gap-1.5", columns === 2 ? "grid-cols-2" : columns === 3 ? "grid-cols-3" : "grid-cols-4")}>
        {ordered.map((role) => {
          const current = role.id === currentRoleId;
          const content = (
            <>
              {/* Role names wrap to two lines (never cut mid-word); the full name is in the cell's tooltip. */}
              <span className="line-clamp-2 break-words text-body font-medium leading-4 text-primary">{role.label}</span>
              <span className="mt-auto flex items-center justify-between gap-1">
                {/* The band word as the guidance group's ScaleLabel (compact: the word and its dot), in the cell's own tint. */}
                <ScaleLabel value={positionLevelValue(role)} compact className="text-current" aria-hidden />
                {role.rating !== undefined ? <span className="font-display text-display-sm font-semibold tabular-nums">{role.rating}</span> : null}
              </span>
              {current ? <span className="t-data text-secondary">Current role</span> : null}
            </>
          );
          const cls = cn("flex h-full min-h-control-xl w-full flex-col gap-1 rounded-md border p-2.5 text-left", LEVEL_CLASS[role.level], current && "ring-2 ring-kit-lift/70 ring-offset-2 ring-offset-surface-1");
          const label = `${role.label}: ${POSITION_LEVEL_LABELS[role.level]}${role.rating !== undefined ? `, ${role.rating} of 20` : ""}`;
          return (
            <li key={role.id} data-level={role.level} aria-current={current ? "true" : undefined}>
              {onSelect ? (
                <button type="button" onClick={() => onSelect(role)} title={role.label} className={cn(cls, "pressable hover:brightness-125 focus-visible:shadow-ring")} aria-label={label}>
                  {content}
                </button>
              ) : (
                <div className={cls} title={role.label} role="img" aria-label={label}>
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <ol className="flex flex-wrap gap-3 text-small text-secondary" aria-label="Legend">
        {POSITION_LEVELS.map((l) => (
          <li key={l} className="inline-flex items-center gap-1">
            <span aria-hidden className={cn("inline-block size-2.5 rounded-xs border", LEVEL_CLASS[l])} />
            {POSITION_LEVEL_LABELS[l]}
          </li>
        ))}
      </ol>
    </div>
  );
}
