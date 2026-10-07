/**
 * Nightly schedule activities (BUILD §9.4): journeyDailyRefresh (matview + attribution refit), benchmarksRebuild
 * (per-archetype channel CPA benchmarks, labelled Estimate), credentialExpiryScan (`credential.expiring`),
 * consentRenewalScan (open-banking consents) and agentMetricsRollup (yesterday's sessions → agent_metrics + health).
 */
import { buildMarkovModel, conversionPathsFromTouches } from "@foundmill/journey";
import { repos } from "@foundmill/db";
import type { ChannelKey } from "@foundmill/shared";
import type { OrchestratorDeps } from "../deps";
import { emitEvent, systemActor } from "../events";
import type { ScheduleResult } from "./types";

const DAY_MS = 86_400_000;
const EXPIRY_WINDOW_DAYS = 14;

export function createScheduleActivities(deps: OrchestratorDeps) {
  const at = (iso?: string) => (iso ? new Date(iso) : deps.clock.now());

  return {
    async journeyDailyRefresh(input: { businessIds: string[]; at?: string }): Promise<ScheduleResult> {
      const { db } = deps;
      const notes: string[] = [];
      let touched = 0;
      try {
        await repos.journeys.refreshDaily(db);
        notes.push("journey_daily refreshed");
      } catch (err) {
        notes.push(`journey_daily refresh skipped: ${(err as Error).message.slice(0, 120)}`);
      }
      for (const businessId of input.businessIds) {
        const since = new Date(at(input.at).getTime() - 90 * DAY_MS);
        const conversions = await repos.journeys.listConversions(db, businessId, { from: since, limit: 500 });
        const groups: { touches: { id: string; occurredAt: string; channelKey: ChannelKey | null }[]; converted: boolean }[] = [];
        for (const c of conversions.items.slice(0, 200)) {
          if (!c.entityId) continue;
          const touches = await repos.journeys.pathForEntity(db, businessId, c.entityId, new Date(c.occurredAt));
          groups.push({ converted: true, touches: touches.map((t) => ({ id: t.id, occurredAt: new Date(t.occurredAt).toISOString(), channelKey: t.channelKey })) });
        }
        const model = groups.length > 0 ? buildMarkovModel(conversionPathsFromTouches(groups)) : null;
        await repos.audit.append(db, businessId, { actorKind: "system", action: "schedule.journey_daily_refresh", target: {}, details: { conversions: conversions.items.length, markovPaths: model?.pathCount ?? 0, baseConversionProbability: model?.baseConversionProbability ?? null, label: "Estimate" } });
        touched += 1;
      }
      return { businesses: input.businessIds.length, touched, eventIds: [], notes };
    },

    async benchmarksRebuild(input: { businessIds: string[]; at?: string }): Promise<ScheduleResult> {
      const { db } = deps;
      const byArchetype = new Map<string, { cpa: number[]; businesses: number }>();
      for (const businessId of input.businessIds) {
        const [business, summary] = await Promise.all([repos.businesses.get(db, businessId), repos.channels.metricsSummary(db, businessId, {})]);
        const key = business.archetype ?? "uncommitted";
        const entry = byArchetype.get(key) ?? { cpa: [], businesses: 0 };
        entry.businesses += 1;
        for (const c of summary.channels) if (c.cpaMinor !== null) entry.cpa.push(c.cpaMinor);
        byArchetype.set(key, entry);
      }
      const benchmarks = [...byArchetype.entries()].map(([archetype, v]) => ({ archetype, businesses: v.businesses, medianCpaMinor: median(v.cpa), label: "Estimate" }));
      for (const businessId of input.businessIds) {
        await repos.audit.append(db, businessId, { actorKind: "system", action: "schedule.benchmarks_rebuild", target: {}, details: { benchmarks, computedAt: at(input.at).toISOString() } });
      }
      return { businesses: input.businessIds.length, touched: benchmarks.length, eventIds: [], notes: benchmarks.map((b) => `${b.archetype}: median CPA ${b.medianCpaMinor === null ? "n/a" : (b.medianCpaMinor / 100).toFixed(2)} (Estimate)`) };
    },

    async credentialExpiryScan(input: { businessIds: string[]; at?: string }): Promise<ScheduleResult> {
      const { db } = deps;
      const now = at(input.at);
      const before = new Date(now.getTime() + EXPIRY_WINDOW_DAYS * DAY_MS);
      const eventIds: string[] = [];
      let touched = 0;
      for (const businessId of input.businessIds) {
        const [expiring, integrations, agents] = await Promise.all([repos.credentials.expiring(db, businessId, before), repos.integrations.list(db, businessId), repos.agents.list(db, businessId, { limit: 200 })]);
        for (const cred of expiring) {
          const integration = integrations.find((i) => i.id === cred.integrationId);
          if (!integration || !cred.expiresAt) continue;
          const expiresAt = new Date(cred.expiresAt);
          const daysRemaining = Math.floor((expiresAt.getTime() - now.getTime()) / DAY_MS);
          const affected: string[] = [];
          for (const a of agents.items) {
            const v = a.currentVersionId ? await repos.agents.getVersion(db, businessId, a.currentVersionId) : null;
            const keys = Array.isArray(v?.tools) ? (v!.tools as { connectorKey?: string }[]).map((t) => t.connectorKey) : [];
            if (keys.includes(integration.connectorKey)) affected.push(a.id);
          }
          const ev = await emitEvent(db, { businessId, type: "credential.expiring", actor: systemActor, payload: { integrationId: integration.id, credentialId: cred.id, connectorKey: integration.connectorKey, accountLabel: integration.accountLabel ?? null, expiresAt: expiresAt.toISOString(), daysRemaining, affectedAgentIds: affected, expired: daysRemaining <= 0 } });
          eventIds.push(ev.id);
          touched += 1;
          if (daysRemaining <= 0 && integration.status !== "expired") await repos.integrations.setStatus(db, businessId, integration.id, "expired", "credential expired");
        }
      }
      return { businesses: input.businessIds.length, touched, eventIds, notes: [] };
    },

    async consentRenewalScan(input: { businessIds: string[]; at?: string }): Promise<ScheduleResult> {
      const { db } = deps;
      const now = at(input.at);
      const before = new Date(now.getTime() + EXPIRY_WINDOW_DAYS * DAY_MS);
      const eventIds: string[] = [];
      let touched = 0;
      for (const businessId of input.businessIds) {
        const accounts = await repos.finance.consentsExpiring(db, businessId, before);
        const integrations = await repos.integrations.list(db, businessId);
        for (const account of accounts) {
          if (!account.consentExpiresAt) continue;
          const integration = integrations.find((i) => i.id === account.integrationId) ?? null;
          const expiresAt = new Date(account.consentExpiresAt);
          const daysRemaining = Math.floor((expiresAt.getTime() - now.getTime()) / DAY_MS);
          if (!integration) continue;
          const ev = await emitEvent(db, { businessId, type: "credential.expiring", actor: systemActor, payload: { integrationId: integration.id, credentialId: integration.id, connectorKey: integration.connectorKey, accountLabel: account.name, expiresAt: expiresAt.toISOString(), daysRemaining, affectedAgentIds: [], expired: daysRemaining <= 0 } });
          eventIds.push(ev.id);
          touched += 1;
        }
      }
      return { businesses: input.businessIds.length, touched, eventIds, notes: [] };
    },

    async agentMetricsRollup(input: { businessIds: string[]; at?: string }): Promise<ScheduleResult> {
      const { db } = deps;
      const now = at(input.at);
      const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - DAY_MS);
      const dayEnd = new Date(dayStart.getTime() + DAY_MS);
      const day = dayStart.toISOString().slice(0, 10);
      let touched = 0;
      for (const businessId of input.businessIds) {
        const agents = await repos.agents.list(db, businessId, { limit: 200 });
        for (const agent of agents.items) {
          const sessions = await repos.agents.listSessions(db, businessId, { agentId: agent.id, limit: 200 });
          const yesterday = sessions.items.filter((s) => s.endedAt && new Date(s.endedAt) >= dayStart && new Date(s.endedAt) < dayEnd);
          if (yesterday.length === 0) continue;
          const done = yesterday.filter((s) => s.outcome === "done").length;
          const costMinor = yesterday.reduce((a, s) => a + Number(s.costMinor), 0);
          await repos.agents.upsertMetric(db, businessId, { agentId: agent.id, day, tasksDone: done, successRate: done / yesterday.length, reviewFindings: 0, approvalsRejected: 0, ratingAvg: null, costMinor });
          touched += 1;
        }
      }
      return { businesses: input.businessIds.length, touched, eventIds: [], notes: [`day ${day}`] };
    },
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

export type ScheduleActivities = ReturnType<typeof createScheduleActivities>;
