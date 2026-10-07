"use client";
/**
 * Distribution › Formation (BUILD §11.7): the Board fed by `distribution.channels.list`. Drag or Enter moves a channel
 * on or off → `distribution.channels.enable/disable`, then the Strategist re-scores through `distribution.recommend`
 * (AC-11.7.2). Click or O opens the channel profile drawer (agents, budget, rules, results, pause).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import { Button, Chip, FormationBoard, GridCell, Panel, ProvenanceChip, formatMoney } from "@foundmill/dugout";
import type { ChannelKey } from "@foundmill/shared";
import { addDays, dayKey, moduleHref, useBusinessEvents, useDepartments, useWidgetData, useWidgetQuery } from "@foundmill/widgets";
import type { ModuleScreenProps } from "../registry";
import { ChannelProfileDrawer } from "./ChannelProfileDrawer";
import { buildChannelViews, toChannelToken, totalBudget, type ChannelView } from "./channel-data";
import { InlineError, LINE_LABELS, LINE_ORDER, Screen, searchParam, useAction } from "./shared";
import type { AgentRow, CampaignRow, ChannelMetricRow, ChannelsListResponse, Page, RecommendResponse, RecommendationRow } from "./types";

export interface FormationScreenProps extends ModuleScreenProps {
  /** Recommended tokens walk onto the Board after mount (default true; tests pass false). */
  animateEntrance?: boolean;
}

export const METRICS_WINDOW_DAYS = 35;

export function FormationScreen({ businessId, departmentId, animateEntrance = true }: FormationScreenProps) {
  const { navigate, currency } = useWidgetData();
  const today = dayKey();
  const channels = useWidgetQuery<ChannelsListResponse>("distribution.channels.list", {});
  const campaigns = useWidgetQuery<Page<CampaignRow>>("distribution.campaigns.list", { limit: 200 });
  const metrics = useWidgetQuery<ChannelMetricRow[]>("distribution.channels.metrics", { from: addDays(today, -METRICS_WINDOW_DAYS) });
  const agents = useWidgetQuery<AgentRow[]>("team.agents.list", {});
  const departments = useDepartments();
  const action = useAction();
  const [recommendation, setRecommendation] = useState<RecommendationRow[] | null>(null);
  const [overrides, setOverrides] = useState<Partial<Record<ChannelKey, boolean>>>({});
  const [selected, setSelected] = useState<ChannelKey | null>(() => searchParam("channel") as ChannelKey | null);
  const [rescoring, setRescoring] = useState(false);

  useBusinessEvents(() => {
    channels.refetch();
    campaigns.refetch();
  }, ["campaign.launched", "channel.threshold_breached"]);

  // Fresh data from the API supersedes the optimistic toggles.
  useEffect(() => {
    setOverrides({});
  }, [channels.data]);

  const views = useMemo<ChannelView[]>(() => {
    const built = buildChannelViews({ channels: channels.data?.channels, campaigns: campaigns.data?.items, metrics: metrics.data, recommendation, currency: currency ?? "EUR", today });
    return built.map((v) => (overrides[v.channelKey] === undefined ? v : { ...v, enabled: overrides[v.channelKey]! }));
  }, [channels.data, campaigns.data, metrics.data, recommendation, currency, today, overrides]);

  const budget = useMemo(() => totalBudget(views), [views]);
  const tokens = useMemo(() => views.map((v) => toChannelToken(v, { agents: agents.data, totalBudgetMinor: budget, departmentId })), [views, agents.data, budget, departmentId]);
  const selectedView = selected ? (views.find((v) => v.channelKey === selected) ?? null) : null;
  const selectedToken = selected ? (tokens.find((t) => t.key === selected) ?? null) : null;
  const scored = views.filter((v) => v.persisted).length;
  const starters = views.filter((v) => v.enabled).length;

  const rescore = useCallback(async () => {
    setRescoring(true);
    try {
      const result = await action.run<RecommendResponse>("distribution.recommend", {}, { key: "recommend" });
      if (result?.recommendation) setRecommendation(result.recommendation);
      channels.refetch();
    } finally {
      setRescoring(false);
    }
  }, [action, channels]);

  const onToggle = useCallback(
    async (key: ChannelKey, enabled: boolean) => {
      setOverrides((o) => ({ ...o, [key]: enabled }));
      const ok = await action.run(enabled ? "distribution.channels.enable" : "distribution.channels.disable", { channelKey: key }, { key: `toggle:${key}` });
      if (ok === undefined) {
        setOverrides((o) => ({ ...o, [key]: !enabled }));
        return;
      }
      await rescore();
    },
    [action, rescore],
  );

  const onPause = useCallback(
    async (key: ChannelKey, paused: boolean) => {
      const view = views.find((v) => v.channelKey === key);
      if (!view) return;
      const targets = view.campaigns.filter((c) => (paused ? c.status === "live" || c.status === "scheduled" : c.status === "paused"));
      for (const c of targets) await action.run("distribution.campaigns.setStatus", { campaignId: c.id, status: paused ? "paused" : "live" }, { key: `pause:${key}` });
      campaigns.refetch();
    },
    [views, action, campaigns],
  );

  const openChannels = (key: ChannelKey) => {
    const href = moduleHref(businessId, departments.data, "distribution", "channels");
    if (href) navigate(`${href}?channel=${key}`);
  };

  const hasData = !!channels.data;
  return (
    <Screen name="distribution/formation">
      <GridCell span={12} className="flex min-h-[560px] gap-gutter">
        <Panel
          title="Board"
          loading={channels.isLoading}
          error={channels.error ? channels.error.message : undefined}
          onRetry={channels.refetch}
          actions={
            <>
              <Chip tone="neutral">
                {starters} of 15 running
              </Chip>
              <Button size="sm" variant="ghost" icon={rescoring ? RefreshCw : Sparkles} loading={rescoring} onClick={rescore}>
                {scored === 0 ? "Get recommendation" : "Re-score"}
              </Button>
            </>
          }
          footer={
            hasData ? (
              <span className="flex flex-wrap items-center gap-2 tabular-nums">
                <span>
                  Budget across running channels {formatMoney({ amountMinor: budget, currency: currency ?? "EUR" })} per month · cost per customer <ProvenanceChip kind="estimate" />
                </span>
                <span className="text-secondary">{LINE_ORDER.map((l) => LINE_LABELS[l]).join(" · ")} are the four lines, top to bottom.</span>
              </span>
            ) : undefined
          }
          className="min-w-0 flex-1"
        >
          {hasData && scored === 0 ? (
            <p className="mb-2 text-small text-secondary" role="status">
              All 15 channels are on the bench. The Distribution Strategist scores each one 1–20 for fit and walks 3 to 6 starters onto the Board.
            </p>
          ) : null}
          <InlineError error={action.error} className="mb-2" />
          {hasData ? <FormationBoard channels={tokens} onToggle={onToggle} onOpenChannel={(k) => setSelected(k)} onPause={onPause} animateEntrance={animateEntrance} benchLabel="All 15 channels are available" /> : null}
        </Panel>
        <ChannelProfileDrawer view={selectedView} token={selectedToken} action={action} onClose={() => setSelected(null)} onToggle={onToggle} onPause={onPause} onBudgetSaved={() => channels.refetch()} onOpenChannels={openChannels} />
      </GridCell>
    </Screen>
  );
}
