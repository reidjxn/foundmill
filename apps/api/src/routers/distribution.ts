/** distribution.recommend / channels.* / campaigns.* / assets.* (BUILD §11.7; AC-11.7.2 enable/disable re-scores). */
import { recordExpiredApprovals } from "@foundmill/events";
import { CreateCampaignInput, UpdateCampaignInput, hasLaunched, repos } from "@foundmill/db";
import { HOUSE_STYLE, POST_DRAFT_CHANNEL } from "@foundmill/agents";
import { AppError, CAMPAIGN_STATUSES, CHANNEL_KEYS, CHANNEL_LINES, CHANNEL_META, CHANNEL_WINDOW_DAYS, ChannelKey, CurrencyCode, dayKeyIn, isTeamPost, mockResultsAllowed, ValidationError, type ChannelLine } from "@foundmill/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { assertChannelMayLaunch, assertChannelMayRun, channelRowsFor, FOUNDER_POSTS_CHANNEL, runnableChannels } from "../services/channel-availability";
import { DISTRIBUTION_NOT_STARTED } from "../services/engines";
import { queuePostDraft, teamPostShares } from "../services/post-drafts";
import { postOutcomeCounts } from "../services/post-attribution";
import { postMediaToolStatus } from "../services/post-media";
import { assertAgentsRunning } from "../services/stop-guard";
import { WORKFLOWS, workflowIds } from "../services/temporal";
import { modelLimited } from "../services/model-limits";
import { Id, audit, emit, router, sectionRead, sectionWrite } from "../trpc";

/**
 * The channel window every screen labels "last 35 days": the business's today (its time zone, 0041; UTC without one)
 * and the CHANNEL_WINDOW_DAYS − 1 days before it, as the inclusive day range the repos take (a `from` of today − 35
 * would count 36 days).
 */
export function channelWindow(now: Date = new Date(), timeZone?: string | null): { from: string; to: string } {
  const to = dayKeyIn(now, timeZone);
  const from = new Date(Date.parse(`${to}T00:00:00.000Z`) - (CHANNEL_WINDOW_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

const read = sectionRead("distribution");
const write = sectionWrite("distribution");

/**
 * The highest cost per customer the Strategist may name, in minor units (100,000 in the major unit). Anything above is
 * not an estimate a founder can act on; the bound also keeps the mock model's numbers plausible.
 */
export const CPA_RANGE_MAX_MINOR = 10_000_000;

const Recommendation = z.object({
  channels: z
    .array(
      z.object({
        channel: ChannelKey,
        fit: z.number().int().min(1).max(20),
        potential: z.number().int().min(1).max(5),
        recommended: z.boolean(),
        cpa_range_minor: z.object({ low: z.number().int().nonnegative().max(CPA_RANGE_MAX_MINOR), high: z.number().int().nonnegative().max(CPA_RANGE_MAX_MINOR) }),
        why: z.string().min(1),
        /** The channel cannot be automated within its terms (print bookings, linear broadcast, outdoor contracts). */
        kit_mode_required: z.boolean().optional(),
      }),
    )
    .min(15)
    .max(15),
});

/** A campaign starts as a draft; it goes live only through `setStatus` (the transitions, `campaign.launched`, the audit). */
const NewCampaignInput = CreateCampaignInput.omit({ status: true });

export const distributionRouter = router({
  /**
   * Distribution Strategist scores all 15 channels and picks 3–6 starters (AC-11.7.1). Writes the scores to `channels`.
   * Only a channel that can really act is ever a starter (founder, 2026-11-11): the Strategist is told which are
   * available and `normaliseRecommendation` holds its answer to them. With no channel available it recommends none,
   * no model is called (nothing is spent on scoring channels that cannot run) and `note` says why in one sentence.
   * "Available" here is what the team can run (`teamRuns`): a channel the founder posts by tap (founder, 2026-11-12) is
   * never a starter, and the Strategist is told which those are so it never writes that the team posts there.
   */
  recommend: write.use(modelLimited("recommend")).mutation(async ({ ctx }) => {
    const [profile, enabled, availability] = await Promise.all([repos.founders.get(ctx.db, ctx.userId), repos.channels.list(ctx.db, ctx.businessId), channelRowsFor(ctx.db, ctx)]);
    if (availability.teamRuns.length === 0) {
      return { channels: enabled.map((c) => ({ ...c, recommended: false })), recommendation: [] as ScoredChannel[], cpaLabel: "Estimate" as const, note: availability.noneSentence };
    }
    const result = await ctx.models.complete({
      route: "leadRecommendation",
      schema: Recommendation,
      system: `You are the Distribution Strategist. Score all 15 channels 1-20 on fit and pick 3-6 starters with potential, a cost-per-customer range (minor units of the business currency, low at most high, Estimate), a three-sentence why, and kit_mode_required for channels that cannot be automated within their terms. Pick starters only from available_channels: the other channels cannot run for this business yet, so score them and never recommend them; with fewer than three available, pick from those only. A channel in founder_posts_channels is posted by the founder with one press on a draft that is ready for them: no agent publishes there, so never pick it as a starter, and when you write about it say the founder posts it, never the team. ${HOUSE_STYLE}`,
      messages: [{ role: "user", content: "```json\n" + JSON.stringify({ business: { name: ctx.business.name, archetype: ctx.business.archetype, business_mode: ctx.business.businessMode }, founder: profile ? { skills: profile.skills, budget_minor: profile.budgetMinor, target_markets: profile.targetMarkets } : null, channels: CHANNEL_KEYS, available_channels: availability.teamRuns, founder_posts_channels: availability.available.filter((k) => !availability.teamRuns.includes(k)), currently_enabled: enabled.filter((c) => c.enabled).map((c) => c.channelKey) }) + "\n```" }],
      attribution: { businessId: ctx.businessId, kind: "distribution_strategist" },
    });
    const scored = normaliseRecommendation(result.json, new Set(availability.teamRuns));
    const channels = await ctx.rls(async (tx) => {
      // Only the scores change: the founder's Board line, on/off state, budget and offline tracking stay (audit #339).
      const rows = await repos.channels.saveScores(
        tx,
        ctx.businessId,
        scored.map((c) => ({ channelKey: c.channel, fit: c.fit, potential: c.potential * 20, recommended: c.recommended, whyMd: c.why, kitModeRequired: c.kit_mode_required })),
      );
      await audit(tx, ctx, { action: "distribution.recommend", target: { kind: "business", id: ctx.businessId }, details: { starters: scored.filter((c) => c.recommended).map((c) => c.channel), costMinor: result.cost.costMinorInt } });
      return rows;
    });
    return { channels, recommendation: scored, cpaLabel: "Estimate" as const, note: null as string | null };
  }),

  channels: router({
    /**
     * Every channel with its window figures and its `availability` (whether it can really act for this business, the
     * reason and one plain sentence; founder, 2026-11-11). `availability` by key covers a channel that has no row yet;
     * `noChannel` is the sentence for a Board with nothing that can run (null otherwise). A channel that is not
     * available is never served as recommended. Screens show the available ones and list the rest in Builder view.
     */
    list: read.query(({ ctx }) =>
      ctx.rls(async (tx) => {
        const [channels, summary, availability] = await Promise.all([repos.channels.list(tx, ctx.businessId), repos.channels.metricsSummary(tx, ctx.businessId, channelWindow(new Date(), ctx.business.timeZone)), channelRowsFor(tx, ctx)]);
        const lines = Object.fromEntries(CHANNEL_LINES.map((l) => [l, [] as string[]])) as Record<ChannelLine, string[]>;
        for (const c of channels) lines[c.line].push(c.channelKey);
        return {
          channels: channels.map((c) => ({ ...c, recommended: c.recommended && availability.rows[c.channelKey].available, meta: CHANNEL_META[c.channelKey], form: summary.channels.find((s) => s.channelId === c.id) ?? null, availability: availability.rows[c.channelKey] })),
          lines,
          blended: summary.blended,
          availability: availability.rows,
          noChannel: availability.noneSentence,
        };
      }),
    ),
    enable: write.input(z.object({ channelKey: ChannelKey })).mutation(({ ctx, input }) => setEnabled(ctx, input.channelKey, true)),
    disable: write.input(z.object({ channelKey: ChannelKey })).mutation(({ ctx, input }) => setEnabled(ctx, input.channelKey, false)),
    move: write.input(z.object({ channelId: Id, line: z.enum(CHANNEL_LINES) })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const channel = await repos.channels.move(tx, ctx.businessId, input.channelId, input.line);
        await audit(tx, ctx, { action: "distribution.channels.move", target: { kind: "channel", id: channel.id }, details: { line: input.line } });
        return channel;
      }),
    ),
    budget: write.input(z.object({ channelId: Id, budgetMinor: z.number().int().nonnegative(), currency: CurrencyCode.optional() })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const channel = await repos.channels.setBudget(tx, ctx.businessId, input.channelId, input.budgetMinor, input.currency);
        await audit(tx, ctx, { action: "distribution.channels.budget", target: { kind: "channel", id: channel.id }, details: { budgetMinor: input.budgetMinor } });
        return channel;
      }),
    ),
    metrics: read.input(z.object({ channelId: Id.optional(), from: z.string().date().optional(), to: z.string().date().optional() })).query(({ ctx, input }) => ctx.rls((tx) => repos.channels.metricsRange(tx, ctx.businessId, input))),
  }),

  campaigns: router({
    list: read.input(z.object({ channelId: Id.optional(), status: z.enum(CAMPAIGN_STATUSES).optional(), limit: z.number().int().min(1).max(200).default(50), cursor: z.string().nullish() })).query(({ ctx, input }) => ctx.rls((tx) => repos.campaigns.list(tx, ctx.businessId, input ?? {}))),
    get: read.input(z.object({ campaignId: Id })).query(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const [campaign, assets] = await Promise.all([repos.campaigns.get(tx, ctx.businessId, input.campaignId), repos.campaigns.listAssets(tx, ctx.businessId, { campaignId: input.campaignId })]);
        return { campaign, assets };
      }),
    ),
    /** A new campaign is a draft in its channel's currency; launching it is `setStatus` (audit #345). */
    create: write.input(NewCampaignInput).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const channel = await repos.channels.get(tx, ctx.businessId, input.channelId);
        if (input.currency && input.currency.toUpperCase() !== channel.currency) throw new TRPCError({ code: "BAD_REQUEST", message: `The budget is in ${channel.currency}, the ${CHANNEL_META[channel.channelKey].label} channel's currency.` });
        const campaign = await repos.campaigns.create(tx, ctx.businessId, { ...input, status: "draft", currency: channel.currency });
        await audit(tx, ctx, { action: "distribution.campaigns.create", target: { kind: "campaign", id: campaign.id }, details: { channelId: campaign.channelId, budgetMinor: campaign.budgetMinor } });
        return campaign;
      }),
    ),
    update: write.input(z.object({ campaignId: Id, patch: UpdateCampaignInput })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        // A campaign's budget stays in its channel's currency after the edit as at creation (audit #345).
        if (input.patch.currency) {
          const channel = await repos.channels.get(tx, ctx.businessId, (await repos.campaigns.get(tx, ctx.businessId, input.campaignId)).channelId);
          if (input.patch.currency.toUpperCase() !== channel.currency) throw new TRPCError({ code: "BAD_REQUEST", message: `The budget is in ${channel.currency}, the ${CHANNEL_META[channel.channelKey].label} channel's currency.` });
        }
        const campaign = await repos.campaigns.update(tx, ctx.businessId, input.campaignId, input.patch);
        await audit(tx, ctx, { action: "distribution.campaigns.update", target: { kind: "campaign", id: campaign.id }, details: { fields: Object.keys(input.patch) } });
        return campaign;
      }),
    ),
    /**
     * Status changes. The first launch needs at least one approved asset and emits `campaign.launched`; resuming a
     * campaign that already went live is neither checked nor announced again. Spend above caps is gated by the engine.
     * Going live is refused while the team is stopped: Stop all agents paused the live campaigns, and no member sets one
     * spending again before an owner or admin resumes the agents (pausing or ending stays allowed).
     */
    setStatus: write.input(z.object({ campaignId: Id, status: z.enum(CAMPAIGN_STATUSES) })).mutation(async ({ ctx, input }) => {
      if (input.status === "live") await assertAgentsRunning(ctx, "a live campaign");
      return ctx.rls(async (tx) => {
        const before = await repos.campaigns.get(tx, ctx.businessId, input.campaignId);
        const launching = input.status === "live" && before.status !== "live" && !hasLaunched(before);
        const approved = launching ? await repos.campaigns.listAssets(tx, ctx.businessId, { campaignId: before.id, approvalState: "approved" }) : [];
        if (launching && approved.length === 0) throw new ValidationError("Launch needs at least one approved asset. Approve one of the campaign's assets first.", { campaignId: before.id });
        // Nothing is scheduled or launched on a channel that is off the board (its engine is stopped; audit #345).
        if ((input.status === "live" || input.status === "scheduled") && before.status !== input.status) {
          const owner = await repos.channels.get(tx, ctx.businessId, before.channelId);
          if (!owner.enabled) throw new TRPCError({ code: "BAD_REQUEST", message: `Put ${CHANNEL_META[owner.channelKey].label} on the board before launching its campaigns.` });
          // Nothing is scheduled or marked live on a channel that cannot really act (founder, 2026-11-11), unless it is in
          // offline tracking, where the founder submits the materials themselves. A channel the founder posts by tap is
          // refused too: no agent can publish there, so a campaign on it is never "live" (founder, 2026-11-12).
          await assertChannelMayLaunch(tx, ctx, owner);
        }
        // On a real project only the engine's launch step marks a campaign live (WP-02 T2, GTM-36): nothing is sent from
        // here, so an offline-tracking campaign is not marked live by hand either. A sample or test project still can.
        if (input.status === "live" && before.status !== "live" && !mockResultsAllowed(ctx.env.APP_ENV, ctx.business.isDemo)) {
          const owner = await repos.channels.get(tx, ctx.businessId, before.channelId);
          if (owner.kitMode) throw new AppError("campaign_nothing_to_send", "Nothing is sent from here, so the campaign stays as it is. Submit the materials yourself, then mark it ended.", 409);
        }
        const campaign = await repos.campaigns.setStatus(tx, ctx.businessId, input.campaignId, input.status);
        if (launching) {
          const channel = await repos.channels.get(tx, ctx.businessId, campaign.channelId);
          await emit(tx, ctx, {
            type: "campaign.launched",
            payload: { campaignId: campaign.id, channelId: channel.id, channelKey: channel.channelKey, name: campaign.name, goal: campaign.goal.slice(0, 500), budget: { amountMinor: campaign.budgetMinor, currency: campaign.currency }, startsAt: (campaign.startsAt ?? new Date()).toISOString(), endsAt: campaign.endsAt?.toISOString() ?? null, kitMode: channel.kitMode, assetIds: approved.map((a) => a.id), approvalId: null },
          });
        }
        await audit(tx, ctx, { action: "distribution.campaigns.set_status", target: { kind: "campaign", id: campaign.id }, details: { from: before.status, to: input.status } });
        return campaign;
      });
    }),
  }),

  assets: router({
    /**
     * Every asset on the Creative tab. A post the team wrote for the founder to share by tap (a team post, packages/shared
     * `team-posts.ts`) also carries `sharePost`: the words with the link and the picture the code attaches, ready for
     * the share panel. Null for every other asset. A team post that led to a real outcome also carries `postOutcomes`
     * (item 8): the counted follows and replies when the reader reads the CRM, payments when they read Finance; null
     * when it led to nothing the reader may see. Visits are never in it. A team post the founder set aside ("Not this one") is not listed again:
     * the row stays (with its audit trail), the offer does not.
     */
    list: read.input(z.object({ campaignId: Id.optional(), approvalState: z.enum(["draft", "pending", "approved", "rejected"]).optional() })).query(async ({ ctx, input }) => {
      // Whether the media tools are connected, as two booleans, read on the service connection before the reader's own
      // transaction: a collaborator's RLS reads no integration rows (0094), yet is told the same as the founders.
      const tools = await postMediaToolStatus(ctx.db, { businessId: ctx.businessId, isDemo: ctx.business.isDemo, env: ctx.env });
      return ctx.rls(async (tx) => {
        const rows = (await repos.campaigns.listAssets(tx, ctx.businessId, input ?? {})).filter((row) => !(row.approvalState === "rejected" && isTeamPost(row)));
        const shares = await teamPostShares(tx, { businessId: ctx.businessId, businessName: ctx.business.name, isDemo: ctx.business.isDemo, appUrl: ctx.env.APP_URL, media: { env: ctx.env, tools } }, rows);
        const outcomes = await postOutcomeCounts(tx, { businessId: ctx.businessId, membership: ctx.membership }, [...shares.keys()]);
        return rows.map((row) => ({ ...row, sharePost: shares.get(row.id) ?? null, postOutcomes: outcomes.get(row.id) ?? null }));
      });
    }),
    approve: write.input(z.object({ assetId: Id })).mutation(({ ctx, input }) => setAssetApproval(ctx, input.assetId, "approved")),
    reject: write.input(z.object({ assetId: Id })).mutation(({ ctx, input }) => setAssetApproval(ctx, input.assetId, "rejected")),
  }),
});

type Ctx = Parameters<Parameters<typeof write.mutation>[0]>[0]["ctx"];

async function setEnabled(ctx: Ctx, channelKey: ChannelKey, enabled: boolean) {
  // Enabling starts the channel's engine, which drafts and launches campaigns: never while the team is stopped.
  if (enabled) await assertAgentsRunning(ctx, "a channel engine");
  const channel = await ctx.rls(async (tx) => {
    const existing = await repos.channels.getByKey(tx, ctx.businessId, channelKey);
    // Only a channel that can really act goes on the board (founder, 2026-11-11). One in offline tracking may: the agent
    // prepares the materials and the founder submits them. Taking a channel off the board is always allowed.
    if (enabled) await assertChannelMayRun(tx, ctx, { channelKey, kitMode: existing ? existing.kitMode : CHANNEL_META[channelKey].kitModeByDefault });
    const toggled = existing ? await repos.channels.setEnabled(tx, ctx.businessId, existing.id, enabled) : null;
    // Launch approvals the channel's campaigns were waiting on expire with it: the event and the closed note (WP-02 T1).
    if (toggled) await recordExpiredApprovals(tx, ctx.businessId, toggled.expiredApprovals, new Date());
    // The expired approvals stay server-side: the response carries the channel only.
    const row = toggled ? (({ expiredApprovals: _expired, ...rest }) => rest)(toggled) : await repos.channels.upsert(tx, ctx.businessId, { channelKey, line: CHANNEL_META[channelKey].line, enabled, kitMode: CHANNEL_META[channelKey].kitModeByDefault });
    await audit(tx, ctx, { action: enabled ? "distribution.channels.enable" : "distribution.channels.disable", target: { kind: "channel", id: row.id }, details: { channelKey } });
    return row;
  });
  // The engine workflow follows the toggle (AC-11.7.2); the Board re-scores from the returned channel list. Before the
  // founder has started distribution (0062) the channel keeps its place on the board and its engine waits for the start.
  const workflowId = workflowIds.engine(channel.id);
  // A channel the founder posts by tap goes on the board with no engine: no agent can publish there (founder, 2026-11-12).
  const founderPosts = enabled && (await runnableChannels(ctx.db, ctx, [channel])).length === 0;
  const workflow = enabled
    ? founderPosts
      ? { queued: false, workflowId, reason: FOUNDER_POSTS_CHANNEL }
      : (await repos.businesses.distributionStarted(ctx.db, ctx.businessId))
        ? await ctx.temporal.start(WORKFLOWS.channelEngine, { workflowId, args: [{ businessId: ctx.businessId, channelId: channel.id, channelKey }] })
        : { queued: false, workflowId, reason: DISTRIBUTION_NOT_STARTED }
    : await ctx.temporal.signal(workflowId, "stop", { reason: "channel_disabled", by: ctx.userId });
  if (workflow.queued) await repos.channels.setEngineWorkflow(ctx.db, ctx.businessId, channel.id, enabled ? workflowId : null);
  // Putting the social channel on the board is the founder's "yes, write posts for me" (services/post-drafts.ts): where
  // the page is already live and no post about it was drafted, the social agent drafts that one now. One draft at most,
  // never waited on, and nothing is launched: this is words for the founder, whatever the channel's engine does.
  if (enabled && channelKey === POST_DRAFT_CHANNEL) queuePostDraft(ctx, ctx.businessId, { kind: "page_published" });
  return { channel: { ...channel, engineWorkflowId: workflow.queued && enabled ? workflowId : channel.engineWorkflowId }, workflow };
}

async function setAssetApproval(ctx: Ctx, assetId: string, state: "approved" | "rejected") {
  return ctx.rls(async (tx) => {
    const asset = await repos.campaigns.setAssetApproval(tx, ctx.businessId, assetId, state);
    await audit(tx, ctx, { action: `distribution.assets.${state === "approved" ? "approve" : "reject"}`, target: { kind: "asset", id: asset.id }, details: { campaignId: asset.campaignId } });
    return asset;
  });
}

export interface ScoredChannel {
  channel: ChannelKey;
  fit: number;
  /** 1–5 stars. */
  potential: number;
  recommended: boolean;
  /** Cost per customer, minor units, low ≤ high (Estimate); null when the Strategist gave no usable range. */
  cpa_range_minor: { low: number; high: number } | null;
  why: string;
  kit_mode_required?: boolean;
}

/**
 * Each channel the Strategist scored, once (a repeated key keeps its last entry), in the order of CHANNEL_KEYS, with the
 * spec's 3–6 starters among them. A channel it left out is not invented here: it keeps what is stored (its last score,
 * or "Not scored"). A cost range comes back low ≤ high, and as null when it is empty (high 0).
 *
 * `available` (when given) is the set of channels that can really act for the business: only those are ever starters,
 * whatever the Strategist answered, so the 3–6 become "up to 6, at least 3 where three are available" and none when
 * none is. The other channels keep their scores and are never recommended.
 */
export function normaliseRecommendation(out: z.infer<typeof Recommendation>, available?: ReadonlySet<ChannelKey>): ScoredChannel[] {
  const byKey = new Map(out.channels.map((c) => [c.channel, c]));
  const rows: ScoredChannel[] = CHANNEL_KEYS.flatMap((channel) => {
    const c = byKey.get(channel);
    if (!c) return [];
    const [low, high] = [Math.min(c.cpa_range_minor.low, c.cpa_range_minor.high), Math.max(c.cpa_range_minor.low, c.cpa_range_minor.high)];
    return [{ channel, fit: c.fit, potential: c.potential, recommended: c.recommended && (available?.has(channel) ?? true), cpa_range_minor: high > 0 ? { low, high } : null, why: c.why, ...(c.kit_mode_required !== undefined ? { kit_mode_required: c.kit_mode_required } : {}) }];
  });
  const ranked = rows.filter((r) => available?.has(r.channel) ?? true).sort((a, b) => b.fit - a.fit);
  let recommended = rows.filter((r) => r.recommended).length;
  for (const r of ranked) {
    if (recommended >= 3) break;
    if (!r.recommended) {
      r.recommended = true;
      recommended++;
    }
  }
  for (const r of [...ranked].reverse()) {
    if (recommended <= 6) break;
    if (r.recommended) {
      r.recommended = false;
      recommended--;
    }
  }
  return rows;
}
