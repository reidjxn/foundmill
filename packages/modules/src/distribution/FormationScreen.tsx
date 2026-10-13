"use client";
/**
 * Distribution › Formation (BUILD §11.7): the Board fed by `distribution.channels.list`. Drag or Enter moves a channel
 * on or off → `distribution.channels.enable/disable`; the Board shows local scores at once and the Strategist re-scores
 * through `distribution.recommend` two seconds after the last toggle (AC-11.7.2; rescore.ts). Click or O opens the
 * channel profile drawer (agents, budget, rules, results, pause).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import { Button, Chip, FormationBoard, GridCell, Panel, ProvenanceChip, formatMoney } from "@foundmill/dugout";
import type { ChannelKey } from "@foundmill/shared";
import { CHANNEL_WINDOW_DAYS } from "@foundmill/shared/constants";
import { addDays } from "@foundmill/widgets/shared/time";
import { moduleHref, useDepartments } from "@foundmill/widgets/shared/departments";
import { useBusinessEvents, useToday, useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import type { ModuleScreenProps } from "../registry";
import { ChannelProfileDrawer } from "./ChannelProfileDrawer";
import { buildChannelViews, channelStatus, resumeStatus, toChannelToken, totalBudget, type ChannelView } from "./channel-data";
import { InlineError, Screen, searchParam, useAction } from "./shared";
import { localScores, RESCORE_DEBOUNCE_MS, useDebouncedRun } from "./rescore";
import type { AgentRow, CampaignRow, ChannelMetricRow, ChannelsListResponse, Page, RecommendResponse, RecommendationRow } from "./types";

export interface FormationScreenProps extends ModuleScreenProps {
  /** Recommended tokens walk onto the Board after mount (default true; tests pass false). */
  animateEntrance?: boolean;
  /** Wait after the last toggle before the Strategist re-scores (default `RESCORE_DEBOUNCE_MS`). */
  rescoreDelayMs?: number;
}

/** The channel window ("last 35 days"): today and the 34 days before it, as the API's channel summary counts it. */
export const METRICS_WINDOW_DAYS = CHANNEL_WINDOW_DAYS;

export function FormationScreen({ businessId, departmentId, animateEntrance = true, rescoreDelayMs = RESCORE_DEBOUNCE_MS }: FormationScreenProps) {
  const { navigate, currency } = useWidgetData();
  const today = useToday();
  const channels = useWidgetQuery<ChannelsListResponse>("distribution.channels.list", {});
  const campaigns = useWidgetQuery<Page<CampaignRow>>("distribution.campaigns.list", { limit: 200 });
  const metrics = useWidgetQuery<ChannelMetricRow[]>("distribution.channels.metrics", { from: addDays(today, -(METRICS_WINDOW_DAYS - 1)) });
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

  // Toggled since the Strategist last scored: the Board shows local scores until its re-score lands.
  const [provisional, setProvisional] = useState(false);
  const views = useMemo<ChannelView[]>(() => {
    const built = buildChannelViews({ channels: channels.data?.channels, campaigns: campaigns.data?.items, metrics: metrics.data, recommendation, currency, today });
    const toggled = built.map((v) => (overrides[v.channelKey] === undefined ? v : { ...v, enabled: overrides[v.channelKey]! }));
    return provisional ? localScores(toggled) : toggled;
  }, [channels.data, campaigns.data, metrics.data, recommendation, currency, today, overrides, provisional]);

  const budget = useMemo(() => totalBudget(views), [views]);
  const tokens = useMemo(() => views.map((v) => toChannelToken(v, { agents: agents.data, totalBudgetMinor: budget, departmentId })), [views, agents.data, budget, departmentId]);
  const selectedView = selected ? (views.find((v) => v.channelKey === selected) ?? null) : null;
  const selectedToken = selected ? (tokens.find((t) => t.key === selected) ?? null) : null;
  const scored = views.filter((v) => v.persisted).length;
  const starters = views.filter((v) => v.enabled).length;
  // On the board but no engine recorded yet: said so, never counted as running (audit GTM-01).
  const starting = views.filter((v) => channelStatus(v).word === "Starting").length;

  const rescore = useCallback(async () => {
    setRescoring(true);
    try {
      const result = await action.run<RecommendResponse>("distribution.recommend", {}, { key: "recommend" });
      if (result?.recommendation) setRecommendation(result.recommendation);
      channels.refetch();
    } finally {
      setRescoring(false);
      setProvisional(false);
    }
  }, [action, channels]);
  // One re-score after a run of toggles, not one per toggle (audit P7; revisits DECISIONS 2026-10-07).
  const rescoreSoon = useDebouncedRun(rescore, rescoreDelayMs);
  const rescoreNow = useCallback(() => {
    rescoreSoon.cancel();
    void rescore();
  }, [rescoreSoon, rescore]);

  const onToggle = useCallback(
    async (key: ChannelKey, enabled: boolean) => {
      setOverrides((o) => ({ ...o, [key]: enabled }));
      setProvisional(true);
      const ok = await action.run(enabled ? "distribution.channels.enable" : "distribution.channels.disable", { channelKey: key }, { key: `toggle:${key}` });
      if (ok === undefined) {
        setOverrides((o) => ({ ...o, [key]: !enabled }));
        return;
      }
      // Counted from the last toggle that landed, so the Strategist always scores the Board as it now is.
      rescoreSoon.schedule();
    },
    [action, rescoreSoon],
  );

  const onPause = useCallback(
    async (key: ChannelKey, paused: boolean) => {
      const view = views.find((v) => v.channelKey === key);
      if (!view) return;
      const targets = view.campaigns.filter((c) => (paused ? c.status === "live" || c.status === "scheduled" : c.status === "paused"));
      for (const c of targets) await action.run("distribution.campaigns.setStatus", { campaignId: c.id, status: paused ? "paused" : resumeStatus(c) }, { key: `pause:${key}` });
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
      <GridCell span={12} className="flex gap-gutter">
        <Panel
          title="Board"
          meta={hasData ? (starting ? `${starters - starting} of 15 running · ${starting} starting` : `${starters} of 15 running`) : undefined}
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
              <Button size="sm" variant="ghost" icon={rescoring ? RefreshCw : Sparkles} loading={rescoring} onClick={rescoreNow}>
                {scored === 0 ? "Get recommendation" : "Re-score"}
              </Button>
            </>
          }
          footer={
            hasData ? (
              <span className="inline-flex flex-wrap items-center gap-1.5 tabular-nums">
                Budget across running channels {formatMoney({ amountMinor: budget, currency })} per month · cost per customer is an <ProvenanceChip kind="estimate" /> · drag a channel on or off the board, or open it for its profile
              </span>
            ) : undefined
          }
          className="min-w-0 flex-1"
        >
          {hasData && scored === 0 ? (
            <p className="mb-2 text-small text-secondary" role="status">
              All 15 channels are off the board. The Distribution Strategist scores each one 1–20 for fit and puts 3 to 6 starters on the Board.
            </p>
          ) : null}
          <InlineError error={action.error} className="mb-2" />
          {hasData ? <FormationBoard channels={tokens} onToggle={onToggle} onOpenChannel={(k) => setSelected(k)} onPause={onPause} animateEntrance={animateEntrance} benchLabel="All 15 channels are available" /> : null}
        </Panel>
        {/* The profile opens on the right when a channel is picked; closed, the board takes the whole width. */}
        {selectedView && selectedToken ? <ChannelProfileDrawer view={selectedView} token={selectedToken} action={action} onClose={() => setSelected(null)} onToggle={onToggle} onPause={onPause} onBudgetSaved={() => channels.refetch()} onOpenChannels={openChannels} /> : null}
      </GridCell>
    </Screen>
  );
}
