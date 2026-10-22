import { cn } from "../../lib/cn";
import { FitText } from "../foundation/FitText";
import { ProvenanceChip } from "../foundation/Chip";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../foundation/HoverCard";
import { ScaleLabel } from "../guidance/ScaleLabel";
import { Term } from "../guidance/Term";
import { RatingBar, RatingFigure } from "./RatingBar";
import type { AttributeRow } from "./types";

export interface AttributeBarsProps {
  attributes: readonly AttributeRow[];
  /** Label column width class. Default w-28. */
  labelClassName?: string;
  /** Two columns of attributes (concept cards show ten as 2 × 5). */
  columns?: 1 | 2;
  /** Figure next to each bar (default true). */
  showValue?: boolean;
  /** The band word (ScaleLabel, compact) beside the figure (default: with the figure), so a number never stands alone. */
  showBand?: boolean;
  className?: string;
}

function evidenceOf(
  a: AttributeRow,
): { summary: string; sources: string[]; provenance?: "forecast" | "estimate" } | null {
  if (!a.evidence) return null;
  if (typeof a.evidence === "string") return { summary: a.evidence, sources: [] };
  return {
    summary: a.evidence.summary,
    sources: a.evidence.sources ?? [],
    provenance: a.evidence.provenance,
  };
}

/**
 * 1–20 attributes as label + 20-cell bars (DESIGN §9 Ideation Studio: "ten attributes as label + 20-cell bars,
 * evidence on hover"). `compare` draws a second value as outlined cells. A row with a `hint` gets its label as a
 * `Term` with an inline definition (the dotted learn underline and the definition card on hover or focus, Enter to
 * pin it), saying what the attribute measures and which way it reads; the keyboard reaches it too, with or without
 * evidence. The definition stays when guidance is off (`always`): an attribute's meaning is information, and the
 * card is the only place that gives it. Each figure carries its band word (ScaleLabel, UX plan §5 principle 4).
 * Server-safe itself: Term and HoverCard are the client boundaries.
 */
export function AttributeBars({
  attributes,
  labelClassName = "w-28",
  columns = 1,
  showValue = true,
  showBand = showValue,
  className,
}: AttributeBarsProps) {
  return (
    <dl
      className={cn(
        "grid gap-x-gutter gap-y-1",
        columns === 2 ? "grid-cols-2" : "grid-cols-1",
        className,
      )}
      data-attribute-bars
    >
      {attributes.map((a) => {
        const ev = evidenceOf(a);
        const row = (
          <div
            key={a.id}
            data-attribute={a.id}
            className="flex min-h-control-xs min-w-0 items-center gap-2 rounded-sm px-1.5 transition-colors duration-hover hover:bg-white/4"
          >
            <dt className={cn("shrink-0 text-small text-secondary", labelClassName)} title={a.hint ? undefined : a.name}>
              {a.hint ? (
                <Term
                  id={`attribute:${a.id}`}
                  definition={{ id: `attribute:${a.id}`, word: a.name, short: a.hint }}
                  always
                  side="top"
                  align="start"
                  className="block w-full text-left text-small text-secondary transition-colors duration-hover hover:text-primary"
                >
                  <FitText minPx={11}>{a.name}</FitText>
                </Term>
              ) : (
                <FitText minPx={11}>{a.name}</FitText>
              )}
            </dt>
            <dd className="flex min-w-0 flex-1 items-center gap-2">
              {showValue ? (
                <RatingFigure value={a.value} className="w-6 text-right text-body" />
              ) : null}
              <RatingBar
                value={a.value}
                compare={a.compare}
                name={a.name}
                cellHeight={6}
                className="flex-1"
              />
              {/* A fixed width keeps the bars aligned across rows; wide enough for "Excellent" and its dot, so nothing is cut. */}
              {showBand ? <ScaleLabel value={a.value} compact className="w-20 shrink-0" aria-hidden /> : null}
              {ev?.provenance ? <ProvenanceChip kind={ev.provenance} /> : null}
            </dd>
          </div>
        );
        if (!ev) return row;
        return (
          <HoverCard key={a.id}>
            <HoverCardTrigger asChild>{row}</HoverCardTrigger>
            <HoverCardContent className="w-72" side="right">
              <p className="t-data mb-1">Evidence · {a.name}</p>
              {a.hint ? <p className="mb-1 text-small text-secondary">{a.hint}</p> : null}
              <p className="text-body text-primary">{ev.summary}</p>
              {ev.sources.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-0.5 border-t border-line pt-2">
                  {ev.sources.map((s) => (
                    <li key={s} className="break-words text-small text-secondary">
                      {s}
                    </li>
                  ))}
                </ul>
              ) : null}
            </HoverCardContent>
          </HoverCard>
        );
      })}
    </dl>
  );
}
