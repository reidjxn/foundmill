"use client";
/**
 * Distribution › Campaigns (BUILD §11.7 engine loop Plan → Create → Approve → Launch): a DataTable of campaigns with
 * saved views and right-click status verbs, plus the selected campaign's detail with its assets and their approval
 * state → `distribution.assets.approve/reject`. Status changes go through `distribution.campaigns.setStatus`.
 */
import { useCallback, useMemo, useState } from "react";
import { Check, CircleStop, ExternalLink, Pause, Play, Rocket, X } from "lucide-react";
import {
  Button,
  Chip,
  DataTable,
  EntityLink,
  KeyValueList,
  Markdown,
  Panel,
  ProvenanceChip,
  StatusPill,
  formatMoney,
  useFormatters,
  type DataTableColumn,
  type RowAction,
  type SavedView,
} from "@foundmill/dugout";
import { ASSET_KINDS, CAMPAIGN_STATUSES, type CampaignStatus } from "@foundmill/shared/constants";
import { moduleTabHref, useDepartments } from "@foundmill/widgets/shared/departments";
import { routes } from "@foundmill/widgets/shared/routes";
import { useBusinessEvents, useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import { useSavedViews } from "@foundmill/widgets/shared/saved-views";
import type { ModuleScreenProps } from "../registry";
import { APPROVAL_WORDS, CAMPAIGN_STATUS_WORDS, assetCounts, canTransition } from "./channel-data";
import { ASSET_KIND_WORD } from "./channel-data";
import { DateText } from "../dates";
import { fitColumns, fitToGrow, type ColumnFit } from "../fit";
import { InlineError, Screen, channelLabel, fitTableHeight, searchParam, useAction } from "./shared";
import type { AgentRow, AssetRow, CampaignRow, ChannelsListResponse, Page } from "./types";

export interface CampaignTableRow extends CampaignRow {
  channelLabel: string;
  assets: AssetRow[];
}

/**
 * The table shares the row with the campaign detail (8 of 12 columns: 647 px at 1280), so each view carries what fits
 * there; the dates and assets of the campaign in hand are in the detail beside it.
 */
export const CAMPAIGN_VIEWS: SavedView[] = [
  { id: "all", name: "All campaigns", builtIn: true, columns: ["name", "channel", "status", "budget", "assets"], sort: [{ id: "starts", desc: true }], filters: [] },
  { id: "live", name: "Live", builtIn: true, columns: ["name", "channel", "budget", "starts", "assets"], sort: [{ id: "starts", desc: true }], filters: [{ id: "f-live", field: "status", op: "eq", value: "Live" }] },
  { id: "approval", name: "Awaiting approval", builtIn: true, columns: ["name", "channel", "status", "assets", "pendingAssets"], sort: [{ id: "pendingAssets", desc: true }], filters: [{ id: "f-appr", field: "pendingAssets", op: "gt", value: 0 }] },
  { id: "drafts", name: "Drafts and scheduled", builtIn: true, columns: ["name", "channel", "status", "budget", "starts"], sort: [{ id: "starts", desc: false }], filters: [{ id: "f-draft", field: "status", op: "in", value: ["Draft", "Scheduled"] }] },
  { id: "ended", name: "Ended", builtIn: true, columns: ["name", "channel", "budget", "starts", "ends"], sort: [{ id: "ends", desc: true }], filters: [{ id: "f-end", field: "status", op: "eq", value: "Ended" }] },
];

/** What each column's content needs and its share of the spare width. */
export const CAMPAIGN_FIT = {
  name: { min: 160, grow: 3 },
  channel: { min: 128, grow: 1 },
  status: { min: 116 },
  budget: { min: 96 },
  starts: { min: 112 },
  ends: { min: 112 },
  assets: { min: 110, grow: 1 },
  pendingAssets: { min: 128 },
} satisfies Record<string, ColumnFit>;
export type CampaignColumnId = keyof typeof CAMPAIGN_FIT;

const STATUS_OPTIONS = CAMPAIGN_STATUSES.map((s) => ({ value: CAMPAIGN_STATUS_WORDS[s].word, label: CAMPAIGN_STATUS_WORDS[s].word }));

export function campaignColumns(sizes: Record<CampaignColumnId, number> = fitColumns<CampaignColumnId>(null, CAMPAIGN_FIT, [])): DataTableColumn<CampaignTableRow>[] {
  return [
    { id: "name", accessorFn: (r) => r.name, header: "Campaign", size: sizes.name, cell: ({ row }) => <span className="truncate text-body-strong text-primary">{row.original.name}</span>, meta: { locked: true } },
    { id: "channel", accessorFn: (r) => r.channelLabel, header: "Channel", size: sizes.channel },
    {
      id: "status",
      accessorFn: (r) => CAMPAIGN_STATUS_WORDS[r.status].word,
      header: "Status",
      size: sizes.status,
      cell: ({ row }) => (
        <StatusPill tone={CAMPAIGN_STATUS_WORDS[row.original.status].tone} className="whitespace-nowrap">
          {CAMPAIGN_STATUS_WORDS[row.original.status].word}
        </StatusPill>
      ),
      meta: { filter: "select", filterOptions: STATUS_OPTIONS },
    },
    { id: "budget", accessorFn: (r) => r.budgetMinor, header: "Budget", size: sizes.budget, cell: ({ row }) => <span className="tabular-nums">{formatMoney({ amountMinor: row.original.budgetMinor, currency: row.original.currency })}</span>, meta: { numeric: true } },
    { id: "starts", accessorFn: (r) => r.startsAt ?? "", header: "Starts", size: sizes.starts, cell: ({ getValue }) => <DateText className="tabular-nums" value={getValue() ? String(getValue()) : null} />, meta: { filter: "date" } },
    { id: "ends", accessorFn: (r) => r.endsAt ?? "", header: "Ends", size: sizes.ends, cell: ({ getValue }) => <DateText className="tabular-nums" value={getValue() ? String(getValue()) : null} />, meta: { filter: "date" } },
    {
      id: "assets",
      accessorFn: (r) => r.assets.length,
      header: "Assets",
      size: sizes.assets,
      cell: ({ row }) => {
        const c = assetCounts(row.original.assets);
        if (c.total === 0) return <span className="text-secondary">None yet</span>;
        return (
          <span className="flex items-center gap-1 tabular-nums">
            <span>{c.approved} of {c.total} approved</span>
            {c.pending > 0 ? <Chip tone="warn" className="whitespace-nowrap">{c.pending} awaiting</Chip> : null}
            {c.rejected > 0 ? <Chip tone="bad" className="whitespace-nowrap">{c.rejected} rejected</Chip> : null}
          </span>
        );
      },
      meta: { numeric: true, csv: (r) => `${assetCounts(r.assets).approved}/${r.assets.length}` },
    },
    { id: "pendingAssets", accessorFn: (r) => assetCounts(r.assets).pending, header: "Awaiting approval", size: sizes.pendingAssets, cell: ({ getValue }) => <span className="tabular-nums">{String(getValue())}</span>, meta: { numeric: true } },
  ];
}

export function CampaignsScreen({ businessId }: ModuleScreenProps) {
  const { navigate } = useWidgetData();
  const departments = useDepartments();
  const campaigns = useWidgetQuery<Page<CampaignRow>>("distribution.campaigns.list", { limit: 200 });
  const channels = useWidgetQuery<ChannelsListResponse>("distribution.channels.list", {});
  const assets = useWidgetQuery<AssetRow[]>("distribution.assets.list", {});
  const agents = useWidgetQuery<AgentRow[]>("team.agents.list", {});
  const action = useAction();
  // Saved per person, business and table (audit #204): they come back after a reload.
  const savedViews = useSavedViews("distribution.campaigns", CAMPAIGN_VIEWS, { defaultViewId: "all" });
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParam("campaign"));
  useBusinessEvents(() => {
    campaigns.refetch();
    assets.refetch();
  }, ["campaign.launched", "approval.resolved"]);

  const rows = useMemo<CampaignTableRow[]>(() => {
    const channelById = new Map((channels.data?.channels ?? []).map((c) => [c.id, c]));
    const byCampaign = new Map<string, AssetRow[]>();
    for (const a of assets.data ?? []) {
      if (!a.campaignId) continue;
      byCampaign.set(a.campaignId, [...(byCampaign.get(a.campaignId) ?? []), a]);
    }
    return (campaigns.data?.items ?? []).map((c) => {
      const ch = channelById.get(c.channelId);
      return { ...c, channelLabel: ch ? channelLabel(ch.channelKey) : "Channel", assets: byCampaign.get(c.id) ?? [] };
    });
  }, [campaigns.data, channels.data, assets.data]);
  const columns = useMemo(() => fitToGrow(campaignColumns(), CAMPAIGN_FIT), []);
  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? rows[0] ?? null, [rows, selectedId]);

  const setStatus = useCallback(
    async (row: CampaignRow, status: CampaignStatus) => {
      const ok = await action.run("distribution.campaigns.setStatus", { campaignId: row.id, status }, { key: `status:${row.id}:${status}` });
      if (ok !== undefined) campaigns.refetch();
    },
    [action, campaigns],
  );
  const decideAsset = useCallback(
    async (asset: AssetRow, decision: "approve" | "reject") => {
      const ok = await action.run(`distribution.assets.${decision}`, { assetId: asset.id }, { key: `${decision}:${asset.id}` });
      if (ok !== undefined) assets.refetch();
    },
    [action, assets],
  );

  const rowActions = useCallback(
    (row: CampaignTableRow): RowAction<CampaignTableRow>[] => [
      { id: "open", label: "Open", icon: ExternalLink, onSelect: (r) => setSelectedId(r.id) },
      { id: "launch", label: "Launch", icon: Rocket, onSelect: (r) => void setStatus(r, "live"), disabled: row.status === "paused" || !canTransition(row.status, "live"), separatorBefore: true },
      { id: "pause", label: "Pause", icon: Pause, onSelect: (r) => void setStatus(r, "paused"), disabled: !canTransition(row.status, "paused") },
      { id: "resume", label: "Resume", icon: Play, onSelect: (r) => void setStatus(r, "live"), disabled: row.status !== "paused" },
      { id: "end", label: "End campaign", icon: CircleStop, variant: "danger", onSelect: (r) => void setStatus(r, "ended"), disabled: !canTransition(row.status, "ended"), separatorBefore: true },
    ],
    [setStatus],
  );

  const live = rows.filter((r) => r.status === "live").length;
  const awaiting = rows.reduce((n, r) => n + assetCounts(r.assets).pending, 0);
  return (
    <Screen name="distribution/campaigns">
      <Panel
        title="Campaigns"
        span={8}
        loading={campaigns.isLoading}
        error={campaigns.error ? campaigns.error.message : undefined}
        onRetry={campaigns.refetch}
        meta={rows.length ? `${rows.length} campaign${rows.length === 1 ? "" : "s"} · ${live} live · ${awaiting} awaiting approval` : undefined}
        footer={<span>Right-click a campaign to launch, pause, resume or end it. Launch needs at least one approved asset.</span>}
        flush
      >
        <InlineError error={action.error} className="px-panel-pad pt-2" />
        <div className="min-w-0">
        <DataTable<CampaignTableRow>
          aria-label="Campaigns"
          data={rows}
          columns={columns}
          {...savedViews}
          defaultViewId="all"
          rowActions={rowActions}
          onRowOpen={(r) => setSelectedId(r.id)}
          onRowClick={(r) => setSelectedId(r.id)}
          rowClassName={(r) => (selected && r.id === selected.id ? "bg-white/4" : undefined)}
          height={fitTableHeight(rows.length, { minRows: 12, maxRows: 18 })}
          exportFileName="campaigns"
          empty={{ title: "No campaigns yet", children: "Each channel on the board plans its first campaign here and asks for your approval before launch." }}
        />
        </div>
      </Panel>
      <Panel
        title={selected ? selected.name : "Campaign"}
        span={4}
        loading={campaigns.isLoading}
        empty={!selected && campaigns.data ? "Pick a campaign to see its objective, budget and assets." : undefined}
        actions={
          selected ? (
            <StatusPill tone={CAMPAIGN_STATUS_WORDS[selected.status].tone} className="whitespace-nowrap">
              {CAMPAIGN_STATUS_WORDS[selected.status].word}
            </StatusPill>
          ) : null
        }
      >
        {selected ? <CampaignDetail row={selected} agents={agents.data} businessId={businessId} pending={action.pending} onStatus={(s) => setStatus(selected, s)} onDecide={decideAsset} onOpenAsset={(a) => navigate(`${moduleTabHref(businessId, departments.data, "distribution", "creative")}?asset=${a.id}`)} /> : null}
      </Panel>
    </Screen>
  );
}

function CampaignDetail({ row, agents, businessId, pending, onStatus, onDecide }: { row: CampaignTableRow; agents: readonly AgentRow[] | undefined; businessId: string; pending: string | null; onStatus: (s: CampaignStatus) => void; onDecide: (a: AssetRow, d: "approve" | "reject") => void; onOpenAsset: (a: AssetRow) => void }) {
  const { formatDate } = useFormatters();
  const counts = assetCounts(row.assets);
  const launchBlocked = canTransition(row.status, "live") && counts.total > 0 && counts.approved === 0;
  const agentName = (id: string) => agents?.find((a) => a.id === id)?.name ?? "Agent";
  const transitions: Array<{ status: CampaignStatus; label: string; icon: typeof Rocket; variant: "default" | "primary" | "danger" }> = [
    { status: "pending_approval", label: "Submit for approval", icon: Check, variant: "default" },
    { status: "live", label: row.status === "paused" ? "Resume" : "Launch", icon: row.status === "paused" ? Play : Rocket, variant: "primary" },
    { status: "paused", label: "Pause", icon: Pause, variant: "default" },
    { status: "ended", label: "End campaign", icon: CircleStop, variant: "danger" },
  ];
  return (
    <div className="flex flex-col gap-3" data-campaign-detail={row.id}>
      <KeyValueList
        layout="grid"
        dense
        items={[
          { label: "Channel", value: row.channelLabel },
          { label: "Budget", value: formatMoney({ amountMinor: row.budgetMinor, currency: row.currency }), numeric: true },
          { label: "Starts", value: row.startsAt ? formatDate(row.startsAt) : "Not scheduled" },
          { label: "Ends", value: row.endsAt ? formatDate(row.endsAt) : "Open-ended" },
        ]}
      />
      {row.goal ? (
        <section aria-label="Objective">
          <p className="t-title mb-1 text-primary">Objective</p>
          <Markdown variant="body">{row.goal}</Markdown>
        </section>
      ) : null}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Campaign actions">
        {transitions
          .filter((t) => canTransition(row.status, t.status))
          .map((t) => (
            <Button key={t.status} size="sm" variant={t.variant} icon={t.icon} loading={pending === `status:${row.id}:${t.status}`} disabled={t.status === "live" && launchBlocked} onClick={() => onStatus(t.status)} title={t.status === "live" && launchBlocked ? "Approve at least one asset before launch" : undefined}>
              {t.label}
            </Button>
          ))}
      </div>
      {launchBlocked ? <p className="text-small text-status-warn">Launch needs at least one approved asset.</p> : null}
      <section aria-label="Assets" className="flex flex-col gap-1 border-t border-subtle pt-2">
        <p className="flex items-baseline gap-2">
          <span className="t-title text-primary">Assets</span>
          {counts.total ? <span className="t-mono text-tertiary">{counts.approved} of {counts.total} approved</span> : null}
        </p>
        {row.assets.length === 0 ? (
          <p className="text-small text-secondary">No assets yet. The engine drafts them in the Create step and lists them here for approval.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {[...row.assets]
              .sort((a, b) => ASSET_KINDS.indexOf(a.kind) - ASSET_KINDS.indexOf(b.kind) || a.title.localeCompare(b.title))
              .map((a) => (
                <li key={a.id} className="flex items-center gap-2 rounded-sm bg-panel-alt px-2 py-1" data-asset={a.id}>
                  <Chip tone="neutral" className="shrink-0 whitespace-nowrap">{ASSET_KIND_WORD[a.kind] ?? a.kind}</Chip>
                  <span className="min-w-0 flex-1 truncate text-body text-primary">{a.title || "Untitled"}</span>
                  {a.authoredByAgentId ? <EntityLink entity={{ id: a.authoredByAgentId, kind: "agent", name: agentName(a.authoredByAgentId), href: routes.agent(businessId, a.authoredByAgentId) }} className="text-small" /> : null}
                  <StatusPill tone={APPROVAL_WORDS[a.approvalState].tone} className="shrink-0 whitespace-nowrap">
                    {APPROVAL_WORDS[a.approvalState].word}
                  </StatusPill>
                  {a.approvalState === "pending" || a.approvalState === "draft" ? (
                    <>
                      <Button size="sm" variant="primary" icon={Check} loading={pending === `approve:${a.id}`} onClick={() => onDecide(a, "approve")} aria-label={`Approve ${a.title || a.kind}`}>
                        Approve
                      </Button>
                      <Button size="sm" variant="ghost" icon={X} loading={pending === `reject:${a.id}`} onClick={() => onDecide(a, "reject")} aria-label={`Reject ${a.title || a.kind}`}>
                        Reject
                      </Button>
                    </>
                  ) : null}
                </li>
              ))}
          </ul>
        )}
      </section>
      <p className="text-small text-secondary">
        Spend above the approval threshold, any contract and anything in the founder's name goes to the Inbox before it happens. Results are an <ProvenanceChip kind="estimate" /> until the conversion API confirms them.
      </p>
    </div>
  );
}
