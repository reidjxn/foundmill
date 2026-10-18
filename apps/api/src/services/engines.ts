/**
 * Channel engines (BUILD §11.7; audit GTM-01): every channel the Board shows as running has its `channelEngine`
 * workflow. `ensureChannelEngines` starts `engine:<channelId>` for each enabled channel it is given (Temporal answers
 * "already running" for a running one, which counts as running) and records the id on the channel. Start distribution
 * calls it for the channels on the board, a resume for every enabled channel; the Board toggle and Inbox decisions start
 * theirs the same way (`distribution.channels.enable`, `syncChannelEngines`). Without Temporal nothing is recorded and
 * the orchestrator's `channelEngineReconcile` schedule starts them once it can (every 15 minutes, and at its boot).
 *
 * Nothing starts before the founder has started distribution (founder, 2026-10-18; `businesses.distribution_started_at`):
 * until then every enabled channel answers `{ queued: false, reason: "distribution_not_started" }` and nothing is recorded.
 */
import { repos, type Executor } from "@foundmill/db";
import { WORKFLOWS, workflowIds, type TemporalResult, type TemporalService } from "./temporal";

export interface EngineChannel {
  id: string;
  channelKey: string;
  enabled: boolean;
}

/** Why an engine did not start: the founder has not started distribution yet. */
export const DISTRIBUTION_NOT_STARTED = "distribution_not_started";

export async function ensureChannelEngines(ctx: { db: Executor; temporal: TemporalService; businessId: string }, channels: readonly EngineChannel[]): Promise<TemporalResult[]> {
  const results: TemporalResult[] = [];
  if (!(await repos.businesses.distributionStarted(ctx.db, ctx.businessId))) {
    return channels.filter((c) => c.enabled).map((c) => ({ queued: false, workflowId: workflowIds.engine(c.id), reason: DISTRIBUTION_NOT_STARTED }));
  }
  for (const c of channels) {
    if (!c.enabled) continue;
    const workflowId = workflowIds.engine(c.id);
    const started = await ctx.temporal.start(WORKFLOWS.channelEngine, { workflowId, args: [{ businessId: ctx.businessId, channelId: c.id, channelKey: c.channelKey }] });
    if (started.queued) await repos.channels.setEngineWorkflow(ctx.db, ctx.businessId, c.id, workflowId);
    results.push(started);
  }
  return results;
}
