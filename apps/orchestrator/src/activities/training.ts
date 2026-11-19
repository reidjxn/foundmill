/**
 * trainingRun activities (BUILD §11.10, §12.5, AC-11.10.1/2/4).
 *
 * `loadTrainingRun` reads the run, the draft and the live version and flags club-rule contradictions in the draft (the
 * rule still applies because `buildSystemPrompt` always prepends it). `runSkillTests` runs one skill's full test set
 * (held-out included, never returned) against the draft version: the candidate answers through the agent's route in
 * the mock sandbox with mock tools only, deterministic checks run first and are authoritative, then the `skillGrader`
 * route scores the rubric. `finalizeTrainingRun` writes results, moves the run to awaiting_decision and emits
 * `training.completed`; `failTrainingRun` ends a run that could not start as failed, so no run stays queued. A run the
 * founder canceled (agent.training.cancel) stays canceled whatever lands later. The live version and the agent's
 * ratings are never touched here; Promote is the founder's button (apps/api), and `repos.training.decide` writes the
 * scores onto the ratings then. A skill with no tests (a library or file skill) is reported as "No tests yet"
 * (`results[key].tests` 0) rather than scored at its baseline.
 *
 * Training spends model credits, so it honours the team-wide stop (0023) on its own, whether or not Stop all agents'
 * signal reached the workflow (a revoked key or used-up credits signal nothing): a run that loads while the team is
 * stopped, and a skill whose next test would start while it is, end the run canceled with the reason; the tests already
 * run are booked. A run that ended stays ended: its remaining skills run no test, even after the agents resume.
 */
import { AgentInstructions, NO_TOOL_LOOP_PRELOAD_BODIES, attachedSkills, buildSystemPrompt, detectClubRuleViolation, getPrompt, selectSkills, getSkillDefinition, getSkillTests, isCustomSkillKey, ratingFromTested, runDeterministicChecks, skillDisplayName, skillTestFromStored, type AgentTemplate, type SkillTest } from "@foundmill/agents";
import { APP_NAME, CREDITS_CURRENCY } from "@foundmill/config";
import { ACTIVE_TRAINING_STATUSES, MICRO_PER_MINOR, microToMinor, repos, type TrainingRun } from "@foundmill/db";
import { SkillGradeOutput, resolveModel } from "@foundmill/models";
import { MockSandboxProvider, RECORDINGS, type MockSandbox } from "@foundmill/sandbox";
import { NotFoundError, countOf, formatCount, type AgentStopReason, type ModelKey } from "@foundmill/shared";
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

const MODEL_NAMES: Record<ModelKey, string> = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku", glm: "GLM-5.3 Flash" };

const STOP_WORDS: Record<AgentStopReason, string> = { kill_switch: "Stop all agents", key_revoked: "the Anthropic key was revoked", credits_exhausted: "the credits ran out" };

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
  /** The canceled run's summary while the team is stopped (or the business archived); null while it may work. */
  async function stoppedSummary(businessId: string): Promise<string | null> {
    const stop = await repos.businesses.stopState(deps.db, businessId);
    if (!stop.stopped) return null;
    return `Training canceled: ${stop.archived ? "the business is archived" : STOP_WORDS[stop.reason ?? "kill_switch"]}. Train again once the agents resume.`;
  }

  /** Ends the run canceled for the stop, unless it already ended (a founder's cancel, Stop all agents' own cancel). */
  async function cancelForStop(input: TrainingRunInput, coachSummaryMd: string): Promise<void> {
    await repos.training.transition(deps.db, input.businessId, input.trainingRunId, ACTIVE_TRAINING_STATUSES, { status: "cancelled", coachSummaryMd, endedAt: deps.clock.now() });
  }

  /**
   * Why the next test must not start, or null while it may: the team is stopped (`cancelWith` is the summary the run
   * ends canceled with), or the run already ended (a founder's cancel, or a stop that canceled it and was lifted since;
   * no signal may have reached the workflow, and a canceled run's remaining skills never spend once the agents resume).
   */
  async function haltFor(input: TrainingRunInput): Promise<{ cancelWith: string | null } | null> {
    const [stopped, run] = await Promise.all([stoppedSummary(input.businessId), repos.training.get(deps.db, input.businessId, input.trainingRunId)]);
    if (stopped) return { cancelWith: stopped };
    return (ACTIVE_TRAINING_STATUSES as readonly string[]).includes(run.status) ? null : { cancelWith: null };
  }

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
     * stores on the run, so it ends failed instead of staying queued. While the team is stopped the run ends canceled
     * with the reason before anything is spent.
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
      const stopped = await stoppedSummary(input.businessId);
      if (stopped) {
        await cancelForStop(input, stopped);
        throw cannotStart(stopped);
      }
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
     * A run that could not start (`loadTrainingRun` refused it or kept failing), or whose results could not be written,
     * ends failed with the reason, unless it already ended (a founder's cancel, or results that did land). Without this
     * the run stayed queued, and the Training tab active, for good.
     */
    async failTrainingRun(input: TrainingRunInput & { error: string }): Promise<TrainingRunResult> {
      const { db } = deps;
      const coachSummaryMd = `Training failed: ${input.error}`;
      const failed = await repos.training.transition(db, input.businessId, input.trainingRunId, ACTIVE_TRAINING_STATUSES, { status: "failed", coachSummaryMd, endedAt: deps.clock.now() });
      if (!failed) {
        // Already ended: canceled by the founder, failed by an earlier attempt of this activity, results that landed
        // before a later step failed (or the row is gone).
        const run = await repos.training.get(db, input.businessId, input.trainingRunId).catch(() => null);
        const status: TrainingRunResult["status"] = run?.status === "failed" ? "failed" : run?.status === "awaiting_decision" || run?.status === "done" ? "awaiting_decision" : "cancelled";
        return { status, skillDeltas: [], eventId: null };
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

    /**
     * One skill's test set against the draft version, in the mock sandbox with mock tools only. The stop flag and the
     * run are read before each test: once the team is stopped no further test starts and the run ends canceled; once the
     * run has ended (canceled by the founder or by a stop lifted since) no further test starts either. The tests already
     * run are booked.
     */
    async runSkillTests(input: TrainingRunInput & { agentId: string; draftVersionId: string; skillKey: string; modelKey: ModelKey }): Promise<SkillTestsOutcome> {
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
      // A custom skill is scored on the tests the founder reviewed (held-out ones included), never on drafts.
      const custom = tests.length === 0 && isCustomSkillKey(input.skillKey) ? await repos.skills.findDefinition(db, input.businessId, agent.agentType, input.skillKey) : null;
      if (custom) {
        const stored = await repos.skills.listTests(db, input.businessId, custom.id, { includeHeldOut: true, reviewedOnly: true });
        tests = stored.map((t) => ("task" in t ? skillTestFromStored(t, input.skillKey) : null)).filter((t): t is SkillTest => t !== null);
      }
      const previous = (await repos.skills.listForAgent(db, input.businessId, agent.id)).find((s) => s.skillKey === input.skillKey);
      const previousTested = previous?.tested === null || previous?.tested === undefined ? null : Number(previous.tested);
      if (tests.length === 0) {
        // No tests yet: a custom skill without a reviewed test set (BUILD §11.10 "founder reviews before it counts"),
        // or a library or file skill, which carries instructions and no tests. `testsRun` 0 tells `finalizeTrainingRun`
        // to report "No tests yet" and a promotion to leave the rating alone; `tested` only fills the results' column.
        return { skillKey: input.skillKey, group, testsRun: 0, meanScore: 0, tested: previousTested ?? template.baselineRating, previousTested, costMinor: 0, costMicroMinor: 0, checksFailed: 0 };
      }
      const instructions = AgentInstructions.safeParse(draft.instructions);
      // The agent as it works: its added skills (library or files) in the index after its instructions (WP-06 T4). A test
      // has no tool loop, so the skill under test and those that improve it are loaded; library skills follow the catalog.
      const added = await repos.skills.listAddedForAgent(db, input.businessId, agent.id, agent.agentType);
      const skills = selectSkills({ skills: attachedSkills([], added), ratedSkillKey: input.skillKey, maxBodies: NO_TOOL_LOOP_PRELOAD_BODIES });
      const system = buildSystemPrompt({ businessName: business.name, appName: APP_NAME, template: { instructions: instructions.success ? instructions.data : template.instructions, description: template.description }, glossary: business.glossary, skills });
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
      /** Set once the team stopped or the run ended mid-skill: no further test starts. */
      let halted: { cancelWith: string | null } | null = null;
      const worker = async () => {
        for (;;) {
          if (halted) return;
          const test = queue.shift();
          if (!test) return;
          const halt = await haltFor(input);
          if (halt) {
            halted = halt;
            return;
          }
          // 1. the candidate answers with mock tools only (no real email or spend can happen here)
          const answer = await deps.models.complete({
            route: template.route,
            system: [system, `## Training\nYou are being tested on "${definition?.name ?? custom?.name ?? skillDisplayName(input.skillKey)}". Available mock tools: ${test.task.mockTools.join(", ") || "none"}. Answer the task directly.`],
            messages: [{ role: "user", content: `${test.task.prompt}\n\n\`\`\`json\n${JSON.stringify({ task: { id: test.id, title: test.task.title, kind: template.taskKinds[0] ?? "ops" }, fixtures: test.task.fixtures })}\n\`\`\`` }],
            modelOverride: route.modelKey,
            // The agent's whole system prompt (about 3k tokens) is the same on every test: written once, then read (audit BF-15).
            cacheSystem: true,
            scope: `training:${agent.id}`,
            attribution,
            // A refusal is the candidate's answer here, scored below, never an error that ends the run (WP-09 T5).
            allowRefusal: true,
          });
          costMicroMinor += answer.cost.costMicroMinor;
          // The candidate declined (the whole fallback chain said no): the test scores 0 and the grader is not called.
          if (answer.stopReason === "refusal") {
            scores.push(0);
            continue;
          }
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
      const stoppedWith = (halted as { cancelWith: string | null } | null)?.cancelWith;
      if (stoppedWith) await cancelForStop(input, stoppedWith);
      const testsRun = scores.length;
      const meanScore = scores.reduce((a, b) => a + b, 0) / Math.max(1, testsRun);
      // Stopped before any test ran: the rating stands where it was.
      const tested = testsRun > 0 ? ratingFromTested(meanScore) : (previousTested ?? template.baselineRating);
      // Every answer and every grader call was booked when it ran (`usageSink`, kind `tokens`): this row only says how many
      // tests the skill had, so it carries no cost (the run's total lives on `training_runs.cost_minor`, audit O-19).
      if (testsRun > 0) await repos.usage.record(db, input.businessId, { agentId: agent.id, kind: "training", quantity: testsRun, unit: "tests", costMinor: 0, currency: CREDITS_CURRENCY, billedTo: business.modelBilling, occurredAt: deps.clock.now(), details: { trainingRunId: input.trainingRunId, skillKey: input.skillKey, label: "Estimate", costBookedPerCall: true } });
      return { skillKey: input.skillKey, group, testsRun, meanScore: Math.round(meanScore * 1000) / 1000, tested, previousTested, costMinor: microToMinor(costMicroMinor), costMicroMinor, checksFailed };
    },

    /** Persist results on the run (never on the live version) and narrate through `training.completed`. */
    async finalizeTrainingRun(input: TrainingRunInput & { agentId: string; draftVersionId: string; liveVersionId: string | null; outcomes: SkillTestsOutcome[]; clubRuleFlags: LoadedTrainingRun["clubRuleFlags"]; startedAt: string; status?: "failed" | "cancelled"; error?: string; retest?: LoadedTrainingRun["retest"] }): Promise<TrainingRunResult> {
      const { db } = deps;
      const run = await repos.training.get(db, input.businessId, input.trainingRunId);
      const results: TrainingRun["results"] = {};
      const skillDeltas: TrainingRunResult["skillDeltas"] = [];
      /** Skills the run found no tests for (a library or file skill): reported as such, never scored at the baseline. */
      const noTests: string[] = [];
      const costMinor = Math.max(0, microToMinor(input.outcomes.reduce((a, o) => a + (o.costMicroMinor ?? o.costMinor * MICRO_PER_MINOR), 0)));
      for (const o of input.outcomes) {
        const before = Math.max(1, Math.min(20, Math.round(o.previousTested ?? o.tested)));
        if (o.testsRun === 0) {
          results[o.skillKey] = { old: before, new: before, tests: 0 };
          noTests.push(o.skillKey);
          continue;
        }
        results[o.skillKey] = { old: before, new: o.tested, tests: o.testsRun };
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
      // Skills by their display names ("Prioritization", "Test automation"), never the stored keys; a skill the
      // business added (custom, from the library or a file) reads under the name the founder gave or chose.
      const skillNames = new Map<string, string>();
      const named = [...drops.map((d) => d.skillKey), ...noTests].filter((key) => !getSkillDefinition(key));
      if (!input.status && named.length) {
        const agentType = (await repos.agents.get(db, input.businessId, input.agentId)).agentType;
        for (const key of named) skillNames.set(key, (await repos.skills.findDefinition(db, input.businessId, agentType, key))?.name ?? skillDisplayName(key));
      }
      const skillName = (key: string) => skillNames.get(key) ?? skillDisplayName(key);
      // A custom skill without reviewed tests is told apart from a library or file skill, which has none to review.
      const pendingReview = noTests.filter((key) => isCustomSkillKey(key));
      const withoutTests = noTests.filter((key) => !isCustomSkillKey(key));
      const stands = (keys: string[]) => `${keys.map(skillName).join(", ")}: ${keys.length === 1 ? "its rating stands" : "their ratings stand"}`;
      const noTestsNote = `${withoutTests.length ? ` No tests yet for ${stands(withoutTests)} until the skill has tests (add it as a custom skill to have tests drafted for your review).` : ""}${pendingReview.length ? ` No reviewed tests yet for ${stands(pendingReview)} until you review the tests drafted for it (Review tests on the agent's profile).` : ""}`;
      const coachSummaryMd = input.status
        ? `Training ${input.status === "cancelled" ? "canceled" : "failed"}${input.error ? `: ${input.error}` : ""}.`
        : `${intro}${countOf(input.outcomes.reduce((a, o) => a + o.testsRun, 0), "test")} across ${countOf(skillDeltas.length, "skill")}. ${countOf(gains.length, "skill")} up, ${formatCount(drops.length)} dropped by more than a point${drops.length ? ` (${drops.map((d) => `${skillName(d.skillKey)} ${d.before}→${d.after}`).join(", ")})` : ""}.${noTestsNote}${flagNote} Recommendation: ${advice} (Estimate from tested ratings; proven ratings follow live work).`;
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
