/** distribution.recommend / channels.* / campaigns.* / assets.* (BUILD §11.7; AC-11.7.2 enable/disable re-scores). */
import { CreateCampaignInput, UpdateCampaignInput, repos } from "@foundmill/db";
import { HOUSE_STYLE } from "@foundmill/agents";
import { CAMPAIGN_STATUSES, CHANNEL_KEYS, CHANNEL_LINES, CHANNEL_META, ChannelKey, type ChannelLine } from "@foundmill/shared";
import { z } from "zod";
import { assertAgentsRunning } from "../services/stop-guard";
import { WORKFLOWS, workflowIds } from "../services/temporal";
import { modelLimited } from "../services/model-limits";
import { Id, audit, emit, router, sectionRead, sectionWrite } from "../trpc";

const read = sectionRead("distribution");
const write = sectionWrite("distribution");

const Recommendation = z.object({
  channels: z
    .array(
      z.object({
        channel: ChannelKey,
        fit: z.number().int().min(1).max(20),
        potential: z.number().int().min(1).max(5),
        recommended: z.boolean(),
        cpa_range_minor: z.object({ low: z.number().int().nonnegative(), high: z.number().int().nonnegative() }),
        why: z.string().min(1),
      }),
    )
    .min(15)
    .max(15),
});

export const distributionRouter = router({
  /** Distribution Strategist scores all 15 channels and picks 3–6 starters (AC-11.7.1). Writes the scores to `channels`. */
  recommend: write.use(modelLimited("recommend")).mutation(async ({ ctx }) => {
    const [profile, enabled] = await Promise.all([repos.founders.get(ctx.db, ctx.userId), repos.channels.list(ctx.db, ctx.businessId)]);
    const result = await ctx.models.complete({
      route: "departmentLead",
      schema: Recommendation,
      system: `You are the Distribution Strategist. Score all 15 channels 1-20 on fit and pick 3-6 starters with potential, a cost-per-customer range (minor units, Estimate) and a three-sentence why. ${HOUSE_STYLE}`,
      messages: [{ role: "user", content: "```json\n" + JSON.stringify({ business: { name: ctx.business.name, archetype: ctx.business.archetype, business_mode: ctx.business.businessMode }, founder: profile ? { skills: profile.skills, budget_minor: profile.budgetMinor, target_markets: profile.targetMarkets } : null, channels: CHANNEL_KEYS, currently_enabled: enabled.filter((c) => c.enabled).map((c) => c.channelKey) }) + "\n```" }],
      attribution: { businessId: ctx.businessId, kind: "distribution_strategist" },
    });
    const scored = normaliseRecommendation(result.json);
    const channels = await ctx.rls(async (tx) => {
      const rows = await repos.channels.upsertMany(
        tx,
        ctx.businessId,
        scored.map((c) => ({ channelKey: c.channel, line: CHANNEL_META[c.channel].line, fit: c.fit, potential: c.potential * 20, recommended: c.recommended, whyMd: c.why, kitMode: CHANNEL_META[c.channel].kitModeByDefault })),
      );
      await audit(tx, ctx, { action: "distribution.recommend", target: { kind: "business", id: ctx.businessId }, details: { starters: scored.filter((c) => c.recommended).map((c) => c.channel), costMinor: result.cost.costMinorInt } });
      return rows;
    });
    return { channels, recommendation: scored, cpaLabel: "Estimate" as const };
  }),

  channels: router({
    list: read.query(({ ctx }) =>
      ctx.rls(async (tx) => {
        const [channels, summary] = await Promise.all([repos.channels.list(tx, ctx.businessId), repos.channels.metricsSummary(tx, ctx.businessId, { from: new Date(Date.now() - 35 * 86_400_000).toISOString().slice(0, 10) })]);
        const lines = Object.fromEntries(CHANNEL_LINES.map((l) => [l, [] as string[]])) as Record<ChannelLine, string[]>;
        for (const c of channels) lines[c.line].push(c.channelKey);
        return { channels: channels.map((c) => ({ ...c, meta: CHANNEL_META[c.channelKey], form: summary.channels.find((s) => s.channelId === c.id) ?? null })), lines, blended: summary.blended };
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
    budget: write.input(z.object({ channelId: Id, budgetMinor: z.number().int().nonnegative(), currency: z.string().length(3).optional() })).mutation(({ ctx, input }) =>
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
    create: write.input(CreateCampaignInput).mutation(async ({ ctx, input }) => {
      // A campaign created live spends at once: never while the team is stopped (setStatus below).
      if (input.status === "live") await assertAgentsRunning(ctx, "a live campaign");
      return ctx.rls(async (tx) => {
        const campaign = await repos.campaigns.create(tx, ctx.businessId, input);
        await audit(tx, ctx, { action: "distribution.campaigns.create", target: { kind: "campaign", id: campaign.id }, details: { channelId: campaign.channelId, budgetMinor: campaign.budgetMinor } });
        return campaign;
      });
    }),
    update: write.input(z.object({ campaignId: Id, patch: UpdateCampaignInput })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const campaign = await repos.campaigns.update(tx, ctx.businessId, input.campaignId, input.patch);
        await audit(tx, ctx, { action: "distribution.campaigns.update", target: { kind: "campaign", id: campaign.id }, details: { fields: Object.keys(input.patch) } });
        return campaign;
      }),
    ),
    /**
     * Status changes; launching a campaign emits `campaign.launched`. Spend above caps is gated by the engine, not here.
     * Going live is refused while the team is stopped: Stop all agents paused the live campaigns, and no member sets one
     * spending again before an owner or admin resumes the agents (pausing or ending stays allowed).
     */
    setStatus: write.input(z.object({ campaignId: Id, status: z.enum(CAMPAIGN_STATUSES) })).mutation(async ({ ctx, input }) => {
      if (input.status === "live") await assertAgentsRunning(ctx, "a live campaign");
      return ctx.rls(async (tx) => {
        const before = await repos.campaigns.get(tx, ctx.businessId, input.campaignId);
        const campaign = await repos.campaigns.setStatus(tx, ctx.businessId, input.campaignId, input.status);
        if (input.status === "live" && before.status !== "live") {
          const channel = await repos.channels.get(tx, ctx.businessId, campaign.channelId);
          const assets = await repos.campaigns.listAssets(tx, ctx.businessId, { campaignId: campaign.id, approvalState: "approved" });
          await emit(tx, ctx, {
            type: "campaign.launched",
            payload: { campaignId: campaign.id, channelId: channel.id, channelKey: channel.channelKey, name: campaign.name, goal: campaign.goal.slice(0, 500), budget: { amountMinor: campaign.budgetMinor, currency: campaign.currency }, startsAt: (campaign.startsAt ?? new Date()).toISOString(), endsAt: campaign.endsAt?.toISOString() ?? null, kitMode: channel.kitMode, assetIds: assets.map((a) => a.id), approvalId: null },
          });
        }
        await audit(tx, ctx, { action: "distribution.campaigns.set_status", target: { kind: "campaign", id: campaign.id }, details: { from: before.status, to: input.status } });
        return campaign;
      });
    }),
  }),

  assets: router({
    list: read.input(z.object({ campaignId: Id.optional(), approvalState: z.enum(["draft", "pending", "approved", "rejected"]).optional() })).query(({ ctx, input }) => ctx.rls((tx) => repos.campaigns.listAssets(tx, ctx.businessId, input ?? {}))),
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
    const row = existing ? await repos.channels.setEnabled(tx, ctx.businessId, existing.id, enabled) : await repos.channels.upsert(tx, ctx.businessId, { channelKey, line: CHANNEL_META[channelKey].line, enabled, kitMode: CHANNEL_META[channelKey].kitModeByDefault });
    await audit(tx, ctx, { action: enabled ? "distribution.channels.enable" : "distribution.channels.disable", target: { kind: "channel", id: row.id }, details: { channelKey } });
    return row;
  });
  // The engine workflow follows the toggle (AC-11.7.2); the Board re-scores from the returned channel list.
  const workflowId = workflowIds.engine(channel.id);
  const workflow = enabled
    ? await ctx.temporal.start(WORKFLOWS.channelEngine, { workflowId, args: [{ businessId: ctx.businessId, channelId: channel.id, channelKey }] })
    : await ctx.temporal.signal(workflowId, "stop", { reason: "channel_disabled", by: ctx.userId });
  if (workflow.queued) await repos.channels.setEngineWorkflow(ctx.db, ctx.businessId, channel.id, enabled ? workflowId : null);
  return { channel: { ...channel, engineWorkflowId: workflow.queued && enabled ? workflowId : channel.engineWorkflowId }, workflow };
}

async function setAssetApproval(ctx: Ctx, assetId: string, state: "approved" | "rejected") {
  return ctx.rls(async (tx) => {
    const asset = await repos.campaigns.setAssetApproval(tx, ctx.businessId, assetId, state);
    await audit(tx, ctx, { action: `distribution.assets.${state === "approved" ? "approve" : "reject"}`, target: { kind: "asset", id: asset.id }, details: { campaignId: asset.campaignId } });
    return asset;
  });
}

/** Keep every channel exactly once with the spec's 3–6 starters, whatever the model returned. */
function normaliseRecommendation(out: z.infer<typeof Recommendation>) {
  const byKey = new Map(out.channels.map((c) => [c.channel, c]));
  const rows = CHANNEL_KEYS.map((channel) => byKey.get(channel) ?? { channel, fit: 8, potential: 2, recommended: false, cpa_range_minor: { low: 0, high: 0 }, why: `${CHANNEL_META[channel].label} was not scored; defaulted to a neutral fit (Estimate).` });
  const ranked = [...rows].sort((a, b) => b.fit - a.fit);
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
