/**
 * Channel engines (BUILD §11.7; audit GTM-01): every channel the Board shows as running has its `channelEngine`
 * workflow. `ensureChannelEngines` starts `engine:<channelId>` for each enabled channel it is given (Temporal answers
 * "already running" for a running one, which counts as running) and records the id on the channel. Commit calls it for
 * the archetype's starters, a resume for every enabled channel; the Board toggle and Inbox decisions start theirs the
 * same way (`distribution.channels.enable`, `syncChannelEngines`). Without Temporal nothing is recorded and the
 * orchestrator's `channelEngineReconcile` schedule starts them once it can (every 15 minutes, and at its boot).
 */
import { repos, type Executor } from "@foundmill/db";
import { WORKFLOWS, workflowIds, type TemporalResult, type TemporalService } from "./temporal";

export interface EngineChannel {
  id: string;
  channelKey: string;
  enabled: boolean;
}

export async function ensureChannelEngines(ctx: { db: Executor; temporal: TemporalService; businessId: string }, channels: readonly EngineChannel[]): Promise<TemporalResult[]> {
  const results: TemporalResult[] = [];
  for (const c of channels) {
    if (!c.enabled) continue;
    const workflowId = workflowIds.engine(c.id);
    const started = await ctx.temporal.start(WORKFLOWS.channelEngine, { workflowId, args: [{ businessId: ctx.businessId, channelId: c.id, channelKey: c.channelKey }] });
    if (started.queued) await repos.channels.setEngineWorkflow(ctx.db, ctx.businessId, c.id, workflowId);
    results.push(started);
  }
  return results;
}
