/**
 * channelEngine activities (BUILD §9.4, §11.7): one step of the weekly loop plan → create → approve → launch →
 * measure → learn → report for an enabled channel. Creative and launch work happens through the channel agent's
 * session (an agentSession child dispatched by the workflow); these activities own the campaign row, the approval,
 * the metrics roll-up and the weekly report. Mock metrics are deterministic and stored as `source: estimate`, so the
 * screens label them Estimate; they are written only for a campaign that actually went live.
 *
 * Budgets: `channels.budget_minor` is the channel's MONTHLY budget (the drawer's "Monthly budget"); each weekly campaign
 * gets the weekly share of it (`weeklyBudgetMinor`), and that is what the mock week spends at most.
 */
import { getChannelTemplate } from "@foundmill/agents";
import { LIMITS } from "@foundmill/config";
import { repos } from "@foundmill/db";
import { stableHash } from "@foundmill/models";
import { CHANNEL_KEYS, CHANNEL_META, type BusinessMode, type ChannelKey } from "@foundmill/shared";
import type { OrchestratorDeps } from "../deps";
import { emitEvent, systemActor } from "../events";
import type { ChannelEngineState, ChannelStep, ChannelStepResult } from "./types";

export const emptyChannelState = (): ChannelEngineState => ({ campaignId: null, approvalId: null, lastStep: null, weeksRun: 0, learnings: [] });

const isChannelKey = (v: string): v is ChannelKey => (CHANNEL_KEYS as readonly string[]).includes(v);

/** Average days in a month (365.25 / 12): a week is 7 / 30.4375 of a monthly budget. */
const DAYS_PER_MONTH = 30.4375;

/** The weekly share of a monthly budget (minor units), what one weekly campaign may spend. */
export function weeklyBudgetMinor(monthlyMinor: number | string | null): number {
  const monthly = monthlyMinor === null ? 0 : Number(monthlyMinor);
  return Number.isFinite(monthly) && monthly > 0 ? Math.round((monthly * 7) / DAYS_PER_MONTH) : 0;
}

/**
 * Whether this week's campaign waits for the founder before it is scheduled (BUILD §9.6 business modes, §11.7
 * "Approve (policy)"), and why. Offline tracking always asks (the agent prepares, the founder submits); Augmented asks for
 * every launch; every mode asks above the approval threshold; Assisted also asks for a new campaign (the channel has not
 * launched one yet, or this one commits more than the last one that ran). Null: schedule without asking.
 */
export function launchApprovalReason(input: { businessMode: BusinessMode; kitMode: boolean; newCampaign: boolean; budgetMinor: number; thresholdMinor: number }): string | null {
  if (input.kitMode) return "offline tracking: the agent prepares, the founder submits";
  if (input.businessMode === "augmented") return "augmented mode: every external action asks";
  if (input.budgetMinor > input.thresholdMinor) return "the weekly budget is above the approval threshold";
  if (input.businessMode === "assisted" && input.newCampaign) return "assisted mode: a new campaign needs your approval";
  return null;
}

export function createChannelActivities(deps: OrchestratorDeps) {
  return {
    async channelStep(input: { businessId: string; channelId: string; channelKey: string; step: ChannelStep; weekIndex: number; state: ChannelEngineState; approvedApprovalId?: string | null }): Promise<ChannelStepResult> {
      const { db, clock } = deps;
      const businessId = input.businessId;
      const state: ChannelEngineState = { ...input.state, learnings: [...input.state.learnings] };
      const channel = await repos.channels.get(db, businessId, input.channelId);
      const done = (note: string, extra: Partial<ChannelStepResult> = {}): ChannelStepResult => ({ step: input.step, state: { ...state, lastStep: input.step }, awaitingApprovalId: null, stop: false, note, ...extra });
      if (!channel.enabled || channel.archivedAt) {
        // Off the board is the full stop: whatever the engine had open on the channel ends with it.
        await repos.campaigns.endForChannel(db, businessId, channel.id);
        return done("channel disabled; engine stopping", { stop: true });
      }
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
          const monthlyMinor = channel.budgetMinor === null ? 0 : Number(channel.budgetMinor);
          state.learnings = state.learnings.slice(-8);
          return done(`Plan for ${meta.label}: core metric ${meta.coreMetric}; monthly budget ${(monthlyMinor / 100).toFixed(2)} ${channel.currency ?? "EUR"}, this week's share ${(weeklyBudgetMinor(monthlyMinor) / 100).toFixed(2)} (Estimate); ${template.name} owns the work.`);
        }
        case "create": {
          const campaign = await repos.campaigns.create(db, businessId, { channelId: channel.id, name: `${meta.label} — ${weekLabel}`, goal: `Improve ${meta.coreMetric}`, status: "draft", budgetMinor: weeklyBudgetMinor(channel.budgetMinor), currency: channel.currency ?? "EUR", config: { weekIndex: input.weekIndex, learnings: state.learnings, kitMode: channel.kitMode } });
          state.campaignId = campaign.id;
          return done(`Campaign drafted (${campaign.id}).`);
        }
        case "approve": {
          if (!state.campaignId) return done("no campaign to approve");
          const campaign = await repos.campaigns.get(db, businessId, state.campaignId);
          const budgetMinor = Number(campaign.budgetMinor);
          if (input.approvedApprovalId && state.approvalId === input.approvedApprovalId) {
            await repos.campaigns.setStatus(db, businessId, state.campaignId, "scheduled");
            state.approvalId = null;
            return done("Founder approved; scheduled.");
          }
          // A campaign the channel already ran at this budget is routine work; its first one, or a bigger one, is new.
          const last = await repos.campaigns.lastLaunched(db, businessId, channel.id, campaign.id);
          const reason = launchApprovalReason({
            businessMode: business.businessMode,
            kitMode: channel.kitMode,
            newCampaign: !last || budgetMinor > Number(last.budgetMinor),
            budgetMinor,
            // The founder's spend cap per action lowers the threshold, as it does at the gateway.
            thresholdMinor: business.spendCapMinor === null ? LIMITS.approvalThresholdMinorDefault : Math.min(LIMITS.approvalThresholdMinorDefault, Number(business.spendCapMinor)),
          });
          if (!reason) {
            await repos.campaigns.setStatus(db, businessId, state.campaignId, "scheduled");
            return done("Inside policy: scheduled without asking.");
          }
          await repos.campaigns.setStatus(db, businessId, state.campaignId, "pending_approval");
          const approval = await repos.approvals.create(db, businessId, { agentId: owner?.id ?? null, connectorKey: "platform", tool: "launch_campaign", args: { campaignId: state.campaignId, channelKey: key }, reasons: [reason] });
          state.approvalId = approval.id;
          if (owner) {
            await emitEvent(db, { businessId, type: "approval.requested", actor: { kind: "agent", id: owner.id }, payload: { approvalId: approval.id, agentId: owner.id, connectorKey: "platform", tool: "launch_campaign", amount: { amountMinor: budgetMinor, currency: campaign.currency ?? channel.currency ?? "EUR" }, reasons: [reason], policyIds: [], decisionType: "publish_content", hardGate: false, summary: `${owner.name} wants to launch "${campaign.name}"` } });
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
          // Only a campaign that went live produced anything (a rejected or unanswered one never launched).
          const campaign = await repos.campaigns.get(db, businessId, state.campaignId);
          if (campaign.status !== "live") return done(`campaign is ${campaign.status.replace(/_/g, " ")}, not live; nothing to measure`);
          // Mock mode: deterministic numbers for the week, seeded by business + campaign + week, stored as an estimate.
          if (deps.env.INTEGRATIONS_MODE === "mock") {
            const seed = parseInt(stableHash(`${businessId}:${state.campaignId}:${input.weekIndex}`).slice(0, 8), 16);
            const day = clock.now().toISOString().slice(0, 10);
            const impressions = 400 + (seed % 3000);
            const leads = Math.max(1, Math.round(impressions * (0.01 + (seed % 7) / 1000)));
            const signups = Math.round(leads * 0.3);
            // The week spends within its campaign's budget (the weekly share of the monthly budget).
            await repos.channels.upsertMetric(db, businessId, { channelId: channel.id, campaignId: state.campaignId, day, spendMinor: Math.round(Number(campaign.budgetMinor) * 0.9), currency: campaign.currency ?? channel.currency ?? "EUR", impressions, leads, signups, activations: Math.round(signups * 0.5), customers: Math.round(signups * 0.2), source: "estimate" });
            return done(`Measured (mock, Estimate): ${impressions} impressions, ${leads} leads, ${signups} signups.`);
          }
          return done("Metrics arrive through the connector webhooks (ingest); nothing to pull here.");
        }
        case "learn": {
          if (!state.campaignId) return done("nothing launched this week; nothing to learn");
          const ran = await repos.campaigns.get(db, businessId, state.campaignId);
          if (ran.status !== "live") return done(`campaign is ${ran.status.replace(/_/g, " ")}, not live; nothing to learn`);
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
