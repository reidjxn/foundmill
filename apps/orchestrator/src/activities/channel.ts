/**
 * channelEngine activities (BUILD §9.4, §11.7): one step of the weekly loop plan → create → approve → launch →
 * measure → learn → report for an enabled channel. Creative and launch work happens through the channel agent's
 * session (an agentSession child dispatched by the workflow); these activities own the campaign row, the approval,
 * the metrics roll-up and the weekly report. Mock metrics are deterministic and labelled "Estimate".
 */
import { getChannelTemplate } from "@foundmill/agents";
import { repos } from "@foundmill/db";
import { stableHash } from "@foundmill/models";
import { CHANNEL_KEYS, CHANNEL_META, type ChannelKey } from "@foundmill/shared";
import type { OrchestratorDeps } from "../deps";
import { emitEvent, systemActor } from "../events";
import type { ChannelEngineState, ChannelStep, ChannelStepResult } from "./types";

export const emptyChannelState = (): ChannelEngineState => ({ campaignId: null, approvalId: null, lastStep: null, weeksRun: 0, learnings: [] });

const isChannelKey = (v: string): v is ChannelKey => (CHANNEL_KEYS as readonly string[]).includes(v);

export function createChannelActivities(deps: OrchestratorDeps) {
  return {
    async channelStep(input: { businessId: string; channelId: string; channelKey: string; step: ChannelStep; weekIndex: number; state: ChannelEngineState; approvedApprovalId?: string | null }): Promise<ChannelStepResult> {
      const { db, clock } = deps;
      const businessId = input.businessId;
      const state: ChannelEngineState = { ...input.state, learnings: [...input.state.learnings] };
      const channel = await repos.channels.get(db, businessId, input.channelId);
      const done = (note: string, extra: Partial<ChannelStepResult> = {}): ChannelStepResult => ({ step: input.step, state: { ...state, lastStep: input.step }, awaitingApprovalId: null, stop: false, note, ...extra });
      if (!channel.enabled || channel.archivedAt) return done("channel disabled; engine stopping", { stop: true });
      // Stop all agents (or a revoked key, used-up credits) ends the engine even when its stop signal was missed;
      // resuming the agents starts it again.
      if (await repos.businesses.agentsStopped(db, businessId)) return done("agents are stopped; engine stopping", { stop: true });
      const key = isChannelKey(input.channelKey) ? input.channelKey : (channel.channelKey as ChannelKey);
      const meta = CHANNEL_META[key];
      const business = await repos.businesses.get(db, businessId);
      const owner = channel.ownerAgentId ? await repos.agents.get(db, businessId, channel.ownerAgentId) : null;
      // The channel's agent paused (its wage cap, or by hand): nothing new is drafted or launched for it this week.
      if (owner?.status === "paused" && (input.step === "create" || input.step === "launch")) return done(`${owner.name} is paused; skipped this week's ${input.step}`);
      const template = getChannelTemplate(key);
      const weekLabel = `week ${input.weekIndex + 1}, ${clock.now().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;

      switch (input.step) {
        case "plan": {
          const budgetMinor = channel.budgetMinor === null ? 0 : Number(channel.budgetMinor);
          state.learnings = state.learnings.slice(-8);
          return done(`Plan for ${meta.label}: core metric ${meta.coreMetric}; weekly budget ${(budgetMinor / 100).toFixed(2)} ${channel.currency ?? "EUR"} (Estimate); ${template.name} owns the work.`);
        }
        case "create": {
          const budgetMinor = channel.budgetMinor === null ? 0 : Number(channel.budgetMinor);
          const campaign = await repos.campaigns.create(db, businessId, { channelId: channel.id, name: `${meta.label} — ${weekLabel}`, goal: `Improve ${meta.coreMetric}`, status: "draft", budgetMinor: Math.max(0, budgetMinor), currency: channel.currency ?? "EUR", config: { weekIndex: input.weekIndex, learnings: state.learnings, kitMode: channel.kitMode } });
          state.campaignId = campaign.id;
          return done(`Campaign drafted (${campaign.id}).`);
        }
        case "approve": {
          if (!state.campaignId) return done("no campaign to approve");
          const needsApproval = business.businessMode === "augmented" || channel.kitMode;
          if (!needsApproval) {
            await repos.campaigns.setStatus(db, businessId, state.campaignId, "scheduled");
            return done("Inside policy: scheduled without asking.");
          }
          if (input.approvedApprovalId && state.approvalId === input.approvedApprovalId) {
            await repos.campaigns.setStatus(db, businessId, state.campaignId, "scheduled");
            state.approvalId = null;
            return done("Founder approved; scheduled.");
          }
          await repos.campaigns.setStatus(db, businessId, state.campaignId, "pending_approval");
          const approval = await repos.approvals.create(db, businessId, { agentId: owner?.id ?? null, connectorKey: "platform", tool: "launch_campaign", args: { campaignId: state.campaignId, channelKey: key }, reasons: [business.businessMode === "augmented" ? "augmented mode: every external action asks" : "offline tracking: the agent prepares, the founder submits"] });
          state.approvalId = approval.id;
          if (owner) {
            await emitEvent(db, { businessId, type: "approval.requested", actor: { kind: "agent", id: owner.id }, payload: { approvalId: approval.id, agentId: owner.id, connectorKey: "platform", tool: "launch_campaign", amount: channel.budgetMinor === null ? null : { amountMinor: Number(channel.budgetMinor), currency: channel.currency ?? "EUR" }, reasons: ["campaign launch needs your approval"], policyIds: [], decisionType: "publish_content", hardGate: false, summary: `${owner.name} wants to launch "${meta.label} — ${weekLabel}"` } });
          }
          return done("Waiting for the founder's approval.", { awaitingApprovalId: approval.id });
        }
        case "launch": {
          if (!state.campaignId) return done("no campaign to launch");
          const campaign = await repos.campaigns.get(db, businessId, state.campaignId);
          if (campaign.status === "pending_approval" || campaign.status === "draft") return done("campaign not approved; skipping launch");
          if (campaign.status !== "live") await repos.campaigns.setStatus(db, businessId, campaign.id, "live");
          await emitEvent(db, { businessId, type: "campaign.launched", actor: owner ? { kind: "agent", id: owner.id } : systemActor, payload: { campaignId: campaign.id, channelId: channel.id, channelKey: key, name: campaign.name.slice(0, 200), goal: campaign.goal.slice(0, 500), budget: { amountMinor: Number(campaign.budgetMinor), currency: campaign.currency ?? "EUR" }, startsAt: clock.now().toISOString(), endsAt: null, kitMode: channel.kitMode, assetIds: [], approvalId: state.approvalId } });
          return done("Live.");
        }
        case "measure": {
          if (!state.campaignId) return done("nothing to measure");
          // Mock mode: deterministic weekly numbers seeded by business + campaign + week; labelled Estimate on the row.
          if (deps.env.INTEGRATIONS_MODE === "mock") {
            const seed = parseInt(stableHash(`${businessId}:${state.campaignId}:${input.weekIndex}`).slice(0, 8), 16);
            const budget = channel.budgetMinor === null ? 0 : Number(channel.budgetMinor);
            const day = clock.now().toISOString().slice(0, 10);
            const impressions = 400 + (seed % 3000);
            const leads = Math.max(1, Math.round(impressions * (0.01 + (seed % 7) / 1000)));
            const signups = Math.round(leads * 0.3);
            await repos.channels.upsertMetric(db, businessId, { channelId: channel.id, campaignId: state.campaignId, day, spendMinor: Math.round(budget * 0.9), currency: channel.currency ?? "EUR", impressions, leads, signups, activations: Math.round(signups * 0.5), customers: Math.round(signups * 0.2) });
            return done(`Measured (mock, Estimate): ${impressions} impressions, ${leads} leads, ${signups} signups.`);
          }
          return done("Metrics arrive through the connector webhooks (ingest); nothing to pull here.");
        }
        case "learn": {
          const summary = await repos.channels.metricsSummary(db, businessId, {});
          const mine = summary.channels.find((c) => c.channelId === channel.id);
          const cpa = mine?.cpaMinor ?? null;
          const learning = cpa === null ? `w${input.weekIndex + 1}: not enough data for a CPA yet` : `w${input.weekIndex + 1}: CPA ${(cpa / 100).toFixed(2)} ${channel.currency ?? "EUR"} (Estimate) vs blended ${summary.blended.cpaMinor === null ? "n/a" : (summary.blended.cpaMinor / 100).toFixed(2)}`;
          state.learnings.push(learning);
          if (cpa !== null && summary.blended.cpaMinor !== null && cpa > summary.blended.cpaMinor * 1.2) {
            await emitEvent(db, { businessId, type: "channel.threshold_breached", actor: systemActor, payload: { channelId: channel.id, channelKey: key, campaignId: state.campaignId, metric: "cpa", value: cpa, threshold: Math.round(summary.blended.cpaMinor * 1.2), direction: "above", windowHours: 24 * 7, action: "alerted" } });
          }
          return done(learning);
        }
        case "report": {
          if (state.campaignId) await repos.campaigns.setStatus(db, businessId, state.campaignId, "ended").catch(() => undefined);
          state.weeksRun += 1;
          await repos.audit.append(db, businessId, { actorKind: "system", action: "channel.week_report", target: { kind: "channel", id: channel.id }, details: { weekIndex: input.weekIndex, campaignId: state.campaignId, learnings: state.learnings.slice(-1) } });
          state.campaignId = null;
          state.approvalId = null;
          return done(`Week ${input.weekIndex + 1} reported.`);
        }
      }
    },
  };
}

export type ChannelActivities = ReturnType<typeof createChannelActivities>;
