"use client";
/**
 * Development › Environments (BUILD §6.3, §11.6 "preview deployment per branch"): one row per agent branch with its
 * latest preview deployment. Branches come from the tasks (`agent/<taskId>` for code tasks in flight or review) and
 * the open PRs; deployments arrive as `deploy.succeeded` business events (no persisted deployment list exists in
 * BUILD §8.3, so rows start as "Awaiting deployment" and fill in live).
 */
import { useMemo, useState } from "react";
import { Boxes, CircleStop, ExternalLink, GitBranch, GitMerge, Hourglass, MonitorPlay, Network, Radio } from "lucide-react";
import { DataTable, FitText, useAgentPersona, Panel, StatusPill, type DataTableColumn, type IconComponent, type RowAction, type SavedView, type StatusTone } from "@foundmill/dugout";
import type { TaskStatus } from "@foundmill/shared";
import { routes } from "@foundmill/widgets/shared/routes";
import { useBusinessEvents, useWidgetData, useWidgetQuery, type WidgetEvent } from "@foundmill/widgets/data";
import { useSavedViews } from "@foundmill/widgets/shared/saved-views";
import { RelativeDateText } from "../dates";
import { fitColumns, fitToGrow, humanise, type ColumnFit } from "../fit";
import type { ModuleScreenProps } from "../registry";
import { useDevScreenOptions } from "./options";
import { SIMPLE_VIEW_ID, Screen, agentBranch, shortSha, toDate, useAgentIndex, useAgents, useDefaultViewId, useDevDepartment } from "./shared";
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
  /** The git branch as it is (`agent/<taskId>`, `main`): the Branch cell's tooltip and the CSV. */
  branch: string;
  /** What the Branch cell shows: the task's title as a branch-style slug (see readableBranch). */
  branchName: string;
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

export const ENVIRONMENT_STATE_META: Record<EnvironmentState, { tone: StatusTone; word: string; icon: IconComponent }> = {
  live: { tone: "good", word: "Live", icon: Radio },
  awaiting: { tone: "info", word: "Awaiting deployment", icon: Hourglass },
  merged: { tone: "neutral", word: "Merged", icon: GitMerge },
  stopped: { tone: "neutral", word: "Stopped", icon: CircleStop },
};

export const ENVIRONMENT_LABELS: Record<Environment, string> = { preview: "Preview", staging: "Staging", production: "Production" };

/** Column minimums and how the extra width is shared (see fit.ts). */
export const ENVIRONMENT_FIT: Record<string, ColumnFit> = {
  branch: { min: 220, grow: 1 },
  title: { min: 280, grow: 4 },
  environment: { min: 112 },
  state: { min: 184 },
  agentName: { min: 168, grow: 1 },
  url: { min: 200, grow: 2 },
  provider: { min: 104 },
  commitSha: { min: 92 },
  deployedAt: { min: 104 },
};

/** Columns with no value on any row ("—" everywhere) are hidden, as the table does with `hideEmptyColumns`. */
export function emptyEnvironmentColumns(rows: readonly EnvironmentRow[]): Set<string> {
  const empty = new Set<string>();
  if (!rows.length) return empty;
  if (rows.every((r) => !r.url)) empty.add("url");
  if (rows.every((r) => !providerLabel(r.provider))) empty.add("provider");
  if (rows.every((r) => !r.commitSha)) empty.add("commitSha");
  if (rows.every((r) => !r.deployedAt)) empty.add("deployedAt");
  return empty;
}

export const ENVIRONMENT_VIEWS: SavedView[] = [
  // Simple (UX plan §7.10): the task, whether its preview is up, and where; it opens first while guidance is on.
  { id: SIMPLE_VIEW_ID, name: "Simple", builtIn: true, columns: ["title", "environment", "state", "url"], sort: [{ id: "deployedAt", desc: true }], filters: [] },
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

/** Small words a branch name leaves out. */
const BRANCH_STOP_WORDS = new Set(["a", "an", "the", "for", "of", "to", "and", "with", "on", "in", "at", "by", "from", "into", "via", "as", "or"]);
/** The longest readable branch name, in characters: it fits the Branch column at 1280 px without stepping down. */
export const BRANCH_NAME_MAX = 26;

/**
 * A readable name for an agent branch: `agent/<taskId>` says nothing to a reader, so the Branch column shows the task's
 * title as a branch-style slug, small words dropped, whole words up to BRANCH_NAME_MAX characters and a trailing number
 * always kept ("Fix invoice PDF 500 for customers with no address" → "fix-invoice-pdf-500", "Order webhook hardening
 * #10" → "order-webhook-hardening-10"). A branch with a name of its own (main, a PR's branch) keeps it, and so does a
 * title with no Latin letters or digits.
 */
export function readableBranch(branch: string, title: string | null | undefined): string {
  if (!title || !/^agent\/[0-9a-z-]{8,}$/i.test(branch)) return branch;
  const words = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['\u2019]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const kept = words.filter((w) => !BRANCH_STOP_WORDS.has(w));
  const pool = kept.length ? kept : words;
  const last = pool[pool.length - 1];
  const num = pool.length > 1 && last && /^\d+$/.test(last) ? last : null;
  const budget = BRANCH_NAME_MAX - (num ? num.length + 1 : 0);
  const picked: string[] = [];
  for (const w of num ? pool.slice(0, -1) : pool) {
    if (picked.length && [...picked, w].join("-").length > budget) break;
    picked.push(w);
  }
  if (num) picked.push(num);
  return picked.length ? picked.join("-") : branch;
}

/** Readable names stay unique: a name two branches share gets the first six characters of its task id ("…-7c9cb7"). */
function uniqueBranchNames(rows: EnvironmentRow[]): EnvironmentRow[] {
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(r.branchName, (seen.get(r.branchName) ?? 0) + 1);
  return rows.map((r) => ((seen.get(r.branchName) ?? 0) > 1 && r.branchName !== r.branch && r.taskId ? { ...r, branchName: `${r.branchName}-${r.taskId.replace(/-/g, "").slice(0, 6)}` } : r));
}

const BRANCH_STATUSES: readonly TaskStatus[] = ["running", "paused", "blocked", "review", "merging", "done", "stopped"];

/** Live first, then the ones waiting for a deployment, then the merged and stopped history. */
const STATE_RANK: Record<EnvironmentState, number> = { live: 0, awaiting: 1, merged: 2, stopped: 3 };

/** Hosting providers in their own spelling; the API sends keys ("vercel"), "unknown" when the event had none. */
const PROVIDER_LABELS: Record<string, string> = { vercel: "Vercel", netlify: "Netlify", railway: "Railway", render: "Render", fly: "Fly.io", cloudflare: "Cloudflare", aws: "AWS", gcp: "Google Cloud", azure: "Azure" };
export function providerLabel(provider: string | null | undefined): string | null {
  if (!provider || provider === "unknown") return null;
  return PROVIDER_LABELS[provider.toLowerCase()] ?? humanise(provider);
}

/**
 * Rows: one per code-task branch (plus any deployed branch without a task): newest deployment first, then live,
 * awaiting, merged and stopped, then by task title (numbers in order: "fix #2" before "fix #10").
 */
export function toEnvironmentRows(tasks: readonly TaskRow[], prs: PrsListResponse | undefined, deployments: readonly Deployment[], agents: Map<string, AgentRow>, nameFor: (agent: AgentRow) => string = (a) => a.name): EnvironmentRow[] {
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
    rows.set(branch, { id: branch, branch, branchName: readableBranch(branch, t.title), taskId: t.id, title: t.title, taskStatus: t.status, agentName: agent ? nameFor(agent) : "Unassigned", environment: d?.environment ?? "preview", state: stateFor(t.status, d), url: d?.url ?? null, provider: d?.provider ?? null, commitSha: d?.commitSha ?? null, deployedAt: d?.occurredAt ?? null });
  }
  for (const pr of prs?.open ?? []) {
    // A non-code task never has a branch to preview, whatever the API sends.
    if (rows.has(pr.branch) || (pr.kind !== undefined && pr.kind !== "code")) continue;
    const d = latest.get(pr.branch);
    const agent = pr.agentId ? agents.get(pr.agentId) : undefined;
    rows.set(pr.branch, { id: pr.branch, branch: pr.branch, branchName: readableBranch(pr.branch, pr.title), taskId: pr.taskId, title: pr.title, taskStatus: pr.status, agentName: agent ? nameFor(agent) : "Unassigned", environment: d?.environment ?? "preview", state: stateFor(pr.status, d), url: d?.url ?? null, provider: d?.provider ?? null, commitSha: d?.commitSha ?? null, deployedAt: d?.occurredAt ?? null });
  }
  for (const [key, d] of latest) {
    if (rows.has(key)) continue;
    const branch = d.branch ?? (d.environment === "preview" ? key : d.environment);
    rows.set(key, { id: key, branch, branchName: branch, taskId: d.taskId, title: d.environment === "preview" ? "Preview" : `${d.environment[0]?.toUpperCase()}${d.environment.slice(1)} release`, taskStatus: null, agentName: "—", environment: d.environment, state: d.url ? "live" : "awaiting", url: d.url, provider: d.provider, commitSha: d.commitSha, deployedAt: d.occurredAt });
  }
  return uniqueBranchNames([...rows.values()]).sort((a, b) => (b.deployedAt?.getTime() ?? 0) - (a.deployedAt?.getTime() ?? 0) || STATE_RANK[a.state] - STATE_RANK[b.state] || a.title.localeCompare(b.title, undefined, { numeric: true }) || a.branch.localeCompare(b.branch));
}

export function EnvironmentsScreen({ businessId, departmentId }: ModuleScreenProps) {
  const { navigate } = useWidgetData();
  const deptSlug = useDevDepartment(departmentId)?.slug ?? "development";
  const options = useDevScreenOptions();
  const tasks = useWidgetQuery<TasksListResponse>("dev.tasks.list", { kind: "code", limit: 500 });
  const prs = useWidgetQuery<PrsListResponse>("dev.prs.list", {});
  const agents = useAgents();
  const agentIndex = useAgentIndex(agents.data?.agents);
  // Agents named under the reader's preference, in the rows' name fields too (One name everywhere).
  const persona = useAgentPersona();
  // Saved per person, business and table (audit #204): they come back after a reload. Simple opens first while guidance is on.
  const defaultViewId = useDefaultViewId("all");
  const savedViews = useSavedViews("development.environments", ENVIRONMENT_VIEWS, { defaultViewId });
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  useBusinessEvents(
    (event) => {
      const d = deploymentFromEvent(event);
      if (d) setDeployments((prev) => [...prev, d]);
      if (event.type === "task.started" || event.type === "task.completed" || event.type === "pr.merged") tasks.refetch();
    },
    ["deploy.succeeded", "task.started", "task.completed", "pr.merged"],
  );

  const rows = useMemo(() => toEnvironmentRows(tasks.data?.items ?? [], prs.data, deployments, agentIndex, persona.labelFor), [tasks.data, prs.data, deployments, agentIndex, persona]);
  const optionNow = options.now;
  const now = useMemo(() => optionNow ?? new Date(), [optionNow]);
  // Each column at its minimum; the table shares the spare width by ENVIRONMENT_FIT's weights itself (`meta.grow`),
  // among the columns it shows (empty ones are hidden).
  const sizes = useMemo(() => fitColumns(null, ENVIRONMENT_FIT, []), []);

  const columns = useMemo<DataTableColumn<EnvironmentRow>[]>(
    () => fitToGrow<EnvironmentRow>([
      {
        // The readable name (the task's title as a slug); the git branch itself is in the tooltip and the CSV.
        id: "branch",
        accessorFn: (r) => r.branchName,
        header: "Branch",
        size: sizes.branch,
        meta: { locked: true, csv: (r) => r.branch, term: "branch" },
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-1.5 font-mono text-mono" title={row.original.branch === row.original.branchName ? undefined : `Branch ${row.original.branch}`} data-branch={row.original.branch}>
            <GitBranch size={12} aria-hidden className="shrink-0 text-tertiary" />
            {/* An identifier, not a figure: in the rare name too long even at 11 px it ends in an ellipsis with the tooltip. */}
            <span className="block min-w-0 flex-1 text-primary" data-allow-truncate="">
              <FitText minPx={11} tooltip={row.original.branch === row.original.branchName}>
                {row.original.branchName}
              </FitText>
            </span>
          </span>
        ),
      },
      {
        id: "title",
        accessorKey: "title",
        header: "Task",
        size: sizes.title,
        // Task titles carry numbers ("#318", "PDF 500"), which never truncate: they step down to 11 px to fit.
        cell: ({ row }) => (
          <span className="block min-w-0 text-body-strong" title={row.original.title}>
            <FitText minPx={11} tooltip={false}>
              {row.original.title}
            </FitText>
          </span>
        ),
      },
      { id: "environment", accessorKey: "environment", header: "Environment", size: sizes.environment, meta: { filter: "select", filterOptions: (Object.keys(ENVIRONMENT_LABELS) as Environment[]).map((e) => ({ value: e, label: ENVIRONMENT_LABELS[e] })), csv: (r) => ENVIRONMENT_LABELS[r.environment] }, cell: ({ row }) => <span className="text-secondary">{ENVIRONMENT_LABELS[row.original.environment] ?? humanise(row.original.environment)}</span> },
      {
        id: "state",
        accessorFn: (r) => ENVIRONMENT_STATE_META[r.state].word,
        header: "State",
        size: sizes.state,
        meta: { filter: "select", filterOptions: Object.values(ENVIRONMENT_STATE_META).map((m) => ({ value: m.word, label: m.word })) },
        cell: ({ row }) => {
          const meta = ENVIRONMENT_STATE_META[row.original.state];
          return (
            <StatusPill tone={meta.tone} icon={meta.icon}>
              {meta.word}
            </StatusPill>
          );
        },
      },
      { id: "agentName", accessorFn: (r) => (r.agentName === "—" ? "" : r.agentName), header: "Agent", size: sizes.agentName, cell: ({ row }) => (row.original.agentName === "—" ? <span className="text-tertiary">—</span> : <span className="block min-w-0 truncate">{row.original.agentName}</span>) },
      {
        id: "url",
        accessorKey: "url",
        header: "URL",
        size: sizes.url,
        meta: { filter: false },
        cell: ({ row }) =>
          row.original.url ? (
            <a href={row.original.url} target="_blank" rel="noreferrer" className="entity-link flex min-w-0 items-center gap-1">
              <MonitorPlay size={14} aria-hidden className="shrink-0" />
              <span className="min-w-0 truncate">{row.original.url.replace(/^https?:\/\//, "")}</span>
            </a>
          ) : (
            <span className="text-tertiary">—</span>
          ),
      },
      { id: "provider", accessorFn: (r) => providerLabel(r.provider) ?? "", header: "Provider", size: sizes.provider, cell: ({ row }) => (providerLabel(row.original.provider) ? <span className="text-secondary">{providerLabel(row.original.provider)}</span> : <span className="text-tertiary">—</span>) },
      { id: "commitSha", accessorFn: (r) => r.commitSha ?? "", header: "Commit", size: sizes.commitSha, cell: ({ row }) => <span className="font-mono text-mono text-secondary">{shortSha(row.original.commitSha) || "—"}</span> },
      { id: "deployedAt", accessorFn: (r) => r.deployedAt?.getTime() ?? null, header: "Deployed", size: sizes.deployedAt, meta: { filter: "date", label: "Deployed" }, cell: ({ row }) => (row.original.deployedAt ? <RelativeDateText className="text-secondary" value={row.original.deployedAt} now={now} /> : <span className="text-tertiary">Not yet</span>) },
    ], ENVIRONMENT_FIT),
    [now, sizes],
  );

  const rowActions = (row: EnvironmentRow): RowAction<EnvironmentRow>[] => [
    { id: "open", label: "Open preview", icon: ExternalLink, disabled: !row.url, onSelect: (r) => r.url && window.open(r.url, "_blank", "noopener") },
    { id: "task", label: "Show in Plan", icon: Network, disabled: !row.taskId, onSelect: (r) => r.taskId && navigate(`${routes.department(businessId, deptSlug, "plan")}?task=${r.taskId}`) },
  ];

  const live = rows.filter((r) => r.state === "live").length;
  const merged = rows.filter((r) => r.state === "merged").length;

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
        meta={
          rows.length ? (
            <span data-testid="env-counts">
              {live} live · {rows.length - live - merged} awaiting · {merged} merged
            </span>
          ) : undefined
        }
        footer={<span>Every agent branch gets its own preview deployment once it passes the quality checks; the URL, provider and commit appear with the first one. Production releases show on the Journey.</span>}
      >
        <div className="min-w-0">
          <DataTable<EnvironmentRow> data={rows} columns={columns} {...savedViews} defaultViewId={defaultViewId} rowActions={rowActions} onRowOpen={(r) => r.url && window.open(r.url, "_blank", "noopener")} height={Math.min(520, Math.max(4, rows.length) * 28 + 42)} hideEmptyColumns exportFileName="environments" empty={{ icon: Boxes, children: "Environments appear here as code tasks start: one preview deployment per agent branch.", action: { label: "Go to Plan", onClick: () => navigate(routes.department(businessId, deptSlug, "plan")) } }} aria-label="Environments" className="border-0" />
        </div>
      </Panel>
    </Screen>
  );
}
