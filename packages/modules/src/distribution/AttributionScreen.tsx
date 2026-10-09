"use client";
/**
 * Distribution › Attribution (BUILD §11.4 attribution, §11.7 Measure): the model in use (position-based 40/20/40 until
 * 200 labelled wins, then data-driven Markov), the touch funnel from `distribution.channels.list`, the channel
 * attribution table with "Partial journey" labels for offline and consent-limited journeys, and the latest wins.
 */
import { useCallback, useMemo, useState } from "react";
import { ExternalLink, Trophy } from "lucide-react";
import { Button, Chip, DataTable, FunnelChart, KeyValueList, Panel, ProvenanceChip, StatusPill, formatDate, formatMoney, formatNumber, formatPercent, type DataTableColumn, type RowAction, type SavedView } from "@foundmill/dugout";
import { CHANNEL_LINES, type ChannelKey, type MatchdayLevel } from "@foundmill/shared";
import { moduleHref, routes, useBusinessEvents, useDepartments, useWidgetData, useWidgetQuery } from "@foundmill/widgets";
import type { ModuleScreenProps } from "../registry";
import { MODEL_LABELS, attributionRows, buildChannelViews, funnelStages, isPartialJourney, modelInUse, type AttributionRow } from "./channel-data";
import { LINE_LABELS, Screen, channelLabel, toDate, useAction } from "./shared";
import type { ChannelsListResponse, JourneyRow, Page } from "./types";

export const ATTRIBUTION_VIEWS: SavedView[] = [
  { id: "all", name: "All channels", builtIn: true, columns: ["channel", "line", "leads", "signups", "customers", "share", "spend", "cpa", "journey"], sort: [{ id: "customers", desc: true }], filters: [] },
  { id: "running", name: "Running only", builtIn: true, columns: ["channel", "line", "leads", "signups", "customers", "share", "cpa", "journey"], sort: [{ id: "customers", desc: true }], filters: [{ id: "f-run", field: "enabled", op: "eq", value: true }] },
  { id: "partial", name: "Partial journeys", builtIn: true, columns: ["channel", "line", "customers", "share", "journey"], sort: [{ id: "customers", desc: true }], filters: [{ id: "f-part", field: "partial", op: "eq", value: true }] },
];

/** Update levels brief / standard / featured (CLAUDE.md vocabulary over the stored `matchday_level` keys). */
export const UPDATE_LEVEL_WORDS: Record<MatchdayLevel, string> = { friendly: "Brief", league: "Standard", cup: "Featured" };

export function attributionColumns(currency: string): DataTableColumn<AttributionRow>[] {
  const money = (minor: number) => formatMoney({ amountMinor: minor, currency });
  return [
    { id: "channel", accessorFn: (r) => channelLabel(r.channelKey), header: "Channel", size: 180, cell: ({ row }) => <span className="truncate text-body-strong text-primary">{channelLabel(row.original.channelKey)}</span>, meta: { locked: true } },
    { id: "line", accessorFn: (r) => LINE_LABELS[r.line], header: "Family", size: 110, meta: { filter: "select", filterOptions: CHANNEL_LINES.map((l) => ({ value: LINE_LABELS[l], label: LINE_LABELS[l] })) } },
    { id: "enabled", accessorFn: (r) => r.enabled, header: "Running", size: 90, cell: ({ getValue }) => (getValue() ? "Yes" : "No"), meta: { filter: "boolean" } },
    { id: "impressions", accessorFn: (r) => r.impressions, header: "Impressions", size: 110, cell: ({ getValue }) => <span className="tabular-nums">{formatNumber(Number(getValue()), { digits: 0 })}</span>, meta: { numeric: true } },
    { id: "leads", accessorFn: (r) => r.leads, header: "Leads", size: 90, cell: ({ getValue }) => <span className="tabular-nums">{formatNumber(Number(getValue()), { digits: 0 })}</span>, meta: { numeric: true } },
    { id: "signups", accessorFn: (r) => r.signups, header: "Signups", size: 90, cell: ({ getValue }) => <span className="tabular-nums">{formatNumber(Number(getValue()), { digits: 0 })}</span>, meta: { numeric: true } },
    { id: "customers", accessorFn: (r) => r.customers, header: "Customers", size: 100, cell: ({ getValue }) => <span className="tabular-nums">{formatNumber(Number(getValue()), { digits: 0 })}</span>, meta: { numeric: true } },
    { id: "share", accessorFn: (r) => r.share, header: "Share of customers", size: 150, cell: ({ getValue }) => <span className="tabular-nums">{formatPercent(Number(getValue()), { digits: 0 })}</span>, meta: { numeric: true } },
    { id: "spend", accessorFn: (r) => r.spendMinor, header: "Spend (35 d)", size: 120, cell: ({ getValue }) => <span className="tabular-nums">{money(Number(getValue()))}</span>, meta: { numeric: true } },
    {
      id: "cpa",
      accessorFn: (r) => r.cpaMinor ?? null,
      header: "Cost per customer",
      size: 170,
      cell: ({ row }) =>
        row.original.cpaMinor === null ? (
          <span className="text-secondary">No customers yet</span>
        ) : (
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            {money(row.original.cpaMinor)} <ProvenanceChip kind="estimate" />
          </span>
        ),
      meta: { numeric: true, label: "Cost per customer (Estimate)" },
    },
    { id: "partial", accessorFn: (r) => r.partial, header: "Partial", size: 80, cell: ({ getValue }) => (getValue() ? "Yes" : "No"), meta: { filter: "boolean" } },
    {
      id: "journey",
      accessorFn: (r) => (r.partial ? "Partial journey" : "Measured"),
      header: "Journey",
      size: 150,
      cell: ({ row }) => (row.original.partial ? <Chip tone="warn" title="Offline touches are inferred from codes, vanity URLs and QR scans, so the journey before them is unknown.">Partial journey</Chip> : <Chip tone="good">Measured</Chip>),
      meta: { filter: "select", filterOptions: [{ value: "Partial journey", label: "Partial journey" }, { value: "Measured", label: "Measured" }] },
    },
  ];
}

export function AttributionScreen({ businessId }: ModuleScreenProps) {
  const { navigate, currency } = useWidgetData();
  const channels = useWidgetQuery<ChannelsListResponse>("distribution.channels.list", {});
  const journeys = useWidgetQuery<Page<JourneyRow>>("journey.list", { limit: 200 });
  const departments = useDepartments();
  const action = useAction();
  const [views, setViews] = useState<SavedView[]>(ATTRIBUTION_VIEWS);
  useBusinessEvents(() => {
    channels.refetch();
    journeys.refetch();
  }, ["customer.converted", "signup.created", "activation.reached"]);

  const cur = currency ?? "EUR";
  const channelViews = useMemo(() => buildChannelViews({ channels: channels.data?.channels, currency: cur }), [channels.data, cur]);
  const rows = useMemo(() => attributionRows(channelViews, channels.data?.blended), [channelViews, channels.data]);
  const columns = useMemo(() => attributionColumns(cur), [cur]);
  const wins = useMemo(() => journeys.data?.items ?? [], [journeys.data]);
  const partialWins = wins.filter(isPartialJourney).length;
  const paying = wins.filter((w) => w.conversion.kind === "payment").length;
  const model = modelInUse(paying);
  const stages = useMemo(() => funnelStages(channels.data?.blended), [channels.data]);

  const openChannel = useCallback(
    (key: ChannelKey) => {
      const href = moduleHref(businessId, departments.data, "distribution", "formation");
      if (href) navigate(`${href}?channel=${key}`);
    },
    [businessId, departments.data, navigate],
  );
  const rowActions = useCallback((): RowAction<AttributionRow>[] => [{ id: "open", label: "Open channel profile", icon: ExternalLink, onSelect: (r) => openChannel(r.channelKey) }], [openChannel]);
  const latest = useMemo(() => wins.slice().sort((a, b) => (toDate(b.conversion.occurredAt)?.getTime() ?? 0) - (toDate(a.conversion.occurredAt)?.getTime() ?? 0)).slice(0, 5), [wins]);

  return (
    <Screen name="distribution/attribution">
      <Panel title="Model in use" span={4} loading={journeys.isLoading} error={journeys.error ? journeys.error.message : undefined} onRetry={journeys.refetch}>
        <div className="flex flex-col gap-2">
          <p className="t-display-sm text-primary">{MODEL_LABELS[model.model]}</p>
          <KeyValueList
            dense
            layout="rows"
            items={[
              { label: "Labelled wins", value: formatNumber(paying, { digits: 0 }), numeric: true },
              { label: "Switch to data-driven at", value: formatNumber(model.threshold, { digits: 0 }), numeric: true },
              { label: "Partial journeys", value: `${partialWins} of ${wins.length}`, numeric: true, hint: "Consent removed third-party touches, so only first-party touches were weighted." },
            ]}
          />
          <p className="text-small text-secondary">
            {model.model === "position_based_40_20_40" ? `${model.remaining} more paying customers before the Markov removal-effect model takes over.` : "Weights come from the removal effect over every recorded conversion path; the position-based model is the fallback for paths the model has not seen."}
          </p>
          <section aria-label="Latest wins" className="flex flex-col gap-1 border-t border-subtle pt-2">
            <p className="t-label">Latest wins</p>
            {latest.length === 0 ? (
              <p className="text-small text-secondary">No wins yet. Each won customer gets a Customer Update with its touches weighted by the model.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {latest.map((w) => (
                  <li key={w.id} className="flex items-center gap-2 text-small">
                    <StatusPill tone={w.conversion.kind === "payment" ? "good" : "info"} icon={w.conversion.kind === "payment" ? Trophy : undefined}>
                      {UPDATE_LEVEL_WORDS[w.matchdayLevel]}
                    </StatusPill>
                    <span className="tabular-nums text-secondary">{formatDate(w.conversion.occurredAt)}</span>
                    <span className="truncate text-primary">{w.conversion.kind === "payment" ? formatMoney({ amountMinor: w.conversion.amountMinor, currency: w.conversion.currency || cur }) : w.conversion.kind}</span>
                    {isPartialJourney(w) ? <Chip tone="warn">Partial journey</Chip> : null}
                    <Button size="sm" variant="ghost" className="ml-auto" onClick={() => navigate(routes.journey(businessId, w.id))} aria-label={`Open Customer Update ${formatDate(w.conversion.occurredAt)}`}>
                      Open
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </Panel>
      <Panel
        title="Touch funnel"
        span={8}
        loading={channels.isLoading}
        error={channels.error ? channels.error.message : undefined}
        onRetry={channels.refetch}
        empty={channels.data && stages.every((s) => s.value === 0) ? "The funnel fills as channels report impressions, leads, signups, activations and customers." : undefined}
        footer={
          <span>
            Trailing 35 days across every channel. Counts come from links, codes, webhooks and conversion APIs; where a channel reports estimates they are an <ProvenanceChip kind="estimate" />.
          </span>
        }
      >
        <FunnelChart stages={stages} label="Touch funnel, impressions to customers" provenance="estimate" />
      </Panel>
      <Panel
        title="Channel attribution"
        span={12}
        loading={channels.isLoading}
        error={channels.error ? channels.error.message : undefined}
        onRetry={channels.refetch}
        footer={
          <span className="tabular-nums">
            {rows.length} channels with activity · share is of measured customers; offline channels carry partial journeys because the touches before a code redemption are unknown.
          </span>
        }
        flush
      >
        <DataTable<AttributionRow>
          aria-label="Channel attribution"
          data={rows}
          columns={columns}
          getRowId={(r) => r.channelKey}
          views={views}
          onViewsChange={setViews}
          defaultViewId="all"
          rowActions={rowActions}
          onRowOpen={(r) => openChannel(r.channelKey)}
          height={420}
          exportFileName="channel-attribution"
          empty={{ title: "No measured touches yet", children: "Once a channel runs, its leads, signups and customers land here with the share each channel earns under the model in use." }}
        />
        {action.error ? <p className="px-panel-pad py-2 text-small text-status-bad">{action.error.message}</p> : null}
      </Panel>
    </Screen>
  );
}
