/**
 * trainingRun activities (BUILD §11.10, §12.5, AC-11.10.1/2/4).
 *
 * `loadTrainingRun` reads the run, the draft and the live version and flags club-rule contradictions in the draft (the
 * rule still applies because `buildSystemPrompt` always prepends it). `runSkillTests` runs one skill's full test set
 * (held-out included, never returned) against the draft version: the candidate answers through the agent's route in
 * the mock sandbox with mock tools only, deterministic checks run first and are authoritative, then the `skillGrader`
 * route scores the rubric. `finalizeTrainingRun` writes results, moves the run to awaiting_decision and emits
 * `training.completed`. The live version is never touched here; Promote is the founder's button (apps/api).
 */
import { AgentInstructions, buildSystemPrompt, detectClubRuleViolation, getPrompt, getSkillDefinition, getSkillTests, ratingFromTested, runDeterministicChecks, type AgentTemplate, type SkillTest } from "@foundmill/agents";
import { APP_NAME } from "@foundmill/config";
import { repos } from "@foundmill/db";
import { SkillGradeOutput, resolveModel } from "@foundmill/models";
import { MockSandboxProvider, RECORDINGS, type MockSandbox } from "@foundmill/sandbox";
import type { OrchestratorDeps } from "../deps";
import { emitEvent, systemActor } from "../events";
import { templateForAgent } from "./session";
import type { LoadedTrainingRun, SkillTestsOutcome, TrainingRunInput, TrainingRunResult } from "./types";

/** A failed deterministic check caps the test's score (BUILD §12.5: checks are authoritative, the grader never overrides them). */
export const FAILED_CHECK_SCORE_CAP = 0.4;

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
    async loadTrainingRun(input: TrainingRunInput): Promise<LoadedTrainingRun> {
      const { db } = deps;
      const run = await repos.training.get(db, input.businessId, input.trainingRunId);
      if (!run.toVersionId) throw new Error("training run has no draft version");
      const [agent, draft] = await Promise.all([repos.agents.get(db, input.businessId, run.agentId), repos.agents.getVersion(db, input.businessId, run.toVersionId)]);
      if (draft.state === "live") throw new Error("refusing to train against the live version (AC-11.10.1)");
      const live = run.fromVersionId ? await repos.agents.getVersion(db, input.businessId, run.fromVersionId) : agent.currentVersionId ? await repos.agents.getVersion(db, input.businessId, agent.currentVersionId) : null;
      const template = templateForAgent(agent);
      const existing = await repos.skills.listForAgent(db, input.businessId, agent.id);
      const skillKeys = existing.length > 0 ? existing.map((s) => s.skillKey) : template.skills;
      await repos.training.update(db, input.businessId, run.id, { status: "running", startedAt: deps.clock.now() });
      return {
        trainingRunId: run.id,
        agentId: agent.id,
        agentType: agent.agentType,
        draftVersionId: draft.id,
        liveVersionId: live?.id ?? null,
        skillKeys,
        modelKey: draft.modelKey,
        clubRuleFlags: flagsFor((live?.instructions as Record<string, unknown> | null) ?? null, draft.instructions as Record<string, unknown>, template),
      };
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
        return { skillKey: input.skillKey, group, testsRun: 0, meanScore: 0, tested: previousTested ?? template.baselineRating, previousTested, costMinor: 0, checksFailed: 0 };
      }
      const instructions = AgentInstructions.safeParse(draft.instructions);
      const system = buildSystemPrompt({ businessName: business.name, appName: APP_NAME, template: { instructions: instructions.success ? instructions.data : template.instructions, description: template.description }, glossary: business.glossary });
      const route = resolveModel(template.route, input.modelKey);
      const sandboxes = new MockSandboxProvider({ speed: Infinity, autoplay: false, holds: { autoResolveAfterMs: 1 } });
      const recording = RECORDINGS.find((r) => r.taskKind === (template.taskKinds[0] ?? "code")) ?? RECORDINGS[0]!;

      let costMinor = 0;
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
            scope: `training:${agent.id}`,
            attribution,
          });
          costMinor += answer.cost.costMinorInt;
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
          costMinor += graded.cost.costMinorInt;
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
      await repos.usage.record(db, input.businessId, { agentId: agent.id, kind: "training", quantity: tests.length, unit: "tests", costMinor: Math.max(0, costMinor), occurredAt: deps.clock.now(), details: { trainingRunId: input.trainingRunId, skillKey: input.skillKey, label: "Estimate" } });
      return { skillKey: input.skillKey, group, testsRun: tests.length, meanScore: Math.round(meanScore * 1000) / 1000, tested, previousTested, costMinor, checksFailed };
    },

    /** Persist results on the run (never on the live version) and narrate through `training.completed`. */
    async finalizeTrainingRun(input: TrainingRunInput & { agentId: string; draftVersionId: string; liveVersionId: string | null; outcomes: SkillTestsOutcome[]; clubRuleFlags: LoadedTrainingRun["clubRuleFlags"]; startedAt: string; status?: "failed" | "cancelled"; error?: string }): Promise<TrainingRunResult> {
      const { db } = deps;
      const run = await repos.training.get(db, input.businessId, input.trainingRunId);
      const results: Record<string, { old: number; new: number }> = {};
      const skillDeltas: TrainingRunResult["skillDeltas"] = [];
      const costMinor = input.outcomes.reduce((a, o) => a + o.costMinor, 0);
      for (const o of input.outcomes) {
        const before = Math.max(1, Math.min(20, Math.round(o.previousTested ?? o.tested)));
        results[o.skillKey] = { old: before, new: o.tested };
        skillDeltas.push({ skillKey: o.skillKey, before, after: o.tested });
      }
      const drops = skillDeltas.filter((d) => d.before - d.after > 1);
      const gains = skillDeltas.filter((d) => d.after > d.before);
      const flagNote = input.clubRuleFlags.length ? ` The draft tried to change ${input.clubRuleFlags.length} house rule${input.clubRuleFlags.length > 1 ? "s" : ""} (${input.clubRuleFlags.map((f) => f.ruleId).join(", ")}); those lines were ignored and the rules still apply.` : "";
      const coachSummaryMd = input.status
        ? `Training ${input.status}${input.error ? `: ${input.error}` : ""}.`
        : `${input.outcomes.reduce((a, o) => a + o.testsRun, 0)} tests across ${input.outcomes.length} skills. ${gains.length} skill${gains.length === 1 ? "" : "s"} up, ${drops.length} dropped by more than a point${drops.length ? ` (${drops.map((d) => `${d.skillKey} ${d.before}→${d.after}`).join(", ")})` : ""}.${flagNote} Recommendation: ${drops.length === 0 && gains.length > 0 ? "promote" : "discard"} (Estimate from tested ratings; proven ratings follow live work).`;
      const status = input.status ?? "awaiting_decision";
      await repos.training.update(db, input.businessId, run.id, { status, results, coachSummaryMd, costMinor: Math.max(0, Math.round(costMinor)), endedAt: deps.clock.now() });
      const ev = await emitEvent(db, {
        businessId: input.businessId,
        type: "training.completed",
        actor: systemActor,
        payload: { trainingRunId: run.id, agentId: input.agentId, fromVersionId: input.liveVersionId ?? input.draftVersionId, toVersionId: input.draftVersionId, status: input.status === "cancelled" ? "cancelled" : input.status === "failed" ? "failed" : "succeeded", cost: { amountMinor: Math.max(0, Math.round(costMinor)), currency: run.currency ?? "EUR" }, durationMs: Math.max(0, deps.clock.nowMs() - new Date(input.startedAt).getTime()), testsRun: input.outcomes.reduce((a, o) => a + o.testsRun, 0), skillDeltas: skillDeltas.map((d) => ({ skillKey: d.skillKey, group: input.outcomes.find((o) => o.skillKey === d.skillKey)?.group ?? "craft", before: d.before, after: d.after })), coachSummary: coachSummaryMd.slice(0, 4000), recommendation: input.status ? null : drops.length === 0 && gains.length > 0 ? "promote" : "discard" },
      });
      await repos.audit.append(db, input.businessId, { actorKind: "system", action: "training.complete", target: { kind: "training_run", id: run.id }, details: { status, skills: skillDeltas.length, flags: input.clubRuleFlags.length } });
      return { status, skillDeltas, eventId: ev.id };
    },
  };
}

export type TrainingActivities = ReturnType<typeof createTrainingActivities>;
