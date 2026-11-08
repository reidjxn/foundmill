"use client";
/**
 * Development › Pull requests (BUILD §6.3, §11.6): open PRs (code tasks in review or the merge queue) from
 * `dev.prs.list` with their merge-queue status and preview links, and the merged PRs (GitHub's `pr.merged` events and
 * the code tasks the merge queue landed) in a second table.
 */
import { useMemo, useState } from "react";
import { ExternalLink, GitMerge, GitPullRequest, MonitorPlay, Network, SearchCheck } from "lucide-react";
import { Avatar, DataTable, EntityLink, useAgentPersona, Explainer, FitText, Panel, StatusPill, Term, formatNumber, type DataTableColumn, type RowAction, type SavedView, type StatusTone } from "@foundmill/dugout";
import type { TaskStatus } from "@foundmill/shared";
import { routes } from "@foundmill/widgets/shared/routes";
import { useBusinessEvents, useWidgetData, useWidgetQuery, type WidgetEvent } from "@foundmill/widgets/data";
import { useSavedViews } from "@foundmill/widgets/shared/saved-views";
import { RelativeDateText } from "../dates";
import { fitColumns, fitToGrow, humanise, type ColumnFit } from "../fit";
import type { ModuleScreenProps } from "../registry";
import { OpenInClaudeCodeDialog } from "./dialogs";
import { useDevScreenOptions } from "./options";
import { SIMPLE_VIEW_ID, Screen, agentHref, shortSha, toDate, toTileAgent, useAgentIndex, useAgents, useDefaultViewId, useDevDepartment } from "./shared";
import type { AgentRow, MergedPrRow, OpenPrRow, PrsListResponse } from "./types";

/** Merge-queue status of an open PR (BUILD §11.6: Review agent → preview → Integration agent merge queue). */
export const QUEUE_META: Partial<Record<TaskStatus, { tone: StatusTone; word: string; icon: typeof SearchCheck }>> = {
  review: { tone: "info", word: "In review", icon: SearchCheck },
  merging: { tone: "info", word: "In merge queue", icon: GitMerge },
};

export interface OpenPrTableRow extends OpenPrRow {
  id: string;
  agentName: string;
  agent: AgentRow | undefined;
  queue: string;
  previewUrl: string | null;
}

export interface MergedPrTableRow extends MergedPrRow {
  id: string;
  mergedAt: Date | null;
  mergedByName: string;
  prLabel: string;
}

export const OPEN_PR_VIEWS: SavedView[] = [
  // Simple (UX plan §7.10): what it is, where it stands, who wrote it and the preview; it opens first while guidance is on.
  { id: SIMPLE_VIEW_ID, name: "Simple", builtIn: true, columns: ["title", "queue", "agentName", "previewUrl"], sort: [], filters: [] },
  { id: "open", name: "Open", builtIn: true, columns: ["title", "queue", "agentName", "branch", "previewUrl"], sort: [], filters: [] },
  { id: "queue", name: "Merge queue", builtIn: true, columns: ["title", "agentName", "branch", "previewUrl"], sort: [], filters: [{ id: "f-queue", field: "status", op: "eq", value: "merging" }] },
  { id: "review", name: "In review", builtIn: true, columns: ["title", "agentName", "branch", "previewUrl"], sort: [], filters: [{ id: "f-review", field: "status", op: "eq", value: "review" }] },
];

export const MERGED_PR_VIEWS: SavedView[] = [
  { id: SIMPLE_VIEW_ID, name: "Simple", builtIn: true, columns: ["prLabel", "title", "mergedByName", "mergedAt"], sort: [{ id: "mergedAt", desc: true }], filters: [] },
  { id: "recent", name: "Recently merged", builtIn: true, columns: ["prLabel", "title", "branch", "mergedByName", "additions", "deletions", "sha", "mergedAt"], sort: [{ id: "mergedAt", desc: true }], filters: [] },
  { id: "by-agents", name: "Merged by agents", builtIn: true, columns: ["prLabel", "title", "branch", "mergedByName", "mergedAt"], sort: [{ id: "mergedAt", desc: true }], filters: [{ id: "f-agent", field: "mergedByName", op: "contains", value: "agent" }] },
];

/** Column minimums and how the extra width is shared (see fit.ts). */
export const OPEN_PR_FIT: Record<string, ColumnFit> = {
  title: { min: 260, grow: 4 },
  queue: { min: 156 },
  status: { min: 120 },
  agentName: { min: 180, grow: 2 },
  branch: { min: 220, grow: 1 },
  previewUrl: { min: 140 },
};
export const MERGED_PR_FIT: Record<string, ColumnFit> = {
  prLabel: { min: 72 },
  title: { min: 220, grow: 4 },
  branch: { min: 180, grow: 1 },
  mergedByName: { min: 150, grow: 1 },
  additions: { min: 76 },
  deletions: { min: 76 },
  sha: { min: 92 },
  mergedAt: { min: 104 },
};

/** An agent branch in mono: ids keep both ends when the column is narrow ("agent/0863…f1c2"). */
function BranchName({ branch }: { branch: string }) {
  return (
    <span className="block min-w-0 font-mono text-mono">
      <FitText minPx={12} truncate="middle">
        {branch}
      </FitText>
    </span>
  );
}

/** Preview URLs seen for a branch (`deploy.succeeded` events with environment "preview"). */
export function previewFromEvent(event: WidgetEvent): { branch: string | null; taskId: string | null; url: string | null } | null {
  if (event.type !== "deploy.succeeded") return null;
  const p = event.payload;
  if (p.environment !== "preview") return null;
  return { branch: typeof p.branch === "string" ? p.branch : null, taskId: typeof p.taskId === "string" ? p.taskId : null, url: typeof p.url === "string" ? p.url : null };
}

/** Only code tasks have a branch, so only they are pull requests (a finance or specialist task in review is not). */
export function isCodePr(pr: Pick<OpenPrRow, "kind">): boolean {
  return pr.kind === undefined || pr.kind === "code";
}

export function toOpenRows(open: readonly OpenPrRow[], agents: Map<string, AgentRow>, previews: Map<string, string>, nameFor: (agent: AgentRow) => string = (a) => a.name): OpenPrTableRow[] {
  // `nameFor` names the agent as the cell shows it (the persona label under the reader's preference), so sort, filter and
  // CSV match what is shown (One name everywhere, Nov 8, 2026).
  return open.filter(isCodePr).map((pr) => {
    const agent = pr.agentId ? agents.get(pr.agentId) : undefined;
    // The founder's title (0070) is what the row shows; the technical one stays on the row for the developer's dialog.
    return { ...pr, id: pr.taskId, title: pr.founderTitle ?? pr.title, agent, agentName: agent ? nameFor(agent) : pr.agentId ? "Agent" : "Unassigned", queue: QUEUE_META[pr.status]?.word ?? pr.status, previewUrl: previews.get(pr.branch) ?? previews.get(pr.taskId) ?? null };
  });
}

/** Who merged, in words, when the event carries a kind but no name. */
const MERGED_BY_KIND: Record<string, string> = { user: "A staff member", agent: "An agent", system: "Automatic merge", webhook: "Merged on GitHub" };

/**
 * Merged rows: GitHub's `pr.merged` events and the merges the merge queue landed itself (done code tasks, no event).
 * An agent who merged is named from the team; a queue merge has no PR number, line counts or commit to show.
 */
export function toMergedRows(merged: readonly MergedPrRow[], agents: Map<string, AgentRow> = new Map(), nameFor: (agent: AgentRow) => string = (a) => a.name): MergedPrTableRow[] {
  return merged.map((m) => {
    const merger = m.mergedBy?.kind === "agent" && m.mergedBy.id ? agents.get(m.mergedBy.id) : undefined;
    const agentName = merger ? nameFor(merger) : undefined;
    return {
      ...m,
      id: m.eventId ?? `task:${m.taskId ?? m.occurredAt}`,
      mergedAt: toDate(m.occurredAt),
      mergedByName: m.mergedBy?.name ?? agentName ?? (m.mergedBy?.kind ? (MERGED_BY_KIND[m.mergedBy.kind] ?? humanise(m.mergedBy.kind)) : "GitHub"),
      prLabel: m.prNumber ? `#${m.prNumber}` : m.source === "merge_queue" || !m.eventId ? "—" : m.eventId.slice(0, 8),
    };
  });
}

/** What a pull request is, for a first-timer, under the title while guidance is on (UX plan §7.12). */
export const PULL_REQUESTS_LEDE = "A bundle of finished code waiting for review.";
/** The tab's intro while guidance is on: the lede, what to do, what to watch for (the Explainer, UX plan §6.2). */
export const PULL_REQUESTS_EXPLAINER = {
  screenId: "development/pull-requests",
  purpose: PULL_REQUESTS_LEDE,
  action: "Open the preview to try the change; when it passes the quality checks, your Inbox asks whether to put it live.",
  watchFor: "Nothing goes live until you say so, whatever the business mode.",
} as const;

export function PullRequestsScreen({ businessId, departmentId }: ModuleScreenProps) {
  const { navigate } = useWidgetData();
  const deptSlug = useDevDepartment(departmentId)?.slug ?? "development";
  const planHref = (taskId: string) => `${routes.department(businessId, deptSlug, "plan")}?task=${taskId}`;
  // Each column at its minimum; the tables share their spare width by the specs' weights themselves (`meta.grow`).
  const openSizes = useMemo(() => fitColumns(null, OPEN_PR_FIT, []), []);
  const mergedSizes = useMemo(() => fitColumns(null, MERGED_PR_FIT, []), []);
  const options = useDevScreenOptions();
  const prs = useWidgetQuery<PrsListResponse>("dev.prs.list", {});
  const agents = useAgents();
  const agentIndex = useAgentIndex(agents.data?.agents);
  // Agents named under the reader's preference, in the rows' name fields too (One name everywhere).
  const persona = useAgentPersona();
  // Saved per person, business and table (audit #204): they come back after a reload. Simple opens first while guidance is on.
  const openDefaultViewId = useDefaultViewId("open");
  const mergedDefaultViewId = useDefaultViewId("recent");
  const openSavedViews = useSavedViews("development.pull-requests.open", OPEN_PR_VIEWS, { defaultViewId: openDefaultViewId });
  const mergedSavedViews = useSavedViews("development.pull-requests.merged", MERGED_PR_VIEWS, { defaultViewId: mergedDefaultViewId });
  const [previews, setPreviews] = useState<Map<string, string>>(() => new Map());
  const [claudeCode, setClaudeCode] = useState<OpenPrTableRow | null>(null);
  useBusinessEvents(
    (event) => {
      if (event.type === "pr.merged" || event.type === "task.completed") prs.refetch();
      const preview = previewFromEvent(event);
      if (preview?.url) {
        setPreviews((prev) => {
          const next = new Map(prev);
          if (preview.branch) next.set(preview.branch, preview.url as string);
          if (preview.taskId) next.set(preview.taskId, preview.url as string);
          return next;
        });
      }
    },
    ["pr.merged", "task.completed", "deploy.succeeded"],
  );

  const openRows = useMemo(() => toOpenRows(prs.data?.open ?? [], agentIndex, previews, persona.labelFor), [prs.data, agentIndex, previews, persona]);
  const mergedRows = useMemo(() => toMergedRows(prs.data?.merged ?? [], agentIndex, persona.labelFor), [prs.data, agentIndex, persona]);
  const optionNow = options.now;
  const now = useMemo(() => optionNow ?? new Date(), [optionNow]);

  const openColumns = useMemo<DataTableColumn<OpenPrTableRow>[]>(
    () => fitToGrow<OpenPrTableRow>([
      { id: "title", accessorKey: "title", header: "Pull request", size: openSizes.title, meta: { locked: true }, cell: ({ row }) => <span className="block min-w-0 truncate text-body-strong" title={row.original.title}>{row.original.title}</span> },
      {
        id: "queue",
        accessorKey: "queue",
        header: "Merge queue",
        size: openSizes.queue,
        meta: { filter: "select", filterOptions: [{ value: "In review", label: "In review" }, { value: "In merge queue", label: "In merge queue" }] },
        cell: ({ row }) => {
          const meta = QUEUE_META[row.original.status];
          return meta ? (
            <StatusPill tone={meta.tone} icon={meta.icon}>
              {meta.word}
            </StatusPill>
          ) : (
            <StatusPill tone="neutral">{humanise(row.original.status)}</StatusPill>
          );
        },
      },
      { id: "status", accessorKey: "status", header: "Status", size: openSizes.status, meta: { filter: "select", filterOptions: [{ value: "review", label: "In review" }, { value: "merging", label: "In merge queue" }] }, cell: ({ row }) => <span className="text-secondary">{QUEUE_META[row.original.status]?.word ?? humanise(row.original.status)}</span> },
      {
        id: "agentName",
        accessorKey: "agentName",
        header: "Agent",
        size: openSizes.agentName,
        cell: ({ row }) => {
          const a = row.original.agent;
          if (!a) return <span className="text-secondary">{row.original.agentName}</span>;
          const tile = toTileAgent(a, a.id);
          return (
            <span className="flex min-w-0 items-center gap-1.5">
              <Avatar size={20} name={a.name} agent={{ seed: tile.seed, dept: tile.dept, personaKey: tile.personaKey, layer: a.layer }} status={a.status} />
              <EntityLink entity={{ id: a.id, kind: "agent", name: a.name, href: agentHref(businessId, a.id) }} display={row.original.agentName} hideIcon hoverCard={false} className="min-w-0 truncate" />
            </span>
          );
        },
      },
      // Branch, PR number, lines and commit are Builder view's (`meta.builderOnly`): off, the tables have none of them.
      { id: "branch", accessorKey: "branch", header: "Branch", size: openSizes.branch, cell: ({ row }) => <BranchName branch={row.original.branch} />, meta: { term: "branch", builderOnly: true } },
      {
        id: "previewUrl",
        accessorKey: "previewUrl",
        header: "Preview",
        size: openSizes.previewUrl,
        meta: { filter: false },
        cell: ({ row }) =>
          row.original.previewUrl ? (
            <a href={row.original.previewUrl} target="_blank" rel="noreferrer" className="entity-link inline-flex items-center gap-1">
              <MonitorPlay size={14} aria-hidden /> Open preview
            </a>
          ) : (
            // No preview has been reported for this branch (deployments are live `deploy.succeeded` events): say so in
            // the Environments tab's words, never that something is deploying.
            <span className="text-secondary">Awaiting deployment</span>
          ),
      },
    ], OPEN_PR_FIT),
    [businessId, openSizes],
  );

  const mergedColumns = useMemo<DataTableColumn<MergedPrTableRow>[]>(
    () => fitToGrow<MergedPrTableRow>([
      { id: "prLabel", accessorKey: "prLabel", header: "PR", size: mergedSizes.prLabel, meta: { locked: true, builderOnly: true }, cell: ({ row }) => (row.original.url ? <a href={row.original.url} target="_blank" rel="noreferrer" className="entity-link font-mono text-mono">{row.original.prLabel}</a> : <span className="font-mono text-mono">{row.original.prLabel}</span>) },
      { id: "title", accessorKey: "title", header: "Title", size: mergedSizes.title, cell: ({ row }) => <span className="block min-w-0 truncate text-body-strong" title={row.original.title ?? undefined}>{row.original.title ?? "—"}</span> },
      { id: "branch", accessorKey: "branch", header: "Branch", size: mergedSizes.branch, cell: ({ row }) => (row.original.branch ? <BranchName branch={row.original.branch} /> : <span className="text-tertiary">—</span>), meta: { term: "branch", builderOnly: true } },
      { id: "mergedByName", accessorKey: "mergedByName", header: "Merged by", size: mergedSizes.mergedByName },
      { id: "additions", accessorKey: "additions", header: "Added", size: mergedSizes.additions, meta: { numeric: true, label: "Lines added", builderOnly: true }, cell: ({ row }) => (row.original.additions === undefined ? <span className="text-tertiary">—</span> : <span className="text-status-good tabular-nums">+{formatNumber(row.original.additions)}</span>) },
      { id: "deletions", accessorKey: "deletions", header: "Removed", size: mergedSizes.deletions, meta: { numeric: true, label: "Lines removed", builderOnly: true }, cell: ({ row }) => (row.original.deletions === undefined ? <span className="text-tertiary">—</span> : <span className="text-status-bad tabular-nums">−{formatNumber(row.original.deletions)}</span>) },
      { id: "sha", accessorKey: "mergeCommitSha", header: "Commit", size: mergedSizes.sha, meta: { builderOnly: true }, cell: ({ row }) => <span className="font-mono text-mono text-secondary">{shortSha(row.original.mergeCommitSha) || "—"}</span> },
      { id: "mergedAt", accessorFn: (r) => r.mergedAt?.getTime() ?? 0, header: "Merged", size: mergedSizes.mergedAt, meta: { filter: "date", label: "Merged" }, cell: ({ row }) => (row.original.mergedAt ? <RelativeDateText className="text-secondary" value={row.original.mergedAt} now={now} /> : <span className="text-tertiary">—</span>) },
    ], MERGED_PR_FIT),
    [now, mergedSizes],
  );

  const openActions = (row: OpenPrTableRow): RowAction<OpenPrTableRow>[] => [
    { id: "preview", label: "Open preview", icon: MonitorPlay, disabled: !row.previewUrl, onSelect: (r) => r.previewUrl && window.open(r.previewUrl, "_blank", "noopener") },
    { id: "task", label: "Show in Plan", icon: Network, onSelect: (r) => navigate(planHref(r.taskId)) },
    { id: "claude", label: "Open in Claude Code", icon: ExternalLink, onSelect: (r) => setClaudeCode(r), separatorBefore: true },
  ];

  const mergedActions = (row: MergedPrTableRow): RowAction<MergedPrTableRow>[] => [
    { id: "github", label: "Open on GitHub", icon: ExternalLink, disabled: !row.url, onSelect: (r) => r.url && window.open(r.url, "_blank", "noopener") },
    { id: "task", label: "Show in Plan", icon: Network, disabled: !row.taskId, onSelect: (r) => r.taskId && navigate(planHref(r.taskId)) },
  ];

  return (
    <Screen name="development/pull-requests">
      <Panel
        span={12}
        title={<Term id="pull_request">Open pull requests</Term>}
        flush
        loading={prs.isLoading}
        error={prs.error ? prs.error.message : undefined}
        onRetry={prs.refetch}
        meta={
          <span data-testid="pr-counts">
            {openRows.filter((r) => r.status === "review").length} in review · {openRows.filter((r) => r.status === "merging").length} in the merge queue
          </span>
        }
        footer={<span>Nothing goes live until you say so: when an agent's change passes the quality checks, you get one decision in your Inbox, whatever the business mode.</span>}
      >
        {/* What a pull request is, in the tab's intro while guidance is on (UX plan §7.12). */}
        <Explainer {...PULL_REQUESTS_EXPLAINER} className="m-panel-pad mb-2" />
        <div className="min-w-0">
          <DataTable<OpenPrTableRow> data={openRows} columns={openColumns} {...openSavedViews} defaultViewId={openDefaultViewId} rowActions={openActions} onRowOpen={(r) => navigate(planHref(r.taskId))} height={Math.min(320, Math.max(3, openRows.length) * 28 + 42)} exportFileName="open-pull-requests" empty={{ icon: GitPullRequest, children: "Pull requests appear here when an agent's task passes its acceptance tests and enters review.", action: { label: "Go to Plan", onClick: () => navigate(routes.department(businessId, deptSlug, "plan")) } }} aria-label="Open pull requests" className="border-0" />
        </div>
      </Panel>

      <Panel span={12} title="Merged" flush loading={prs.isLoading} error={prs.error ? prs.error.message : undefined} onRetry={prs.refetch} meta={mergedRows.length ? <span>{mergedRows.length} merged</span> : undefined}>
        <div className="min-w-0">
          <DataTable<MergedPrTableRow> data={mergedRows} columns={mergedColumns} {...mergedSavedViews} defaultViewId={mergedDefaultViewId} rowActions={mergedActions} height={mergedRows.length ? 360 : 240} exportFileName="merged-pull-requests" empty={{ icon: GitMerge, children: "Merged pull requests are listed here as the merge queue lands them.", action: openRows.length ? { label: "Go to Plan", onClick: () => navigate(routes.department(businessId, deptSlug, "plan")) } : undefined }} aria-label="Merged pull requests" className="border-0" />
        </div>
      </Panel>

      <OpenInClaudeCodeDialog taskId={claudeCode?.taskId ?? null} taskTitle={claudeCode?.title} onOpenChange={(o) => !o && setClaudeCode(null)} />
    </Screen>
  );
}
