import { Bot } from "lucide-react";
import type { DeptColourToken } from "@foundmill/shared";
import { cn } from "../../../lib/cn";
import { BusinessLogo } from "../../foundation/BusinessLogo";
import { EmptyState } from "../../foundation/EmptyState";
import { Icon } from "../../foundation/Icon";
import { StarRating } from "../../foundation/StarRating";
import { CONCEPT_ATTRIBUTE_HINTS, CONCEPT_ATTRIBUTE_KEYS, CONCEPT_ATTRIBUTE_LABELS, type Concept, type ConceptAttributeKey } from "../types";
import { AttributeBar, AttributeLabel } from "./AttributeBar";
import { conceptOverall } from "./ConceptCard";
import { RadarChart } from "./RadarChart";

export const COMPARE_MIN = 2;
export const COMPARE_MAX = 4;
/** Department colours for the compared concepts, in order (DESIGN §9: radar in department colours). */
export const COMPARE_TONES: DeptColourToken[] = ["dept-1", "dept-3", "dept-5", "dept-6"];

export interface ConceptCompareProps {
  concepts: Concept[];
  /** Radar diameter. Default 320. */
  radarSize?: number;
  className?: string;
}

function attributeValue(c: Concept, key: ConceptAttributeKey): number {
  return c.attributes.find((a) => a.key === key)?.value ?? 1;
}

/** Index of the best concept per attribute (ties: the first). */
export function compareLeaders(concepts: readonly Concept[]): Record<ConceptAttributeKey, number> {
  const out = {} as Record<ConceptAttributeKey, number>;
  for (const key of CONCEPT_ATTRIBUTE_KEYS) {
    let best = 0;
    concepts.forEach((c, i) => {
      if (attributeValue(c, key) > attributeValue(concepts[best] as Concept, key)) best = i;
    });
    out[key] = best;
  }
  return out;
}

/** Side-by-side attribute bars, a radar and the agent verdicts for 2–4 concepts (BUILD §11.1, AC-11.1.4). */
export function ConceptCompare({ concepts, radarSize = 320, className }: ConceptCompareProps) {
  const shown = concepts.slice(0, COMPARE_MAX);
  if (shown.length < COMPARE_MIN) {
    return (
      <EmptyState className={className}>
        Pick {COMPARE_MIN} to {COMPARE_MAX} concepts from their cards to compare attributes, the radar and the agent verdict.
      </EmptyState>
    );
  }
  const leaders = compareLeaders(shown);
  const cols = `minmax(160px,1fr) repeat(${shown.length}, minmax(180px, 1fr))`;
  return (
    <div className={cn("flex flex-col gap-gutter", className)} data-concept-compare={shown.length}>
      <div className="surface-panel overflow-hidden">
        <div className="grid items-center gap-x-4 border-b border-subtle bg-panel-alt px-panel-pad py-2" style={{ gridTemplateColumns: cols }} role="row">
          <span className="t-label" role="columnheader">
            Attribute
          </span>
          {shown.map((c, i) => (
            <div key={c.id} className="flex min-w-0 items-center gap-2" role="columnheader">
              <BusinessLogo src={c.logoSrc} name={c.name} primary={c.kit.primary} monogram={c.monogram} size={32} />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span aria-hidden className={cn("inline-block size-2 rounded-full", `bg-${COMPARE_TONES[i]}`)} />
                  <span className="t-display-sm truncate">{c.name}</span>
                </div>
                <StarRating value={c.currentStars} potential={c.potentialStars} label="Current ability" />
              </div>
              <span className="ml-auto t-display-md tabular-nums" title="Overall (mean attribute)">
                {conceptOverall(c)}
              </span>
            </div>
          ))}
        </div>
        <ol className="flex flex-col divide-y divide-subtle/50">
          {CONCEPT_ATTRIBUTE_KEYS.map((key) => (
            <li key={key} className="grid items-center gap-x-4 px-panel-pad py-1.5" style={{ gridTemplateColumns: cols }} role="row" data-compare-row={key}>
              <span className="text-body text-primary" role="rowheader">
                <AttributeLabel label={CONCEPT_ATTRIBUTE_LABELS[key]} hint={CONCEPT_ATTRIBUTE_HINTS[key]} attributeKey={key} textClassName="text-body text-primary" />
              </span>
              {shown.map((c, i) => {
                const leader = leaders[key] === i;
                return (
                  <div key={c.id} className={cn("rounded-chip px-1", leader && "bg-white/4")} data-leader={leader || undefined}>
                    <AttributeBar label={`${c.name} · ${CONCEPT_ATTRIBUTE_LABELS[key]}`} value={attributeValue(c, key)} evidence={c.attributes.find((a) => a.key === key)?.evidence} hideLabel />
                  </div>
                );
              })}
            </li>
          ))}
        </ol>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-gutter">
        <div className="surface-panel p-panel-pad">
          <RadarChart label="Attribute radar" size={radarSize} axes={CONCEPT_ATTRIBUTE_KEYS.map((k) => ({ key: k, label: CONCEPT_ATTRIBUTE_LABELS[k].replace("Speed to first customer", "Speed").replace("Agent-executability", "Agents").replace("Distribution clarity", "Distribution").replace("Regulatory load", "Regulatory").replace("Capital intensity", "Capital") }))} series={shown.map((c, i) => ({ id: c.id, label: c.name, tone: COMPARE_TONES[i] as DeptColourToken, values: CONCEPT_ATTRIBUTE_KEYS.map((k) => attributeValue(c, k)) }))} />
        </div>
        <section className="surface-panel flex flex-col overflow-hidden" aria-label="Agent verdict">
          <header className="flex h-panel-header items-center gap-2 border-b border-subtle bg-panel-alt px-panel-pad">
            <Icon icon={Bot} size="inline" className="text-secondary" />
            <h3 className="t-label">Agent verdict</h3>
          </header>
          <ol className="flex flex-col divide-y divide-subtle/50">
            {shown.map((c, i) => (
              <li key={c.id} className="flex gap-3 p-panel-pad">
                <span aria-hidden className={cn("mt-1.5 inline-block size-2 shrink-0 rounded-full", `bg-${COMPARE_TONES[i]}`)} />
                <div className="min-w-0">
                  <span className="text-body-strong">{c.name}</span>
                  <p className="text-body text-secondary">{c.verdict ?? "No verdict yet; the research agent is still grounding this concept."}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
