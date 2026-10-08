"use client";
import { ArrowRight, CircleCheck, CircleX, Clock, TriangleAlert } from "lucide-react";
import type { EntityKind } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { Avatar } from "../foundation/Avatar";
import { Button } from "../foundation/Button";
import { ProvenanceChip } from "../foundation/Chip";
import { Icon, type IconComponent } from "../foundation/Icon";
import { Sparkline } from "../foundation/Sparkline";
import { StatusPill, agentStatusTone, type StatusTone } from "../foundation/StatusPill";
import { Tooltip } from "../foundation/Tooltip";
import { EntityText } from "./EntityText";
import { DEPT_BG, DEPT_TEXT } from "./ribbon/OnThisDayCard";
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

const DELTA_CLASS: Record<HealthTone, string> = { good: "text-status-good", warn: "text-status-warn", bad: "text-status-bad" };

/**
 * Home's department card (BUILD §11.2, DESIGN §9): header with the colour dot, name, lead avatar and health pill;
 * squad strip with status rings (hover shows role, model and task); up to three "Now" lines with entities linked;
 * the module's headline metric with a 48 px sparkline; "Next up".
 */
export function DepartmentCard({ department: d, onOpen, onOpenAgent, onOpenEntity, entityKinds, maxSquad = 8, className }: DepartmentCardProps) {
  const health = HEALTH[d.health];
  const squad = d.squad.slice(0, maxSquad);
  const extra = d.squad.length - squad.length;
  const working = d.squad.filter((m) => m.status === "healthy").length;
  return (
    <section className={cn("surface-panel flex min-w-0 flex-col overflow-hidden", className)} aria-label={`${d.name} department`} data-department={d.id} data-health={d.health}>
      <header className="flex h-panel-header items-center gap-2 border-b border-subtle bg-panel-alt pl-panel-pad pr-2">
        <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", DEPT_BG[d.dept])} />
        <h3 className="t-label min-w-0 flex-1 truncate text-primary">{d.name}</h3>
        <Tooltip content={`${d.lead.name} · lead`}>
          <button type="button" className="inline-flex rounded-full outline-none focus-visible:outline-2 focus-visible:outline-link" onClick={() => onOpenAgent?.(d.squad.find((m) => m.name === d.lead.name)?.id ?? d.lead.name)} aria-label={`${d.lead.name}, department lead`}>
            <Avatar size={20} name={d.lead.name} agent={{ seed: d.lead.seed, dept: d.dept }} status={d.lead.status} />
          </button>
        </Tooltip>
        <StatusPill tone={health.tone} icon={health.icon}>
          {d.healthWord ?? health.word}
        </StatusPill>
      </header>
      <div className="flex flex-col gap-3 p-panel-pad">
        <div className="flex items-center gap-2" aria-label={`Team: ${d.squad.length} agents, ${working} working`}>
          <ul className="flex items-center" data-squad-strip>
            {squad.map((m, i) => {
              const { word } = agentStatusTone(m.status);
              return (
                <li key={m.id} className={cn(i > 0 && "-ml-1.5")}>
                  <Tooltip
                    content={
                      <span className="flex flex-col gap-0.5">
                        <span className="text-body-strong">
                          {m.name} · {word}
                        </span>
                        <span className="text-secondary">
                          {m.role} · <span className="font-mono text-mono">{m.model}</span>
                        </span>
                        {m.task ? <span className="text-secondary">{m.task}</span> : <span className="text-secondary">No task</span>}
                      </span>
                    }
                  >
                    <button type="button" className="inline-flex rounded-full outline-none ring-offset-panel focus-visible:outline-2 focus-visible:outline-link" onClick={() => onOpenAgent?.(m.id)} aria-label={`${m.name}, ${m.role}, ${word}${m.task ? `: ${m.task}` : ""}`} data-squad-member={m.id}>
                      <Avatar size={24} name={m.name} agent={{ seed: m.seed, dept: d.dept }} status={m.status} />
                    </button>
                  </Tooltip>
                </li>
              );
            })}
            {extra > 0 ? (
              <li className="-ml-1.5 inline-flex size-6 items-center justify-center rounded-full bg-panel-alt font-mono text-mono text-secondary" aria-label={`${extra} more agents`}>
                +{extra}
              </li>
            ) : null}
          </ul>
          <span className="text-small text-secondary tabular-nums">
            {working} of {d.squad.length} working
          </span>
        </div>
        <div>
          <span className="t-label">Now</span>
          {d.now.length === 0 ? (
            <p className="text-small text-secondary">Quiet. The next cycle starts with Continue.</p>
          ) : (
            <ul className="mt-0.5 flex flex-col gap-0.5" data-now-lines>
              {d.now.slice(0, 3).map((line, i) => (
                <li key={i} className="flex items-start gap-1.5 text-body">
                  <span aria-hidden className={cn("mt-2 inline-block size-1 shrink-0 rounded-full", DEPT_BG[d.dept])} />
                  <EntityText text={line} kinds={entityKinds} onOpenEntity={onOpenEntity} className="min-w-0 truncate" />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <span className="t-label">{d.metric.label}</span>
            <div className="flex items-baseline gap-2">
              <span className="t-display-lg text-primary">{d.metric.value}</span>
              {d.metric.delta ? <span className={cn("text-small tabular-nums", DELTA_CLASS[d.metric.deltaTone ?? "good"])}>{d.metric.delta}</span> : null}
              {d.metric.provenance ? <ProvenanceChip kind={d.metric.provenance} /> : null}
            </div>
          </div>
          <Sparkline data={d.metric.series} width={48} height={16} className={DEPT_TEXT[d.dept]} label={`${d.metric.label}, ${d.metric.series.length} periods`} />
        </div>
        <div className="flex items-center gap-2 border-t border-subtle pt-2">
          <Icon icon={Clock} size="inline" className="text-secondary" />
          <span className="min-w-0 flex-1 truncate text-small text-secondary">
            <span className="t-label mr-1">Next up</span>
            {d.nextUp}
          </span>
          {onOpen ? (
            <Button size="sm" variant="ghost" iconRight={ArrowRight} className="h-6 px-1.5" onClick={() => onOpen(d.id)}>
              Open
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
