import { Sparkle, TriangleAlert } from "lucide-react";
import { cn } from "../../lib/cn";
import { Chip, type ChipTone } from "../foundation/Chip";
import { Tooltip } from "../foundation/Tooltip";
import type { Trait } from "./types";

export interface TraitChipsProps {
  traits: readonly Trait[];
  max?: number;
  className?: string;
}

const TONE: Record<NonNullable<Trait["tone"]>, ChipTone> = { neutral: "neutral", good: "good", warn: "warn" };

/** Traits derived from instructions ("Writes tests first"); hover shows the instruction line each one came from. */
export function TraitChips({ traits, max, className }: TraitChipsProps) {
  const shown = max ? traits.slice(0, max) : traits;
  const extra = traits.length - shown.length;
  return (
    <ul aria-label="Traits" className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {shown.map((t) => (
        <li key={t.id}>
          <Tooltip content={t.derivedFrom ? `Derived from: "${t.derivedFrom}"` : undefined}>
            <span className="inline-flex" tabIndex={t.derivedFrom ? 0 : -1}>
              <Chip tone={TONE[t.tone ?? "neutral"]} icon={t.tone === "warn" ? TriangleAlert : t.tone === "good" ? Sparkle : undefined}>
                {t.label}
              </Chip>
            </span>
          </Tooltip>
        </li>
      ))}
      {extra > 0 ? (
        <li>
          <Chip tone="neutral">+{extra} more</Chip>
        </li>
      ) : null}
    </ul>
  );
}
