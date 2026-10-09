"use client";
/**
 * Team › Health (BUILD §6.3, §9.10, §11.9): a status board grouped by health, the ones that need the founder first
 * (failing, down, degraded, paused, idle, healthy). "Down" shows the expected return once the integration is
 * reconnected. Live: `agent.health_changed` moves an agent between groups within 2 s (AC-11.9.1).
 */
import { useMemo } from "react";
import { Activity, ExternalLink, HeartPulse, UserRoundPlus } from "lucide-react";
import { Avatar, Button, Chip, EntityLink, Panel, StatusStrip, cn, formatPercent, formatRelative, healthSummary, type HealthDetails, type MetricTileProps } from "@foundmill/dugout";
import { AGENT_STATUSES, type AgentStatus } from "@foundmill/shared";
import { departmentForModule, routes, useDepartments, useWidgetData } from "@foundmill/widgets";
import type { ModuleScreenProps } from "../registry";
import { AgentStatusWordPill, STATUS_DESCRIPTION, STATUS_ORDER, STATUS_WORD, Screen, agentDept, agentEntity, agentHref, taskHref, toIso, useAgents, useLiveAgentStatus, useNow, useTeamOptions, withLiveStatus } from "./shared";
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

const TONE_CLASS: Record<AgentStatus, string> = { failing: "text-status-bad", injured: "text-status-bad", degraded: "text-status-warn", paused: "text-secondary", idle: "text-secondary", healthy: "text-status-good" };

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

  const tiles: MetricTileProps[] = AGENT_STATUSES.map((status) => ({
    label: STATUS_WORD[status],
    value: agents.filter((a) => a.status === status).length,
    format: "integer",
    caption: status === "injured" ? "Expected back once reconnected" : undefined,
  }));

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
          <span className={cn("text-small tabular-nums", needsYou ? "text-status-warn" : "text-secondary")} data-testid="health-summary">
            {needsYou ? `${needsYou} ${needsYou === 1 ? "agent needs" : "agents need"} you` : agents.length ? "Everyone is working" : "No agents yet"}
          </span>
        }
        footer="Computed every minute: heartbeat, error rate over 24 h (above 10 % is degraded), loop detection (failing), credential status (down with an expected return), rate limits and budget."
      >
        <StatusStrip tiles={tiles} className="rounded-none border-0" aria-label="Agents by health" />
      </Panel>

      {!loading && !error && agents.length === 0 ? (
        <Panel span={12} title="Team" empty={{ icon: HeartPulse, title: "No agents to watch", children: "Each agent appears here under its health with heartbeat, error rate and, when down, the expected return.", action: { label: "Go to Recruitment", icon: UserRoundPlus, onClick: () => navigate(recruitHref) } }} />
      ) : null}

      {groups.map((group) => (
        <Panel key={group.status} span={12} title={`${group.word} · ${group.agents.length}`} data-health-group={group.status} actions={<span className="text-small text-secondary">{group.description}</span>}>
          <ul className="grid grid-cols-3 gap-gutter" aria-label={`${group.word} agents`}>
            {group.agents.map((agent) => {
              const details = healthDetails(agent);
              const summary = healthSummary(agent.status, details, now);
              const back = details.expectedReturnAt;
              return (
                <li key={agent.id} data-agent-id={agent.id} className="flex flex-col gap-2 rounded-panel border border-subtle bg-panel-alt p-panel-pad">
                  <div className="flex items-center gap-2">
                    <Avatar size={32} name={agent.name} agent={{ seed: agent.avatarSeed || agent.id, dept: agentDept(agent) }} status={agent.status} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <EntityLink entity={{ id: agent.id, kind: "agent", name: agent.name, href: agentHref(businessId, agent.id) }} details={agentEntity(businessId, agent, currency)} hideIcon className="text-body-strong" onOpen={(e) => e.href && navigate(e.href)} onVerb={(verb, e) => verb === "open_profile" && e.href && navigate(e.href)} />
                      <span className="truncate text-small text-secondary">{agent.role ?? agent.agentType ?? "Agent"}</span>
                    </span>
                    <AgentStatusWordPill status={agent.status} expectedReturnAt={back} now={now} />
                  </div>
                  <p className={cn("flex items-start gap-1 text-small", TONE_CLASS[agent.status])}>
                    <Activity size={14} className="mt-0.5 shrink-0" aria-hidden />
                    <span>{summary || (agent.status === "healthy" ? "Heartbeat on time, errors low." : STATUS_DESCRIPTION[agent.status])}</span>
                  </p>
                  <dl className="grid grid-cols-3 gap-x-2 text-small">
                    <dt className="t-label">Heartbeat</dt>
                    <dt className="t-label">Errors 24 h</dt>
                    <dt className="t-label">Task</dt>
                    <dd className="truncate text-primary tabular-nums">{details.lastHeartbeatAt ? formatRelative(details.lastHeartbeatAt, now) : "—"}</dd>
                    <dd className="truncate text-primary tabular-nums">{typeof details.errorRate === "number" ? formatPercent(details.errorRate, { digits: 1 }) : "—"}</dd>
                    <dd className="truncate">
                      {agent.currentTask ? (
                        <a href={taskHref(businessId, agent.currentTask.id)} className="entity-link" onClick={(e) => { e.preventDefault(); navigate(taskHref(businessId, agent.currentTask!.id)); }}>
                          {agent.currentTask.title}
                        </a>
                      ) : (
                        <span className="text-secondary">None</span>
                      )}
                    </dd>
                  </dl>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex flex-wrap gap-1">
                      {(agent.departments ?? []).map((d) => (
                        <Chip key={d.id} tone={d.colourToken}>
                          {d.name}
                        </Chip>
                      ))}
                      {details.loopDetected ? <Chip tone="warn">Loop</Chip> : null}
                    </span>
                    <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => navigate(agentHref(businessId, agent.id))} aria-label={`Open ${agent.name}'s profile`}>
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
