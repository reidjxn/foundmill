import { cn } from "../../lib/cn";
import { FitText } from "../foundation/FitText";
import { ProvenanceChip } from "../foundation/Chip";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../foundation/HoverCard";
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
 * evidence on hover"). `compare` draws a second value as outlined cells.
 */
export function AttributeBars({
  attributes,
  labelClassName = "w-28",
  columns = 1,
  showValue = true,
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
            <dt className={cn("shrink-0 text-small text-secondary", labelClassName)} title={a.name}>
              <FitText minPx={11}>{a.name}</FitText>
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
