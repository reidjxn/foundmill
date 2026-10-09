"use client";
import { ArrowRight, CircleCheck, CircleX, Clock, TriangleAlert } from "lucide-react";
import type { EntityKind } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { Avatar } from "../foundation/Avatar";
import { Button } from "../foundation/Button";
import { ProvenanceChip } from "../foundation/Chip";
import { Icon, type IconComponent } from "../foundation/Icon";
import { FitText } from "../foundation/FitText";
import { StatusPill, agentStatusTone, type StatusTone } from "../foundation/StatusPill";
import { Tooltip } from "../foundation/Tooltip";
import { EntityText } from "./EntityText";
import { Figure } from "../data/Figure";
import { TileSpark } from "../data/MetricTile";
import { DEPT_TEXT, DEPT_TONE } from "./ribbon/OnThisDayCard";
import type { DepartmentCardData, HealthTone } from "./types";

export interface DepartmentCardProps {
  department: DepartmentCardData;
  onOpen?: (departmentId: string) => void;
  onOpenAgent?: (agentId: string) => void;
  onOpenEntity?: (entityId: string) => void;
  entityKinds?: Record<string, EntityKind>;
  /** Max avatars in the squad strip before "+N". Default 8. */
  maxSquad?: number;
  className?: string;
}

const HEALTH: Record<HealthTone, { tone: StatusTone; icon: IconComponent; word: string }> = {
  good: { tone: "good", icon: CircleCheck, word: "Healthy" },
  warn: { tone: "warn", icon: TriangleAlert, word: "Waiting" },
  bad: { tone: "bad", icon: CircleX, word: "Failing" },
};

const DELTA_CLASS: Record<HealthTone, string> = { good: "tone-status-good text-status-good", warn: "tone-status-warn text-status-warn", bad: "tone-status-bad text-status-bad" };

/**
 * Home's department card (BUILD §11.2, DESIGN §9, Mission): a department-glow panel whose lit corner takes the
 * department colour. Header: the glowing dot, the name (fits: founder-defined names step down, never clip), the lead's
 * face and name, the health pill. The team strip with status rings (hover shows role, model and task) and "4 of 7
 * working"; up to three "Now" lines that wrap to two lines instead of clipping; the headline metric on an inner plate
 * with its sparkline; "Next up" at the foot.
 */
export function DepartmentCard({ department: d, onOpen, onOpenAgent, onOpenEntity, entityKinds, maxSquad = 8, className }: DepartmentCardProps) {
  const health = HEALTH[d.health];
  const squad = d.squad.slice(0, maxSquad);
  const extra = d.squad.length - squad.length;
  const working = d.squad.filter((m) => m.status === "healthy").length;
  return (
    <section className={cn("@container surface-panel glow-dept edge-tint flex min-w-0 flex-col overflow-hidden", DEPT_TONE[d.dept], className)} aria-label={`${d.name} department`} data-department={d.id} data-health={d.health}>
      <header className="flex h-panel-header shrink-0 items-center gap-2 pl-panel-pad pr-2.5 rule-fade">
        <span aria-hidden className="chip-dot" />
        <h3 className="min-w-0 shrink t-title text-primary">
          <FitText minPx={11}>{d.name}</FitText>
        </h3>
        <Tooltip content={`${d.lead.name} · lead`}>
          <button type="button" className="ml-1 inline-flex min-w-0 shrink-2 items-center gap-1.5 rounded-pill pr-1 text-small text-secondary outline-none transition-colors duration-hover hover:text-primary focus-visible:shadow-ring" onClick={() => onOpenAgent?.(d.squad.find((m) => m.name === d.lead.name)?.id ?? d.lead.name)} aria-label={`${d.lead.name}, department lead`}>
            <Avatar size={22} name={d.lead.name} agent={{ seed: d.lead.seed, dept: d.dept }} status={d.lead.status} />
            {/* The lead's name only where the header has room for it beside the department's own name. */}
            <span className="hidden min-w-0 truncate @md:inline" aria-hidden>
              {d.lead.name}
            </span>
          </button>
        </Tooltip>
        <span className="flex-1" />
        <StatusPill tone={health.tone} icon={health.icon} className="shrink-0">
          {d.healthWord ?? health.word}
        </StatusPill>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-panel-pad pb-3 pt-3">
        <div className="flex items-center gap-2" aria-label={`Team: ${d.squad.length} agents, ${working} working`}>
          <ul className="flex items-center" data-squad-strip>
            {squad.map((m, i) => {
              const { word } = agentStatusTone(m.status);
              return (
                <li key={m.id} className={cn(i > 0 && "-ml-1.5")}>
                  <Tooltip
                    content={
                      <span className="flex flex-col gap-0.5">
                        <span className="font-medium">
                          {m.name} · {word}
                        </span>
                        <span className="text-secondary">
                          {m.role} · <span className="font-mono text-mono">{m.model}</span>
                        </span>
                        {m.task ? <span className="text-secondary">{m.task}</span> : <span className="text-secondary">No task</span>}
                      </span>
                    }
                  >
                    <button type="button" className="inline-flex rounded-full outline-none transition-transform duration-hover ease-out hover:-translate-y-0.5 focus-visible:shadow-ring" onClick={() => onOpenAgent?.(m.id)} aria-label={`${m.name}, ${m.role}, ${word}${m.task ? `: ${m.task}` : ""}`} data-squad-member={m.id}>
                      <Avatar size={26} name={m.name} agent={{ seed: m.seed, dept: d.dept }} status={m.status} stacked surface="surface-1" />
                    </button>
                  </Tooltip>
                </li>
              );
            })}
            {extra > 0 ? (
              <li className="ml-1 inline-flex h-control-xs items-center px-1 font-mono text-mono text-tertiary" aria-label={`${extra} more agents`}>
                +{extra}
              </li>
            ) : null}
          </ul>
          <span className="ml-auto whitespace-nowrap text-small text-secondary tabular-nums">
            <span className="font-medium text-primary">{working}</span> of {d.squad.length} working
          </span>
        </div>
        <div>
          <span className="t-data">Now</span>
          {d.now.length === 0 ? (
            <p className="mt-1 text-small text-secondary">Quiet. The next cycle starts with Continue.</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-1" data-now-lines>
              {d.now.slice(0, 3).map((line, i) => (
                <li key={i} className="flex items-start gap-2 text-body text-primary">
                  <span aria-hidden className="chip-dot mt-1.5 size-1.5" />
                  <EntityText text={line} kinds={entityKinds} onOpenEntity={onOpenEntity} className="line-clamp-2 min-w-0 text-pretty" />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-end justify-between gap-3 rounded-md border border-line-faint bg-white/2 px-3 pb-2.5 pt-2" data-department-metric>
          <div className="min-w-0">
            <span className="t-data block">{d.metric.label}</span>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <FitText className="font-display text-display-md font-semibold text-primary" text={d.metric.value} truncate={false} tooltip={false}>
                <Figure value={d.metric.value} />
              </FitText>
              {d.metric.delta ? (
                <span className={cn("chip-tone inline-flex h-badge items-center whitespace-nowrap rounded-pill border px-1.5 text-small font-medium tabular-nums", DELTA_CLASS[d.metric.deltaTone ?? "good"])}>{d.metric.delta}</span>
              ) : null}
              {d.metric.provenance ? <ProvenanceChip kind={d.metric.provenance} /> : null}
            </div>
          </div>
          <TileSpark data={d.metric.series} className={cn("mb-1 max-w-32 shrink-0 basis-1/3", DEPT_TEXT[d.dept])} label={`${d.metric.label}, ${d.metric.series.length} periods`} />
        </div>
        <div className="mt-auto flex items-center gap-2">
          <Icon icon={Clock} size="inline" className="shrink-0 text-tertiary" />
          <span className="t-data shrink-0">Next up</span>
          <span className="line-clamp-2 min-w-0 flex-1 text-small text-secondary" title={d.nextUp}>
            {d.nextUp}
          </span>
          {onOpen ? (
            <Button size="sm" variant="ghost" iconRight={ArrowRight} className="shrink-0 px-2" onClick={() => onOpen(d.id)}>
              Open
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
