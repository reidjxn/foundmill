"use client";
/**
 * Distribution › Channels (BUILD §11.7): a DataTable of the 15 channels — line, fit, potential stars, cost-per-customer
 * range (Estimate), budget, status and the offline-tracking chip — with saved views and right-click verbs
 * (open profile, move on/off the Board, pause/resume, set budget).
 */
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpToLine, Coins, ExternalLink, Pause, Play, ThumbsUp } from "lucide-react";
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
  Field,
  MoneyInput,
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
import { CHANNEL_LINES, CHANNEL_WINDOW_DAYS, type ChannelKey } from "@foundmill/shared/constants";
import { addDays } from "@foundmill/widgets/shared/time";
import { moduleHref, useDepartments } from "@foundmill/widgets/shared/departments";
import { useBusinessEvents, useToday, useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import { useSavedViews } from "@foundmill/widgets/shared/saved-views";
import { usePinToHomeMenu } from "@foundmill/widgets/shared/pin";
import type { ModuleScreenProps } from "../registry";
import { buildChannelViews, channelStatus, type ChannelView } from "./channel-data";
import { METRICS_WINDOW_DAYS } from "./FormationScreen";
import { localScores, RESCORE_DEBOUNCE_MS, useDebouncedRun } from "./rescore";
import { fitColumns, fitToGrow, type ColumnFit } from "../fit";
import { EstimatedMoney, InlineError, LINE_LABELS, OFFLINE_TRACKING_LABEL, Screen, fitTableHeight, parseMajor, searchParam, useAction } from "./shared";
import type { CampaignRow, ChannelMetricRow, ChannelsListResponse, Page, RecommendResponse, RecommendationRow } from "./types";

export const CHANNEL_VIEWS: SavedView[] = [
  { id: "all", name: "All channels", builtIn: true, columns: ["label", "line", "fit", "stars", "cpa", "budget", "status", "tracking"], sort: [{ id: "fit", desc: true }], filters: [] },
  { id: "running", name: "Running", builtIn: true, columns: ["label", "fit", "budget", "status", "leads", "customers", "cpaActual"], sort: [{ id: "fit", desc: true }], filters: [{ id: "f-run", field: "enabled", op: "eq", value: true }] },
  { id: "bench", name: "Off the board", builtIn: true, columns: ["label", "line", "fit", "stars", "cpa", "status"], sort: [{ id: "fit", desc: true }], filters: [{ id: "f-bench", field: "enabled", op: "eq", value: false }] },
  { id: "offline", name: "Offline tracking", builtIn: true, columns: ["label", "line", "fit", "budget", "status", "tracking"], sort: [{ id: "fit", desc: true }], filters: [{ id: "f-off", field: "tracking", op: "eq", value: true }] },
];

/**
 * What each column's content needs (px, cell padding included) and its share of the spare width. The default view
 * sums to 966 px, inside the 980 px the table has at 1280; the Running view drops Family to fit its 35-day figures.
 */
export const CHANNEL_FIT = {
  label: { min: 170, grow: 3 },
  line: { min: 104, grow: 1 },
  fit: { min: 56 },
  stars: { min: 110 },
  cpa: { min: 146 },
  cpaActual: { min: 184 },
  budget: { min: 130 },
  status: { min: 130, grow: 1 },
  enabled: { min: 90 },
  tracking: { min: 130, grow: 1 },
  leads: { min: 108 },
  customers: { min: 132 },
} satisfies Record<string, ColumnFit>;
export type ChannelColumnId = keyof typeof CHANNEL_FIT;

/** The Strategist's pick: the Board's thumbs-up disc beside the name (a shape and a tooltip, never colour alone). */
export function RecommendedMark() {
  return (
    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-kit-primary text-kit-on-primary" title="Recommended by the Distribution Strategist">
      <ThumbsUp size={11} strokeWidth={2.25} aria-hidden />
      <span className="sr-only">Recommended</span>
    </span>
  );
}

export function channelColumns(sizes: Record<ChannelColumnId, number> = fitColumns<ChannelColumnId>(null, CHANNEL_FIT, [])): DataTableColumn<ChannelView>[] {
  return [
    {
      id: "label",
      accessorFn: (r) => r.meta?.label ?? r.channelKey,
      header: "Channel",
      size: sizes.label,
      cell: ({ row }) => {
        const label = row.original.meta?.label ?? row.original.channelKey;
        return (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-body-strong text-primary" title={label} data-channel-name="">
              {label}
            </span>
            {row.original.recommended ? <RecommendedMark /> : null}
          </span>
        );
      },
      meta: { locked: true },
    },
    {
      id: "line",
      accessorFn: (r) => LINE_LABELS[r.line],
      header: "Family",
      size: sizes.line,
      meta: { filter: "select", filterOptions: CHANNEL_LINES.map((l) => ({ value: LINE_LABELS[l], label: LINE_LABELS[l] })) },
    },
    { id: "fit", accessorFn: (r) => r.fit, header: "Fit", size: sizes.fit, cell: ({ row }) => (row.original.persisted ? <RatingFigure value={row.original.fit} /> : <span className="text-secondary">—</span>), meta: { numeric: true } },
    {
      id: "stars",
      accessorFn: (r) => r.stars,
      header: "Potential",
      size: sizes.stars,
      cell: ({ row }) => (row.original.persisted ? <StarRating value={row.original.stars} label={`${row.original.meta?.label ?? row.original.channelKey} potential`} showValue /> : <span className="text-secondary">—</span>),
      meta: { numeric: true },
    },
    {
      id: "cpa",
      accessorFn: (r) => r.cpaRange?.high ?? r.form?.cpaMinor ?? null,
      header: "Cost per customer",
      size: sizes.cpa,
      cell: ({ row }) => <CostPerCustomer view={row.original} />,
      meta: { numeric: true, label: "Cost per customer (Estimate)" },
    },
    { id: "cpaActual", accessorFn: (r) => r.form?.cpaMinor ?? null, header: `Cost per customer, ${CHANNEL_WINDOW_DAYS} days`, size: sizes.cpaActual, cell: ({ row }) => <EstimatedMoney amountMinor={row.original.form?.cpaMinor ?? null} currency={row.original.currency} spendMinor={row.original.form?.spendMinor ?? null} />, meta: { numeric: true, label: `Cost per customer, ${CHANNEL_WINDOW_DAYS} days (Estimate)` } },
    { id: "budget", accessorFn: (r) => r.budgetMinor, header: "Monthly budget", size: sizes.budget, cell: ({ row }) => <span className="tabular-nums">{row.original.persisted ? formatMoney({ amountMinor: row.original.budgetMinor, currency: row.original.currency }) : "—"}</span>, meta: { numeric: true } },
    {
      id: "status",
      accessorFn: (r) => channelStatus(r).word,
      header: "Status",
      size: sizes.status,
      cell: ({ row }) => {
        const s = channelStatus(row.original);
        return (
          <StatusPill tone={s.tone} className="whitespace-nowrap">
            {s.word}
          </StatusPill>
        );
      },
      meta: { filter: "select", filterOptions: ["Running", "Paused", "Off the board", "Not scored"].map((w) => ({ value: w, label: w })) },
    },
    { id: "enabled", accessorFn: (r) => r.enabled, header: "Running", size: sizes.enabled, cell: ({ getValue }) => (getValue() ? "Yes" : "No"), meta: { filter: "boolean" } },
    {
      id: "tracking",
      accessorFn: (r) => !!r.kitMode,
      header: "Tracking",
      size: sizes.tracking,
      cell: ({ row }) => (row.original.kitMode ? <Chip tone="info" className="whitespace-nowrap">{OFFLINE_TRACKING_LABEL}</Chip> : <span className="text-secondary">Connected</span>),
      meta: { filter: "boolean", label: "Offline tracking" },
    },
    { id: "leads", accessorFn: (r) => r.form?.leads ?? 0, header: `Leads, ${CHANNEL_WINDOW_DAYS} days`, size: sizes.leads, cell: ({ getValue }) => <span className="tabular-nums">{formatNumber(Number(getValue() ?? 0), { digits: 0 })}</span>, meta: { numeric: true } },
    { id: "customers", accessorFn: (r) => r.form?.customers ?? 0, header: `Customers, ${CHANNEL_WINDOW_DAYS} days`, size: sizes.customers, cell: ({ getValue }) => <span className="tabular-nums">{formatNumber(Number(getValue() ?? 0), { digits: 0 })}</span>, meta: { numeric: true } },
  ];
}

/** The Strategist's cost-per-customer range when it has one, else the measured cost, else why there is none. */
export function CostPerCustomer({ view }: { view: ChannelView }) {
  if (view.cpaRange && view.cpaRange.high > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 tabular-nums">
        {formatMoney({ amountMinor: view.cpaRange.low, currency: view.currency })} – {formatMoney({ amountMinor: view.cpaRange.high, currency: view.currency })} <ProvenanceChip kind="estimate" />
      </span>
    );
  }
  if (view.form?.cpaMinor !== null && view.form?.cpaMinor !== undefined) return <EstimatedMoney amountMinor={view.form.cpaMinor} currency={view.currency} spendMinor={view.form.spendMinor} />;
  return <span className="text-secondary">No range yet</span>;
}

export interface ChannelsScreenProps extends ModuleScreenProps {
  /** Wait after the last toggle before the Strategist re-scores (default `RESCORE_DEBOUNCE_MS`). */
  rescoreDelayMs?: number;
}

export function ChannelsScreen({ businessId, rescoreDelayMs = RESCORE_DEBOUNCE_MS }: ChannelsScreenProps) {
  const { navigate, currency } = useWidgetData();
  const today = useToday();
  const channels = useWidgetQuery<ChannelsListResponse>("distribution.channels.list", {});
  // Pin to Home (audit #394): the channels are the gallery's Channel performance widget.
  const pinMenu = usePinToHomeMenu({ key: "channel_form_guide" });
  const campaigns = useWidgetQuery<Page<CampaignRow>>("distribution.campaigns.list", { limit: 200 });
  const metrics = useWidgetQuery<ChannelMetricRow[]>("distribution.channels.metrics", { from: addDays(today, -(METRICS_WINDOW_DAYS - 1)) });
  const departments = useDepartments();
  const action = useAction();
  // Saved per person, business and table (audit #204): they come back after a reload.
  const savedViews = useSavedViews("distribution.channels", CHANNEL_VIEWS, { defaultViewId: "all" });
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
  const columns = useMemo(() => fitToGrow(channelColumns(), CHANNEL_FIT), []);

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
        menu={pinMenu}
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
        meta={`${rows.filter((r) => r.enabled).length} on the board · ${scored} of 15 scored`}
        footer={
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <RecommendedMark /> marks the Distribution Strategist's picks. Cost per customer is an <ProvenanceChip kind="estimate" /> until the conversion API confirms it. Right-click a channel to move it on or off the board, pause it or set its budget.
          </span>
        }
        flush
      >
        <InlineError error={action.error} className="px-panel-pad pt-2" />
        <div className="min-w-0">
        <DataTable<ChannelView>
          aria-label="Channels"
          data={rows}
          columns={columns}
          getRowId={(r) => r.channelKey}
          {...savedViews}
          defaultViewId="all"
          rowActions={rowActions}
          onRowOpen={(r) => openProfile(r.channelKey)}
          rowClassName={(r) => (r.channelKey === highlight ? "bg-white/4" : undefined)}
          height={fitTableHeight(rows.length, { maxRows: 16 })}
          exportFileName="channels"
          empty={{ title: "No channels scored yet", children: "Ask the Distribution Strategist for a recommendation.", action: { label: "Get recommendation", onClick: rescoreNow } }}
        />
        </div>
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
    const major = parseMajor(value);
    if (major === null || major < 0) return;
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
          <DialogDescription>{row ? `${row.meta?.label ?? row.channelKey}. Engines spend within this share each month.` : ""}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field htmlFor={id} label="Monthly budget">
            <MoneyInput id={id} controlSize="lg" currency={row?.currency} value={value} onValueChange={setValue} autoFocus />
          </Field>
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
