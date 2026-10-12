/**
 * Source Watcher workflows (BUILD §11.5): `sourceWatch` reads the sources apps/api just added
 * (`source-watch:{sourceId}:added`), `sourceWatchSweep` re-reads every business's stale sources on a schedule (the
 * nightly schedule passes the active business ids, like the other schedule workflows). Each source is one
 * `watchSource` activity with its own retries; when they run out the read is recorded as failed and the next sweep
 * tries again. A failure never stops the other sources.
 */
import { proxyActivities } from "@temporalio/workflow";
import type { Activities, ScheduleResult, SourceWatchResult, SourceWatchSweepInput, SourceWatchWorkflowInput, SourceWatchWorkflowResult } from "../activities";

/** One read: a page fetch and up to two model calls (the drafting one on Opus). Heartbeats while it waits. */
const watchActs = proxyActivities<Activities>({ startToCloseTimeout: "6 minutes", heartbeatTimeout: "1 minute", retry: { maximumAttempts: 3, initialInterval: "30 seconds", backoffCoefficient: 2 } });
/** Database reads and writes: short and retried. */
const writeActs = proxyActivities<Activities>({ startToCloseTimeout: "1 minute", retry: { maximumAttempts: 5, initialInterval: "2 seconds", backoffCoefficient: 2 } });

/** The reason stored when retries ran out (founder copy; never worker or vendor text). */
export const SOURCE_WATCH_FAILED_REASON = "The Source Watcher could not finish reading this source. It tries again on the next sweep.";
/** Businesses read at the same time by the sweep. */
export const SWEEP_PARALLEL_BUSINESSES = 4;

async function watchOne(businessId: string, sourceId: string, reason: SourceWatchWorkflowInput["reason"]): Promise<SourceWatchResult> {
  try {
    return await watchActs.watchSource({ businessId, sourceId, reason });
  } catch {
    await writeActs.failSourceWatch({ businessId, sourceId, error: SOURCE_WATCH_FAILED_REASON });
    return { sourceId, status: "skipped", reason: "failed", relevantBlockIds: [], proposalId: null, costMinor: 0 };
  }
}

export async function sourceWatch(input: SourceWatchWorkflowInput): Promise<SourceWatchWorkflowResult> {
  const results: SourceWatchResult[] = [];
  for (const sourceId of input.sourceIds) results.push(await watchOne(input.businessId, sourceId, input.reason));
  return { results };
}

export async function sourceWatchSweep(input: SourceWatchSweepInput): Promise<ScheduleResult> {
  const notes: string[] = [];
  let touched = 0;
  const sweepBusiness = async (businessId: string) => {
    const { sourceIds } = await writeActs.listSourcesToWatch({ businessId, staleAfterHours: input.staleAfterHours, limit: input.perBusiness, at: input.at });
    if (!sourceIds.length) return;
    touched += 1;
    let proposals = 0;
    let failed = 0;
    for (const sourceId of sourceIds) {
      const r = await watchOne(businessId, sourceId, "schedule");
      if (r.proposalId && r.status === "scored") proposals += 1;
      if (r.reason === "failed") failed += 1;
    }
    notes.push(`${businessId}: ${sourceIds.length} source(s) read, ${proposals} proposal(s), ${failed} failed`);
  };
  for (let i = 0; i < input.businessIds.length; i += SWEEP_PARALLEL_BUSINESSES) {
    await Promise.all(input.businessIds.slice(i, i + SWEEP_PARALLEL_BUSINESSES).map(sweepBusiness));
  }
  return { businesses: input.businessIds.length, touched, eventIds: [], notes };
}
