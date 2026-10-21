"use client";
/**
 * Distribution › Attribution (BUILD §11.4 attribution, §11.7 Measure): the model in use (position-based 40/20/40 until
 * 200 labeled conversions, then data-driven Markov) and the partial-journey count from `journey.attribution`, counted
 * over the whole history on the basis the journey builder and the replays use; the touch funnel from
 * `distribution.channels.list`, the channel attribution table with "Partial journey" labels for offline and
 * consent-limited journeys, and the latest wins.
 */
import { useCallback, useMemo } from "react";
import { ChevronRight, ExternalLink, Route, Trophy } from "lucide-react";
import { Button, Chip, DataTable, FunnelChart, KeyValueList, Panel, ProvenanceChip, StatusPill, Term, formatMoney, formatNumber, formatPercent, useFormatters, type DataTableColumn, type RowAction, type SavedView } from "@foundmill/dugout";
import { CHANNEL_LINES, CHANNEL_WINDOW_DAYS, type ChannelKey, type MatchdayLevel } from "@foundmill/shared/constants";
import { moduleHref, useDepartments } from "@foundmill/widgets/shared/departments";
import { routes } from "@foundmill/widgets/shared/routes";
import { useBusinessEvents, useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import { useSavedViews } from "@foundmill/widgets/shared/saved-views";
import { usePinToHomeMenu } from "@foundmill/widgets/shared/pin";
import type { ModuleScreenProps } from "../registry";
import { MODEL_LABELS, attributionRows, buildChannelViews, funnelStages, type AttributionRow } from "./channel-data";
import { fitColumns, fitToGrow, type ColumnFit } from "../fit";
import { EstimatedMoney, LINE_LABELS, SIMPLE_VIEW_ID, Screen, channelLabel, fitTableHeight, herePath, plainWords, useAction, useDefaultViewId } from "./shared";
import type { AttributionSummaryResponse, ChannelsListResponse, JourneyRow, Page } from "./types";

export const ATTRIBUTION_VIEWS: SavedView[] = [
  // Simple (UX plan §7.10): who won the customers and what each one cost; the table opens on it while guidance is on.
  { id: SIMPLE_VIEW_ID, name: "Simple", builtIn: true, columns: ["channel", "customers", "share", "cpa"], sort: [{ id: "customers", desc: true }], filters: [] },
  { id: "all", name: "All channels", builtIn: true, columns: ["channel", "line", "leads", "signups", "customers", "share", "spend", "cpa", "journey"], sort: [{ id: "customers", desc: true }], filters: [] },
  { id: "running", name: "Running only", builtIn: true, columns: ["channel", "line", "leads", "signups", "customers", "share", "cpa", "journey"], sort: [{ id: "customers", desc: true }], filters: [{ id: "f-run", field: "enabled", op: "eq", value: true }] },
  { id: "partial", name: "Partial journeys", builtIn: true, columns: ["channel", "line", "customers", "share", "journey"], sort: [{ id: "customers", desc: true }], filters: [{ id: "f-part", field: "partial", op: "eq", value: true }] },
];

/** Update levels brief / standard / featured (CLAUDE.md vocabulary over the stored `matchday_level` keys). */
export const UPDATE_LEVEL_WORDS: Record<MatchdayLevel, string> = { friendly: "Brief", league: "Standard", cup: "Featured" };
/** What each Customer Update level means, as the level pill's tooltip (UX plan §7.18, C24). */
export const UPDATE_LEVEL_HINT = "Brief = signup, Standard = activation, Featured = first payment";

/** The channel window in words, the same on every screen that shows channel figures. */
const WINDOW_WORDS = `last ${CHANNEL_WINDOW_DAYS} days`;
/** How many of the newest wins the panel lists. */
const LATEST_WINS = 5;

/** Conversion kinds as words; payments show their amount instead. */
const CONVERSION_WORDS: Record<string, string> = { signup: "Signup", activation: "Activation", lead: "Lead", trial: "Trial started", order: "Order" };

/**
 * How credit for a win is shared, in one plain sentence per model (UX plan §7.13, C7). The model's name and its
 * mechanics stay under "Technical detail".
 */
export function creditSharingHeadline(model: AttributionSummaryResponse["attributionModel"]): string {
  return model === "data_driven_markov" ? "Each touch gets the credit it earned: the more wins depended on it, the bigger its share." : "Early touches get 40 %, the last touch 40 %, the middle 20 %.";
}

/** What each column's content needs and its share of the spare width: every view fits the 980 px table at 1280. */
export const ATTRIBUTION_FIT = {
  channel: { min: 140, grow: 2 },
  line: { min: 104, grow: 1 },
  enabled: { min: 90 },
  impressions: { min: 112 },
  leads: { min: 80 },
  signups: { min: 84 },
  customers: { min: 104 },
  share: { min: 84 },
  spend: { min: 100 },
  cpa: { min: 146 },
  partial: { min: 80 },
  journey: { min: 136, grow: 1 },
} satisfies Record<string, ColumnFit>;
export type AttributionColumnId = keyof typeof ATTRIBUTION_FIT;

export function attributionColumns(currency: string, sizes: Record<AttributionColumnId, number> = fitColumns<AttributionColumnId>(null, ATTRIBUTION_FIT, [])): DataTableColumn<AttributionRow>[] {
  const money = (minor: number) => formatMoney({ amountMinor: minor, currency });
  return [
    { id: "channel", accessorFn: (r) => channelLabel(r.channelKey), header: "Channel", size: sizes.channel, cell: ({ row }) => <span className="truncate text-body-strong text-primary">{channelLabel(row.original.channelKey)}</span>, meta: { locked: true } },
    { id: "line", accessorFn: (r) => LINE_LABELS[r.line], header: "Family", size: sizes.line, meta: { filter: "select", filterOptions: CHANNEL_LINES.map((l) => ({ value: LINE_LABELS[l], label: LINE_LABELS[l] })) } },
    { id: "enabled", accessorFn: (r) => r.enabled, header: "Running", size: sizes.enabled, cell: ({ getValue }) => (getValue() ? "Yes" : "No"), meta: { filter: "boolean" } },
    { id: "impressions", accessorFn: (r) => r.impressions, header: "Impressions", size: sizes.impressions, cell: ({ getValue }) => <span className="tabular-nums">{formatNumber(Number(getValue()), { digits: 0 })}</span>, meta: { numeric: true } },
    { id: "leads", accessorFn: (r) => r.leads, header: "Leads", size: sizes.leads, cell: ({ getValue }) => <span className="tabular-nums">{formatNumber(Number(getValue()), { digits: 0 })}</span>, meta: { numeric: true } },
    { id: "signups", accessorFn: (r) => r.signups, header: "Signups", size: sizes.signups, cell: ({ getValue }) => <span className="tabular-nums">{formatNumber(Number(getValue()), { digits: 0 })}</span>, meta: { numeric: true } },
    { id: "customers", accessorFn: (r) => r.customers, header: "Customers", size: sizes.customers, cell: ({ getValue }) => <span className="tabular-nums">{formatNumber(Number(getValue()), { digits: 0 })}</span>, meta: { numeric: true } },
    { id: "share", accessorFn: (r) => r.share, header: "Share", size: sizes.share, cell: ({ getValue }) => <span className="tabular-nums">{formatPercent(Number(getValue()), { digits: 0 })}</span>, meta: { numeric: true, label: "Share of customers" } },
    { id: "spend", accessorFn: (r) => r.spendMinor, header: "Spend", size: sizes.spend, cell: ({ getValue }) => <span className="tabular-nums">{money(Number(getValue()))}</span>, meta: { numeric: true, label: `Spend, ${CHANNEL_WINDOW_DAYS} days` } },
    {
      id: "cpa",
      accessorFn: (r) => r.cpaMinor ?? null,
      header: "Cost per customer",
      size: sizes.cpa,
      cell: ({ row }) => <EstimatedMoney amountMinor={row.original.cpaMinor} currency={currency} spendMinor={row.original.spendMinor} />,
      meta: { numeric: true, label: "Cost per customer (Estimate)", term: "acquisition_cost" },
    },
    { id: "partial", accessorFn: (r) => r.partial, header: "Partial", size: sizes.partial, cell: ({ getValue }) => (getValue() ? "Yes" : "No"), meta: { filter: "boolean" } },
    {
      id: "journey",
      accessorFn: (r) => (r.partial ? "Partial journey" : "Measured"),
      header: "Journey",
      size: sizes.journey,
      cell: ({ row }) =>
        row.original.partial ? (
          <StatusPill tone="warn" icon={Route} className="whitespace-nowrap" title="Offline touches are inferred from codes, vanity URLs and QR scans, so the journey before them is unknown.">
            Partial journey
          </StatusPill>
        ) : (
          <StatusPill tone="good" className="whitespace-nowrap">
            Measured
          </StatusPill>
        ),
      meta: { filter: "select", filterOptions: [{ value: "Partial journey", label: "Partial journey" }, { value: "Measured", label: "Measured" }] },
    },
  ];
}

export function AttributionScreen({ businessId }: ModuleScreenProps) {
  const { formatDate } = useFormatters();
  const { navigate, currency } = useWidgetData();
  const channels = useWidgetQuery<ChannelsListResponse>("distribution.channels.list", {});
  // Pin to Home (audit #394): the touch funnel is the gallery's Funnel widget.
  const pinMenu = usePinToHomeMenu({ key: "funnel" });
  // The model in use and the partial count come from the whole history (journey.attribution), never from a page of
  // journeys; the list only feeds the latest wins, newest win first.
  const summary = useWidgetQuery<AttributionSummaryResponse>("journey.attribution", {});
  const journeys = useWidgetQuery<Page<JourneyRow>>("journey.list", { limit: LATEST_WINS, orderBy: "converted" });
  const departments = useDepartments();
  const action = useAction();
  // Saved per person, business and table (audit #204): they come back after a reload. Simple opens first while guidance is on.
  const defaultViewId = useDefaultViewId("all");
  const savedViews = useSavedViews("distribution.attribution", ATTRIBUTION_VIEWS, { defaultViewId });
  useBusinessEvents(() => {
    channels.refetch();
    summary.refetch();
    journeys.refetch();
  }, ["customer.converted", "signup.created", "activation.reached"]);

  const cur = currency;
  const channelViews = useMemo(() => buildChannelViews({ channels: channels.data?.channels, currency: cur }), [channels.data, cur]);
  const rows = useMemo(() => attributionRows(channelViews, channels.data?.blended), [channelViews, channels.data]);
  // A count no channel reports (every row 0, e.g. no lead capture yet) is noise, not data: its column is left out.
  const unmeasured = useMemo(() => (rows.length ? (["impressions", "leads", "signups"] as const).filter((k) => rows.every((r) => r[k] === 0)) : []), [rows]);
  const present = useMemo(() => (Object.keys(ATTRIBUTION_FIT) as AttributionColumnId[]).filter((id) => !(unmeasured as readonly string[]).includes(id)), [unmeasured]);
  const columns = useMemo(() => fitToGrow(attributionColumns(cur), ATTRIBUTION_FIT).filter((c) => present.includes(c.id as AttributionColumnId)), [cur, present]);
  const latest = useMemo(() => journeys.data?.items ?? [], [journeys.data]);
  const model = summary.data ?? null;
  const allStages = useMemo(() => funnelStages(channels.data?.blended), [channels.data]);
  // Impressions are reach, not a step: when the next stage is under 1 % of them their bar dwarfs the rest into
  // hairlines and every rate reads 0 %, so they move to the panel's meta and the funnel starts at the first response.
  const reach = allStages[0]?.label === "Impressions" && allStages.length > 2 && (allStages[1]?.value ?? 0) < (allStages[0]?.value ?? 0) * 0.01 ? allStages[0]!.value : null;
  const stages = reach === null ? allStages : allStages.slice(1);

  const openChannel = useCallback(
    (key: ChannelKey) => {
      const href = moduleHref(businessId, departments.data, "distribution", "formation");
      if (href) navigate(`${href}?channel=${key}`);
    },
    [businessId, departments.data, navigate],
  );
  const rowActions = useCallback((): RowAction<AttributionRow>[] => [{ id: "open", label: "Open channel profile", icon: ExternalLink, onSelect: (r) => openChannel(r.channelKey) }], [openChannel]);
  const modelError = summary.error ?? journeys.error;

  return (
    <Screen name="distribution/attribution">
      <Panel
        title="How credit is shared"
        help="When a customer is won, every channel that touched them along the way gets a share of the credit."
        span={4}
        loading={summary.isLoading || journeys.isLoading}
        error={modelError ? modelError.message : undefined}
        onRetry={() => {
          summary.refetch();
          journeys.refetch();
        }}
      >
        {model ? (
        <div className="flex flex-col gap-3">
          {/* The business thing first (how a win's credit is split), the system thing (the model) behind a disclosure. */}
          <p className="t-display-sm text-pretty text-primary" data-testid="credit-headline">
            {creditSharingHeadline(model.attributionModel)}
          </p>
          <KeyValueList
            dense
            layout="rows"
            labelClassName="w-40"
            items={[
              { label: "Labeled conversions", value: formatNumber(model.conversionCount, { digits: 0 }), numeric: true },
              { label: "Paying customers", value: formatNumber(model.byKind.payment ?? 0, { digits: 0 }), numeric: true },
              { label: "Partial journeys", value: `${formatNumber(model.partialJourneys, { digits: 0 })} of ${formatNumber(model.journeys, { digits: 0 })}`, numeric: true },
            ]}
          />
          {model.partialJourneys ? <p className="text-small text-secondary">Where consent was not granted, only first-party touches were weighted.</p> : null}
          {/* The model's name is information an operator wants, so it stays behind a disclosure in both guidance states
              (an InfoTip would hide it when guidance is off); the panel's help tip carries the one-sentence version. */}
          <details className="group/detail text-small" data-testid="credit-technical">
            <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm text-secondary transition-colors duration-hover ease-out hover:text-primary [&::-webkit-details-marker]:hidden">
              <ChevronRight size={14} aria-hidden className="transition-transform duration-overlay ease-out group-open/detail:rotate-90" />
              Technical detail
            </summary>
            <div className="mt-1.5 flex flex-col gap-1 text-secondary">
              <p>
                <span className="text-body-strong text-primary">{MODEL_LABELS[model.attributionModel]}</span>
              </p>
              <p>
                {model.attributionModel === "position_based_40_20_40"
                  ? `The data-driven model takes over at ${formatNumber(model.threshold, { digits: 0 })} labeled conversions (signups, activations and first payments): ${formatNumber(model.remaining, { digits: 0 })} more to go.`
                  : "Weights come from the removal effect over every recorded conversion path; the position-based model is the fallback for paths the model has not seen."}
              </p>
            </div>
          </details>
          <section aria-label="Latest wins" className="flex flex-col gap-1 border-t border-subtle pt-2">
            <p className="t-title text-primary">Latest wins</p>
            {latest.length === 0 ? (
              <p className="text-small text-secondary">No wins yet. Each won customer gets a Customer Update with its touches weighted by the model.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {latest.map((w) => (
                  // Wraps rather than squeezes: an amount is never truncated, whatever the date and chips beside it take.
                  <li key={w.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small">
                    <StatusPill tone={w.conversion.kind === "payment" ? "good" : "info"} icon={w.conversion.kind === "payment" ? Trophy : undefined} className="shrink-0 whitespace-nowrap" title={UPDATE_LEVEL_HINT}>
                      {UPDATE_LEVEL_WORDS[w.matchdayLevel]}
                    </StatusPill>
                    <span className="shrink-0 tabular-nums text-secondary">{formatDate(w.conversion.occurredAt)}</span>
                    <span className="shrink-0 whitespace-nowrap tabular-nums text-primary">{w.conversion.kind === "payment" ? formatMoney({ amountMinor: w.conversion.amountMinor, currency: w.conversion.currency || cur }) : (CONVERSION_WORDS[w.conversion.kind] ?? plainWords(w.conversion.kind))}</span>
                    {w.partialJourney ? (
                      <Chip tone="warn" className="shrink-0 whitespace-nowrap">
                        Partial journey
                      </Chip>
                    ) : null}
                    <Button size="sm" variant="ghost" className="ml-auto" onClick={() => navigate(routes.journey(businessId, w.id, herePath()))} aria-label={`Open Customer Update ${formatDate(w.conversion.occurredAt)}`}>
                      Open
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        ) : null}
      </Panel>
      <Panel
        title={<Term id="funnel">Touch funnel</Term>}
        menu={pinMenu}
        span={8}
        loading={channels.isLoading}
        error={channels.error ? channels.error.message : undefined}
        onRetry={channels.refetch}
        meta={reach === null ? WINDOW_WORDS : `${WINDOW_WORDS} · ${formatNumber(reach, { digits: 0 })} impressions`}
        actions={stages.length ? <ProvenanceChip kind="estimate" /> : undefined}
        empty={channels.data && stages.every((s) => s.value === 0) ? "The funnel fills as channels report impressions, leads, signups, activations and customers." : undefined}
        footer={<span>Counts come from tracked links, codes and the conversion reports each channel sends back; a stage no channel measures yet is left out.</span>}
      >
        <FunnelChart stages={stages} label={`Touch funnel, ${(stages[0]?.label ?? "impressions").toLowerCase()} to customers`} />
      </Panel>
      <Panel
        title={<Term id="attribution">Channel attribution</Term>}
        span={12}
        loading={channels.isLoading}
        error={channels.error ? channels.error.message : undefined}
        onRetry={channels.refetch}
        meta={`${rows.length} channel${rows.length === 1 ? "" : "s"} with activity · ${WINDOW_WORDS}`}
        footer={<span>Share is of measured customers. Cost per customer is an <Term id="estimate" always>Estimate</Term>: spend divided by the customers a channel brought in. Offline channels carry partial journeys because the touches before a code redemption are unknown.</span>}
        flush
      >
        <div className="min-w-0">
        <DataTable<AttributionRow>
          aria-label="Channel attribution"
          data={rows}
          columns={columns}
          getRowId={(r) => r.channelKey}
          {...savedViews}
          defaultViewId={defaultViewId}
          rowActions={rowActions}
          onRowOpen={(r) => openChannel(r.channelKey)}
          height={fitTableHeight(rows.length, { minRows: 6, maxRows: 15 })}
          exportFileName="channel-attribution"
          empty={{ title: "No measured touches yet", children: "Once a channel runs, its customers land here with the share each one earns." }}
        />
        </div>
        {action.error ? <p className="px-panel-pad py-2 text-small text-status-bad">{action.error.message}</p> : null}
      </Panel>
    </Screen>
  );
}
