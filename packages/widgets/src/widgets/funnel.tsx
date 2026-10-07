"use client";
/**
 * Funnel widget: impressions → leads → signups → activations → customers over the last 35 days, blended across
 * channels or for one channel (BUILD §11.7 channel metrics).
 */
import { useMemo } from "react";
import { z } from "zod";
import { Filter } from "lucide-react";
import { CHANNEL_KEYS, CHANNEL_META } from "@foundmill/shared";
import { FunnelChart, formatNumber, type FunnelStage } from "@foundmill/dugout";
import { useBusinessEvents, useWidgetQuery } from "../data";
import { registerWidget, type WidgetProps } from "../registry";
import { WidgetFrame } from "../shared/frame";
import type { ChannelFormSummary, ChannelsListResponse } from "../shared/types";

export const FunnelSettings = z.object({
  /** One channel, or null for the blended funnel. */
  channelKey: z.enum(CHANNEL_KEYS).nullable().default(null),
  /** Start the funnel at leads (channels without impressions). */
  fromLeads: z.boolean().default(false),
});
export type FunnelSettings = z.infer<typeof FunnelSettings>;

type Counts = Pick<ChannelFormSummary, "impressions" | "leads" | "signups" | "activations" | "customers">;

export function funnelStages(c: Counts | null | undefined, fromLeads = false): FunnelStage[] {
  if (!c) return [];
  const stages: FunnelStage[] = [
    { label: "Impressions", value: Number(c.impressions) },
    { label: "Leads", value: Number(c.leads) },
    { label: "Signups", value: Number(c.signups) },
    { label: "Activations", value: Number(c.activations) },
    { label: "Customers", value: Number(c.customers) },
  ];
  return fromLeads || Number(c.impressions) === 0 ? stages.slice(1) : stages;
}

function FunnelWidget({ settings }: WidgetProps<FunnelSettings>) {
  const channels = useWidgetQuery<ChannelsListResponse>("distribution.channels.list", {});
  useBusinessEvents(() => channels.refetch(), ["signup.created", "activation.reached", "payment.received", "lead.created", "channel.threshold_breached"]);
  const counts = useMemo(() => {
    if (!channels.data) return null;
    if (!settings.channelKey) return channels.data.blended;
    return channels.data.channels.find((c) => c.channelKey === settings.channelKey)?.form ?? null;
  }, [channels.data, settings.channelKey]);
  const stages = useMemo(() => funnelStages(counts, settings.fromLeads), [counts, settings.fromLeads]);
  const total = stages.reduce((s, st) => s + st.value, 0);
  const title = settings.channelKey ? `Funnel · ${CHANNEL_META[settings.channelKey].label}` : "Funnel";
  return (
    <WidgetFrame
      title={title}
      data-widget="funnel"
      queries={[channels]}
      empty={channels.data && total === 0 ? { icon: Filter, text: settings.channelKey ? "No activity on this channel in the last 35 days." : "The funnel fills as channels run. Enable channels on the Formation board." } : null}
      footer={<span>Last 35 days · {settings.channelKey ? "one channel" : "all channels"} · {formatNumber(stages.at(-1)?.value ?? 0, { maxDigits: 0 })} customers</span>}
    >
      <FunnelChart stages={stages} label={`${title}, last 35 days`} />
    </WidgetFrame>
  );
}

export const funnelWidget = registerWidget<FunnelSettings>({
  key: "funnel",
  title: "Funnel",
  description: "Impressions to customers, blended or per channel, with step conversion rates.",
  icon: "filter",
  surfaces: ["home", "department"],
  defaultSize: { w: 6, h: 10, minW: 3, minH: 8 },
  settingsSchema: FunnelSettings,
  defaultSettings: FunnelSettings.parse({}),
  Component: FunnelWidget,
});
