"use client";
/**
 * Channel form guide widget (BUILD §11.7 "form guide (last 5 weeks of CPA)"): every enabled channel with its fit,
 * five weekly form cells and this week's cost per customer (Estimate).
 */
import { useMemo } from "react";
import { z } from "zod";
import { Megaphone } from "lucide-react";
import { CHANNEL_META, type ChannelKey } from "@foundmill/shared/constants";
import { FormGuide, MiniTable, ProvenanceChip, RatingFigure, formatMoney, formatNumber, type FormCell, type MiniTableColumn } from "@foundmill/dugout";
import { useBusinessEvents, useWidgetData, useWidgetQuery } from "../data";
import { registerWidget, type WidgetProps } from "../registry";
import { moduleHref, useDepartments } from "../shared/departments";
import { WidgetFrame } from "../shared/frame";
import { addDays, dayKey, weekKey } from "../shared/time";
import type { ChannelMetricRow, ChannelRow, ChannelsListResponse } from "../shared/types";

export const ChannelFormGuideSettings = z.object({
  /** Include channels on the bench (disabled). */
  includeDisabled: z.boolean().default(false),
  /** How many channels to show (sorted by fit). */
  max: z.number().int().min(3).max(15).default(8),
});
export type ChannelFormGuideSettings = z.infer<typeof ChannelFormGuideSettings>;

export const FORM_WEEKS = 5;

export interface ChannelFormRow {
  channelId: string;
  channelKey: ChannelKey;
  label: string;
  fit: number;
  enabled: boolean;
  recommended: boolean;
  form: FormCell[];
  /** This week's cost per customer in minor units; null without customers. */
  cpaMinor: number | null;
  customers: number;
  spendMinor: number;
}

/** Weekly CPA against the channel's own median: within ±10 % is "near cap", lower is good, higher is bad. */
export function formCells(weekly: readonly { spendMinor: number; customers: number }[]): FormCell[] {
  const cpas = weekly.map((w) => (w.customers > 0 ? w.spendMinor / w.customers : w.spendMinor > 0 ? Number.POSITIVE_INFINITY : null));
  const finite = cpas.filter((c): c is number => c !== null && Number.isFinite(c)).sort((a, b) => a - b);
  const median = finite.length ? (finite[Math.floor((finite.length - 1) / 2)]! + finite[Math.ceil((finite.length - 1) / 2)]!) / 2 : null;
  return cpas.map((c) => {
    if (c === null) return "none";
    if (!Number.isFinite(c)) return "bad";
    if (median === null || median === 0) return "good";
    if (c <= median * 0.9) return "good";
    if (c >= median * 1.1) return "bad";
    return "warn";
  });
}

export function buildFormRows(channels: readonly ChannelRow[], metrics: readonly ChannelMetricRow[], today: string, opts: { includeDisabled: boolean; max: number }): ChannelFormRow[] {
  const weeks = Array.from({ length: FORM_WEEKS }, (_, i) => weekKey(addDays(today, -7 * (FORM_WEEKS - 1 - i))));
  const byChannel = new Map<string, Map<string, { spendMinor: number; customers: number }>>();
  for (const m of metrics) {
    const wk = weekKey(m.day);
    if (!weeks.includes(wk)) continue;
    const perWeek = byChannel.get(m.channelId) ?? new Map();
    const cur = perWeek.get(wk) ?? { spendMinor: 0, customers: 0 };
    cur.spendMinor += Number(m.spendMinor);
    cur.customers += Number(m.customers);
    perWeek.set(wk, cur);
    byChannel.set(m.channelId, perWeek);
  }
  return channels
    .filter((c) => opts.includeDisabled || c.enabled)
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || b.fit - a.fit || a.channelKey.localeCompare(b.channelKey))
    .slice(0, opts.max)
    .map((c) => {
      const perWeek = byChannel.get(c.id);
      const weekly = weeks.map((wk) => perWeek?.get(wk) ?? { spendMinor: 0, customers: 0 });
      const thisWeek = weekly[weekly.length - 1]!;
      return {
        channelId: c.id,
        channelKey: c.channelKey,
        label: c.meta?.label ?? CHANNEL_META[c.channelKey]?.label ?? c.channelKey,
        fit: c.fit,
        enabled: c.enabled,
        recommended: c.recommended,
        form: formCells(weekly),
        cpaMinor: thisWeek.customers > 0 ? Math.round(thisWeek.spendMinor / thisWeek.customers) : null,
        customers: weekly.reduce((s, w) => s + w.customers, 0),
        spendMinor: weekly.reduce((s, w) => s + w.spendMinor, 0),
      };
    });
}

function ChannelFormGuideWidget({ settings }: WidgetProps<ChannelFormGuideSettings>) {
  const { businessId, navigate, currency = "EUR" } = useWidgetData();
  const today = dayKey();
  const channels = useWidgetQuery<ChannelsListResponse>("distribution.channels.list", {});
  const metrics = useWidgetQuery<ChannelMetricRow[]>("distribution.channels.metrics", { from: addDays(today, -7 * FORM_WEEKS), to: today });
  const departments = useDepartments();
  useBusinessEvents(() => {
    channels.refetch();
    metrics.refetch();
  }, ["channel.threshold_breached", "campaign.launched", "payment.received"]);
  const rows = useMemo(() => buildFormRows(channels.data?.channels ?? [], metrics.data ?? [], today, settings), [channels.data, metrics.data, today, settings]);
  const cur = channels.data?.channels[0]?.currency ?? currency;
  const columns: MiniTableColumn<ChannelFormRow>[] = [
    { id: "channel", header: "Channel", cell: (r) => <span className={r.enabled ? "text-body-strong" : "text-secondary"}>{r.label}{r.recommended ? <span className="ml-1 text-small text-tertiary">Recommended</span> : null}</span> },
    { id: "fit", header: "Fit", numeric: true, width: 44, cell: (r) => <RatingFigure value={r.fit} /> },
    { id: "form", header: "Form", width: 64, cell: (r) => <FormGuide form={r.form} name={`${r.label} form`} /> },
    { id: "cpa", header: "CPA this week", numeric: true, width: 110, cell: (r) => (r.cpaMinor === null ? "—" : formatMoney({ amountMinor: r.cpaMinor, currency: cur })) },
    { id: "customers", header: "Customers (5 wk)", numeric: true, width: 110, cell: (r) => formatNumber(r.customers, { maxDigits: 0 }) },
  ];
  const openChannels = () => navigate(moduleHref(businessId, departments.data, "distribution", "channels") ?? moduleHref(businessId, departments.data, "distribution") ?? `/b/${businessId}/home`);
  return (
    <WidgetFrame
      title="Channel performance"
      data-widget="channel_form_guide"
      queries={[channels, metrics]}
      flush
      empty={channels.data && rows.length === 0 ? { icon: Megaphone, text: "No channels are on the board yet. Put starters on the Channel Board.", action: { label: "Open Channel Board", onClick: () => navigate(moduleHref(businessId, departments.data, "distribution", "formation") ?? `/b/${businessId}/home`) } } : null}
      actions={<ProvenanceChip kind="estimate" title="CPA = spend ÷ customers attributed to the channel" />}
      footer={<span>Form: each week's CPA against the channel's own median · last {FORM_WEEKS} weeks</span>}
    >
      <MiniTable columns={columns} rows={rows} getRowKey={(r) => r.channelId} onRowClick={openChannels} aria-label="Channel performance" emptyText="No channels." />
    </WidgetFrame>
  );
}

export const channelFormGuideWidget = registerWidget<ChannelFormGuideSettings>({
  key: "channel_form_guide",
  title: "Channel performance",
  description: "Every channel's fit, five-week form and cost per customer.",
  icon: "megaphone",
  surfaces: ["home", "department"],
  defaultSize: { w: 6, h: 10, minW: 4, minH: 8 },
  settingsSchema: ChannelFormGuideSettings,
  defaultSettings: ChannelFormGuideSettings.parse({}),
  Component: ChannelFormGuideWidget,
});
