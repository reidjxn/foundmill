"use client";
/**
 * Distribution › Formation (BUILD §11.7): the Board fed by `distribution.channels.list`. Drag or Enter moves a channel
 * on or off → `distribution.channels.enable/disable`; the Board shows local scores at once and the Strategist re-scores
 * through `distribution.recommend` two seconds after the last toggle (AC-11.7.2; rescore.ts). Click or O opens the
 * channel profile drawer (agents, budget, rules, results, pause).
 *
 * The Board shows only channels that can really act for this business (founder, 2026-11-11; the API's `availability`
 * on every channel), plus one the founder put on in offline tracking. The others are listed under "Not available yet"
 * in Builder view only. With no channel to show, the Board is one honest empty state: what opens first, and that
 * nothing is wrong.
 *
 * A channel the founder posts by tap (founder, 2026-11-12: social) is on the Board as available with its own sentence
 * ("You post each one with one press: the text and link are filled in for you."). Put on the board it reads "You post
 * it" and is never counted as running: no engine runs for it.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Megaphone, Play, RefreshCw, Sparkles } from "lucide-react";
import { Button, Chip, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, Explainer, FormationBoard, GridCell, Panel, ProvenanceChip, Term, formatMoney } from "@foundmill/dugout";
import type { ChannelKey } from "@foundmill/shared";
import { CHANNEL_KEYS, CHANNEL_WINDOW_DAYS } from "@foundmill/shared/constants";
import { emptyWhy } from "@foundmill/shared/empty-why";
import { routes } from "@foundmill/widgets/shared/routes";
import { addDays } from "@foundmill/widgets/shared/time";
import { moduleHref, useDepartments } from "@foundmill/widgets/shared/departments";
import { useBusinessEvents, useToday, useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import type { ModuleScreenProps } from "../registry";
import { useBusinessStage } from "../stage";
import { ChannelProfileDrawer } from "./ChannelProfileDrawer";
import { CHANNEL_META } from "@foundmill/shared/constants";
import { buildChannelViews, channelStatus, postedByTap, resumeStatus, splitByAvailability, toChannelToken, totalBudget, type ChannelView } from "./channel-data";
import { NotAvailableChannels } from "./NotAvailableChannels";
import { InlineError, Screen, searchParam, useAction } from "./shared";
import { localScores, RESCORE_DEBOUNCE_MS, useDebouncedRun } from "./rescore";
import type { AgentsListResponse, CampaignRow, ChannelMetricRow, ChannelsListResponse, Page, RecommendResponse, RecommendationRow } from "./types";

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
  watchFor: "Cost per customer is an Estimate until the ad platform reports which customers it actually brought.",
} as const;

/** Every channel the product knows (the Board says "of 15" only while all of them can run). */
const ALL_CHANNELS = CHANNEL_KEYS.length;

/**
 * The tray's label: how many channels can run, in plain words. `byTap` of them are the founder's own to post (tap-to-
 * post): they are named apart, never as channels that run.
 */
export function benchLabelFor(shown: number, byTap = 0): string {
  if (shown === ALL_CHANNELS) return `All ${ALL_CHANNELS} channels are available`;
  const runs = shown - byTap;
  const yours = byTap > 0 ? `${byTap} you post yourself` : "";
  if (byTap > 0 && runs <= 0) return `${byTap} channel${byTap === 1 ? "" : "s"} you post yourself`;
  return `${runs} channel${runs === 1 ? "" : "s"} can run now${yours ? `, ${yours}` : ""}`;
}

export function FormationScreen({ businessId, departmentId, animateEntrance = true, rescoreDelayMs = RESCORE_DEBOUNCE_MS }: FormationScreenProps) {
  const { navigate, currency } = useWidgetData();
  const today = useToday();
  const channels = useWidgetQuery<ChannelsListResponse>("distribution.channels.list", {});
  const campaigns = useWidgetQuery<Page<CampaignRow>>("distribution.campaigns.list", { limit: 200 });
  const metrics = useWidgetQuery<ChannelMetricRow[]>("distribution.channels.metrics", { from: addDays(today, -(METRICS_WINDOW_DAYS - 1)) });
  const agents = useWidgetQuery<AgentsListResponse>("team.agents.list", {});
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
  const all = useMemo<ChannelView[]>(() => {
    const built = buildChannelViews({ channels: channels.data?.channels, campaigns: campaigns.data?.items, metrics: metrics.data, recommendation, currency, today, availability: channels.data?.availability });
    return built.map((v) => (overrides[v.channelKey] === undefined ? v : { ...v, enabled: overrides[v.channelKey]! }));
  }, [channels.data, campaigns.data, metrics.data, recommendation, currency, today, overrides]);
  // Only channels that can really act are on the Board; the rest wait in Builder view's "Not available yet" list.
  const { views, unavailable } = useMemo(() => {
    const split = splitByAvailability(all);
    return { views: provisional ? localScores(split.shown) : split.shown, unavailable: split.unavailable };
  }, [all, provisional]);

  const budget = useMemo(() => totalBudget(views), [views]);
  const tokens = useMemo(() => views.map((v) => toChannelToken(v, { agents: agents.data?.agents, totalBudgetMinor: budget, departmentId })), [views, agents.data, budget, departmentId]);
  const selectedView = selected ? (views.find((v) => v.channelKey === selected) ?? null) : null;
  const selectedToken = selected ? (tokens.find((t) => t.key === selected) ?? null) : null;
  const scored = views.filter((v) => v.scored).length;
  const starters = views.filter((v) => v.enabled).length;
  // On the board but no engine recorded yet: said so, never counted as running (audit GTM-01); before Start distribution
  // every channel on the board waits for the product.
  const waiting = stage.distributionStarted === false;
  const starting = views.filter((v) => channelStatus(v, { distributionStarted: stage.distributionStarted }).word === "Starting").length;
  // Channels the founder posts by tap: on the Board with their own sentence, and never counted as running.
  const byTapViews = views.filter((v) => v.availability.available && v.availability.byTap && v.availability.sentence);
  const byTapOnly = views.filter(postedByTap);
  const youPost = byTapOnly.filter((v) => v.enabled).length;
  const runningWords = `${starters - starting - youPost} of ${views.length} running${starting ? ` · ${starting} starting` : ""}${youPost ? ` · ${youPost} you post` : ""}`;

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
  // From "Not available yet": the channel moves between that list and the Board once the API has answered.
  const onToggleUnavailable = useCallback(
    async (view: ChannelView, enabled: boolean) => {
      const ok = await action.run(enabled ? "distribution.channels.enable" : "distribution.channels.disable", { channelKey: view.channelKey }, { key: `toggle:${view.channelKey}` });
      if (ok !== undefined) channels.refetch();
    },
    [action, channels],
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
  // No channel can run on its own and none is on the board in offline tracking: the Board says so instead of an empty map.
  const nothingToShow = hasData && views.length === 0;
  const none = emptyWhy("channel_board");
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
            {nothingToShow ? "No channel can run yet, so nothing starts today. You can still start distribution, and a channel starts the day it opens." : "The channels on the board keep their place; their engines start when you start distribution."}{" "}
            {stage.stage === "building" ? "The team is building the first roadmap items now." : stage.stage === "awaiting_signoff" || stage.stage === "drafting" ? "Approve your plan first." : ""}
          </p>
          <Dialog open={startOpen} onOpenChange={setStartOpen}>
            <DialogContent size="sm">
              <DialogHeader>
                <DialogTitle>Start distribution?</DialogTitle>
                <DialogDescription>
                  {nothingToShow
                    ? "No channel can run yet, so nothing starts and nothing is spent today. Once you start, a channel you put on the board starts the day it opens."
                    : "The channels on the board start their engines: they draft creative, ask you before anything launches in Assisted mode, and spend within their budgets. The Board will ask which route to the first customer comes first."}
                </DialogDescription>
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
          meta={hasData && !nothingToShow ? (waiting ? `${starters} of ${views.length} on the board · waiting for the product` : runningWords) : undefined}
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
              {nothingToShow ? null : (
                <Button size="sm" variant="ghost" icon={rescoring ? RefreshCw : Sparkles} loading={rescoring} onClick={rescoreNow}>
                  {scored === 0 ? "Get recommendation" : "Score again"}
                </Button>
              )}
            </>
          }
          footer={
            hasData && !nothingToShow ? (
              <span className="inline-flex flex-wrap items-center gap-1.5 tabular-nums">
                Budget across running channels {formatMoney({ amountMinor: budget, currency })} per month · <Term id="acquisition_cost">cost per customer</Term> is an <ProvenanceChip kind="estimate" /> · drag a channel on or off the board, or open it for its profile
              </span>
            ) : undefined
          }
          className="min-w-0 flex-1"
        >
          {/* The department's intro (guidance on), then what the numbers mean, said once under the title (UX plan §7.13). */}
          {/* With no channel to show there is no board to explain: the empty state below says what opens first. */}
          {nothingToShow ? null : (
            <>
              <Explainer {...DISTRIBUTION_EXPLAINER} className="mb-3" />
              <p className="mb-2 max-w-reading text-small text-secondary" data-testid="board-caption">
                <Term id="fit">Fit</Term> 1–20: how well a channel suits this business, scored by the <Term id="distribution_strategist">Distribution Strategist</Term>. Closer to the center means a better fit.
              </p>
            </>
          )}
          {hasData && !nothingToShow && scored === 0 ? (
            <p className="mb-2 text-small text-secondary" role="status">
              {starters > 0 ? "No channel has been scored yet." : views.length === ALL_CHANNELS ? "All 15 channels are off the board." : "No channel is on the board yet."}{" "}
              {views.length === ALL_CHANNELS ? "The Distribution Strategist scores each one 1–20 for fit and picks 3 to 6 channels to start with." : "The Distribution Strategist scores each one 1–20 for fit and picks which to start with."}
            </p>
          ) : null}
          {/* Tap-to-post: what "available" means for a channel no agent publishes to, in the founder's words. */}
          {hasData && byTapViews.length > 0 ? (
            <ul className="mb-2 flex max-w-reading flex-col gap-1" data-testid="board-by-tap">
              {byTapViews.map((v) => (
                <li key={v.channelKey} data-channel={v.channelKey} data-reason={v.availability.reason} className="flex flex-wrap items-baseline gap-x-2 text-small text-secondary">
                  <span className="text-body-strong text-primary">{CHANNEL_META[v.channelKey].label}</span>
                  <span>{v.availability.sentence}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <InlineError error={action.error} className="mb-2" />
          {nothingToShow ? (
            <EmptyState icon={Megaphone} title={none.title} data-testid="board-no-channels">
              {channels.data?.noChannel ?? none.text}
            </EmptyState>
          ) : hasData ? (
            <FormationBoard channels={tokens} onToggle={onToggle} onOpenChannel={(k) => setSelected(k)} onPause={onPause} animateEntrance={animateEntrance} benchLabel={benchLabelFor(views.length, byTapOnly.length)} />
          ) : null}
        </Panel>
        {/* The profile opens on the right when a channel is picked; closed, the board takes the whole width. */}
        {selectedView && selectedToken ? <ChannelProfileDrawer view={selectedView} token={selectedToken} action={action} onClose={() => setSelected(null)} onToggle={onToggle} onPause={onPause} onBudgetSaved={() => channels.refetch()} onOpenChannels={openChannels} /> : null}
      </GridCell>
      <NotAvailableChannels views={unavailable} pending={action.pending} onToggle={(v, enabled) => void onToggleUnavailable(v, enabled)} onOpenIntegrations={() => navigate(routes.settings(businessId, "integrations"))} />
    </Screen>
  );
}
