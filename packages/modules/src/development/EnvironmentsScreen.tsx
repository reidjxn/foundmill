"use client";
/**
 * Development › Environments (BUILD §6.3, §11.6 "preview deployment per branch"): one row per agent branch with its
 * latest preview deployment. Branches come from the tasks (`agent/<taskId>` for code tasks in flight or review) and
 * the open PRs; deployments arrive as `deploy.succeeded` business events (no persisted deployment list exists in
 * BUILD §8.3, so rows start as "Awaiting deployment" and fill in live).
 */
import { useMemo, useState } from "react";
import { Boxes, ExternalLink, MonitorPlay, Network } from "lucide-react";
import { DataTable, Panel, StatusPill, formatDate, formatRelative, type DataTableColumn, type RowAction, type SavedView, type StatusTone } from "@foundmill/dugout";
import type { TaskStatus } from "@foundmill/shared";
import { routes, useBusinessEvents, useWidgetData, useWidgetQuery, type WidgetEvent } from "@foundmill/widgets";
import type { ModuleScreenProps } from "../registry";
import { useDevScreenOptions } from "./options";
import { Screen, agentBranch, shortSha, toDate, useAgentIndex, useAgents } from "./shared";
import type { AgentRow, PrsListResponse, TaskRow, TasksListResponse } from "./types";

export type Environment = "preview" | "staging" | "production";

export interface Deployment {
  branch: string | null;
  taskId: string | null;
  environment: Environment;
  provider: string;
  url: string | null;
  commitSha: string;
  occurredAt: Date;
}

export type EnvironmentState = "live" | "awaiting" | "merged" | "stopped";

export interface EnvironmentRow {
  id: string;
  branch: string;
  taskId: string | null;
  title: string;
  taskStatus: TaskStatus | null;
  agentName: string;
  environment: Environment;
  state: EnvironmentState;
  url: string | null;
  provider: string | null;
  commitSha: string | null;
  deployedAt: Date | null;
}

export const ENVIRONMENT_STATE_META: Record<EnvironmentState, { tone: StatusTone; word: string }> = {
  live: { tone: "good", word: "Live" },
  awaiting: { tone: "info", word: "Awaiting deployment" },
  merged: { tone: "neutral", word: "Merged" },
  stopped: { tone: "neutral", word: "Stopped" },
};

export const ENVIRONMENT_VIEWS: SavedView[] = [
  { id: "all", name: "All environments", builtIn: true, columns: ["branch", "title", "environment", "state", "agentName", "url", "provider", "commitSha", "deployedAt"], sort: [{ id: "deployedAt", desc: true }], filters: [] },
  { id: "live", name: "Live previews", builtIn: true, columns: ["branch", "title", "agentName", "url", "deployedAt"], sort: [{ id: "deployedAt", desc: true }], filters: [{ id: "f-live", field: "state", op: "eq", value: "Live" }] },
  { id: "awaiting", name: "Awaiting deployment", builtIn: true, columns: ["branch", "title", "agentName"], sort: [], filters: [{ id: "f-await", field: "state", op: "eq", value: "Awaiting deployment" }] },
  { id: "releases", name: "Releases", builtIn: true, columns: ["environment", "url", "commitSha", "deployedAt"], sort: [{ id: "deployedAt", desc: true }], filters: [{ id: "f-rel", field: "environment", op: "in", value: ["staging", "production"] }] },
];

export function deploymentFromEvent(event: WidgetEvent): Deployment | null {
  if (event.type !== "deploy.succeeded") return null;
  const p = event.payload;
  const environment = p.environment === "preview" || p.environment === "staging" || p.environment === "production" ? p.environment : null;
  if (!environment || typeof p.commitSha !== "string") return null;
  return {
    branch: typeof p.branch === "string" ? p.branch : null,
    taskId: typeof p.taskId === "string" ? p.taskId : null,
    environment,
    provider: typeof p.provider === "string" ? p.provider : "unknown",
    url: typeof p.url === "string" ? p.url : null,
    commitSha: p.commitSha,
    occurredAt: toDate(event.occurredAt) ?? new Date(),
  };
}

const BRANCH_STATUSES: readonly TaskStatus[] = ["running", "paused", "blocked", "review", "merging", "done", "stopped"];

/** Rows: one per code-task branch (plus any deployed branch without a task), newest deployment first. */
export function toEnvironmentRows(tasks: readonly TaskRow[], prs: PrsListResponse | undefined, deployments: readonly Deployment[], agents: Map<string, AgentRow>): EnvironmentRow[] {
  const latest = new Map<string, Deployment>();
  for (const d of deployments) {
    const key = d.branch ?? (d.taskId ? agentBranch(d.taskId) : `${d.environment}`);
    const prev = latest.get(key);
    if (!prev || d.occurredAt.getTime() >= prev.occurredAt.getTime()) latest.set(key, d);
  }
  const rows = new Map<string, EnvironmentRow>();
  const stateFor = (status: TaskStatus | null, d: Deployment | undefined): EnvironmentState => {
    if (status === "done") return "merged";
    if (status === "stopped" || status === "failed") return "stopped";
    return d?.url ? "live" : "awaiting";
  };
  for (const t of tasks) {
    if (t.kind !== "code" || !BRANCH_STATUSES.includes(t.status)) continue;
    const branch = agentBranch(t.id);
    const d = latest.get(branch) ?? latest.get(agentBranch(t.id));
    const agent = t.assigneeAgentId ? agents.get(t.assigneeAgentId) : undefined;
    rows.set(branch, { id: branch, branch, taskId: t.id, title: t.title, taskStatus: t.status, agentName: agent?.name ?? "Unassigned", environment: d?.environment ?? "preview", state: stateFor(t.status, d), url: d?.url ?? null, provider: d?.provider ?? null, commitSha: d?.commitSha ?? null, deployedAt: d?.occurredAt ?? null });
  }
  for (const pr of prs?.open ?? []) {
    if (rows.has(pr.branch)) continue;
    const d = latest.get(pr.branch);
    const agent = pr.agentId ? agents.get(pr.agentId) : undefined;
    rows.set(pr.branch, { id: pr.branch, branch: pr.branch, taskId: pr.taskId, title: pr.title, taskStatus: pr.status, agentName: agent?.name ?? "Unassigned", environment: d?.environment ?? "preview", state: stateFor(pr.status, d), url: d?.url ?? null, provider: d?.provider ?? null, commitSha: d?.commitSha ?? null, deployedAt: d?.occurredAt ?? null });
  }
  for (const [key, d] of latest) {
    if (rows.has(key)) continue;
    rows.set(key, { id: key, branch: d.branch ?? (d.environment === "preview" ? key : d.environment), taskId: d.taskId, title: d.environment === "preview" ? "Preview" : `${d.environment[0]?.toUpperCase()}${d.environment.slice(1)} release`, taskStatus: null, agentName: "—", environment: d.environment, state: d.url ? "live" : "awaiting", url: d.url, provider: d.provider, commitSha: d.commitSha, deployedAt: d.occurredAt });
  }
  return [...rows.values()].sort((a, b) => (b.deployedAt?.getTime() ?? 0) - (a.deployedAt?.getTime() ?? 0) || a.branch.localeCompare(b.branch));
}

export function EnvironmentsScreen({ businessId }: ModuleScreenProps) {
  const { navigate } = useWidgetData();
  const options = useDevScreenOptions();
  const tasks = useWidgetQuery<TasksListResponse>("dev.tasks.list", { kind: "code", limit: 500 });
  const prs = useWidgetQuery<PrsListResponse>("dev.prs.list", {});
  const agents = useAgents();
  const agentIndex = useAgentIndex(agents.data?.agents);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  useBusinessEvents(
    (event) => {
      const d = deploymentFromEvent(event);
      if (d) setDeployments((prev) => [...prev, d]);
      if (event.type === "task.started" || event.type === "task.completed" || event.type === "pr.merged") tasks.refetch();
    },
    ["deploy.succeeded", "task.started", "task.completed", "pr.merged"],
  );

  const rows = useMemo(() => toEnvironmentRows(tasks.data?.items ?? [], prs.data, deployments, agentIndex), [tasks.data, prs.data, deployments, agentIndex]);
  const optionNow = options.now;
  const now = useMemo(() => optionNow ?? new Date(), [optionNow]);

  const columns = useMemo<DataTableColumn<EnvironmentRow>[]>(
    () => [
      { id: "branch", accessorKey: "branch", header: "Branch", meta: { locked: true }, cell: ({ row }) => <span className="font-mono text-mono">{row.original.branch}</span> },
      { id: "title", accessorKey: "title", header: "Task", cell: ({ row }) => <span className="truncate text-body-strong">{row.original.title}</span> },
      { id: "environment", accessorKey: "environment", header: "Environment", meta: { filter: "select", filterOptions: [{ value: "preview", label: "preview" }, { value: "staging", label: "staging" }, { value: "production", label: "production" }] } },
      {
        id: "state",
        accessorFn: (r) => ENVIRONMENT_STATE_META[r.state].word,
        header: "State",
        meta: { filter: "select", filterOptions: Object.values(ENVIRONMENT_STATE_META).map((m) => ({ value: m.word, label: m.word })) },
        cell: ({ row }) => <StatusPill tone={ENVIRONMENT_STATE_META[row.original.state].tone}>{ENVIRONMENT_STATE_META[row.original.state].word}</StatusPill>,
      },
      { id: "agentName", accessorKey: "agentName", header: "Agent" },
      {
        id: "url",
        accessorKey: "url",
        header: "URL",
        meta: { filter: false },
        cell: ({ row }) =>
          row.original.url ? (
            <a href={row.original.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 truncate text-link hover:underline">
              <MonitorPlay size={14} /> {row.original.url.replace(/^https?:\/\//, "")}
            </a>
          ) : (
            <span className="text-secondary">—</span>
          ),
      },
      { id: "provider", accessorKey: "provider", header: "Provider", cell: ({ row }) => row.original.provider ?? <span className="text-secondary">—</span> },
      { id: "commitSha", accessorKey: "commitSha", header: "Commit", cell: ({ row }) => <span className="font-mono text-mono text-secondary">{shortSha(row.original.commitSha) || "—"}</span> },
      { id: "deployedAt", accessorFn: (r) => r.deployedAt?.getTime() ?? 0, header: "Deployed", meta: { filter: "date", label: "Deployed" }, cell: ({ row }) => (row.original.deployedAt ? <span title={formatDate(row.original.deployedAt)}>{formatRelative(row.original.deployedAt, now)}</span> : <span className="text-secondary">Not yet</span>) },
    ],
    [now],
  );

  const rowActions = (row: EnvironmentRow): RowAction<EnvironmentRow>[] => [
    { id: "open", label: "Open preview", icon: ExternalLink, disabled: !row.url, onSelect: (r) => r.url && window.open(r.url, "_blank", "noopener") },
    { id: "task", label: "Show in Plan", icon: Network, disabled: !row.taskId, onSelect: (r) => r.taskId && navigate(`${routes.department(businessId, "development", "plan")}?task=${r.taskId}`) },
  ];

  const live = rows.filter((r) => r.state === "live").length;

  return (
    <Screen name="development/environments">
      <Panel
        span={12}
        title="Preview deployments"
        flush
        loading={tasks.isLoading || (prs.isLoading && !prs.data)}
        error={tasks.error ? tasks.error.message : prs.error ? prs.error.message : undefined}
        onRetry={() => {
          tasks.refetch();
          prs.refetch();
        }}
        actions={
          <span className="text-small text-secondary tabular-nums" data-testid="env-counts">
            {live} live · {rows.length - live} without a deployment
          </span>
        }
        footer={<span>Every agent branch gets its own preview deployment once its tests pass; production releases show on the Journey Ribbon.</span>}
      >
        <DataTable<EnvironmentRow> data={rows} columns={columns} views={ENVIRONMENT_VIEWS} defaultViewId="all" rowActions={rowActions} onRowOpen={(r) => r.url && window.open(r.url, "_blank", "noopener")} height={520} exportFileName="environments" empty={{ icon: Boxes, children: "Environments appear here as code tasks start: one preview deployment per agent branch." }} aria-label="Environments" />
      </Panel>
    </Screen>
  );
}
