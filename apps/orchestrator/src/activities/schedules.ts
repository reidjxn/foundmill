/**
 * Schedule activities (BUILD §9.4; the Temporal Schedules are registered at boot by src/schedules.ts):
 * - nightly: journeyDailyRefresh (matview + attribution refit), milestonesCatchUp (trophies the live path missed),
 *   benchmarksRebuild (per-archetype channel CPA benchmarks, labeled Estimate), credentialExpiryScan
 *   (`credential.expiring`), consentRenewalScan (open-banking consents), agentMetricsRollup (yesterday's sessions →
 *   agent_metrics), rollLegalCalendars (filings due/overdue), purgeDueEntities (CRM deletion requests past their date)
 *   and the business deletion steps (listDueBusinessDeletions, purgeBusiness);
 * - frequent: refreshJourneyDaily (the matview alone), listEnginesToEnsure / recordEngineWorkflows (the engine
 *   reconciler).
 *
 * A batch over businesses heartbeats after each one with how far it got, so a retry (a worker restart, a timeout)
 * starts where the last attempt stopped instead of redoing (and re-emitting) what it already did; one business that
 * fails is reported in `notes` and never stops the others.
 */
import { Context } from "@temporalio/activity";
import { buildMarkovModel, conversionPathsFromTouches } from "@foundmill/journey";
import { catchUpMilestones, repos, stopBusinessAgents } from "@foundmill/db";
import type { ChannelKey } from "@foundmill/shared";
import type { OrchestratorDeps } from "../deps";
import { emitEvent, systemActor } from "../events";
import type { DueBusinessDeletion, EngineToEnsure, ScheduleBatch, ScheduleResult } from "./types";

const DAY_MS = 86_400_000;
const EXPIRY_WINDOW_DAYS = 14;

function activityContext(): Context | null {
  try {
    return Context.current();
  } catch {
    return null;
  }
}

/**
 * Runs `fn` for every business of the batch, from where the previous attempt's heartbeat left off. Each business ends
 * with a heartbeat carrying the next index; a failure is noted and the batch moves on.
 */
async function eachBusiness(deps: OrchestratorDeps, task: string, businessIds: readonly string[], notes: string[], fn: (businessId: string) => Promise<void>): Promise<void> {
  const ctx = activityContext();
  const resumed = ctx?.info.heartbeatDetails;
  const start = typeof resumed === "number" && resumed > 0 && resumed <= businessIds.length ? resumed : 0;
  if (start > 0) notes.push(`resumed at business ${start + 1} of ${businessIds.length}`);
  for (let i = start; i < businessIds.length; i++) {
    const businessId = businessIds[i]!;
    try {
      await fn(businessId);
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      deps.log.warn({ task, businessId, err: message }, "schedule step failed for one business; the others continue");
      notes.push(`${businessId}: failed (${message.slice(0, 120)})`);
    }
    ctx?.heartbeat(i + 1);
  }
}

export function createScheduleActivities(deps: OrchestratorDeps) {
  const at = (iso?: string) => (iso ? new Date(iso) : deps.clock.now());

  return {
    /** The businesses a scheduled run covers: every committed, live business; `runnable` leaves stopped teams out. */
    async listScheduledBusinesses(input: { runnable?: boolean } = {}): Promise<{ businessIds: string[] }> {
      return { businessIds: await repos.businesses.listForSchedules(deps.db, { runnable: input.runnable }) };
    },

    /** Refreshes `journey_daily_mv` alone (every 15 minutes): the Ribbon, the status strip and the department cards. */
    async refreshJourneyDaily(): Promise<{ refreshed: boolean; error: string | null }> {
      try {
        await repos.journeys.refreshDaily(deps.db);
        return { refreshed: true, error: null };
      } catch (err) {
        const message = (err as Error).message.slice(0, 200);
        deps.log.warn({ err: message }, "journey_daily refresh failed");
        return { refreshed: false, error: message };
      }
    },

    async journeyDailyRefresh(input: ScheduleBatch): Promise<ScheduleResult> {
      const { db } = deps;
      const notes: string[] = [];
      let touched = 0;
      try {
        await repos.journeys.refreshDaily(db);
        notes.push("journey_daily refreshed");
      } catch (err) {
        notes.push(`journey_daily refresh skipped: ${(err as Error).message.slice(0, 120)}`);
      }
      await eachBusiness(deps, "journeyDailyRefresh", input.businessIds, notes, async (businessId) => {
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
      });
      return { businesses: input.businessIds.length, touched, eventIds: [], notes };
    },

    /** Awards every trophy a business reached but does not hold (a payment the live path missed); idempotent. */
    async milestonesCatchUp(input: ScheduleBatch): Promise<ScheduleResult> {
      const notes: string[] = [];
      let touched = 0;
      await eachBusiness(deps, "milestonesCatchUp", input.businessIds, notes, async (businessId) => {
        const awarded = await catchUpMilestones(deps.db, businessId, { until: at(input.at) });
        if (awarded.length === 0) return;
        touched += 1;
        notes.push(`${businessId}: ${awarded.map((m) => m.label).join(", ")}`);
      });
      return { businesses: input.businessIds.length, touched, eventIds: [], notes };
    },

    async benchmarksRebuild(input: ScheduleBatch): Promise<ScheduleResult> {
      const { db } = deps;
      const notes: string[] = [];
      const byArchetype = new Map<string, { cpa: number[]; businesses: number }>();
      // Read pass: every business on every attempt (the medians need all of them). Its heartbeats carry the previous
      // attempt's write progress unchanged, so a retry reads everything again and resumes only the writes.
      const ctx = activityContext();
      const writesDone: unknown = ctx?.info.heartbeatDetails;
      const unread = new Set<string>();
      for (const businessId of input.businessIds) {
        try {
          const [business, summary] = await Promise.all([repos.businesses.get(db, businessId), repos.channels.metricsSummary(db, businessId, {})]);
          const key = business.archetype ?? "uncommitted";
          const entry = byArchetype.get(key) ?? { cpa: [], businesses: 0 };
          entry.businesses += 1;
          for (const c of summary.channels) if (c.cpaMinor !== null) entry.cpa.push(c.cpaMinor);
          byArchetype.set(key, entry);
        } catch (err) {
          const message = (err as Error)?.message ?? String(err);
          deps.log.warn({ task: "benchmarksRebuild", businessId, err: message }, "schedule step failed for one business; the others continue");
          notes.push(`${businessId}: failed (${message.slice(0, 120)})`);
          unread.add(businessId);
        }
        ctx?.heartbeat(writesDone);
      }
      const benchmarks = [...byArchetype.entries()].map(([archetype, v]) => ({ archetype, businesses: v.businesses, medianCpaMinor: median(v.cpa), label: "Estimate" }));
      await eachBusiness(deps, "benchmarksRebuild", input.businessIds, notes, async (businessId) => {
        if (unread.has(businessId)) return;
        await repos.audit.append(db, businessId, { actorKind: "system", action: "schedule.benchmarks_rebuild", target: {}, details: { benchmarks, computedAt: at(input.at).toISOString() } });
      });
      return { businesses: input.businessIds.length, touched: benchmarks.length, eventIds: [], notes: [...notes, ...benchmarks.map((b) => `${b.archetype}: median CPA ${b.medianCpaMinor === null ? "n/a" : (b.medianCpaMinor / 100).toFixed(2)} (Estimate)`)] };
    },

    async credentialExpiryScan(input: ScheduleBatch): Promise<ScheduleResult> {
      const { db } = deps;
      const now = at(input.at);
      const before = new Date(now.getTime() + EXPIRY_WINDOW_DAYS * DAY_MS);
      const eventIds: string[] = [];
      const notes: string[] = [];
      let touched = 0;
      await eachBusiness(deps, "credentialExpiryScan", input.businessIds, notes, async (businessId) => {
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
      });
      return { businesses: input.businessIds.length, touched, eventIds, notes };
    },

    async consentRenewalScan(input: ScheduleBatch): Promise<ScheduleResult> {
      const { db } = deps;
      const now = at(input.at);
      const before = new Date(now.getTime() + EXPIRY_WINDOW_DAYS * DAY_MS);
      const eventIds: string[] = [];
      const notes: string[] = [];
      let touched = 0;
      await eachBusiness(deps, "consentRenewalScan", input.businessIds, notes, async (businessId) => {
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
      });
      return { businesses: input.businessIds.length, touched, eventIds, notes };
    },

    async agentMetricsRollup(input: ScheduleBatch): Promise<ScheduleResult> {
      const { db } = deps;
      const now = at(input.at);
      const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - DAY_MS);
      const dayEnd = new Date(dayStart.getTime() + DAY_MS);
      const day = dayStart.toISOString().slice(0, 10);
      const notes: string[] = [`day ${day}`];
      let touched = 0;
      await eachBusiness(deps, "agentMetricsRollup", input.businessIds, notes, async (businessId) => {
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
      });
      return { businesses: input.businessIds.length, touched, eventIds: [], notes };
    },

    /** Legal calendars: filings move to due inside 30 days and to overdue after their date (DECISIONS legal calendar). */
    async rollLegalCalendars(input: ScheduleBatch): Promise<ScheduleResult> {
      const notes: string[] = [];
      let touched = 0;
      await eachBusiness(deps, "rollLegalCalendars", input.businessIds, notes, async (businessId) => {
        const changed = await repos.legal.rollFilingStatuses(deps.db, businessId, at(input.at));
        if (changed > 0) touched += 1;
      });
      return { businesses: input.businessIds.length, touched, eventIds: [], notes };
    },

    /**
     * CRM deletion requests past their date (audit RA-23): each record is purged with the records merged into it, and
     * the business's audit chain records it (ids and counts only, no personal data). The suppression entries stay.
     */
    async purgeDueEntities(input: { at?: string; limit?: number } = {}): Promise<ScheduleResult> {
      const due = await repos.entities.deletionsDue(deps.db, at(input.at), input.limit ?? 500);
      const notes: string[] = [];
      const businesses = new Set<string>();
      let touched = 0;
      const ctx = activityContext();
      for (const d of due) {
        try {
          const result = await repos.entities.purge(deps.db, d.businessId, d.entityId);
          if (result.blocked) {
            notes.push(`${d.businessId}/${d.entityId}: kept (${result.blocked})`);
          } else if (result.purged.length) {
            await repos.audit.append(deps.db, d.businessId, { actorKind: "system", action: "crm.entity.purged", target: { kind: "entity", id: d.entityId }, details: { records: result.purged.length, dueAt: d.dueAt.toISOString(), job: "crmDeletionSweep" } });
            businesses.add(d.businessId);
            touched += 1;
          }
        } catch (err) {
          deps.log.warn({ businessId: d.businessId, entityId: d.entityId, err: (err as Error).message }, "CRM record purge failed; the next sweep tries again");
          notes.push(`${d.businessId}/${d.entityId}: failed`);
        }
        ctx?.heartbeat(touched);
      }
      return { businesses: businesses.size, touched, eventIds: [], notes };
    },

    /**
     * Businesses whose scheduled deletion came due (audit MLSL-20), each with the workflows that still run for it (its
     * latest cycles, channel engines, open sessions, a vacation, executing plans), which the sweep stops before the purge.
     */
    async listDueBusinessDeletions(input: { at?: string } = {}): Promise<{ due: DueBusinessDeletion[] }> {
      const { db } = deps;
      const due: DueBusinessDeletion[] = [];
      for (const d of await repos.businesses.deletionsDue(db, at(input.at))) {
        const [cycles, channels, sessions, holiday, plans] = await Promise.all([
          repos.events.list(db, d.businessId, { type: "cycle.started", limit: 3 }),
          repos.channels.list(db, d.businessId, { includeArchived: true }),
          repos.agents.listSessions(db, d.businessId, { openOnly: true, limit: 500 }),
          repos.holidays.current(db, d.businessId),
          repos.plans.list(db, d.businessId, { status: "executing", limit: 500 }),
        ]);
        const ids = new Set<string>();
        // A cycle still running would otherwise keep dispatching into a business that is going away (a finished one
        // ignores the signal).
        for (const e of cycles.items) {
          const workflowId = (e.payload as { workflowId?: unknown } | null)?.workflowId;
          if (typeof workflowId === "string" && workflowId) ids.add(workflowId);
        }
        for (const c of channels) {
          ids.add(`engine:${c.id}`);
          if (c.engineWorkflowId) ids.add(c.engineWorkflowId);
        }
        for (const s of sessions.items) ids.add(`session:${s.id}`);
        if (holiday) ids.add(`holiday:${holiday.id}`);
        for (const p of plans.items) if (p.workflowId) ids.add(p.workflowId);
        due.push({ businessId: d.businessId, scheduledFor: d.scheduledFor.toISOString(), workflowIds: [...ids] });
      }
      return { due };
    },

    /**
     * Permanently deletes one business whose scheduled deletion is (still) due: the team is stopped first so nothing
     * starts while the rows go, then `fm_purge_business` removes it with everything it owns. A deletion canceled in the
     * meantime is left alone.
     */
    async purgeBusiness(input: { businessId: string; at?: string }): Promise<{ purged: boolean; reason: string | null }> {
      const { db } = deps;
      const stillDue = (await repos.businesses.deletionsDue(db, at(input.at))).some((d) => d.businessId === input.businessId);
      if (!stillDue) return { purged: false, reason: "not due (canceled, or already deleted)" };
      await stopBusinessAgents(db, input.businessId, { reason: "kill_switch" }).catch(() => undefined);
      const purged = await repos.businesses.purge(db, input.businessId);
      deps.log.info({ businessId: input.businessId, purged }, "scheduled business deletion carried out");
      return { purged, reason: purged ? null : "nothing to delete" };
    },

    /** Every channel the Board shows as running, of a business whose team may work (the engine reconciler's input). */
    async listEnginesToEnsure(): Promise<{ channels: EngineToEnsure[] }> {
      return { channels: await repos.channels.listForEngines(deps.db) };
    },

    /** Records the engine id on each channel whose engine the reconciler started or found running. */
    async recordEngineWorkflows(input: { entries: { businessId: string; channelId: string; workflowId: string }[] }): Promise<{ updated: number }> {
      let updated = 0;
      for (const e of input.entries) {
        const channel = await repos.channels.get(deps.db, e.businessId, e.channelId).catch(() => null);
        if (!channel || !channel.enabled || channel.engineWorkflowId === e.workflowId) continue;
        await repos.channels.setEngineWorkflow(deps.db, e.businessId, e.channelId, e.workflowId);
        updated += 1;
      }
      return { updated };
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
