"use client";
/**
 * Distribution › Formation (BUILD §11.7): the Board fed by `distribution.channels.list`. Drag or Enter moves a channel
 * on or off → `distribution.channels.enable/disable`; the Board shows local scores at once and the Strategist re-scores
 * through `distribution.recommend` two seconds after the last toggle (AC-11.7.2; rescore.ts). Click or O opens the
 * channel profile drawer (agents, budget, rules, results, pause).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Play, RefreshCw, Sparkles } from "lucide-react";
import { Button, Chip, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Explainer, FormationBoard, GridCell, Panel, ProvenanceChip, Term, formatMoney } from "@foundmill/dugout";
import type { ChannelKey } from "@foundmill/shared";
import { CHANNEL_WINDOW_DAYS } from "@foundmill/shared/constants";
import { addDays } from "@foundmill/widgets/shared/time";
import { moduleHref, useDepartments } from "@foundmill/widgets/shared/departments";
import { useBusinessEvents, useToday, useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import type { ModuleScreenProps } from "../registry";
import { useBusinessStage } from "../stage";
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

/** The department's intro, on its first tab while guidance is on (UX plan §7.10). */
export const DISTRIBUTION_EXPLAINER = {
  screenId: "distribution/board",
  purpose: "How customers will find you.",
  action: "Channels on the Board are running; the rest wait in the tray. Drag one up to start it, or open it for its profile.",
  watchFor: "Cost per customer is an Estimate until the conversion API confirms it.",
} as const;

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
  // Distribution waits for the founder's explicit start (founder, 2026-10-18): the Board keeps every channel in its place,
  // the engines start with Start distribution (owners and admins).
  const stage = useBusinessStage();
  const [startOpen, setStartOpen] = useState(false);
  const startDistribution = useCallback(async () => {
    await action.run("business.startDistribution", {}, {
      key: "start-distribution",
      then: () => {
        setStartOpen(false);
        stage.refetch();
        channels.refetch();
      },
    });
  }, [action, stage, channels]);
  // Opened from another screen (a Channels row): the location is only the new one once this screen has mounted.
  useEffect(() => {
    const key = searchParam("channel");
    if (key) setSelected(key as ChannelKey);
  }, []);

  useBusinessEvents(() => {
    channels.refetch();
    campaigns.refetch();
  }, ["campaign.launched", "channel.threshold_breached", "distribution.started"]);

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
  const scored = views.filter((v) => v.scored).length;
  const starters = views.filter((v) => v.enabled).length;
  // On the board but no engine recorded yet: said so, never counted as running (audit GTM-01); before Start distribution
  // every channel on the board waits for the product.
  const waiting = stage.distributionStarted === false;
  const starting = views.filter((v) => channelStatus(v, { distributionStarted: stage.distributionStarted }).word === "Starting").length;

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
      {waiting ? (
        <Panel
          span={12}
          title="Distribution starts when the product is ready to show"
          glow="brand"
          data-testid="distribution-waiting"
          data-product-stage={stage.stage ?? undefined}
          actions={
            <Button size="sm" variant="primary" icon={Play} onClick={() => setStartOpen(true)} disabled={!stage.canStartDistribution} title={stage.canStartDistribution ? undefined : "Owners and admins start distribution"} data-testid="start-distribution">
              Start distribution
            </Button>
          }
        >
          <p className="text-body text-secondary">
            The channels on the board keep their place; their engines start when you start distribution.{" "}
            {stage.stage === "building" ? "The team is building the first roadmap items now." : stage.stage === "awaiting_signoff" || stage.stage === "drafting" ? "Sign off the specification and the roadmap first." : ""}
          </p>
          <Dialog open={startOpen} onOpenChange={setStartOpen}>
            <DialogContent size="sm">
              <DialogHeader>
                <DialogTitle>Start distribution?</DialogTitle>
                <DialogDescription>The channels on the board start their engines: they draft creative, ask you before anything launches in Assisted mode, and spend within their budgets. The Board will ask which route to the first customer comes first.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <InlineError error={action.error} />
                <Button variant="ghost" onClick={() => setStartOpen(false)}>
                  Not yet
                </Button>
                <Button variant="primary" icon={Play} onClick={() => void startDistribution()} loading={action.pending === "start-distribution"} data-testid="start-distribution-confirm">
                  Start distribution
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Panel>
      ) : null}
      <GridCell span={12} className="flex gap-gutter">
        <Panel
          title="Board"
          meta={hasData ? (waiting ? `${starters} of 15 on the board · waiting for the product` : starting ? `${starters - starting} of 15 running · ${starting} starting` : `${starters} of 15 running`) : undefined}
          help="Each token is a channel; drag it onto the board to start it, or off the board to stop it."
          loading={channels.isLoading}
          error={channels.error ? channels.error.message : undefined}
          onRetry={channels.refetch}
          actions={
            <>
              {rescoreSoon.pending ? (
                <Chip tone="neutral" data-testid="rescore-pending">
                  Scores are being refreshed
                </Chip>
              ) : null}
              <Button size="sm" variant="ghost" icon={rescoring ? RefreshCw : Sparkles} loading={rescoring} onClick={rescoreNow}>
                {scored === 0 ? "Get recommendation" : "Score again"}
              </Button>
            </>
          }
          footer={
            hasData ? (
              <span className="inline-flex flex-wrap items-center gap-1.5 tabular-nums">
                Budget across running channels {formatMoney({ amountMinor: budget, currency })} per month · <Term id="acquisition_cost">cost per customer</Term> is an <ProvenanceChip kind="estimate" /> · drag a channel on or off the board, or open it for its profile
              </span>
            ) : undefined
          }
          className="min-w-0 flex-1"
        >
          {/* The department's intro (guidance on), then what the numbers mean, said once under the title (UX plan §7.13). */}
          <Explainer {...DISTRIBUTION_EXPLAINER} className="mb-3" />
          <p className="mb-2 max-w-reading text-small text-secondary" data-testid="board-caption">
            <Term id="fit">Fit</Term> 1–20: how well a channel suits this business, scored by the <Term id="distribution_strategist">Distribution Strategist</Term>. Closer to the center means a better fit.
          </p>
          {hasData && scored === 0 ? (
            <p className="mb-2 text-small text-secondary" role="status">
              {starters > 0 ? "No channel has been scored yet." : "All 15 channels are off the board."} The Distribution Strategist scores each one 1–20 for fit and picks 3 to 6 channels to start with.
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
