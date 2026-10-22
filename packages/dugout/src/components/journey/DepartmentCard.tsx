"use client";
import type { ReactNode } from "react";
import { ArrowRight, CircleCheck, CircleX, Clock, Inbox, MessageSquareReply, Moon, RefreshCw, TriangleAlert } from "lucide-react";
import type { EntityKind } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { useAgentPersona } from "../foundation/AgentPersona";
import { Avatar } from "../foundation/Avatar";
import { Button } from "../foundation/Button";
import { ProvenanceChip } from "../foundation/Chip";
import { Icon, type IconComponent } from "../foundation/Icon";
import { FitText } from "../foundation/FitText";
import { Skeleton } from "../foundation/Skeleton";
import { StatusPill, agentStatusTone, type StatusTone } from "../foundation/StatusPill";
import { Tooltip } from "../foundation/Tooltip";
import { PlainFigure } from "../guidance/PlainFigure";
import { EntityText } from "./EntityText";
import { Figure } from "../data/Figure";
import { TileSpark } from "../data/MetricTile";
import { DEPT_TEXT, DEPT_TONE } from "./ribbon/OnThisDayCard";
import type { DepartmentCardData, DepartmentQuietLine, HealthTone, SquadMember } from "./types";

export interface DepartmentCardProps {
  department: DepartmentCardData;
  onOpen?: (departmentId: string) => void;
  onOpenAgent?: (agentId: string) => void;
  onOpenEntity?: (entityId: string) => void;
  /** Opens what a quiet card's line names (the note waiting in the Inbox). Without it the line is plain text. */
  onOpenQuiet?: () => void;
  entityKinds?: Record<string, EntityKind>;
  /** Max avatars in the squad strip before "+N". Default 8. */
  maxSquad?: number;
  /**
   * The headline metric in plain words under its figure while guidance is on (PlainFigure, UX plan §7.8): the id of its
   * definition ("runway", "team_health", "acquisition_cost"), or an explicit line in `metricPlain`.
   */
  metricId?: string;
  metricPlain?: ReactNode;
  className?: string;
}

const HEALTH: Record<HealthTone, { tone: StatusTone; icon: IconComponent; word: string }> = {
  good: { tone: "good", icon: CircleCheck, word: "Healthy" },
  warn: { tone: "warn", icon: TriangleAlert, word: "Waiting" },
  bad: { tone: "bad", icon: CircleX, word: "Failing" },
};

const DELTA_CLASS: Record<HealthTone, string> = { good: "tone-status-good text-status-good", warn: "tone-status-warn text-status-warn", bad: "tone-status-bad text-status-bad" };

/** The statuses that need the founder, worst first, in the words Team › Health uses for them (shared/health.ts in widgets). */
const ATTENTION_WORDS: ReadonlyArray<[status: SquadMember["status"], word: string]> = [
  ["failing", "failing"],
  ["injured", "down"],
  ["degraded", "degraded"],
];

/**
 * The team strip's words (UX plan B19): "3 of 4 working" counts the agents with a task right now, never the healthy
 * ones (a healthy idle agent is not working). With nobody on a task the strip says what the team is instead: "4 agents,
 * all healthy", or what needs the founder ("4 agents, 1 down, 1 degraded").
 */
export function teamStripWords(squad: readonly { status: SquadMember["status"]; task?: string | null }[]): string {
  const total = squad.length;
  if (total === 0) return "No agents yet";
  const working = squad.filter((m) => !!m.task).length;
  if (working > 0) return `${working} of ${total} working`;
  const agents = total === 1 ? "1 agent" : `${total} agents`;
  const parts = ATTENTION_WORDS.map(([status, word]) => {
    const n = squad.filter((m) => m.status === status).length;
    return n > 0 ? `${n} ${word}` : null;
  }).filter((p): p is string => p !== null);
  if (parts.length > 0) return `${agents}, ${parts.join(", ")}`;
  return total === 1 ? "1 agent, healthy" : `${agents}, all healthy`;
}

/**
 * Home's department card (BUILD §11.2, DESIGN §9, Mission): a department-glow panel whose lit corner takes the
 * department colour. Header: the glowing dot, the name (fits: founder-defined names step down, never clip), the lead's
 * face and name, the health pill. The team strip with status rings (hover shows role, model and task) and "3 of 7
 * working" (agents on a task; "7 agents, all healthy" when nobody is); up to three "Working on now" lines that wrap to
 * two lines instead of clipping; the headline metric on an inner plate with its sparkline; "Next" at the foot.
 * "Working on now" takes the card's spare height, so the metric and "Next" sit at the foot, level with the other cards
 * in the row. A quiet card (nothing in progress) fills "Working on now" with one line from real data — the note waiting
 * for the founder, an unread note, the last task it finished, or "All clear" — never a void (`QuietLine`); while the
 * work is loading it shows placeholders rather than calling the department quiet.
 */
export function DepartmentCard({ department: d, onOpen, onOpenAgent, onOpenEntity, onOpenQuiet, entityKinds, maxSquad = 8, metricId, metricPlain, className }: DepartmentCardProps) {
  const health = HEALTH[d.health];
  const persona = useAgentPersona();
  const leadMember = d.squad.find((m) => m.name === d.lead.name);
  const lead = { name: d.lead.name, role: d.lead.role ?? leadMember?.role, personaKey: d.lead.personaKey ?? leadMember?.personaKey };
  const squad = d.squad.slice(0, maxSquad);
  const extra = d.squad.length - squad.length;
  const stripWords = teamStripWords(d.squad);
  // The leading count stands out ("3 of 4 working", "4 agents, all healthy"); the rest of the words stay secondary.
  const stripParts = /^(\d+)(.*)$/.exec(stripWords);
  const quiet = d.now.length === 0 && !d.nowLoading;
  // A failed load is not a quiet department: the line says so instead of "Quiet".
  const failed = quiet && d.quiet?.kind === "error";
  return (
    <section className={cn("@container surface-panel glow-dept edge-tint flex min-w-0 flex-col overflow-hidden", DEPT_TONE[d.dept], className)} aria-label={`${d.name} department`} data-department={d.id} data-health={d.health}>
      <header className="flex h-panel-header shrink-0 items-center gap-2 pl-panel-pad pr-2.5 rule-fade">
        <span aria-hidden className="chip-dot" />
        <h3 className="min-w-0 shrink t-title text-primary">
          <FitText minPx={11}>{d.name}</FitText>
        </h3>
        <Tooltip content={`${persona.labelFor(lead)} · lead`}>
          <button type="button" className="ml-1 inline-flex min-w-0 shrink-2 items-center gap-1.5 rounded-pill pr-1 text-small text-secondary outline-none transition-colors duration-hover hover:text-primary focus-visible:shadow-ring" onClick={() => onOpenAgent?.(d.squad.find((m) => m.name === d.lead.name)?.id ?? d.lead.name)} aria-label={`${persona.labelFor(lead)}, department lead`}>
            <Avatar size={22} name={persona.nameFor(lead)} agent={{ seed: d.lead.seed, dept: d.dept, personaKey: lead.personaKey }} status={d.lead.status} />
            {/* The lead's name only where the header has room for it beside the department's own name. */}
            <span className="hidden min-w-0 truncate @md:inline" aria-hidden>
              {persona.nameFor(lead)}
            </span>
          </button>
        </Tooltip>
        <span className="flex-1" />
        <StatusPill tone={health.tone} icon={health.icon} className="shrink-0">
          {d.healthWord ?? health.word}
        </StatusPill>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-panel-pad pb-3 pt-3">
        <div className="flex items-center gap-2" aria-label={`Team: ${stripWords}`} data-team-strip>
          <ul className="flex items-center" data-squad-strip>
            {squad.map((m, i) => {
              const { word } = agentStatusTone(m.status);
              return (
                <li key={m.id} className={cn(i > 0 && "-ml-1.5")}>
                  <Tooltip
                    content={
                      <span className="flex flex-col gap-0.5">
                        <span className="font-medium">
                          {persona.nameFor(m)} · {word}
                        </span>
                        <span className="text-secondary">
                          {m.role} · <span className="font-mono text-mono">{m.model}</span>
                        </span>
                        {m.task ? <span className="text-secondary">{m.task}</span> : <span className="text-secondary">No task</span>}
                      </span>
                    }
                  >
                    <button type="button" className="inline-flex rounded-full outline-none transition-transform duration-hover ease-out hover:-translate-y-0.5 focus-visible:shadow-ring" onClick={() => onOpenAgent?.(m.id)} aria-label={`${persona.nameFor(m)}, ${m.role}, ${word}${m.task ? `: ${m.task}` : ""}`} data-squad-member={m.id}>
                      <Avatar size={26} name={persona.nameFor(m)} agent={{ seed: m.seed, dept: d.dept, personaKey: m.personaKey }} status={m.status} stacked surface="surface-1" />
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
          <span className="ml-auto whitespace-nowrap text-small text-secondary tabular-nums" data-team-strip-words>
            {stripParts ? (
              <>
                <span className="font-medium text-primary">{stripParts[1]}</span>
                {stripParts[2]}
              </>
            ) : (
              stripWords
            )}
          </span>
        </div>
        <div className="flex flex-1 flex-col" data-now>
          <div className="flex items-center gap-1.5">
            <span className="t-data">Working on now</span>
            {quiet && !failed ? (
              <>
                <span aria-hidden className="t-data">
                  ·
                </span>
                <span className="t-data" data-now-quiet>
                  Quiet
                </span>
              </>
            ) : null}
          </div>
          {d.nowLoading && d.now.length === 0 ? (
            <div role="status" className="mt-2 flex flex-col gap-2" aria-busy aria-label="Loading what the team is doing">
              <Skeleton className="h-3 w-4/5" index={0} />
              <Skeleton className="h-3 w-3/5" index={1} />
            </div>
          ) : quiet ? (
            <QuietLine line={d.quiet ?? null} onOpen={onOpenQuiet} />
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
            {/* The plain-words line under the figure while guidance is on; the figure alone otherwise (same structure). */}
            <PlainFigure metricId={metricId} plain={metricPlain} className="mt-0.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <FitText className="font-display text-display-md font-semibold text-primary" text={d.metric.value} truncate={false} tooltip={false}>
                  <Figure value={d.metric.value} />
                </FitText>
                {d.metric.delta ? (
                  <span className={cn("chip-tone inline-flex h-badge items-center whitespace-nowrap rounded-pill border px-1.5 text-small font-medium tabular-nums", DELTA_CLASS[d.metric.deltaTone ?? "good"])}>{d.metric.delta}</span>
                ) : null}
                {d.metric.provenance ? <ProvenanceChip kind={d.metric.provenance} /> : null}
              </div>
            </PlainFigure>
          </div>
          <TileSpark data={d.metric.series} className={cn("mb-1 max-w-32 shrink-0 basis-1/3", DEPT_TEXT[d.dept])} label={d.metric.seriesLabel ?? `${d.metric.label}, ${d.metric.series.length} periods`} />
        </div>
        <div className="flex items-center gap-2">
          <Icon icon={Clock} size="inline" className="shrink-0 text-tertiary" />
          <span className="t-data shrink-0">Next</span>
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

const QUIET_ICON: Record<DepartmentQuietLine["kind"] | "unknown", IconComponent> = { attention: TriangleAlert, respond: MessageSquareReply, inbox: Inbox, finished: CircleCheck, clear: Moon, error: RefreshCw, unknown: Moon };

/** Lines that open something (the note, the agent or task that needs the founder, a retry); the rest are plain text. */
const QUIET_OPENS: ReadonlySet<DepartmentQuietLine["kind"]> = new Set(["attention", "respond", "inbox", "error"]);

/**
 * A quiet card's one line, set in the space "Working on now" lines would take: the department's light on an icon disc, a kicker
 * ("Needs your answer", "New in your Inbox", "Last finished", "All clear"), the line itself (two lines at most, the whole
 * text on hover) and a short detail. A note opens from the line. Without a line it says only what the card knows.
 */
function QuietLine({ line, onOpen }: { line: DepartmentQuietLine | null; onOpen?: () => void }) {
  const kind = line?.kind ?? "unknown";
  const text = line?.text ?? "Nothing in progress right now.";
  const opens = !!onOpen && !!line && QUIET_OPENS.has(line.kind);
  const body = (
    <>
      <span aria-hidden className="icon-halo size-control-md">
        <Icon icon={QUIET_ICON[kind]} size="inline" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 self-center">
        {line ? <span className="t-data">{line.label}</span> : null}
        <span className="line-clamp-2 text-pretty text-body text-primary" title={text}>
          {text}
        </span>
        {line?.detail ? <span className="text-small text-secondary tabular-nums">{line.detail}</span> : null}
      </span>
      {opens ? <Icon icon={ArrowRight} size="inline" className="shrink-0 self-center text-tertiary transition-colors duration-hover group-hover/quiet:text-primary" /> : null}
    </>
  );
  const box = "flex w-full items-start gap-3 rounded-md px-2 py-2 text-left";
  return (
    <div className="-mx-2 flex flex-1 items-center pt-1" data-now-quiet-line={kind}>
      {opens && line ? (
        <button type="button" onClick={onOpen} className={cn(box, "group/quiet outline-none transition-colors duration-hover hover:bg-white/4 focus-visible:shadow-ring")} aria-label={`${line.label}: ${text}${line.detail ? `. ${line.detail}` : ""}`}>
          {body}
        </button>
      ) : (
        <p className={box}>{body}</p>
      )}
    </div>
  );
}
