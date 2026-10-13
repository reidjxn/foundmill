"use client";
/**
 * Team › Health (BUILD §6.3, §9.10, §11.9): a status board grouped by health, the ones that need the founder first
 * (failing, down, degraded, paused, idle, healthy). "Down" shows the expected return once the integration is
 * reconnected. Live: `agent.health_changed` moves an agent between groups within 2 s (AC-11.9.1).
 */
import { useMemo } from "react";
import { Activity, CircleCheck, ExternalLink, HeartPulse, TriangleAlert, UserRoundPlus } from "lucide-react";
import { Avatar, Button, Chip, DeptChip, EntityLink, Panel, StatusPill, StatusStrip, cn, formatPercent, formatRelative, type HealthDetails, type MetricTileProps } from "@foundmill/dugout";
import { AGENT_STATUSES, type AgentStatus } from "@foundmill/shared/constants";
import { departmentForModule, useDepartments } from "@foundmill/widgets/shared/departments";
import { routes } from "@foundmill/widgets/shared/routes";
import { useWidgetData } from "@foundmill/widgets/data";
import { plural } from "../fit";
import type { ModuleScreenProps } from "../registry";
import { AgentStatusWordPill, STATUS_DESCRIPTION, STATUS_ORDER, STATUS_WORD, Screen, agentDept, agentRoleLine, agentEntity, agentHref, taskHref, toIso, useAgents, useLiveAgentStatus, useNow, useTeamOptions, withLiveStatus } from "./shared";
import type { AgentRow } from "./types";

export interface HealthGroup {
  status: AgentStatus;
  word: string;
  description: string;
  agents: AgentRow[];
}

/** Groups in STATUS_ORDER, empty groups dropped; agents sorted by name inside a group. */
export function groupByHealth(agents: readonly AgentRow[]): HealthGroup[] {
  return STATUS_ORDER.map((status) => ({ status, word: STATUS_WORD[status], description: STATUS_DESCRIPTION[status], agents: agents.filter((a) => a.status === status).sort((a, b) => a.name.localeCompare(b.name)) })).filter((g) => g.agents.length > 0);
}

export function healthDetails(agent: AgentRow): HealthDetails {
  return {
    lastHeartbeatAt: toIso(agent.health?.lastHeartbeatAt ?? null),
    errorRate: agent.health?.errorRate ?? null,
    loopDetected: agent.health?.loopDetected ?? false,
    expectedReturnAt: toIso(agent.expectedReturnAt ?? agent.health?.expectedReturnAt ?? null),
    reason: agent.health?.reason ?? null,
  };
}

/**
 * Why this agent is in its group, in one line: the expected return, the reason, a loop, or (degraded) the error rate.
 * Empty when there is nothing beyond what the group's own description and the card's figures already say, so a card
 * never repeats its panel header or its Heartbeat / Errors figures.
 */
export function healthReason(status: AgentStatus, details: HealthDetails, now: Date): string {
  const parts: string[] = [];
  // Down: when it is back, else the reason names what to reconnect; only with neither does the generic line show.
  if (status === "injured") {
    if (details.expectedReturnAt) parts.push(`Expected back ${formatRelative(details.expectedReturnAt, now)}`);
    else if (!details.reason) parts.push("Back once its integration is reconnected in Settings › Integrations");
  }
  if (details.reason) parts.push(details.reason);
  const loop = "Loop detected on the last session";
  if (details.loopDetected && !parts.some((p) => p.toLowerCase().includes("loop"))) parts.push(loop);
  if (status === "degraded" && typeof details.errorRate === "number" && !parts.some((p) => /error rate/i.test(p))) parts.push(`Error rate ${formatPercent(details.errorRate, { digits: 1 })} over 24 h`);
  return parts.join(" · ");
}

/**
 * The Health headline when nobody needs the founder: how many agents are working (healthy) out of the team. All idle
 * is not "everyone is working".
 */
export function healthSummary(agents: readonly Pick<AgentRow, "status">[]): { text: string; tone: "good" | "neutral" } {
  const working = agents.filter((a) => a.status === "healthy").length;
  if (working === 0) return { text: "No agent is working right now", tone: "neutral" };
  if (working === agents.length) return { text: "Everyone is working", tone: "good" };
  return { text: `${working} of ${agents.length} working`, tone: "good" };
}

const TONE_CLASS: Record<AgentStatus, string> = { failing: "text-status-bad", injured: "text-status-bad", degraded: "text-status-warn", paused: "text-secondary", idle: "text-secondary", healthy: "text-status-good" };

/** One short line under each count in the strip. */
export const STATUS_CAPTION: Record<AgentStatus, string> = {
  healthy: "Heartbeat on time",
  degraded: "Errors above 10%",
  failing: "Sessions stopped",
  injured: "Back once reconnected",
  paused: "By you or a vacation",
  idle: "No task assigned",
};

/** Scroll a health group's panel into view (the strip's tiles are shortcuts to their group). */
function showGroup(status: AgentStatus) {
  if (typeof document === "undefined") return;
  document.querySelector(`[data-health-group="${status}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function HealthScreen({ businessId }: ModuleScreenProps) {
  const { navigate, currency = "EUR" } = useWidgetData();
  const { liveRefetchMs } = useTeamOptions();
  const now = useNow();
  const agentsQuery = useAgents();
  const departments = useDepartments();
  const live = useLiveAgentStatus(agentsQuery, { debounceMs: liveRefetchMs });
  const agents = useMemo(() => withLiveStatus(agentsQuery.data?.agents, live).filter((a) => !a.archivedAt), [agentsQuery.data, live]);
  const groups = useMemo(() => groupByHealth(agents), [agents]);
  const teamDept = departmentForModule(departments.data, "team");
  const recruitHref = routes.department(businessId, teamDept?.slug ?? "team", "recruitment");
  const needsYou = agents.filter((a) => a.status === "failing" || a.status === "injured" || a.status === "degraded").length;
  const summary = healthSummary(agents);

  const tiles: MetricTileProps[] = AGENT_STATUSES.map((status) => {
    const count = agents.filter((a) => a.status === status).length;
    return { label: STATUS_WORD[status], value: count, format: "integer", caption: STATUS_CAPTION[status], onClick: count ? () => showGroup(status) : undefined };
  });

  const loading = agentsQuery.isLoading && !agentsQuery.data;
  const error = agentsQuery.error ? agentsQuery.error.message : undefined;

  return (
    <Screen name="team/health">
      <Panel
        span={12}
        title="Health"
        flush
        loading={loading}
        error={error}
        onRetry={agentsQuery.refetch}
        actions={
          needsYou ? (
            <StatusPill tone="warn" icon={TriangleAlert} data-testid="health-summary">
              {needsYou === 1 ? "1 agent needs you" : `${needsYou} agents need you`}
            </StatusPill>
          ) : agents.length ? (
            <StatusPill tone={summary.tone} icon={summary.tone === "good" ? CircleCheck : undefined} data-testid="health-summary">
              {summary.text}
            </StatusPill>
          ) : (
            <span className="text-small text-secondary" data-testid="health-summary">
              No agents yet
            </span>
          )
        }
        footer="Statuses change as sessions start, end, fail or loop, and when a credential lapses or a wage cap is reached. Heartbeat is an agent's last activity; errors are the share of its sessions that failed over 24 h."
      >
        <StatusStrip tiles={tiles} className="rounded-none border-0" aria-label="Agents by health" />
      </Panel>

      {!loading && !error && agents.length === 0 ? (
        <Panel span={12} title="Team" empty={{ icon: HeartPulse, title: "No agents to watch", children: "Each agent appears here under its health with heartbeat, error rate and, when down, the expected return.", action: { label: "Go to Recruitment", icon: UserRoundPlus, onClick: () => navigate(recruitHref) } }} />
      ) : null}

      {groups.map((group) => (
        <Panel key={group.status} span={12} title={group.word} meta={plural(group.agents.length, "agent")} data-health-group={group.status} className="scroll-mt-4" actions={<span className="text-small text-secondary">{group.description}</span>}>
          <ul className="grid grid-cols-3 gap-3" aria-label={`${group.word} agents`}>
            {group.agents.map((agent) => {
              const details = healthDetails(agent);
              const reason = healthReason(agent.status, details, now);
              const roleLine = agentRoleLine(agent);
              const back = details.expectedReturnAt;
              return (
                <li key={agent.id} data-agent-id={agent.id} className="edge flex min-w-0 flex-col gap-3 rounded-md bg-surface-2 p-panel-pad">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar size={32} name={agent.name} agent={{ seed: agent.avatarSeed || agent.id, dept: agentDept(agent) }} status={agent.status} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <EntityLink entity={{ id: agent.id, kind: "agent", name: agent.name, href: agentHref(businessId, agent.id) }} details={agentEntity(businessId, agent, currency)} hideIcon className="min-w-0 truncate text-body-strong" onOpen={(e) => e.href && navigate(e.href)} onVerb={(verb, e) => verb === "open_profile" && e.href && navigate(e.href)} />
                      {roleLine ? <span className="truncate text-small text-secondary">{roleLine}</span> : null}
                    </span>
                    <AgentStatusWordPill status={agent.status} expectedReturnAt={back} now={now} withReturn={false} className="shrink-0" />
                  </div>
                  {reason ? (
                    <p className={cn("flex items-start gap-1.5 text-small", TONE_CLASS[agent.status])}>
                      <Activity size={14} className="mt-0.5 shrink-0" aria-hidden />
                      <span className="min-w-0">{reason}</span>
                    </p>
                  ) : null}
                  <dl className="flex min-w-0 gap-4">
                    <div className="flex shrink-0 flex-col gap-0.5">
                      <dt className="t-data">Heartbeat</dt>
                      <dd className="whitespace-nowrap text-body text-primary tabular-nums">{details.lastHeartbeatAt ? formatRelative(details.lastHeartbeatAt, now) : <span className="text-tertiary">—</span>}</dd>
                    </div>
                    <div className="flex shrink-0 flex-col gap-0.5">
                      <dt className="t-data">Errors 24 h</dt>
                      <dd className="whitespace-nowrap text-body text-primary tabular-nums">{typeof details.errorRate === "number" ? formatPercent(details.errorRate, { digits: 1 }) : <span className="text-tertiary">—</span>}</dd>
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <dt className="t-data">Task</dt>
                      <dd className="min-w-0 text-body">
                        {agent.currentTask ? (
                          <a
                            href={taskHref(businessId, agent.currentTask.id)}
                            className="entity-link line-clamp-2 break-words"
                            onClick={(e) => {
                              e.preventDefault();
                              navigate(taskHref(businessId, agent.currentTask!.id));
                            }}
                          >
                            {agent.currentTask.title}
                          </a>
                        ) : (
                          <span className="text-tertiary">None</span>
                        )}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-auto flex items-center justify-between gap-2">
                    <span className="flex min-w-0 flex-wrap gap-1">
                      {(agent.departments ?? []).map((d) => (
                        <DeptChip key={d.id} dept={d.colourToken}>
                          {d.name}
                        </DeptChip>
                      ))}
                      {details.loopDetected ? <Chip tone="warn">Loop</Chip> : null}
                    </span>
                    <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => navigate(agentHref(businessId, agent.id))} aria-label={`Open ${agent.name}'s profile`} className="shrink-0">
                      Profile
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      ))}
    </Screen>
  );
}
