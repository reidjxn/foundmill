"use client";
/**
 * Distribution › Channels (BUILD §11.7): a DataTable of the 15 channels — line, fit, potential stars, cost-per-customer
 * range (Estimate), budget, status and the offline-tracking chip — with saved views and right-click verbs
 * (open profile, move on/off the Board, pause/resume, set budget).
 */
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpToLine, Coins, ExternalLink, Pause, Play } from "lucide-react";
import {
  Button,
  Chip,
  DataTable,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Panel,
  ProvenanceChip,
  RatingFigure,
  StarRating,
  StatusPill,
  formatMoney,
  formatNumber,
  type DataTableColumn,
  type RowAction,
  type SavedView,
} from "@foundmill/dugout";
import { CHANNEL_LINES, type ChannelKey } from "@foundmill/shared/constants";
import { addDays, dayKey } from "@foundmill/widgets/shared/time";
import { moduleHref, useDepartments } from "@foundmill/widgets/shared/departments";
import { useBusinessEvents, useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import type { ModuleScreenProps } from "../registry";
import { buildChannelViews, channelStatus, type ChannelView } from "./channel-data";
import { METRICS_WINDOW_DAYS } from "./FormationScreen";
import { localScores, RESCORE_DEBOUNCE_MS, useDebouncedRun } from "./rescore";
import { InlineError, LINE_LABELS, OFFLINE_TRACKING_LABEL, Screen, searchParam, useAction } from "./shared";
import type { CampaignRow, ChannelMetricRow, ChannelsListResponse, Page, RecommendResponse, RecommendationRow } from "./types";

export const CHANNEL_VIEWS: SavedView[] = [
  { id: "all", name: "All channels", builtIn: true, columns: ["label", "line", "fit", "stars", "cpa", "budget", "status", "tracking", "customers"], sort: [{ id: "fit", desc: true }], filters: [] },
  { id: "running", name: "Running", builtIn: true, columns: ["label", "line", "fit", "budget", "status", "leads", "customers", "cpaActual"], sort: [{ id: "fit", desc: true }], filters: [{ id: "f-run", field: "enabled", op: "eq", value: true }] },
  { id: "bench", name: "Off the board", builtIn: true, columns: ["label", "line", "fit", "stars", "cpa", "status"], sort: [{ id: "fit", desc: true }], filters: [{ id: "f-bench", field: "enabled", op: "eq", value: false }] },
  { id: "offline", name: "Offline tracking", builtIn: true, columns: ["label", "line", "fit", "budget", "status", "tracking"], sort: [{ id: "fit", desc: true }], filters: [{ id: "f-off", field: "tracking", op: "eq", value: true }] },
];

export function channelColumns(): DataTableColumn<ChannelView>[] {
  return [
    {
      id: "label",
      accessorFn: (r) => r.meta?.label ?? r.channelKey,
      header: "Channel",
      size: 190,
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-body-strong text-primary">{row.original.meta?.label ?? row.original.channelKey}</span>
          {row.original.recommended ? (
            <Chip tone="kit" title="Recommended by the Distribution Strategist">
              Recommended
            </Chip>
          ) : null}
        </span>
      ),
      meta: { locked: true },
    },
    {
      id: "line",
      accessorFn: (r) => LINE_LABELS[r.line],
      header: "Family",
      size: 110,
      meta: { filter: "select", filterOptions: CHANNEL_LINES.map((l) => ({ value: LINE_LABELS[l], label: LINE_LABELS[l] })) },
    },
    { id: "fit", accessorFn: (r) => r.fit, header: "Fit", size: 70, cell: ({ row }) => (row.original.persisted ? <RatingFigure value={row.original.fit} /> : <span className="text-secondary">—</span>), meta: { numeric: true } },
    {
      id: "stars",
      accessorFn: (r) => r.stars,
      header: "Potential",
      size: 120,
      cell: ({ row }) => (row.original.persisted ? <StarRating value={row.original.stars} label={`${row.original.meta?.label ?? row.original.channelKey} potential`} showValue /> : <span className="text-secondary">—</span>),
      meta: { numeric: true },
    },
    {
      id: "cpa",
      accessorFn: (r) => r.cpaRange?.high ?? r.form?.cpaMinor ?? null,
      header: "Cost per customer",
      size: 190,
      cell: ({ row }) => {
        const r = row.original;
        if (r.cpaRange) {
          return (
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              {formatMoney({ amountMinor: r.cpaRange.low, currency: r.currency })} – {formatMoney({ amountMinor: r.cpaRange.high, currency: r.currency })} <ProvenanceChip kind="estimate" />
            </span>
          );
        }
        if (r.form?.cpaMinor !== null && r.form?.cpaMinor !== undefined) {
          return (
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              {formatMoney({ amountMinor: r.form.cpaMinor, currency: r.currency })} <ProvenanceChip kind="estimate" />
            </span>
          );
        }
        return <span className="text-secondary">No range yet</span>;
      },
      meta: { numeric: true, label: "Cost per customer (Estimate)" },
    },
    { id: "cpaActual", accessorFn: (r) => r.form?.cpaMinor ?? null, header: "CPA (35 days)", size: 130, cell: ({ row }) => (row.original.form?.cpaMinor != null ? <span className="inline-flex items-center gap-1.5 tabular-nums">{formatMoney({ amountMinor: row.original.form.cpaMinor, currency: row.original.currency })} <ProvenanceChip kind="estimate" /></span> : <span className="text-secondary">—</span>), meta: { numeric: true, label: "CPA, 35 days (Estimate)" } },
    { id: "budget", accessorFn: (r) => r.budgetMinor, header: "Budget / month", size: 130, cell: ({ row }) => <span className="tabular-nums">{row.original.persisted ? formatMoney({ amountMinor: row.original.budgetMinor, currency: row.original.currency }) : "—"}</span>, meta: { numeric: true } },
    {
      id: "status",
      accessorFn: (r) => channelStatus(r).word,
      header: "Status",
      size: 130,
      cell: ({ row }) => {
        const s = channelStatus(row.original);
        return <StatusPill tone={s.tone}>{s.word}</StatusPill>;
      },
      meta: { filter: "select", filterOptions: ["Running", "Paused", "Off the board", "Not scored"].map((w) => ({ value: w, label: w })) },
    },
    { id: "enabled", accessorFn: (r) => r.enabled, header: "Running", size: 90, cell: ({ getValue }) => (getValue() ? "Yes" : "No"), meta: { filter: "boolean" } },
    {
      id: "tracking",
      accessorFn: (r) => !!r.kitMode,
      header: "Tracking",
      size: 140,
      cell: ({ row }) => (row.original.kitMode ? <Chip tone="info">{OFFLINE_TRACKING_LABEL}</Chip> : <span className="text-secondary">Connected</span>),
      meta: { filter: "boolean", label: "Offline tracking" },
    },
    { id: "leads", accessorFn: (r) => r.form?.leads ?? 0, header: "Leads (35 d)", size: 100, cell: ({ getValue }) => <span className="tabular-nums">{formatNumber(Number(getValue() ?? 0), { digits: 0 })}</span>, meta: { numeric: true } },
    { id: "customers", accessorFn: (r) => r.form?.customers ?? 0, header: "Customers (35 d)", size: 120, cell: ({ getValue }) => <span className="tabular-nums">{formatNumber(Number(getValue() ?? 0), { digits: 0 })}</span>, meta: { numeric: true } },
  ];
}

export interface ChannelsScreenProps extends ModuleScreenProps {
  /** Wait after the last toggle before the Strategist re-scores (default `RESCORE_DEBOUNCE_MS`). */
  rescoreDelayMs?: number;
}

export function ChannelsScreen({ businessId, rescoreDelayMs = RESCORE_DEBOUNCE_MS }: ChannelsScreenProps) {
  const { navigate, currency } = useWidgetData();
  const today = dayKey();
  const channels = useWidgetQuery<ChannelsListResponse>("distribution.channels.list", {});
  const campaigns = useWidgetQuery<Page<CampaignRow>>("distribution.campaigns.list", { limit: 200 });
  const metrics = useWidgetQuery<ChannelMetricRow[]>("distribution.channels.metrics", { from: addDays(today, -METRICS_WINDOW_DAYS) });
  const departments = useDepartments();
  const action = useAction();
  const [views, setViews] = useState<SavedView[]>(CHANNEL_VIEWS);
  const [recommendation, setRecommendation] = useState<RecommendationRow[] | null>(null);
  const [highlight] = useState<string | null>(() => searchParam("channel"));
  const [budgetFor, setBudgetFor] = useState<ChannelView | null>(null);
  useBusinessEvents(() => channels.refetch(), ["campaign.launched", "channel.threshold_breached"]);

  // Toggled since the Strategist last scored: local scores until its re-score lands (rescore.ts).
  const [provisional, setProvisional] = useState(false);
  const rows = useMemo(() => {
    const built = buildChannelViews({ channels: channels.data?.channels, campaigns: campaigns.data?.items, metrics: metrics.data, recommendation, currency: currency ?? "EUR", today });
    return provisional ? localScores(built) : built;
  }, [channels.data, campaigns.data, metrics.data, recommendation, currency, today, provisional]);
  const columns = useMemo(() => channelColumns(), []);

  const rescore = useCallback(async () => {
    try {
      const result = await action.run<RecommendResponse>("distribution.recommend", {}, { key: "recommend" });
      if (result?.recommendation) setRecommendation(result.recommendation);
      channels.refetch();
    } finally {
      setProvisional(false);
    }
  }, [action, channels]);
  // One re-score after a run of toggles, not one per toggle (audit P7; revisits DECISIONS 2026-10-07).
  const rescoreSoon = useDebouncedRun(rescore, rescoreDelayMs);
  const rescoreNow = useCallback(() => {
    rescoreSoon.cancel();
    void rescore();
  }, [rescoreSoon, rescore]);

  const toggle = useCallback(
    async (row: ChannelView, enabled: boolean) => {
      const ok = await action.run(enabled ? "distribution.channels.enable" : "distribution.channels.disable", { channelKey: row.channelKey }, { key: `toggle:${row.channelKey}` });
      if (ok === undefined) return;
      // The row moves at once; the Strategist re-scores two seconds after the last toggle.
      setProvisional(true);
      channels.refetch();
      rescoreSoon.schedule();
    },
    [action, channels, rescoreSoon],
  );

  const pause = useCallback(
    async (row: ChannelView, paused: boolean) => {
      const targets = row.campaigns.filter((c) => (paused ? c.status === "live" || c.status === "scheduled" : c.status === "paused"));
      for (const c of targets) await action.run("distribution.campaigns.setStatus", { campaignId: c.id, status: paused ? "paused" : "live" }, { key: `pause:${row.channelKey}` });
      campaigns.refetch();
    },
    [action, campaigns],
  );

  const openProfile = useCallback(
    (key: ChannelKey) => {
      const href = moduleHref(businessId, departments.data, "distribution", "formation");
      if (href) navigate(`${href}?channel=${key}`);
    },
    [businessId, departments.data, navigate],
  );

  const rowActions = useCallback(
    (row: ChannelView): RowAction<ChannelView>[] => [
      { id: "open", label: "Open profile", icon: ExternalLink, onSelect: (r) => openProfile(r.channelKey) },
      row.enabled
        ? { id: "bench", label: "Take off the board", icon: ArrowDownToLine, onSelect: (r) => void toggle(r, false), separatorBefore: true }
        : { id: "start", label: "Move to Board", icon: ArrowUpToLine, onSelect: (r) => void toggle(r, true), separatorBefore: true },
      { id: "pause", label: row.paused ? "Resume campaigns" : "Pause campaigns", icon: row.paused ? Play : Pause, onSelect: (r) => void pause(r, !r.paused), disabled: !row.enabled || row.campaigns.length === 0 },
      { id: "budget", label: "Set budget…", icon: Coins, onSelect: (r) => setBudgetFor(r), disabled: !row.persisted, separatorBefore: true },
    ],
    [openProfile, toggle, pause],
  );

  const scored = rows.filter((r) => r.persisted).length;
  return (
    <Screen name="distribution/channels">
      <Panel
        title="Channels"
        span={12}
        loading={channels.isLoading}
        error={channels.error ? channels.error.message : undefined}
        onRetry={channels.refetch}
        actions={
          <>
            {rescoreSoon.pending ? (
              <Chip tone="neutral" data-testid="rescore-pending">
                Local scores · re-scoring shortly
              </Chip>
            ) : null}
            <Button size="sm" variant="ghost" loading={action.pending === "recommend"} onClick={rescoreNow}>
              {scored === 0 ? "Get recommendation" : "Re-score"}
            </Button>
          </>
        }
        footer={
          <span className="tabular-nums">
            {rows.filter((r) => r.enabled).length} on the Board · {scored} of 15 scored · cost-per-customer figures are an <ProvenanceChip kind="estimate" />
          </span>
        }
        flush
      >
        <InlineError error={action.error} className="px-panel-pad pt-2" />
        <DataTable<ChannelView>
          aria-label="Channels"
          data={rows}
          columns={columns}
          getRowId={(r) => r.channelKey}
          views={views}
          onViewsChange={setViews}
          defaultViewId="all"
          rowActions={rowActions}
          onRowOpen={(r) => openProfile(r.channelKey)}
          rowClassName={(r) => (r.channelKey === highlight ? "bg-white/4" : undefined)}
          height={520}
          exportFileName="channels"
          empty={{ title: "No channels scored yet", children: "Ask the Distribution Strategist for a recommendation; every channel then appears here with its fit, potential and cost range.", action: { label: "Get recommendation", onClick: rescoreNow } }}
        />
      </Panel>
      <BudgetDialog row={budgetFor} action={action} onClose={() => setBudgetFor(null)} onSaved={() => channels.refetch()} />
    </Screen>
  );
}

function BudgetDialog({ row, action, onClose, onSaved }: { row: ChannelView | null; action: ReturnType<typeof useAction>; onClose: () => void; onSaved: () => void }) {
  const id = useId();
  const [value, setValue] = useState("");
  useEffect(() => {
    setValue(row ? String(Math.round(row.budgetMinor / 100)) : "");
  }, [row]);
  const save = async () => {
    if (!row) return;
    const major = Number(value);
    if (!Number.isFinite(major) || major < 0) return;
    const ok = await action.run("distribution.channels.budget", { channelId: row.id, budgetMinor: Math.round(major * 100), currency: row.currency }, { key: `budget:${row.id}` });
    if (ok !== undefined) {
      onSaved();
      onClose();
    }
  };
  return (
    <Dialog open={!!row} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Set budget</DialogTitle>
          <DialogDescription>{row ? `${row.meta?.label ?? row.channelKey}, per month in ${row.currency}. Engines spend within this share.` : ""}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <label htmlFor={id} className="flex flex-col gap-1">
            <span className="t-label">Monthly budget</span>
            <Input id={id} numeric inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          </label>
          <InlineError error={action.error} className="mt-2" />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={!!row && action.pending === `budget:${row.id}`} onClick={save}>
            Save budget
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
