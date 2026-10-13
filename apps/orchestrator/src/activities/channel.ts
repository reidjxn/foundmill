/**
 * channelEngine activities (BUILD §9.4, §11.7): one step of the weekly loop plan → create → approve → launch →
 * measure → learn → report for an enabled channel. These activities own the campaign row, its creative, the approval,
 * the metrics roll-up, the leads and the weekly report. Mock metrics are deterministic and labeled "Estimate".
 *
 * - create: the channel's agent drafts the week's creative through packages/models (`buildChannelCreativeRequest`, the
 *   worker route, billed to the agent as an Estimate); each draft is a `pending` asset on the Creative tab. In mock mode
 *   the drafts come from the mock model and say so in their first line. A failed draft leaves the campaign without
 *   creative, and it does not launch (audit GTM-12).
 * - approve: a campaign with no creative stops here. Inside policy (`launchApprovalReason`) the drafts are approved with
 *   the launch; otherwise the founder is asked, and their approval approves the campaign's drafts. Assets the founder
 *   rejected stay rejected.
 * - launch: never with zero approved assets; `campaign.launched` carries their ids. With offline tracking the founder
 *   gets a task with every material attached and nothing is booked (AC-11.7.6).
 * - measure (mock): the week's numbers, and for the lead channels (lead generation, content, events) one CRM record
 *   with a `lead` role per lead counted, so the Leads tab and the Attribution counts come from the same records
 *   (audit GTM-02).
 */
import { buildChannelCreativeRequest, docText, finaliseCreative, getChannelTemplate } from "@foundmill/agents";
import { LIMITS } from "@foundmill/config";
import { repos } from "@foundmill/db";
import { stableHash } from "@foundmill/models";
import { CHANNEL_KEYS, CHANNEL_META, type BusinessMode, type ChannelKey } from "@foundmill/shared";
import type { OrchestratorDeps } from "../deps";
import { emitEvent, systemActor } from "../events";
import { openApprovalNote } from "./approvals";
import { requestJourneyDailyRefresh } from "../journey-refresh";
import type { ChannelEngineState, ChannelStep, ChannelStepResult } from "./types";

export const emptyChannelState = (): ChannelEngineState => ({ campaignId: null, approvalId: null, lastStep: null, weeksRun: 0, learnings: [] });

const isChannelKey = (v: string): v is ChannelKey => (CHANNEL_KEYS as readonly string[]).includes(v);

/** The first line of every body the mock model drafted, so a mock draft is never mistaken for a written one. */
export const MOCK_CREATIVE_LABEL = "Mock draft: written in mock mode, no model was called. Replace before it reaches anyone.";

/** Channels whose engine counts leads, with the lawful basis a lead from it carries (BUILD §11.12 data duties). */
export const LEAD_CHANNELS: Partial<Record<ChannelKey, { basis: "legitimate_interest" | "consent"; maxPerWeek: number }>> = {
  lead_generation: { basis: "legitimate_interest", maxPerWeek: 8 },
  content: { basis: "consent", maxPerWeek: 4 },
  events: { basis: "consent", maxPerWeek: 4 },
};

const MOCK_FIRST = ["Ada", "Grace", "Alan", "Katherine", "Tim", "Radia", "Linus", "Barbara", "Edsger", "Frances", "Ken", "Margaret"];
const MOCK_LAST = ["Okafor", "Lindqvist", "Moreau", "Tanaka", "Silva", "Novak", "Haddad", "Kowalski", "Reyes", "Byrne", "Iqbal", "Sorensen"];
const MOCK_COMPANY = ["Northbeam", "Quillon", "Harbor Labs", "Brightlane", "Corvid", "Tessellate", "Fieldnote", "Larchmont", "Kestrel", "Ostara"];

/** A deterministic mock lead (names from a fixed list, `.example` addresses that can never receive mail). */
export function mockLead(seed: string): { displayName: string; email: string; company: string; domain: string } {
  const n = parseInt(stableHash(seed).slice(0, 12), 16);
  const first = MOCK_FIRST[n % MOCK_FIRST.length]!;
  const last = MOCK_LAST[Math.floor(n / 7) % MOCK_LAST.length]!;
  const company = MOCK_COMPANY[Math.floor(n / 97) % MOCK_COMPANY.length]!;
  const domain = `${company.toLowerCase().replace(/[^a-z]+/g, "")}.example`;
  return { displayName: `${first} ${last}`, email: `${first}.${last}.${(n % 997).toString(36)}@${domain}`.toLowerCase(), company, domain };
}

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
  /** The business brief the creative is written from: the spec's opening sections, as plain text. */
  async function creativeBrief(businessId: string): Promise<string | null> {
    const blocks = await repos.product.listBlocks(deps.db, businessId).catch(() => []);
    const text = blocks
      .slice(0, 6)
      .map((b) => {
        const body = docText(b.content).trim();
        return body ? `${b.section}: ${body}` : "";
      })
      .filter(Boolean)
      .join("\n");
    return text ? text.slice(0, 2_000) : null;
  }

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
      const currency = channel.currency;

      switch (input.step) {
        case "plan": {
          const monthlyMinor = channel.budgetMinor === null ? 0 : Number(channel.budgetMinor);
          state.learnings = state.learnings.slice(-8);
          return done(`Plan for ${meta.label}: core metric ${meta.coreMetric}; monthly budget ${(monthlyMinor / 100).toFixed(2)} ${currency}, this week's share ${(weeklyBudgetMinor(monthlyMinor) / 100).toFixed(2)} (Estimate); ${template.name} owns the work.`);
        }
        case "create": {
          const budgetMinor = weeklyBudgetMinor(channel.budgetMinor);
          const campaign = await repos.campaigns.create(db, businessId, { channelId: channel.id, name: `${meta.label} — ${weekLabel}`, goal: `Improve ${meta.coreMetric}`, status: "draft", budgetMinor, currency, config: { weekIndex: input.weekIndex, learnings: state.learnings, kitMode: channel.kitMode } });
          state.campaignId = campaign.id;
          // The channel's agent drafts the week's creative; the cost is the agent's (an Estimate).
          let drafted = 0;
          let failure: string | null = null;
          try {
            const result = await deps.models.complete({
              ...buildChannelCreativeRequest({ businessName: business.name, channelKey: key, campaignName: campaign.name, objective: campaign.goal, learnings: state.learnings, kitMode: channel.kitMode, brief: await creativeBrief(businessId), weeklyBudget: budgetMinor > 0 ? { amountMinor: budgetMinor, currency } : null }),
              scope: `channel-creative:${businessId}`,
              attribution: { businessId, ...(owner ? { agentId: owner.id } : {}), kind: "channel_creative" },
            });
            const assets = finaliseCreative(result.json, { channelKey: key, label: result.mode === "mock" ? MOCK_CREATIVE_LABEL : null });
            for (const a of assets) {
              await repos.campaigns.createAsset(db, businessId, { campaignId: campaign.id, kind: a.kind, title: a.title, body: a.body, approvalState: "pending", authoredByAgentId: owner?.id ?? null });
              drafted += 1;
            }
          } catch (err) {
            failure = ((err as Error)?.message ?? String(err)).slice(0, 160);
            deps.log.warn({ businessId, channelId: channel.id, campaignId: campaign.id, err: failure }, "channel creative not drafted; the campaign does not launch this week");
          }
          if (drafted === 0) return done(`Campaign drafted (${campaign.id}) without creative${failure ? ` (${failure})` : ""}; it does not launch this week.`);
          return done(`Campaign drafted (${campaign.id}) with ${drafted} creative draft${drafted === 1 ? "" : "s"} for approval.`);
        }
        case "approve": {
          if (!state.campaignId) return done("no campaign to approve");
          const assets = (await repos.campaigns.listAssets(db, businessId, { campaignId: state.campaignId })).filter((a) => a.approvalState !== "rejected");
          if (assets.length === 0) return done("No creative to approve; the campaign does not launch this week.");
          const campaign = await repos.campaigns.get(db, businessId, state.campaignId);
          const budgetMinor = Number(campaign.budgetMinor);
          if (input.approvedApprovalId && state.approvalId === input.approvedApprovalId) {
            const approved = await repos.campaigns.approveCampaignAssets(db, businessId, state.campaignId);
            await repos.campaigns.setStatus(db, businessId, state.campaignId, "scheduled");
            state.approvalId = null;
            return done(`Founder approved; ${approved.length} creative draft${approved.length === 1 ? "" : "s"} approved and the campaign scheduled.`);
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
            const approved = await repos.campaigns.approveCampaignAssets(db, businessId, state.campaignId);
            await repos.campaigns.setStatus(db, businessId, state.campaignId, "scheduled");
            return done(`Inside policy: ${approved.length} creative draft${approved.length === 1 ? "" : "s"} approved with the launch; scheduled without asking.`);
          }
          await repos.campaigns.setStatus(db, businessId, state.campaignId, "pending_approval");
          const budget = budgetMinor <= 0 ? null : { amountMinor: budgetMinor, currency: campaign.currency };
          const approval = await repos.approvals.create(db, businessId, { agentId: owner?.id ?? null, connectorKey: "platform", tool: "launch_campaign", args: { campaignId: state.campaignId, channelKey: key, assetIds: assets.map((a) => a.id) }, reasons: [reason], ...(budget ?? {}) });
          state.approvalId = approval.id;
          const requested = owner ? await emitEvent(db, { businessId, type: "approval.requested", actor: { kind: "agent", id: owner.id }, payload: { approvalId: approval.id, agentId: owner.id, connectorKey: "platform", tool: "launch_campaign", amount: budget, reasons: ["campaign launch needs your approval"], policyIds: [], decisionType: "publish_content", hardGate: false, summary: `${owner.name} wants to launch "${meta.label} — ${weekLabel}"` } }) : null;
          // Answered in the Inbox: Approve or Reject signals `approval:<id>`, the wait this engine runs in.
          await openApprovalNote(db, businessId, approval, { agent: owner ? { id: owner.id, name: owner.name } : null, taskTitle: null, argsSummary: `Launch "${meta.label} — ${weekLabel}"`, sourceEventIds: requested ? [requested.id] : [] });
          return done("Waiting for the founder's approval.", { awaitingApprovalId: approval.id });
        }
        case "launch": {
          if (!state.campaignId) return done("no campaign to launch");
          const campaign = await repos.campaigns.get(db, businessId, state.campaignId);
          if (campaign.status === "pending_approval" || campaign.status === "draft") return done("campaign not approved; skipping launch");
          const approved = await repos.campaigns.listAssets(db, businessId, { campaignId: campaign.id, approvalState: "approved" });
          // Never live with nothing to show (the Campaigns footer: launch needs at least one approved asset).
          if (approved.length === 0) return done("No approved creative; the campaign does not launch.");
          if (campaign.status !== "live") await repos.campaigns.setStatus(db, businessId, campaign.id, "live");
          if (channel.kitMode) {
            // Offline tracking: the founder submits, with every material attached; nothing is booked (AC-11.7.6).
            const materials = approved.map((a, i) => `${i + 1}. ${a.title} (${a.kind})\n${(a.body ?? a.contentRef ?? "").slice(0, 1_500)}`).join("\n\n");
            await repos.tasks.create(db, businessId, {
              kind: "channel",
              title: `Founder action: submit the ${meta.label.toLowerCase()} materials for "${campaign.name}"`.slice(0, 200),
              goalMd: `Offline tracking: ${owner?.name ?? "The channel's agent"} prepared these materials; you submit or book them yourself. Nothing has been booked, bought or signed.\n\n${materials}`.slice(0, 20_000),
              acceptance: ["The founder submitted the materials (offline tracking)."],
              assigneeAgentId: null,
              status: "ready",
              priority: 50,
              currency,
            });
          }
          await emitEvent(db, { businessId, type: "campaign.launched", actor: owner ? { kind: "agent", id: owner.id } : systemActor, payload: { campaignId: campaign.id, channelId: channel.id, channelKey: key, name: campaign.name.slice(0, 200), goal: campaign.goal.slice(0, 500), budget: { amountMinor: Number(campaign.budgetMinor), currency: campaign.currency ?? currency }, startsAt: clock.now().toISOString(), endsAt: null, kitMode: channel.kitMode, assetIds: approved.map((a) => a.id), approvalId: state.approvalId } });
          return done(channel.kitMode ? `Live with ${approved.length} asset${approved.length === 1 ? "" : "s"}; the founder submits them (offline tracking).` : `Live with ${approved.length} asset${approved.length === 1 ? "" : "s"}.`);
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
            const leadChannel = LEAD_CHANNELS[key];
            // Lead channels count the leads they record; the others measure signups from their reach.
            const recorded = leadChannel ? await recordMockLeads(businessId, channel.id, key, state.campaignId, owner?.id ?? null, 1 + (seed % leadChannel.maxPerWeek), leadChannel.basis, `${state.campaignId}:${input.weekIndex}`) : 0;
            const signups = leadChannel ? Math.round(recorded * 0.3) : Math.round(impressions * (0.002 + (seed % 5) / 1000));
            await repos.channels.upsertMetric(db, businessId, { channelId: channel.id, campaignId: state.campaignId, day, spendMinor: Math.round(Number(campaign.budgetMinor) * 0.9), currency: campaign.currency, impressions, leads: recorded, signups, activations: Math.round(signups * 0.5), customers: Math.round(signups * 0.2), source: "estimate" });
            requestJourneyDailyRefresh(deps);
            return done(`Measured (mock, Estimate): ${impressions} impressions, ${recorded} leads, ${signups} signups.`);
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
          const learning = cpa === null ? `w${input.weekIndex + 1}: not enough data for a CPA yet` : `w${input.weekIndex + 1}: CPA ${(cpa / 100).toFixed(2)} ${currency} (Estimate) vs blended ${summary.blended.cpaMinor === null ? "n/a" : (summary.blended.cpaMinor / 100).toFixed(2)}`;
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

  /**
   * Mock mode: `count` leads for a lead channel, each a CRM record (deterministic name, an `.example` address, its
   * company, the channel as source and the channel's lawful basis) with a `lead` role owned by the channel's agent, and
   * `lead.created`. A suppressed address is skipped and not counted. Returns how many were recorded.
   */
  async function recordMockLeads(businessId: string, channelId: string, channelKey: ChannelKey, campaignId: string, ownerAgentId: string | null, count: number, basis: "legitimate_interest" | "consent", seed: string): Promise<number> {
    let recorded = 0;
    for (let i = 0; i < count; i++) {
      const lead = mockLead(`${businessId}:${channelId}:${seed}:${i}`);
      const out = await repos.entities.upsertLead(deps.db, businessId, { kind: "person", displayName: lead.displayName, email: lead.email, company: lead.company, domain: lead.domain, source: channelKey, lawfulBasis: basis, ownerAgentId });
      if (out.status === "suppressed") continue;
      // Counted even when a retried step finds the record it wrote before; announced once.
      recorded += 1;
      if (!out.roleCreated) continue;
      await emitEvent(deps.db, { businessId, type: "lead.created", actor: ownerAgentId ? { kind: "agent", id: ownerAgentId } : systemActor, entityIds: [out.entity.id], payload: { entityId: out.entity.id, channelKey, campaignId, score: null, source: `${CHANNEL_META[channelKey].label} (mock)`, lawfulBasis: basis, country: null } });
    }
    return recorded;
  }
}

export type ChannelActivities = ReturnType<typeof createChannelActivities>;
