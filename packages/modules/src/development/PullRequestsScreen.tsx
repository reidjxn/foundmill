"use client";
/**
 * Development › Pull requests (BUILD §6.3, §11.6): open PRs from `dev.prs.list` with their merge-queue status and
 * preview links, and the merged PRs (`pr.merged` events) in a second table.
 */
import { useMemo, useState } from "react";
import { ExternalLink, GitMerge, GitPullRequest, MonitorPlay, Network, SearchCheck } from "lucide-react";
import { Avatar, DataTable, EntityLink, Panel, StatusPill, formatDate, formatNumber, formatRelative, type DataTableColumn, type RowAction, type SavedView, type StatusTone } from "@foundmill/dugout";
import type { TaskStatus } from "@foundmill/shared";
import { routes } from "@foundmill/widgets/shared/routes";
import { useBusinessEvents, useWidgetData, useWidgetQuery, type WidgetEvent } from "@foundmill/widgets/data";
import type { ModuleScreenProps } from "../registry";
import { OpenInClaudeCodeDialog } from "./dialogs";
import { useDevScreenOptions } from "./options";
import { Screen, agentHref, shortSha, toDate, toTileAgent, useAgentIndex, useAgents } from "./shared";
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
  { id: "open", name: "Open", builtIn: true, columns: ["title", "queue", "agentName", "branch", "previewUrl"], sort: [], filters: [] },
  { id: "queue", name: "Merge queue", builtIn: true, columns: ["title", "agentName", "branch", "previewUrl"], sort: [], filters: [{ id: "f-queue", field: "status", op: "eq", value: "merging" }] },
  { id: "review", name: "In review", builtIn: true, columns: ["title", "agentName", "branch", "previewUrl"], sort: [], filters: [{ id: "f-review", field: "status", op: "eq", value: "review" }] },
];

export const MERGED_PR_VIEWS: SavedView[] = [
  { id: "recent", name: "Recently merged", builtIn: true, columns: ["prLabel", "title", "branch", "mergedByName", "additions", "deletions", "sha", "mergedAt"], sort: [{ id: "mergedAt", desc: true }], filters: [] },
  { id: "by-agents", name: "Merged by agents", builtIn: true, columns: ["prLabel", "title", "branch", "mergedByName", "mergedAt"], sort: [{ id: "mergedAt", desc: true }], filters: [{ id: "f-agent", field: "mergedByName", op: "contains", value: "agent" }] },
];

/** Preview URLs seen for a branch (`deploy.succeeded` events with environment "preview"). */
export function previewFromEvent(event: WidgetEvent): { branch: string | null; taskId: string | null; url: string | null } | null {
  if (event.type !== "deploy.succeeded") return null;
  const p = event.payload;
  if (p.environment !== "preview") return null;
  return { branch: typeof p.branch === "string" ? p.branch : null, taskId: typeof p.taskId === "string" ? p.taskId : null, url: typeof p.url === "string" ? p.url : null };
}

export function toOpenRows(open: readonly OpenPrRow[], agents: Map<string, AgentRow>, previews: Map<string, string>): OpenPrTableRow[] {
  return open.map((pr) => {
    const agent = pr.agentId ? agents.get(pr.agentId) : undefined;
    return { ...pr, id: pr.taskId, agent, agentName: agent?.name ?? (pr.agentId ? "Agent" : "Unassigned"), queue: QUEUE_META[pr.status]?.word ?? pr.status, previewUrl: previews.get(pr.branch) ?? previews.get(pr.taskId) ?? null };
  });
}

export function toMergedRows(merged: readonly MergedPrRow[]): MergedPrTableRow[] {
  return merged.map((m) => ({
    ...m,
    id: m.eventId,
    mergedAt: toDate(m.occurredAt),
    mergedByName: m.mergedBy?.name ?? (m.mergedBy?.kind ? `${m.mergedBy.kind}${m.mergedBy.id ? ` ${m.mergedBy.id.slice(0, 8)}` : ""}` : "GitHub"),
    prLabel: m.prNumber ? `#${m.prNumber}` : m.eventId.slice(0, 8),
  }));
}

export function PullRequestsScreen({ businessId }: ModuleScreenProps) {
  const { navigate } = useWidgetData();
  const options = useDevScreenOptions();
  const prs = useWidgetQuery<PrsListResponse>("dev.prs.list", {});
  const agents = useAgents();
  const agentIndex = useAgentIndex(agents.data?.agents);
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

  const openRows = useMemo(() => toOpenRows(prs.data?.open ?? [], agentIndex, previews), [prs.data, agentIndex, previews]);
  const mergedRows = useMemo(() => toMergedRows(prs.data?.merged ?? []), [prs.data]);
  const optionNow = options.now;
  const now = useMemo(() => optionNow ?? new Date(), [optionNow]);

  const openColumns = useMemo<DataTableColumn<OpenPrTableRow>[]>(
    () => [
      { id: "title", accessorKey: "title", header: "Pull request", meta: { locked: true }, cell: ({ row }) => <span className="truncate text-body-strong">{row.original.title}</span> },
      {
        id: "queue",
        accessorKey: "queue",
        header: "Merge queue",
        meta: { filter: "select", filterOptions: [{ value: "In review", label: "In review" }, { value: "In merge queue", label: "In merge queue" }] },
        cell: ({ row }) => {
          const meta = QUEUE_META[row.original.status];
          return meta ? (
            <StatusPill tone={meta.tone} icon={meta.icon}>
              {meta.word}
            </StatusPill>
          ) : (
            <StatusPill tone="neutral">{row.original.status}</StatusPill>
          );
        },
      },
      { id: "status", accessorKey: "status", header: "Status", meta: { filter: "select", filterOptions: [{ value: "review", label: "review" }, { value: "merging", label: "merging" }] } },
      {
        id: "agentName",
        accessorKey: "agentName",
        header: "Agent",
        cell: ({ row }) => {
          const a = row.original.agent;
          if (!a) return <span className="text-secondary">{row.original.agentName}</span>;
          const tile = toTileAgent(a, a.id);
          return (
            <span className="flex items-center gap-1.5">
              <Avatar size={20} name={a.name} agent={{ seed: tile.seed, dept: tile.dept }} status={a.status} />
              <EntityLink entity={{ id: a.id, kind: "agent", name: a.name, href: agentHref(businessId, a.id) }} hideIcon hoverCard={false} />
            </span>
          );
        },
      },
      { id: "branch", accessorKey: "branch", header: "Branch", cell: ({ row }) => <span className="font-mono text-mono">{row.original.branch}</span> },
      {
        id: "previewUrl",
        accessorKey: "previewUrl",
        header: "Preview",
        meta: { filter: false },
        cell: ({ row }) =>
          row.original.previewUrl ? (
            <a href={row.original.previewUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-link hover:underline">
              <MonitorPlay size={14} /> Open preview
            </a>
          ) : (
            <span className="text-secondary">Deploying…</span>
          ),
      },
    ],
    [businessId],
  );

  const mergedColumns = useMemo<DataTableColumn<MergedPrTableRow>[]>(
    () => [
      { id: "prLabel", accessorKey: "prLabel", header: "PR", meta: { locked: true }, cell: ({ row }) => (row.original.url ? <a href={row.original.url} target="_blank" rel="noreferrer" className="font-mono text-mono text-link hover:underline">{row.original.prLabel}</a> : <span className="font-mono text-mono">{row.original.prLabel}</span>) },
      { id: "title", accessorKey: "title", header: "Title", cell: ({ row }) => <span className="truncate text-body-strong">{row.original.title ?? "—"}</span> },
      { id: "branch", accessorKey: "branch", header: "Branch", cell: ({ row }) => <span className="font-mono text-mono">{row.original.branch ?? "—"}</span> },
      { id: "mergedByName", accessorKey: "mergedByName", header: "Merged by" },
      { id: "additions", accessorKey: "additions", header: "+", meta: { numeric: true, label: "Additions" }, cell: ({ row }) => <span className="text-status-good tabular-nums">+{formatNumber(row.original.additions ?? 0)}</span> },
      { id: "deletions", accessorKey: "deletions", header: "−", meta: { numeric: true, label: "Deletions" }, cell: ({ row }) => <span className="text-status-bad tabular-nums">−{formatNumber(row.original.deletions ?? 0)}</span> },
      { id: "sha", accessorKey: "mergeCommitSha", header: "Commit", cell: ({ row }) => <span className="font-mono text-mono text-secondary">{shortSha(row.original.mergeCommitSha)}</span> },
      { id: "mergedAt", accessorFn: (r) => r.mergedAt?.getTime() ?? 0, header: "Merged", meta: { filter: "date", label: "Merged" }, cell: ({ row }) => (row.original.mergedAt ? <span title={formatDate(row.original.mergedAt)}>{formatRelative(row.original.mergedAt, now)}</span> : "—") },
    ],
    [now],
  );

  const openActions = (row: OpenPrTableRow): RowAction<OpenPrTableRow>[] => [
    { id: "preview", label: "Open preview", icon: MonitorPlay, disabled: !row.previewUrl, onSelect: (r) => r.previewUrl && window.open(r.previewUrl, "_blank", "noopener") },
    { id: "task", label: "Show in Plan", icon: Network, onSelect: (r) => navigate(`${routes.department(businessId, "development", "plan")}?task=${r.taskId}`) },
    { id: "claude", label: "Open in Claude Code", icon: ExternalLink, onSelect: (r) => setClaudeCode(r), separatorBefore: true },
  ];

  const mergedActions = (row: MergedPrTableRow): RowAction<MergedPrTableRow>[] => [
    { id: "github", label: "Open on GitHub", icon: ExternalLink, disabled: !row.url, onSelect: (r) => r.url && window.open(r.url, "_blank", "noopener") },
    { id: "task", label: "Show in Plan", icon: Network, disabled: !row.taskId, onSelect: (r) => r.taskId && navigate(`${routes.department(businessId, "development", "plan")}?task=${r.taskId}`) },
  ];

  return (
    <Screen name="development/pull-requests">
      <Panel
        span={12}
        title="Open pull requests"
        flush
        loading={prs.isLoading}
        error={prs.error ? prs.error.message : undefined}
        onRetry={prs.refetch}
        actions={
          <span className="text-small text-secondary tabular-nums" data-testid="pr-counts">
            {openRows.filter((r) => r.status === "review").length} in review · {openRows.filter((r) => r.status === "merging").length} in the merge queue
          </span>
        }
        footer={<span>Merges follow the business mode: automatic when green in Assisted and Automated, founder approval in Augmented (AC-11.6.5).</span>}
      >
        <DataTable<OpenPrTableRow> data={openRows} columns={openColumns} views={OPEN_PR_VIEWS} defaultViewId="open" rowActions={openActions} onRowOpen={(r) => navigate(`${routes.department(businessId, "development", "plan")}?task=${r.taskId}`)} height={320} exportFileName="open-pull-requests" empty={{ icon: GitPullRequest, children: "Pull requests appear here when an agent's task passes its acceptance tests and enters review." }} aria-label="Open pull requests" />
      </Panel>

      <Panel span={12} title="Merged" flush loading={prs.isLoading} error={prs.error ? prs.error.message : undefined} onRetry={prs.refetch}>
        <DataTable<MergedPrTableRow> data={mergedRows} columns={mergedColumns} views={MERGED_PR_VIEWS} defaultViewId="recent" rowActions={mergedActions} height={360} exportFileName="merged-pull-requests" empty={{ icon: GitMerge, children: "Merged pull requests are listed here as the merge queue lands them." }} aria-label="Merged pull requests" />
      </Panel>

      <OpenInClaudeCodeDialog taskId={claudeCode?.taskId ?? null} taskTitle={claudeCode?.title} onOpenChange={(o) => !o && setClaudeCode(null)} />
    </Screen>
  );
}
