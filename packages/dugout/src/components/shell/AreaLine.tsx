/**
 * The opening line of a founder area (docs/DESIGN.md §9 "Opening line"): one plain sentence first on every tab of Plan,
 * Customers, Money, Product and Team, built from the figures the tab's tiles show. After the sentence, the Estimate or
 * Forecast chip of its closing figure; under it, optional section lines (Money's Company line) and the kind line, which
 * says what kind of area a department with a name of its own sits in ("Formulation Lab is part of Product.").
 *
 * A string sentence may carry `[[ent:<id>|Name]]` mentions; they render through EntityText, so every entity is an
 * EntityLink. A caller that needs its own rendering (an agent named by the reader's preference) passes a node. While
 * the figures load, a one-line skeleton holds the place, so the tab does not jump when the sentence arrives. Information,
 * not tutoring: shown with guidance off too. Server-safe (EntityText and the chip are their own client boundaries).
 */
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";
import { ProvenanceChip } from "../foundation/Chip";
import { Skeleton } from "../foundation/Skeleton";
import { EntityText } from "../data/EntityText";

export type AreaLineProvenance = "estimate" | "forecast";

export interface AreaLineSection {
  id: string;
  /** The section's name, read before its sentence ("Company"). */
  label: string;
  sentence: ReactNode;
  provenance?: AreaLineProvenance | null;
}

export interface AreaLineProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /** The area's name, for the landmark ("Money"). */
  area: string;
  /** The sentence; a string may carry entity markup. Null or undefined while loading (with `loading`) or hides the line. */
  sentence?: ReactNode;
  /** The chip after the sentence: its closing figure is worked out (Estimate) or projected (Forecast). */
  provenance?: AreaLineProvenance | null;
  /** Lines under the sentence for a section of the area (Money's Company). */
  sections?: readonly AreaLineSection[];
  /** "Formulation Lab is part of Product.": the kind of area this tab's department is part of. */
  kind?: ReactNode;
  /** The figures are still loading: a one-line skeleton in the sentence's place. */
  loading?: boolean;
}

function Words({ sentence }: { sentence: ReactNode }) {
  return typeof sentence === "string" ? <EntityText>{sentence}</EntityText> : <>{sentence}</>;
}

function AreaChip({ kind }: { kind: AreaLineProvenance | null | undefined }) {
  return kind ? <ProvenanceChip kind={kind} className="ml-1.5 align-[0.1em]" /> : null;
}

export function AreaLine({ area, sentence, provenance, sections, kind, loading, className, ...rest }: AreaLineProps) {
  const hasSentence = sentence !== null && sentence !== undefined && sentence !== "";
  const shownSections = (sections ?? []).filter((s) => s.sentence !== null && s.sentence !== undefined && s.sentence !== "");
  if (!hasSentence && !loading && !shownSections.length && !kind) return null;
  return (
    <section aria-label={`${area} at a glance`} data-area-line="" data-testid="area-line" aria-busy={loading && !hasSentence ? true : undefined} className={cn("flex max-w-reading flex-col gap-1", className)} {...rest}>
      {hasSentence ? (
        <p className="text-reading text-primary text-pretty" data-area-sentence="">
          <Words sentence={sentence} />
          <AreaChip kind={provenance} />
        </p>
      ) : loading ? (
        <Skeleton className="h-4 w-2/3" />
      ) : null}
      {shownSections.map((s) => (
        <p key={s.id} className="text-body text-secondary text-pretty" data-area-section={s.id}>
          <span className="text-body-strong text-primary">{s.label}:</span> <Words sentence={s.sentence} />
          <AreaChip kind={s.provenance} />
        </p>
      ))}
      {kind ? (
        <p className="text-small text-tertiary" data-area-kind="">
          {kind}
        </p>
      ) : null}
    </section>
  );
}
