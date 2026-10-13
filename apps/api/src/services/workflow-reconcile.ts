/**
 * Keeps long-lived workflows alive for the rows that need them (audit OL-08, SOAK-01). Ending a vacation and running an
 * Automated business are enforced by workflows, but a row can exist without one: a vacation the seed inserted, one whose
 * start was recorded while Temporal was down ("Recorded; the workflow is not running"), a workflow lost with a Temporal
 * reset, or a business set to Automated before the orchestrator was up. This starts the missing ones, at boot and on a
 * timer; a workflow that already runs is left alone. Nothing here ends anything: a vacation past its date is closed (with
 * its "While you were away" report) by its own workflow as soon as that starts, and `holidays.current` already treats it as over.
 */
import { repos, type Db } from "@foundmill/db";
import type { ApiLogger } from "./log";
import { WORKFLOWS, workflowIds, type TemporalService } from "./temporal";

export const WORKFLOW_RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

export interface ReconcileResult {
  reachable: boolean;
  holidaysStarted: number;
  automatedStarted: number;
}

export async function reconcileWorkflows(deps: { db: Db; temporal: TemporalService; log: ApiLogger }): Promise<ReconcileResult> {
  const { db, temporal, log } = deps;
  const result: ReconcileResult = { reachable: false, holidaysStarted: 0, automatedStarted: 0 };
  if (!(await temporal.reachable())) return result;
  result.reachable = true;

  for (const h of await repos.holidays.running(db)) {
    const state = await temporal.describe(workflowIds.holiday(h.id));
    if (!state.reachable) break;
    if (state.running) continue;
    const started = await temporal.start(WORKFLOWS.holiday, { workflowId: workflowIds.holiday(h.id), args: [{ businessId: h.businessId, holidayId: h.id }] });
    if (started.queued && !started.alreadyStarted) {
      result.holidaysStarted += 1;
      log.info({ businessId: h.businessId, holidayId: h.id }, "started the workflow of a running vacation that had none");
    }
  }

  for (const b of await repos.businesses.listAutomated(db)) {
    const started = await temporal.start(WORKFLOWS.automatedMode, { workflowId: workflowIds.automatedMode(b.id), args: [{ businessId: b.id }] });
    if (started.queued && !started.alreadyStarted) {
      result.automatedStarted += 1;
      log.info({ businessId: b.id }, "started the Automated mode loop of a business");
    } else if (!started.queued) break;
  }
  return result;
}

/** Run `reconcileWorkflows` now and then until stopped; a failed pass is logged and tried again next time. */
export function startWorkflowReconciler(deps: { db: Db; temporal: TemporalService; log: ApiLogger }, intervalMs = WORKFLOW_RECONCILE_INTERVAL_MS): { stop(): void; done: Promise<unknown> } {
  const pass = () => reconcileWorkflows(deps).catch((err: unknown) => deps.log.warn({ err: (err as Error).message }, "workflow reconcile failed"));
  const done = pass();
  const timer = setInterval(() => void pass(), intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer), done };
}
