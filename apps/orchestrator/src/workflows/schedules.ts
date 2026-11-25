/**
 * Schedule workflows (BUILD §9.4). The orchestrator registers one Temporal Schedule per workflow at boot
 * (src/schedules.ts, `SCHEDULES`); each run lists the businesses it covers when it starts (or takes the ids it was given),
 * so a business committed since the schedule was registered is included and an archived one is not.
 *
 * Nightly: journeyDailyRefresh (matview, attribution refit, milestone catch-up), benchmarksRebuild, credentialExpiryScan,
 * consentRenewalScan, agentMetricsRollup (also refreshes every agent's health, BUILD §9.10), legalCalendarRoll,
 * crmDeletionSweep and businessDeletionSweep. Frequent: journeyMatviewRefresh, agentHealthSweep (health, rested failing
 * agents back, wage-cap pauses lifted in a new period) and channelEngineReconcile (every channel on the board has its
 * engine running). Work that starts agents (engines, the Source Watcher's sweep in ./sourceWatch.ts) only covers
 * businesses whose team is not stopped.
 */
import { WorkflowExecutionAlreadyStartedError, WorkflowIdReusePolicy } from "@temporalio/common";
import { ParentClosePolicy, getExternalWorkflowHandle, patched, proxyActivities, startChild } from "@temporalio/workflow";
import type { Activities, EngineToEnsure, ScheduleInput, ScheduleResult } from "../activities";
import { channelEngine } from "./channelEngine";
import { playbook } from "./playbook";
import { stopSignal } from "./signals";

/** Batches over businesses: they heartbeat after each one and resume where a failed attempt stopped. */
const acts = proxyActivities<Activities>({ startToCloseTimeout: "30 minutes", heartbeatTimeout: "5 minutes", retry: { maximumAttempts: 3, initialInterval: "30 seconds" } });
/** Short reads and writes. */
const quick = proxyActivities<Activities>({ startToCloseTimeout: "2 minutes", retry: { maximumAttempts: 5, initialInterval: "5 seconds", backoffCoefficient: 2 } });
/** One business's purge: a large business is many rows. */
const purge = proxyActivities<Activities>({ startToCloseTimeout: "15 minutes", retry: { maximumAttempts: 3, initialInterval: "1 minute" } });

/** The businesses a run covers: the ids it was started with, else every committed business (`runnable`: not stopped). */
export async function scheduledBusinesses(input: ScheduleInput, runnable = false): Promise<string[]> {
  return input.businessIds ?? (await quick.listScheduledBusinesses({ runnable })).businessIds;
}

const merge = (a: ScheduleResult, b: ScheduleResult): ScheduleResult => ({ businesses: Math.max(a.businesses, b.businesses), touched: a.touched + b.touched, eventIds: [...a.eventIds, ...b.eventIds], notes: [...a.notes, ...b.notes] });

export async function journeyDailyRefresh(input: ScheduleInput = {}): Promise<ScheduleResult> {
  const businessIds = await scheduledBusinesses(input);
  const refreshed = await acts.journeyDailyRefresh({ businessIds, at: input.at });
  const milestones = await acts.milestonesCatchUp({ businessIds, at: input.at });
  return merge(refreshed, milestones);
}

/** Every 15 minutes: the journey matview alone, so the Ribbon follows writes made outside the orchestrator. */
export async function journeyMatviewRefresh(): Promise<{ refreshed: boolean; error: string | null }> {
  return quick.refreshJourneyDaily();
}

/**
 * Every five minutes: founder emails (retention plan, 2026-11-11). Waiting decisions, wins, milestones, finished runs,
 * used-up credits, the morning brief / weekly review at each founder's hour and the lifecycle emails, then the emails
 * about a kept card to people with no project yet (WP-04 T12; activities/notify.ts).
 */
export async function founderNotifications(input: ScheduleInput = {}): Promise<ScheduleResult> {
  const projects = await acts.founderNotificationsSweep({ businessIds: await scheduledBusinesses(input), at: input.at });
  // A run given business ids (a test, a replay) is about those businesses only; a run recorded before the card emails
  // existed replays without them.
  if (input.businessIds || !patched("card-emails")) return projects;
  return merge(projects, await acts.cardEmailsSweep({ at: input.at }));
}

export async function benchmarksRebuild(input: ScheduleInput = {}): Promise<ScheduleResult> {
  return acts.benchmarksRebuild({ businessIds: await scheduledBusinesses(input), at: input.at });
}

export async function credentialExpiryScan(input: ScheduleInput = {}): Promise<ScheduleResult> {
  return acts.credentialExpiryScan({ businessIds: await scheduledBusinesses(input), at: input.at });
}

export async function consentRenewalScan(input: ScheduleInput = {}): Promise<ScheduleResult> {
  return acts.consentRenewalScan({ businessIds: await scheduledBusinesses(input), at: input.at });
}

export async function legalCalendarRoll(input: ScheduleInput = {}): Promise<ScheduleResult> {
  return acts.rollLegalCalendars({ businessIds: await scheduledBusinesses(input), at: input.at });
}

/** Health for each business: one activity each, so one slow business never holds the others' slot for long. */
async function refreshHealth(businessIds: readonly string[]): Promise<{ eventIds: string[]; notes: string[] }> {
  const eventIds: string[] = [];
  const notes: string[] = [];
  for (const businessId of businessIds) {
    try {
      const health = await quick.refreshAgentHealth({ businessId });
      eventIds.push(...health.eventIds);
      if (health.changed.length) notes.push(`${businessId}: ${health.changed.length} agent status change(s)`);
    } catch {
      notes.push(`${businessId}: health refresh failed`);
    }
  }
  return { eventIds, notes };
}

export async function agentMetricsRollup(input: ScheduleInput = {}): Promise<ScheduleResult> {
  const businessIds = await scheduledBusinesses(input);
  const rolled = await acts.agentMetricsRollup({ businessIds, at: input.at });
  const health = await refreshHealth(businessIds);
  return { ...rolled, eventIds: [...rolled.eventIds, ...health.eventIds], notes: [...rolled.notes, ...health.notes] };
}

/**
 * Hourly: every agent's health (BUILD §9.10), and the agents the dispatch guard paused for their wage cap come back once
 * they are under it (a new period, a higher cap). A stopped team is left as it is (`refreshAgentHealth` never lifts a
 * pause and `recoverAgents` does nothing while stopped).
 */
export async function agentHealthSweep(input: ScheduleInput = {}): Promise<ScheduleResult> {
  const businessIds = await scheduledBusinesses(input);
  const health = await refreshHealth(businessIds);
  return { businesses: businessIds.length, touched: health.notes.length, eventIds: health.eventIds, notes: health.notes };
}

export interface EngineReconcileResult {
  channels: number;
  started: string[];
  running: string[];
  failed: string[];
}

/**
 * Every channel the Board shows as running has its engine (audit GTM-01): for each enabled channel of a business whose
 * team may work, `engine:<channelId>` is started unless it already runs (Temporal refuses a second run of a running id),
 * and the id is recorded on the channel. Engines outlive this run (abandoned children).
 */
export async function channelEngineReconcile(): Promise<EngineReconcileResult> {
  const { channels } = await quick.listEnginesToEnsure();
  const started: string[] = [];
  const running: string[] = [];
  const failed: string[] = [];
  const entries: { businessId: string; channelId: string; workflowId: string }[] = [];
  for (const c of channels as EngineToEnsure[]) {
    const workflowId = `engine:${c.channelId}`;
    try {
      await startChild(channelEngine, { workflowId, args: [{ businessId: c.businessId, channelId: c.channelId, channelKey: c.channelKey }], parentClosePolicy: ParentClosePolicy.ABANDON });
      started.push(workflowId);
    } catch (err) {
      if (!(err instanceof WorkflowExecutionAlreadyStartedError)) {
        failed.push(workflowId);
        continue;
      }
      running.push(workflowId);
    }
    if (c.engineWorkflowId !== workflowId) entries.push({ businessId: c.businessId, channelId: c.channelId, workflowId });
  }
  if (entries.length) await quick.recordEngineWorkflows({ entries });
  return { channels: channels.length, started, running, failed };
}

/** Nightly: CRM records whose deletion request came due are purged (suppression entries stay). */
/** Nightly: generated results on real projects, counted ("report") or removed ("apply", MOCK_RESULTS_CLEANUP; WP-02 T4). */
export async function mockResultsCleanup(_input: Record<string, never> = {}): Promise<Awaited<ReturnType<Activities["cleanMockResults"]>>> {
  return purge.cleanMockResults({});
}

/** Nightly: yesterday's funnel, north star, retention and agent-work counts for real projects (WP-02 T10). */
export async function platformMetrics(_input: Record<string, never> = {}): Promise<{ day: string }> {
  return purge.recordPlatformMetrics({});
}

/**
 * Every 15 minutes: the waitlist admits today's number (WAITLIST_ADMIT_PER_DAY, in `WAITLIST_ORDER`), then emails
 * everyone admitted and not yet told, the operator's admissions too (WP-03 T2; activities/waitlist.ts).
 */
export async function waitlistAdmissions(input: { at?: string } = {}): Promise<ScheduleResult> {
  return quick.waitlistSweep({ at: input.at });
}

/** Every 15 minutes: the reminder a customer gets the day before their booking (activities/booking.ts). */
export async function bookingReminders(input: { at?: string } = {}): Promise<ScheduleResult> {
  return quick.bookingRemindersSweep({ at: input.at });
}

export async function crmDeletionSweep(input: { at?: string } = {}): Promise<ScheduleResult> {
  return acts.purgeDueEntities({ at: input.at });
}

export interface BusinessDeletionResult {
  due: number;
  purged: string[];
  skipped: { businessId: string; reason: string }[];
}

/**
 * Nightly: each business whose scheduled deletion came due and was not canceled (Settings › Danger zone, 7 days) is
 * deleted with everything it owns. Its running workflows get `stop` first, so nothing writes while the rows go.
 */
export async function businessDeletionSweep(input: { at?: string } = {}): Promise<BusinessDeletionResult> {
  const { due } = await quick.listDueBusinessDeletions({ at: input.at });
  const purged: string[] = [];
  const skipped: { businessId: string; reason: string }[] = [];
  for (const d of due) {
    await Promise.all(
      d.workflowIds.map((workflowId) =>
        getExternalWorkflowHandle(workflowId)
          .signal(stopSignal, { reason: "business_deleted", by: null })
          .catch(() => undefined),
      ),
    );
    try {
      const result = await purge.purgeBusiness({ businessId: d.businessId, at: input.at });
      if (result.purged) purged.push(d.businessId);
      else skipped.push({ businessId: d.businessId, reason: result.reason ?? "not purged" });
    } catch {
      skipped.push({ businessId: d.businessId, reason: "purge failed; the next sweep tries again" });
    }
  }
  return { due: due.length, purged, skipped };
}

/**
 * Nightly (WP-12 T1): a drafted, unpublished public page and the Product lead's note for each real project that began
 * before public pages and has none. A batch of at most `limit` a night, oldest first.
 */
export async function pageCatchUp(input: { businessIds?: string[]; limit?: number; at?: string } = {}): Promise<ScheduleResult> {
  return acts.draftMissingProjectPages(input);
}

/**
 * Every 15 minutes: the playbooks on a schedule (founder, Nov 25, 2026) whose time came due start, each as its own
 * `playbook` run under `playbook:<id>:at:<time>`. Temporal refuses that id a second time, so each time runs once however
 * many sweeps see it. Runs are abandoned children: the sweep never waits for one, and nothing here holds up the founder.
 */
export async function playbookScheduleSweep(input: ScheduleInput = {}): Promise<ScheduleResult> {
  const { due } = await quick.listDueScheduledPlaybooks({ ...(input.businessIds ? { businessIds: input.businessIds } : {}), ...(input.at ? { at: input.at } : {}) });
  const notes: string[] = [];
  for (const d of due) {
    try {
      await startChild(playbook, { workflowId: `playbook:${d.playbookId}:at:${d.scheduledFor}`, args: [{ businessId: d.businessId, playbookId: d.playbookId, event: null, scheduledFor: d.scheduledFor }], parentClosePolicy: ParentClosePolicy.ABANDON, workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE });
      notes.push(`${d.businessId}: playbook ${d.playbookId} started for ${d.scheduledFor}`);
    } catch (err) {
      if (!(err instanceof WorkflowExecutionAlreadyStartedError)) throw err;
    }
  }
  return { businesses: new Set(due.map((d) => d.businessId)).size, touched: notes.length, eventIds: [], notes };
}
