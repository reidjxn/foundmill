/**
 * Training on both paths (WP-09 T10 step 4), live only (evals-training-live.yml, dispatched by hand). One agent's
 * check of three skills runs now, then through the half-price batch path, on PGlite with no production data. It prints
 * both runs' `cost_minor` and fails when the run now costs more than $1.00 (Done-when item 4). The batch is polled
 * every two minutes until `TRAINING_BATCH_DEADLINE_MINUTES` (default 340, inside a hosted runner's six-hour limit).
 * Cost: about $1.50 a run (Estimate).
 */
import { getSkillTests, getTemplateByAgentType } from "@foundmill/agents";
import { repos } from "@foundmill/db";
import { trainingEstimate, type CompleteResult, type ModelClient } from "@foundmill/models";
import { createTrainingActivities } from "@foundmill/orchestrator/activities/training";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "@foundmill/orchestrator/__tests__/harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEvalClient, isLiveEvalEnabled } from "../harness";

export const MAX_RUN_NOW_MINOR = 100;
const SKILLS = 3;
const POLL_MS = 2 * 60 * 1000;
const DEADLINE_MS = Number(process.env.TRAINING_BATCH_DEADLINE_MINUTES ?? 340) * 60 * 1000;

const live = isLiveEvalEnabled();
let t: OrchestratorTestHarness;
let client: ModelClient;

/** Tokens and cost per route, so a run shows where its spend goes (candidate answers or grading, input or output). */
type Tally = Record<string, { calls: number; inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number; costMicroMinor: number }>;
function add(tally: Tally, r: Pick<CompleteResult, "route" | "usage" | "cost">) {
  const row = (tally[r.route] ??= { calls: 0, inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, costMicroMinor: 0 });
  row.calls++;
  row.inputTokens += r.usage.inputTokens;
  row.outputTokens += r.usage.outputTokens;
  row.cacheWriteTokens += r.usage.cacheCreationInputTokens;
  row.cacheReadTokens += r.usage.cacheReadInputTokens;
  row.costMicroMinor += r.cost.costMicroMinor;
}
/** The client with every answer it returns counted, now (`complete`) and in batches (`collectBatch`). */
function counting(base: ModelClient, tally: { now: Tally; batch: Tally }): ModelClient {
  const c = Object.create(base) as ModelClient;
  const seen = new Set<string>();
  c.complete = (async (req: Parameters<ModelClient["complete"]>[0]) => {
    const r = await base.complete(req as never);
    add(tally.now, r);
    return r;
  }) as ModelClient["complete"];
  // On the base client, so a mock that answers at submit through `complete` is not counted as a call made now.
  c.submitBatch = (items) => base.submitBatch!(items);
  c.collectBatch = (async (batchId: string, items: never) => {
    const rs = await base.collectBatch!(batchId, items);
    // The candidates are collected twice (for the grades, then for the outcomes): each answer is counted once.
    for (const r of rs) if (r.ok && !seen.has(`${batchId}:${r.customId}`)) {
      seen.add(`${batchId}:${r.customId}`);
      add(tally.batch, r.result);
    }
    return rs;
  }) as ModelClient["collectBatch"];
  return c;
}

describe.skipIf(!live)("training now and on the batch path (live)", () => {
  beforeAll(async () => {
    // Before the harness, which sets MODEL_MODE=mock for its own deps.
    client = createEvalClient();
    t = await setupOrchestratorHarness({ prefix: "trainlive" });
  }, 120_000);
  afterAll(async () => {
    await t?.close();
  });

  it(
    "checks three skills each way and reports both costs",
    async () => {
      const tally = { now: {} as Tally, batch: {} as Tally };
      const acts = createTrainingActivities({ ...t.deps, models: counting(client, tally) });
      const agent = await repos.agents.get(t.db, t.businessId, t.workerId);
      const live = await repos.agents.getVersion(t.db, t.businessId, agent.currentVersionId!);
      const start = async () => {
        const draft = await repos.agents.createVersion(t.db, t.businessId, agent.id, { instructions: live.instructions as never, tools: live.tools, modelKey: live.modelKey, state: "draft", createdByKind: "user" });
        // The skills a run with no focus would test (loadTrainingRun's rule): the agent's own, else its template's.
        const own = (await repos.skills.listForAgent(t.db, t.businessId, agent.id)).map((s) => s.skillKey);
        const all = own.length ? own : (getTemplateByAgentType(agent.agentType)?.skills ?? []);
        const skillKeys = all.filter((k) => getSkillTests(k, { includeHeldOut: true }).length > 0).slice(0, SKILLS);
        expect(skillKeys).toHaveLength(SKILLS);
        const run = await repos.training.create(t.db, t.businessId, { agentId: agent.id, fromVersionId: live.id, toVersionId: draft.id, skillKeys });
        const loaded = await acts.loadTrainingRun({ businessId: t.businessId, trainingRunId: run.id });
        return { run, loaded, input: { businessId: t.businessId, trainingRunId: run.id, agentId: loaded.agentId, draftVersionId: loaded.draftVersionId, skillKeys: loaded.skillKeys, modelKey: loaded.modelKey } };
      };
      const finalize = async (s: Awaited<ReturnType<typeof start>>, outcomes: Awaited<ReturnType<typeof acts.runSkillTests>>[]) => {
        const result = await acts.finalizeTrainingRun({ ...s.input, liveVersionId: live.id, outcomes, clubRuleFlags: s.loaded.clubRuleFlags, startedAt: new Date().toISOString() });
        expect(result.status).toBe("awaiting_decision");
        const stored = await repos.training.get(t.db, t.businessId, s.run.id);
        return { costMinor: Number(stored.costMinor), tests: outcomes.reduce((a, o) => a + o.testsRun, 0), costMicroMinor: outcomes.reduce((a, o) => a + (o.costMicroMinor ?? 0), 0) };
      };

      // Run now.
      const nowRun = await start();
      const nowOutcomes = [];
      for (const skillKey of nowRun.input.skillKeys) nowOutcomes.push(await acts.runSkillTests({ ...nowRun.input, skillKey }));
      const now = await finalize(nowRun, nowOutcomes);

      // The batch path: candidates, checks, grades, collect.
      const batchRun = await start();
      const deadline = Date.now() + DEADLINE_MS;
      const ended = async (batchId: string) => {
        while (!(await acts.trainingBatchEnded({ batchId, businessId: t.businessId }))) {
          if (Date.now() >= deadline) throw new Error(`Batch ${batchId} did not end in ${DEADLINE_MS / 60_000} minutes`);
          await new Promise((r) => setTimeout(r, POLL_MS));
        }
      };
      const { batchId: candidateBatchId } = await acts.submitTrainingCandidates(batchRun.input);
      expect(candidateBatchId).toEqual(expect.any(String));
      await ended(candidateBatchId!);
      const { batchId: graderBatchId } = await acts.submitTrainingGrades({ ...batchRun.input, candidateBatchId: candidateBatchId! });
      if (graderBatchId) await ended(graderBatchId);
      const batch = await finalize(batchRun, await acts.collectTrainingOutcomes({ ...batchRun.input, candidateBatchId, graderBatchId }));

      const estimate = (b: boolean, tests: number) => trainingEstimate({ tests, agentModel: nowRun.loaded.modelKey, batch: b }).costMinor;
      console.warn(`[eval] training cost: ${JSON.stringify({ skills: nowRun.input.skillKeys, model: nowRun.loaded.modelKey, now: { ...now, estimateMinor: estimate(false, now.tests), byRoute: tally.now }, batch: { ...batch, estimateMinor: estimate(true, batch.tests), byRoute: tally.batch } })} (list price, before the credit markup)`);
      expect(now.tests).toBeGreaterThan(0);
      expect(batch.tests).toBeGreaterThan(0);
      expect(now.costMinor).toBeLessThanOrEqual(MAX_RUN_NOW_MINOR);
    },
    DEADLINE_MS + 60 * 60 * 1000,
  );
});
