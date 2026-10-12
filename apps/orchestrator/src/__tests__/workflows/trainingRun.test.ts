/**
 * trainingRun with the real training activities on PGlite (audit TPD-03 / O-18): a model change's retest scores a draft
 * copy on the new model and ends awaiting a decision; a run that cannot start (its candidate is the live version, as
 * the old retests were, or it was canceled) ends failed or stays canceled at once, never queued for good.
 */
import { repos } from "@foundmill/db";
import { MODEL_KEYS, type ModelKey } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Activities, TrainingRunInput } from "../../activities";
import { createTrainingActivities } from "../../activities/training";
import { TRAINING_FINISH_FAILED, TRAINING_START_FAILED, trainingRun } from "../../workflows";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "../harness";
import { createTemporalRig, wfId, type TemporalRig } from "./temporal";

let rig: TemporalRig;
let t: OrchestratorTestHarness;
beforeAll(async () => {
  [rig, t] = await Promise.all([createTemporalRig(), setupOrchestratorHarness({ prefix: "trainwf" })]);
}, 180_000);
afterAll(async () => {
  await Promise.all([rig?.teardown(), t?.close()]);
});

/** The real activities (or an override), with every `loadTrainingRun` attempt and every `failTrainingRun` reason counted. */
function activities(override: Partial<Activities> = {}) {
  const real = createTrainingActivities(t.deps);
  const calls = { load: 0, fail: [] as string[] };
  const acts: Partial<Activities> = {
    ...real,
    ...override,
    async loadTrainingRun(input) {
      calls.load++;
      return (override.loadTrainingRun ?? real.loadTrainingRun)(input);
    },
    async failTrainingRun(input) {
      calls.fail.push(input.error);
      return real.failTrainingRun(input);
    },
  };
  return { acts, calls };
}

const execute = (acts: Partial<Activities>, input: TrainingRunInput) => rig.run(acts, (client, taskQueue) => client.workflow.execute(trainingRun, { workflowId: wfId("training"), taskQueue, args: [input] }));

describe("trainingRun workflow", () => {
  it("a model retest scores the draft copy on the new model and ends awaiting a decision, live version untouched", async () => {
    const agent = await repos.agents.get(t.db, t.businessId, t.workerId);
    const live = await repos.agents.getVersion(t.db, t.businessId, agent.currentVersionId!);
    const target = MODEL_KEYS.find((m) => m !== live.modelKey) as ModelKey;
    const { run, draft } = (await repos.training.createModelRetest(t.db, t.businessId, agent.id, { modelKey: target })).retest!;
    const { acts, calls } = activities();

    const result = await execute(acts, { businessId: t.businessId, trainingRunId: run.id });
    expect(result.status).toBe("awaiting_decision");
    expect(result.skillDeltas.length).toBeGreaterThan(0);
    expect(calls).toMatchObject({ load: 1, fail: [] });
    const stored = await repos.training.get(t.db, t.businessId, run.id);
    expect(stored.status).toBe("awaiting_decision");
    expect(stored.startedAt).toBeInstanceOf(Date);
    expect(stored.endedAt).toBeInstanceOf(Date);
    expect(stored.coachSummaryMd).toMatch(/^Retest on (Opus|Sonnet|Haiku) after the model change from (Opus|Sonnet|Haiku): /);
    expect(stored.coachSummaryMd).toMatch(/Recommendation: (promote, so the live version runs on|discard, and change the model back to)/);
    // The candidate was the copy on the new model; the live version and the agent's pointer are untouched.
    expect(stored.toVersionId).toBe(draft.id);
    expect((await repos.agents.getVersion(t.db, t.businessId, draft.id)).modelKey).toBe(target);
    expect((await repos.agents.get(t.db, t.businessId, agent.id)).currentVersionId).toBe(live.id);
    expect((await repos.agents.getVersion(t.db, t.businessId, live.id)).state).toBe("live");
  });

  it("a run whose candidate is the live version (the old retests) fails at once with the reason instead of staying queued", async () => {
    const agent = await repos.agents.get(t.db, t.businessId, t.workerId);
    const run = await repos.training.create(t.db, t.businessId, { agentId: agent.id, fromVersionId: agent.currentVersionId, toVersionId: agent.currentVersionId, status: "queued" });
    const { acts, calls } = activities();

    const result = await execute(acts, { businessId: t.businessId, trainingRunId: run.id });
    expect(result.status).toBe("failed");
    // Not retried: retrying cannot change the candidate.
    expect(calls.load).toBe(1);
    expect(calls.fail).toHaveLength(1);
    expect(calls.fail[0]).toMatch(/live version/);
    const stored = await repos.training.get(t.db, t.businessId, run.id);
    expect(stored.status).toBe("failed");
    expect(stored.endedAt).toBeInstanceOf(Date);
    expect(stored.coachSummaryMd).toMatch(/^Training failed: .*live version/);
    expect(stored.coachSummaryMd).not.toMatch(/AC-11|refusing/);
    const events = await repos.events.list(t.db, t.businessId, { type: "training.completed", limit: 20 });
    expect(events.items.find((e) => (e.payload as { trainingRunId: string }).trainingRunId === run.id)?.payload).toMatchObject({ status: "failed", recommendation: null });
  });

  it("an unexpected start failure is retried, then fails the run with a generic reason (no worker text)", async () => {
    const agent = await repos.agents.get(t.db, t.businessId, t.workerId);
    const { draft, run } = (await repos.training.createModelRetest(t.db, t.businessId, agent.id, { modelKey: "haiku" })).retest!;
    const { acts, calls } = activities({
      async loadTrainingRun() {
        throw new Error("connection terminated unexpectedly at 10.0.0.7:5432");
      },
    });

    const result = await execute(acts, { businessId: t.businessId, trainingRunId: run.id });
    expect(result.status).toBe("failed");
    expect(calls.load).toBe(3);
    expect(calls.fail).toEqual([TRAINING_START_FAILED]);
    const stored = await repos.training.get(t.db, t.businessId, run.id);
    expect(stored).toMatchObject({ status: "failed", toVersionId: draft.id });
    expect(stored.coachSummaryMd).not.toMatch(/10\.0\.0\.7/);
  });

  it("results that cannot be written end the run failed with a generic reason, never running for good", async () => {
    const agent = await repos.agents.get(t.db, t.businessId, t.workerId);
    const { run } = (await repos.training.createModelRetest(t.db, t.businessId, agent.id, { modelKey: "haiku" })).retest!;
    let finalizeCalls = 0;
    const { acts, calls } = activities({
      async finalizeTrainingRun() {
        finalizeCalls++;
        throw new Error("payload rejected: skillDeltas.0.group");
      },
    });

    const result = await execute(acts, { businessId: t.businessId, trainingRunId: run.id });
    expect(result.status).toBe("failed");
    expect(finalizeCalls).toBe(3);
    expect(calls.fail).toEqual([TRAINING_FINISH_FAILED]);
    const stored = await repos.training.get(t.db, t.businessId, run.id);
    expect(stored).toMatchObject({ status: "failed", coachSummaryMd: `Training failed: ${TRAINING_FINISH_FAILED}` });
    expect(stored.endedAt).toBeInstanceOf(Date);
    expect(stored.coachSummaryMd).not.toMatch(/payload rejected/);
  });

  it("a run the founder canceled before it started stays canceled", async () => {
    const agent = await repos.agents.get(t.db, t.businessId, t.workerId);
    const { run } = (await repos.training.createModelRetest(t.db, t.businessId, agent.id, { modelKey: "opus" })).retest!;
    await repos.training.cancel(t.db, t.businessId, run.id);
    const { acts, calls } = activities();

    const result = await execute(acts, { businessId: t.businessId, trainingRunId: run.id });
    expect(result.status).toBe("cancelled");
    expect(calls.load).toBe(1);
    expect((await repos.training.get(t.db, t.businessId, run.id)).status).toBe("cancelled");
  });
});
