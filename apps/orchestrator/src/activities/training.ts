/**
 * trainingRun activities (BUILD §11.10, §12.5, AC-11.10.1/2/4).
 *
 * `loadTrainingRun` reads the run, the draft and the live version and flags club-rule contradictions in the draft (the
 * rule still applies because `buildSystemPrompt` always prepends it). `runSkillTests` runs one skill's full test set
 * (held-out included, never returned) against the draft version: the candidate answers through the agent's route in
 * the mock sandbox with mock tools only, deterministic checks run first and are authoritative, then the `skillGrader`
 * route scores the rubric. `finalizeTrainingRun` writes results, moves the run to awaiting_decision and emits
 * `training.completed`; `failTrainingRun` ends a run that could not start as failed, so no run stays queued. A run the
 * founder canceled (agent.training.cancel) stays canceled whatever lands later. The live version is never touched
 * here; Promote is the founder's button (apps/api).
 */
import { AgentInstructions, buildSystemPrompt, detectClubRuleViolation, getPrompt, getSkillDefinition, getSkillTests, ratingFromTested, runDeterministicChecks, type AgentTemplate, type SkillTest } from "@foundmill/agents";
import { APP_NAME, CREDITS_CURRENCY } from "@foundmill/config";
import { ACTIVE_TRAINING_STATUSES, MICRO_PER_MINOR, microToMinor, repos } from "@foundmill/db";
import { SkillGradeOutput, resolveModel } from "@foundmill/models";
import { MockSandboxProvider, RECORDINGS, type MockSandbox } from "@foundmill/sandbox";
import { NotFoundError, type ModelKey } from "@foundmill/shared";
import { ApplicationFailure } from "@temporalio/common";
import type { OrchestratorDeps } from "../deps";
import { emitEvent, systemActor } from "../events";
import { templateForAgent } from "./session";
import type { LoadedTrainingRun, SkillTestsOutcome, TrainingRunInput, TrainingRunResult } from "./types";

/** A failed deterministic check caps the test's score (BUILD §12.5: checks are authoritative, the grader never overrides them). */
export const FAILED_CHECK_SCORE_CAP = 0.4;

/** The only failure type whose message is a founder-readable reason a run could not start (workflows/trainingRun stores it). */
export const TRAINING_RUN_ERROR = "TrainingRunError";
/** Retrying cannot help these: the run is failed at once with the reason. */
const cannotStart = (message: string) => ApplicationFailure.create({ message, type: TRAINING_RUN_ERROR, nonRetryable: true });
/** A run starts from queued; running too, when `loadTrainingRun` itself is retried after it moved the run. */
const STARTABLE = ["queued", "running"] as const;

const MODEL_NAMES: Record<ModelKey, string> = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" };

export function scoreTest(graderScore: number, checks: readonly { passed: boolean }[]): number {
  const failed = checks.some((c) => !c.passed);
  const s = failed ? Math.min(graderScore, FAILED_CHECK_SCORE_CAP) : graderScore;
  return Math.round(Math.max(0, Math.min(1, s)) * 1000) / 1000;
}

function flagsFor(before: Record<string, unknown> | null, after: Record<string, unknown>, template: AgentTemplate): LoadedTrainingRun["clubRuleFlags"] {
  const b = before ? AgentInstructions.safeParse(before) : null;
  const a = AgentInstructions.safeParse(after);
  if (!a.success) return [];
  const report = detectClubRuleViolation({ before: b?.success ? b.data : template.instructions, after: a.data });
  return report.violations.map((v) => ({ ruleId: String(v.ruleId), line: v.line, reason: v.reason }));
}

export function createTrainingActivities(deps: OrchestratorDeps) {
  async function graderFor(skill: string, test: SkillTest, output: string, checks: { kind: string; passed: boolean; detail?: string }[], attribution: { businessId: string; agentId: string }) {
    const prompt = getPrompt("skill_grader").render({});
    const payload = {
      skill,
      task: { title: test.task.title, prompt: test.task.prompt },
      rubric: test.rubric.lines.map((l) => ({ criterion: l.criterion, weight: l.weight })),
      deterministic: checks.map((c) => ({ criterion: c.kind, passed: c.passed, detail: c.detail ?? "" })),
      output,
    };
    const result = await deps.models.complete({ route: "skillGrader", schema: SkillGradeOutput, system: prompt, messages: [{ role: "user", content: `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`` }], scope: `training:${attribution.agentId}`, attribution: { ...attribution, kind: "skill_grader" } });
    return result;
  }

  return {
    /**
     * Reads the run and moves it to running. A run that can never start (its candidate is the live version, it has no
     * draft, a row is gone, it was canceled) fails with a non-retryable `TrainingRunError` whose message the workflow
     * stores on the run, so it ends failed instead of staying queued.
     */
    async loadTrainingRun(input: TrainingRunInput): Promise<LoadedTrainingRun> {
      const { db } = deps;
      const permanent = async <T>(read: Promise<T>): Promise<T> => {
        try {
          return await read;
        } catch (err) {
          if (err instanceof NotFoundError) throw cannotStart("The run, its agent or its draft version no longer exists.");
          throw err;
        }
      };
      const run = await permanent(repos.training.get(db, input.businessId, input.trainingRunId));
      if (!(STARTABLE as readonly string[]).includes(run.status)) throw cannotStart("The run had already ended before it started.");
      if (!run.toVersionId) throw cannotStart("The run has no draft version to test.");
      const [agent, draft] = await permanent(Promise.all([repos.agents.get(db, input.businessId, run.agentId), repos.agents.getVersion(db, input.businessId, run.toVersionId)]));
      if (draft.state !== "draft") throw cannotStart(draft.state === "live" ? "The candidate is the live version; training only ever scores a draft." : "The candidate is no longer a draft.");
      const live = run.fromVersionId ? await permanent(repos.agents.getVersion(db, input.businessId, run.fromVersionId)) : agent.currentVersionId ? await permanent(repos.agents.getVersion(db, input.businessId, agent.currentVersionId)) : null;
      const template = templateForAgent(agent);
      const existing = await repos.skills.listForAgent(db, input.businessId, agent.id);
      const skillKeys = existing.length > 0 ? existing.map((s) => s.skillKey) : template.skills;
      // Only from queued (or running, on a retry of this activity): a cancel that landed meanwhile stands.
      const started = await repos.training.transition(db, input.businessId, run.id, STARTABLE, { status: "running", startedAt: run.startedAt ?? deps.clock.now() });
      if (!started) throw cannotStart("The run had already ended before it started.");
      return {
        trainingRunId: run.id,
        agentId: agent.id,
        agentType: agent.agentType,
        draftVersionId: draft.id,
        liveVersionId: live?.id ?? null,
        skillKeys,
        modelKey: draft.modelKey,
        clubRuleFlags: flagsFor((live?.instructions as Record<string, unknown> | null) ?? null, draft.instructions as Record<string, unknown>, template),
        // A model change's retest (agent.model.set): the system's copy of the live version on another model.
        retest: live && draft.createdByKind === "system" && draft.modelKey !== live.modelKey ? { fromModelKey: live.modelKey, toModelKey: draft.modelKey } : null,
      };
    },

    /**
     * A run that could not start (`loadTrainingRun` refused it or kept failing) ends failed with the reason, unless it
     * already ended (a founder's cancel). Without this the run stayed queued, and the Training tab active, for good.
     */
    async failTrainingRun(input: TrainingRunInput & { error: string }): Promise<TrainingRunResult> {
      const { db } = deps;
      const coachSummaryMd = `Training failed: ${input.error}`;
      const failed = await repos.training.transition(db, input.businessId, input.trainingRunId, ACTIVE_TRAINING_STATUSES, { status: "failed", coachSummaryMd, endedAt: deps.clock.now() });
      if (!failed) {
        // Already ended: canceled by the founder, or failed by an earlier attempt of this activity (or the row is gone).
        const run = await repos.training.get(db, input.businessId, input.trainingRunId).catch(() => null);
        return { status: run?.status === "failed" ? "failed" : "cancelled", skillDeltas: [], eventId: null };
      }
      let eventId: string | null = null;
      if (failed.toVersionId) {
        const ev = await emitEvent(db, {
          businessId: input.businessId,
          type: "training.completed",
          actor: systemActor,
          payload: { trainingRunId: failed.id, agentId: failed.agentId, fromVersionId: failed.fromVersionId ?? failed.toVersionId, toVersionId: failed.toVersionId, status: "failed", cost: { amountMinor: 0, currency: failed.currency }, durationMs: 0, testsRun: 0, skillDeltas: [], coachSummary: coachSummaryMd.slice(0, 4000), recommendation: null },
        });
        eventId = ev.id;
      }
      await repos.audit.append(db, input.businessId, { actorKind: "system", action: "training.complete", target: { kind: "training_run", id: failed.id }, details: { status: "failed", error: input.error.slice(0, 400) } });
      return { status: "failed", skillDeltas: [], eventId };
    },

    /** One skill's test set against the draft version, in the mock sandbox with mock tools only. */
    async runSkillTests(input: TrainingRunInput & { agentId: string; draftVersionId: string; skillKey: string; modelKey: "opus" | "sonnet" | "haiku" }): Promise<SkillTestsOutcome> {
      const { db } = deps;
      const [agent, draft, business] = await Promise.all([repos.agents.get(db, input.businessId, input.agentId), repos.agents.getVersion(db, input.businessId, input.draftVersionId), repos.businesses.get(db, input.businessId)]);
      const template = templateForAgent(agent);
      const definition = getSkillDefinition(input.skillKey);
      const group = definition?.group ?? "craft";
      let tests: SkillTest[] = [];
      try {
        tests = getSkillTests(input.skillKey, { includeHeldOut: true });
      } catch {
        tests = [];
      }
      const previous = (await repos.skills.listForAgent(db, input.businessId, agent.id)).find((s) => s.skillKey === input.skillKey);
      const previousTested = previous?.tested === null || previous?.tested === undefined ? null : Number(previous.tested);
      if (tests.length === 0) {
        // Custom skills without a reviewed test set do not count yet (BUILD §11.10 "founder reviews before it counts").
        return { skillKey: input.skillKey, group, testsRun: 0, meanScore: 0, tested: previousTested ?? template.baselineRating, previousTested, costMinor: 0, costMicroMinor: 0, checksFailed: 0 };
      }
      const instructions = AgentInstructions.safeParse(draft.instructions);
      const system = buildSystemPrompt({ businessName: business.name, appName: APP_NAME, template: { instructions: instructions.success ? instructions.data : template.instructions, description: template.description }, glossary: business.glossary });
      const route = resolveModel(template.route, input.modelKey);
      const sandboxes = new MockSandboxProvider({ speed: Infinity, autoplay: false, holds: { autoResolveAfterMs: 1 } });
      const recording = RECORDINGS.find((r) => r.taskKind === (template.taskKinds[0] ?? "code")) ?? RECORDINGS[0]!;

      // Exact costs (millionths of a cent) are summed and rounded once, so the run's total is not the sum of roundings.
      let costMicroMinor = 0;
      let checksFailed = 0;
      const scores: number[] = [];
      const attribution = { businessId: input.businessId, agentId: agent.id, kind: "training" };
      const CONCURRENCY = 4;
      const queue = [...tests];
      const worker = async () => {
        for (;;) {
          const test = queue.shift();
          if (!test) return;
          // 1. the candidate answers with mock tools only (no real email or spend can happen here)
          const answer = await deps.models.complete({
            route: template.route,
            system: [system, `## Training\nYou are being tested on "${definition?.name ?? input.skillKey}". Available mock tools: ${test.task.mockTools.join(", ") || "none"}. Answer the task directly.`],
            messages: [{ role: "user", content: `${test.task.prompt}\n\n\`\`\`json\n${JSON.stringify({ task: { id: test.id, title: test.task.title, kind: template.taskKinds[0] ?? "ops" }, fixtures: test.task.fixtures })}\n\`\`\`` }],
            modelOverride: route.modelKey,
            // The agent's whole system prompt (about 3k tokens) is the same on every test: written once, then read (audit BF-15).
            cacheSystem: true,
            scope: `training:${agent.id}`,
            attribution,
          });
          costMicroMinor += answer.cost.costMicroMinor;
          // 2. the sandbox runs the task's tests when the skill has any (mock: canned results per recording)
          let testsPassed: boolean | undefined;
          if (test.checks.some((c) => c.kind === "tests_pass")) {
            const sandbox = (await sandboxes.create({ businessId: input.businessId, taskId: `training-${test.id}`.slice(0, 120), sessionId: `${input.trainingRunId}:${test.id}`.slice(0, 200), recording: recording.key })) as MockSandbox;
            await sandbox.start();
            const res = await sandbox.exec("pnpm test");
            testsPassed = res.code === 0;
            await sandbox.stop();
          }
          let json: unknown;
          try {
            json = JSON.parse(answer.text);
          } catch {
            json = undefined;
          }
          // 3. deterministic checks first; they are authoritative
          const checks = runDeterministicChecks(test.checks, { output: answer.text, json, testsPassed, policyViolations: [], toolCalls: [], sourceIds: Object.keys(test.task.fixtures) });
          checksFailed += checks.filter((c) => !c.passed).length;
          // 4. the grader scores the rubric
          const graded = await graderFor(input.skillKey, test, answer.text, checks, { businessId: input.businessId, agentId: agent.id });
          costMicroMinor += graded.cost.costMicroMinor;
          scores.push(scoreTest(graded.json.score, checks));
          try {
            const { Context } = await import("@temporalio/activity");
            Context.current().heartbeat({ skill: input.skillKey, done: scores.length, total: tests.length });
          } catch {
            /* outside Temporal */
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tests.length) }, worker));
      const meanScore = scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length);
      const tested = ratingFromTested(meanScore);
      // Every answer and every grader call was booked when it ran (`usageSink`, kind `tokens`): this row only says how many
      // tests the skill had, so it carries no cost (the run's total lives on `training_runs.cost_minor`, audit O-19).
      // Booked to the business's billing and the price list's currency like every other row.
      await repos.usage.record(db, input.businessId, { agentId: agent.id, kind: "training", quantity: tests.length, unit: "tests", costMinor: 0, currency: CREDITS_CURRENCY, billedTo: business.modelBilling, occurredAt: deps.clock.now(), details: { trainingRunId: input.trainingRunId, skillKey: input.skillKey, label: "Estimate", costBookedPerCall: true } });
      return { skillKey: input.skillKey, group, testsRun: tests.length, meanScore: Math.round(meanScore * 1000) / 1000, tested, previousTested, costMinor: microToMinor(costMicroMinor), costMicroMinor, checksFailed };
    },

    /** Persist results on the run (never on the live version) and narrate through `training.completed`. */
    async finalizeTrainingRun(input: TrainingRunInput & { agentId: string; draftVersionId: string; liveVersionId: string | null; outcomes: SkillTestsOutcome[]; clubRuleFlags: LoadedTrainingRun["clubRuleFlags"]; startedAt: string; status?: "failed" | "cancelled"; error?: string; retest?: LoadedTrainingRun["retest"] }): Promise<TrainingRunResult> {
      const { db } = deps;
      const run = await repos.training.get(db, input.businessId, input.trainingRunId);
      const results: Record<string, { old: number; new: number }> = {};
      const skillDeltas: TrainingRunResult["skillDeltas"] = [];
      const costMinor = Math.max(0, microToMinor(input.outcomes.reduce((a, o) => a + (o.costMicroMinor ?? o.costMinor * MICRO_PER_MINOR), 0)));
      for (const o of input.outcomes) {
        const before = Math.max(1, Math.min(20, Math.round(o.previousTested ?? o.tested)));
        results[o.skillKey] = { old: before, new: o.tested };
        skillDeltas.push({ skillKey: o.skillKey, before, after: o.tested });
      }
      const drops = skillDeltas.filter((d) => d.before - d.after > 1);
      const gains = skillDeltas.filter((d) => d.after > d.before);
      const retest = input.retest ?? null;
      // A retest has nothing to gain by itself: the new model is kept unless skills drop.
      const recommendation = drops.length === 0 && (gains.length > 0 || retest) ? "promote" : "discard";
      const flagNote = input.clubRuleFlags.length ? ` The draft tried to change ${input.clubRuleFlags.length} house rule${input.clubRuleFlags.length > 1 ? "s" : ""} (${input.clubRuleFlags.map((f) => f.ruleId).join(", ")}); those lines were ignored and the rules still apply.` : "";
      const intro = retest ? `Retest on ${MODEL_NAMES[retest.toModelKey]} after the model change from ${MODEL_NAMES[retest.fromModelKey]}: ` : "";
      const advice = !retest ? recommendation : recommendation === "promote" ? `promote, so the live version runs on ${MODEL_NAMES[retest.toModelKey]} too` : `discard, and change the model back to ${MODEL_NAMES[retest.fromModelKey]} (the agent works on ${MODEL_NAMES[retest.toModelKey]} until you do)`;
      const coachSummaryMd = input.status
        ? `Training ${input.status === "cancelled" ? "canceled" : "failed"}${input.error ? `: ${input.error}` : ""}.`
        : `${intro}${input.outcomes.reduce((a, o) => a + o.testsRun, 0)} tests across ${input.outcomes.length} skills. ${gains.length} skill${gains.length === 1 ? "" : "s"} up, ${drops.length} dropped by more than a point${drops.length ? ` (${drops.map((d) => `${d.skillKey} ${d.before}→${d.after}`).join(", ")})` : ""}.${flagNote} Recommendation: ${advice} (Estimate from tested ratings; proven ratings follow live work).`;
      // Only a run still in flight takes the outcome: a founder's cancel (agent.training.cancel) that landed while the
      // tests ran stands, and keeps what the tests cost.
      const moved = await repos.training.transition(db, input.businessId, run.id, ACTIVE_TRAINING_STATUSES, { status: input.status ?? "awaiting_decision", results, coachSummaryMd, costMinor, endedAt: deps.clock.now() });
      let stored = moved;
      if (!stored) {
        const current = await repos.training.get(db, input.businessId, run.id);
        stored = current.status === "cancelled" ? await repos.training.update(db, input.businessId, run.id, { costMinor }) : current;
      }
      const status: TrainingRunResult["status"] = stored.status === "cancelled" ? "cancelled" : stored.status === "failed" ? "failed" : "awaiting_decision";
      const ev = await emitEvent(db, {
        businessId: input.businessId,
        type: "training.completed",
        actor: systemActor,
        payload: { trainingRunId: run.id, agentId: input.agentId, fromVersionId: input.liveVersionId ?? input.draftVersionId, toVersionId: input.draftVersionId, status: status === "awaiting_decision" ? "succeeded" : status, cost: { amountMinor: Math.max(0, Math.round(costMinor)), currency: CREDITS_CURRENCY }, durationMs: Math.max(0, deps.clock.nowMs() - new Date(input.startedAt).getTime()), testsRun: input.outcomes.reduce((a, o) => a + o.testsRun, 0), skillDeltas: skillDeltas.map((d) => ({ skillKey: d.skillKey, group: input.outcomes.find((o) => o.skillKey === d.skillKey)?.group ?? "craft", before: d.before, after: d.after })), coachSummary: (moved ? coachSummaryMd : stored.coachSummaryMd || "Training canceled.").slice(0, 4000), recommendation: status === "awaiting_decision" ? recommendation : null },
      });
      await repos.audit.append(db, input.businessId, { actorKind: "system", action: "training.complete", target: { kind: "training_run", id: run.id }, details: { status, skills: skillDeltas.length, flags: input.clubRuleFlags.length } });
      return { status, skillDeltas, eventId: ev.id };
    },
  };
}

export type TrainingActivities = ReturnType<typeof createTrainingActivities>;
