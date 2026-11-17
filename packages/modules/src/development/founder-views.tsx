"use client";
/**
 * The founder's renderings of Development's change and preview lists, while Builder view is off (docs/DESIGN.md
 * "Builder view"; founder, Nov 8, 2026). The data is the same as the builder's tables; the words are the founder's:
 *
 *   - **What changed** (Pull requests): "Waiting for your go-ahead" (a change being checked or ready for the founder's
 *     yes) and "Gone live" (what the team put live, and when). No PR number, branch, lines or commit. A change finished
 *     with nowhere to publish (WP-05 T8) is listed under "Saved, not live anywhere" instead of "Gone live".
 *   - **Live product** (Environments): "Your live product" (its address and when it last changed) and "Previews of
 *     changes" (each change's own copy to try). No branch, commit or hosting provider.
 *
 * Titles are the task's founder title (0070), else the deterministic rewrite of @foundmill/shared (`founderPhrase`).
 */
import { useMemo } from "react";
import { CircleCheck, CircleDashed, Clock, Globe, MonitorPlay, Network, Radio, SearchCheck, Sparkles } from "lucide-react";
import { Avatar, DataTable, EmptyState, EntityLink, KeyValueList, Panel, StatusPill, useFormatters, type DataTableColumn, type IconComponent, type RowAction, type StatusTone } from "@foundmill/dugout";
import { founderPhrase, type TaskStatus } from "@foundmill/shared";
import { routes } from "@foundmill/widgets/shared/routes";
import { useWidgetData } from "@foundmill/widgets/data";
import { Screen, agentHref, toDate, toTileAgent } from "./shared";
import type { AgentRow, Iso, MergedPrRow, OpenPrRow } from "./types";

/** A change's title in the founder's words: the stored founder title, else the deterministic rewrite, else the title. */
export function founderTitleOf(founderTitle: string | null | undefined, title: string | null | undefined): string {
  if (founderTitle?.trim()) return founderTitle.trim();
  const technical = title?.trim() ?? "";
  return (technical && founderPhrase(technical)) || technical || "A change to the product";
}

/** Where an open change stands, in the founder's words: still being checked, or ready for the founder's yes. */
export const FOUNDER_CHANGE_STATUS: Partial<Record<TaskStatus, { tone: StatusTone; word: string; icon: IconComponent }>> = {
  review: { tone: "info", word: "Being checked", icon: SearchCheck },
  merging: { tone: "good", word: "Ready for your go-ahead", icon: CircleCheck },
};

export interface FounderChangeRow {
  id: string;
  taskId: string;
  title: string;
  agent: AgentRow | undefined;
  agentName: string;
  status: TaskStatus;
  statusWord: string;
  previewUrl: string | null;
}

export interface FounderLiveRow {
  id: string;
  taskId: string | null;
  title: string;
  agent: AgentRow | undefined;
  agentName: string;
  liveAt: Date | null;
  /** Finished with nowhere to push (WP-05 T8): listed under "Saved, not live anywhere", never as gone live. */
  savedOnly?: boolean;
}

/** A finished code change that had nowhere to publish (WP-05 T8, founder decision D3), in the founder's words. */
export const SAVED_ONLY_WORD = "Saved, not live anywhere";
export const SAVED_ONLY_LINE = "The work is kept with this task. It goes live once the project has a place to publish.";

/** The open changes as the founder reads them (code tasks only, like the builder's table). */
export function toFounderChangeRows(open: readonly OpenPrRow[], agents: Map<string, AgentRow>, previews: Map<string, string>, nameFor: (agent: AgentRow) => string = (a) => a.name): FounderChangeRow[] {
  return open
    .filter((pr) => pr.kind === undefined || pr.kind === "code")
    .map((pr) => {
      const agent = pr.agentId ? agents.get(pr.agentId) : undefined;
      return { id: pr.taskId, taskId: pr.taskId, title: founderTitleOf(pr.founderTitle, pr.title), agent, agentName: agent ? nameFor(agent) : pr.agentId ? "Agent" : "The team", status: pr.status, statusWord: FOUNDER_CHANGE_STATUS[pr.status]?.word ?? "Being checked", previewUrl: previews.get(pr.branch) ?? previews.get(pr.taskId) ?? null };
    });
}

/** What went live, newest first: the agent is the change's own (its task's), else the agent that put it live. */
export function toFounderLiveRows(merged: readonly MergedPrRow[], agents: Map<string, AgentRow>, nameFor: (agent: AgentRow) => string = (a) => a.name): FounderLiveRow[] {
  return merged
    .map((m) => {
      const agentId = m.agentId ?? (m.mergedBy?.kind === "agent" ? m.mergedBy.id : null);
      const agent = agentId ? agents.get(agentId) : undefined;
      return { id: m.eventId ?? `task:${m.taskId ?? String(m.occurredAt)}`, taskId: m.taskId ?? null, title: founderTitleOf(m.founderTitle, m.title), agent, agentName: agent ? nameFor(agent) : "The team", liveAt: toDate(m.occurredAt), savedOnly: m.landed === "saved_only" };
    })
    .sort((a, b) => (b.liveAt?.getTime() ?? 0) - (a.liveAt?.getTime() ?? 0));
}

/** The agent with its avatar, linked to its profile; "The team" when the change has no agent of its own. */
function AgentCell({ businessId, agent, name }: { businessId: string; agent: AgentRow | undefined; name: string }) {
  if (!agent) return <span className="text-secondary">{name}</span>;
  const tile = toTileAgent(agent, agent.id);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Avatar size={20} name={agent.name} agent={{ seed: tile.seed, dept: tile.dept, personaKey: tile.personaKey, layer: agent.layer }} status={agent.status} />
      <EntityLink entity={{ id: agent.id, kind: "agent", name: agent.name, href: agentHref(businessId, agent.id) }} display={name} hideIcon hoverCard={false} className="min-w-0 truncate" />
    </span>
  );
}

function TitleCell({ title }: { title: string }) {
  return (
    <span className="block min-w-0 truncate text-body-strong" title={title}>
      {title}
    </span>
  );
}

function PreviewLink({ url, label }: { url: string; label: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="entity-link inline-flex items-center gap-1">
      <MonitorPlay size={14} aria-hidden /> {label}
    </a>
  );
}

export interface WhatChangedProps {
  businessId: string;
  deptSlug: string;
  open: FounderChangeRow[];
  live: FounderLiveRow[];
  loading: boolean;
  error?: string;
  onRetry: () => void;
  now: Date;
  /** Where the team's code goes (WP-02 T5); absent reads as "github". */
  destination?: "none" | "github";
}

/** The What changed footer: with no repository to push to, nothing can go live from the team's code (WP-02 T5). */
export function waitingFooter(destination: "none" | "github" = "github"): string {
  return destination === "none"
    ? "The team's code is saved in your project. It has nowhere to go live yet: connect a GitHub repository in Settings › Integrations to have it pushed there for you to approve."
    : "Nothing goes live until you say so: when a change passes the quality checks, you get one decision in your Inbox, whatever the business mode.";
}

/** Development › What changed: the founder's rendering of the Pull requests tab. */
export function WhatChanged({ businessId, deptSlug, open, live, loading, error, onRetry, now, destination }: WhatChangedProps) {
  const { navigate } = useWidgetData();
  const { formatDateSmart } = useFormatters();
  const planHref = (taskId: string) => `${routes.department(businessId, deptSlug, "plan")}?task=${taskId}`;

  const openColumns = useMemo<DataTableColumn<FounderChangeRow>[]>(
    () => [
      { id: "title", accessorKey: "title", header: "Change", size: 320, meta: { locked: true, grow: 4 }, cell: ({ row }) => <TitleCell title={row.original.title} /> },
      { id: "agentName", accessorKey: "agentName", header: "Agent", size: 200, meta: { grow: 2 }, cell: ({ row }) => <AgentCell businessId={businessId} agent={row.original.agent} name={row.original.agentName} /> },
      {
        id: "status",
        accessorKey: "statusWord",
        header: "Status",
        size: 216,
        meta: { filter: "select", filterOptions: Object.values(FOUNDER_CHANGE_STATUS).map((m) => ({ value: m!.word, label: m!.word })) },
        cell: ({ row }) => {
          const meta = FOUNDER_CHANGE_STATUS[row.original.status] ?? FOUNDER_CHANGE_STATUS.review!;
          return (
            <StatusPill tone={meta.tone} icon={meta.icon}>
              {meta.word}
            </StatusPill>
          );
        },
      },
      { id: "previewUrl", accessorKey: "previewUrl", header: "See it", size: 140, meta: { filter: false }, cell: ({ row }) => (row.original.previewUrl ? <PreviewLink url={row.original.previewUrl} label="See it" /> : <span className="text-tertiary">Not ready yet</span>) },
    ],
    [businessId],
  );

  const liveColumns = useMemo<DataTableColumn<FounderLiveRow>[]>(
    () => [
      { id: "title", accessorKey: "title", header: "Change", size: 320, meta: { locked: true, grow: 4 }, cell: ({ row }) => <TitleCell title={row.original.title} /> },
      { id: "agentName", accessorKey: "agentName", header: "Agent", size: 200, meta: { grow: 2 }, cell: ({ row }) => <AgentCell businessId={businessId} agent={row.original.agent} name={row.original.agentName} /> },
      {
        id: "liveAt",
        accessorFn: (r) => r.liveAt?.getTime() ?? 0,
        header: "Gone live",
        size: 156,
        meta: { filter: "date", label: "Gone live", csv: (r) => (r.liveAt ? formatDateSmart(r.liveAt, now) : "") },
        cell: ({ row }) => (row.original.liveAt ? <span className="text-secondary">Put live {formatDateSmart(row.original.liveAt, now)}</span> : <span className="text-tertiary">—</span>),
      },
    ],
    [businessId, formatDateSmart, now],
  );

  const openActions = (row: FounderChangeRow): RowAction<FounderChangeRow>[] => [
    { id: "preview", label: "See it", icon: MonitorPlay, disabled: !row.previewUrl, onSelect: (r) => r.previewUrl && window.open(r.previewUrl, "_blank", "noopener") },
    { id: "task", label: "Show in Plan", icon: Network, onSelect: (r) => navigate(planHref(r.taskId)) },
  ];
  const liveActions = (row: FounderLiveRow): RowAction<FounderLiveRow>[] => [{ id: "task", label: "Show in Plan", icon: Network, disabled: !row.taskId, onSelect: (r) => r.taskId && navigate(planHref(r.taskId)) }];
  const ready = open.filter((r) => r.status === "merging").length;
  const gone = useMemo(() => live.filter((r) => !r.savedOnly), [live]);
  const saved = useMemo(() => live.filter((r) => r.savedOnly), [live]);
  // The saved list: the change, its agent and its state (no "Put live" date: it is not live anywhere).
  const savedColumns = useMemo<DataTableColumn<FounderLiveRow>[]>(
    () => [
      ...liveColumns.slice(0, 2),
      {
        id: "state",
        accessorFn: () => SAVED_ONLY_WORD,
        header: "State",
        size: 240,
        meta: { filter: false },
        cell: () => (
          <StatusPill tone="warn" icon={CircleDashed} title={SAVED_ONLY_LINE}>
            {SAVED_ONLY_WORD}
          </StatusPill>
        ),
      },
    ],
    [liveColumns],
  );

  return (
    <Screen name="development/pull-requests">
      <Panel
        span={12}
        title="Waiting for your go-ahead"
        flush
        loading={loading}
        error={error}
        onRetry={onRetry}
        meta={
          <span data-testid="pr-counts">
            {open.length - ready} being checked · {ready} ready for your go-ahead
          </span>
        }
        footer={<span>{waitingFooter(destination)}</span>}
        data-testid="what-changed-waiting"
      >
        <div className="min-w-0">
          <DataTable<FounderChangeRow> data={open} columns={openColumns} rowActions={openActions} onRowOpen={(r) => navigate(planHref(r.taskId))} height={Math.min(320, Math.max(3, open.length) * 28 + 42)} exportFileName="changes-waiting" empty={{ icon: Sparkles, children: "Changes appear here when an agent finishes one and the quality checks start on it.", action: { label: "Go to Plan", onClick: () => navigate(routes.department(businessId, deptSlug, "plan")) } }} aria-label="Waiting for your go-ahead" className="border-0" />
        </div>
      </Panel>

      <Panel span={12} title="Gone live" flush loading={loading} error={error} onRetry={onRetry} meta={gone.length ? <span>{gone.length} put live</span> : undefined} data-testid="what-changed-live">
        <div className="min-w-0">
          <DataTable<FounderLiveRow> data={gone} columns={liveColumns} rowActions={liveActions} height={gone.length ? 360 : 240} exportFileName="changes-gone-live" empty={{ icon: CircleCheck, children: "Changes the team put live are listed here, newest first." }} aria-label="Gone live" className="border-0" />
        </div>
      </Panel>

      {/* Finished with nowhere to publish (WP-05 T8, D3): kept with the task, never listed as gone live. */}
      {saved.length ? (
        <Panel span={12} title={SAVED_ONLY_WORD} flush meta={<span>{saved.length} saved</span>} footer={<span>{SAVED_ONLY_LINE}</span>} data-testid="what-changed-saved">
          <div className="min-w-0">
            <DataTable<FounderLiveRow> data={saved} columns={savedColumns} rowActions={liveActions} height={Math.min(320, Math.max(3, saved.length) * 28 + 42)} exportFileName="changes-saved" aria-label={SAVED_ONLY_WORD} className="border-0" />
          </div>
        </Panel>
      ) : null}
    </Screen>
  );
}

/** One deployment as the founder's Live product reads it. */
export interface FounderDeployment {
  environment: "preview" | "staging" | "production";
  url: string | null;
  taskId: string | null;
  branch: string | null;
  occurredAt: Date;
}

export interface FounderPreviewRow {
  id: string;
  taskId: string | null;
  title: string;
  agentName: string;
  url: string | null;
  updatedAt: Date | null;
}

/** The newest production deployment with an address: the founder's live product. */
export function liveProductOf(deployments: readonly FounderDeployment[]): { url: string; updatedAt: Date } | null {
  let best: FounderDeployment | null = null;
  for (const d of deployments) if (d.environment === "production" && d.url && (!best || d.occurredAt.getTime() > best.occurredAt.getTime())) best = d;
  return best?.url ? { url: best.url, updatedAt: best.occurredAt } : null;
}

export interface LiveProductProps {
  businessId: string;
  deptSlug: string;
  live: { url: string; updatedAt: Date } | null;
  previews: FounderPreviewRow[];
  loading: boolean;
  error?: string;
  onRetry: () => void;
  now: Date;
  /** Product › Public page, the first thing people can open while nothing is live from here (WP-02 T5). */
  publicPageHref?: string;
}

/** Development › Live product: the founder's rendering of the Environments tab. */
export function LiveProduct({ businessId, deptSlug, live, previews, loading, error, onRetry, now, publicPageHref }: LiveProductProps) {
  const { navigate } = useWidgetData();
  const { formatDateSmart } = useFormatters();
  const columns = useMemo<DataTableColumn<FounderPreviewRow>[]>(
    () => [
      { id: "title", accessorKey: "title", header: "Change", size: 320, meta: { locked: true, grow: 4 }, cell: ({ row }) => <TitleCell title={row.original.title} /> },
      { id: "agentName", accessorKey: "agentName", header: "Agent", size: 200, meta: { grow: 2 }, cell: ({ row }) => <span className="block min-w-0 truncate">{row.original.agentName}</span> },
      { id: "url", accessorKey: "url", header: "Preview", size: 160, meta: { filter: false }, cell: ({ row }) => (row.original.url ? <PreviewLink url={row.original.url} label="Open preview" /> : <span className="text-tertiary">Not ready yet</span>) },
      { id: "updatedAt", accessorFn: (r) => r.updatedAt?.getTime() ?? 0, header: "Updated", size: 120, meta: { filter: "date", label: "Updated", csv: (r) => (r.updatedAt ? formatDateSmart(r.updatedAt, now) : "") }, cell: ({ row }) => (row.original.updatedAt ? <span className="text-secondary">{formatDateSmart(row.original.updatedAt, now)}</span> : <span className="text-tertiary">Not yet</span>) },
    ],
    [formatDateSmart, now],
  );
  const actions = (row: FounderPreviewRow): RowAction<FounderPreviewRow>[] => [
    { id: "open", label: "Open preview", icon: MonitorPlay, disabled: !row.url, onSelect: (r) => r.url && window.open(r.url, "_blank", "noopener") },
    { id: "task", label: "Show in Plan", icon: Network, disabled: !row.taskId, onSelect: (r) => r.taskId && navigate(`${routes.department(businessId, deptSlug, "plan")}?task=${r.taskId}`) },
  ];
  return (
    <Screen name="development/environments">
      <Panel span={12} title="Your live product" loading={loading} error={error} onRetry={onRetry} data-testid="live-product-card">
        {live ? (
          <KeyValueList
            items={[
              {
                label: "Address",
                value: (
                  <a href={live.url} target="_blank" rel="noreferrer" className="entity-link inline-flex items-center gap-1" data-testid="live-product-url">
                    <Globe size={14} aria-hidden /> {live.url.replace(/^https?:\/\//, "")}
                  </a>
                ),
              },
              { label: "Updated", value: <span data-testid="live-product-updated">Updated {formatDateSmart(live.updatedAt, now)}</span> },
            ]}
          />
        ) : (
          <EmptyState icon={Radio} title="No release recorded yet" className="py-4">
            Nothing is live from here yet. Your public page is the first thing people can open:{" "}
            {publicPageHref ? (
              <a href={publicPageHref} className="entity-link" data-testid="live-product-public-page">
                Product › Public page
              </a>
            ) : (
              "Product › Public page"
            )}
            .
          </EmptyState>
        )}
      </Panel>
      <Panel span={12} title="Previews of changes" flush loading={loading} error={error} onRetry={onRetry} meta={previews.length ? <span>{previews.filter((p) => p.url).length} ready to open</span> : undefined} footer={<span>{live ? "Each change gets its own preview to try before it goes live; it opens here once the quality checks pass." : "Previews are not available yet."}</span>}>
        <div className="min-w-0">
          <DataTable<FounderPreviewRow> data={previews} columns={columns} rowActions={actions} onRowOpen={(r) => r.url && window.open(r.url, "_blank", "noopener")} height={Math.min(520, Math.max(4, previews.length) * 28 + 42)} exportFileName="previews" empty={{ icon: Clock, children: "Previews appear here as the team works on changes to the product.", action: { label: "Go to Plan", onClick: () => navigate(routes.department(businessId, deptSlug, "plan")) } }} aria-label="Previews of changes" className="border-0" />
        </div>
      </Panel>
    </Screen>
  );
}

/** A deployment's time as a Date, for rows read from `dev.deployments.list` (ISO on the wire). */
export function deploymentAt(at: Iso): Date {
  return toDate(at) ?? new Date(0);
}
