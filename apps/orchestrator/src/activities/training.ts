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
import { SkillGradeOutput, batchEnded, collectBatch, resolveModel, submitBatch, type BatchItem, type BatchItemResult, type CompleteRequest } from "@foundmill/models";
import { MockSandboxProvider, RECORDINGS, type MockSandbox } from "@foundmill/sandbox";
import { NotFoundError, countOf, formatCount, type AgentStopReason, type ModelKey } from "@foundmill/shared";
import { ApplicationFailure } from "@temporalio/common";
import type { OrchestratorDeps } from "../deps";
import { emitEvent, systemActor } from "../events";
import { templateForAgent } from "./session";
import type { LoadedTrainingRun, SkillTestsOutcome, TrainingBatchInput, TrainingRunInput, TrainingRunResult } from "./types";

type SkillInput = TrainingRunInput & { agentId: string; draftVersionId: string; skillKey: string; modelKey: ModelKey; measuredSkillKey?: string };
type Check = ReturnType<typeof runDeterministicChecks>[number];
/** One arm's pass over a test set: its scores, exact cost and failed checks. */
type ArmTally = { scores: number[]; costMicroMinor: number; checksFailed: number };

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

  function graderRequest(skill: string, test: SkillTest, output: string, checks: Check[], attribution: { businessId: string; agentId: string }) {
    const prompt = getPrompt("skill_grader").render({});
    const payload = {
      skill,
      task: { title: test.task.title, prompt: test.task.prompt },
      rubric: test.rubric.lines.map((l) => ({ criterion: l.criterion, weight: l.weight })),
      deterministic: checks.map((c) => ({ criterion: c.kind, passed: c.passed, detail: c.detail ?? "" })),
      output,
    };
    return { route: "skillGrader" as const, schema: SkillGradeOutput, system: prompt, messages: [{ role: "user" as const, content: `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`` }], scope: `training:${attribution.agentId}`, attribution: { ...attribution, kind: "skill_grader" } };
  }

  /** What every test of one skill needs, read once: the agent, its test set (held-out included) and its system prompt. */
  async function prepareSkill(input: SkillInput) {
    const { db } = deps;
    const [agent, draft, business] = await Promise.all([repos.agents.get(db, input.businessId, input.agentId), repos.agents.getVersion(db, input.businessId, input.draftVersionId), repos.businesses.get(db, input.businessId)]);
    const template = templateForAgent(agent);
    const definition = getSkillDefinition(input.skillKey);
    let tests: SkillTest[];
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
    const instructions = AgentInstructions.safeParse(draft.instructions);
    // The agent as it works: its added skills (library or files) in the index after its instructions (WP-06 T4). A test
    // has no tool loop, so the skill under test and those that improve it are loaded; library skills follow the catalog.
    const added = tests.length ? await repos.skills.listAddedForAgent(db, input.businessId, agent.id, agent.agentType) : [];
    const systemFor = (rows: typeof added) => {
      const skills = selectSkills({ skills: attachedSkills([], rows), ratedSkillKey: input.skillKey, maxBodies: NO_TOOL_LOOP_PRELOAD_BODIES });
      return buildSystemPrompt({ businessName: business.name, appName: APP_NAME, template: { instructions: instructions.success ? instructions.data : template.instructions, description: template.description }, glossary: business.glossary, skills });
    };
    return {
      agent,
      business,
      template,
      definition,
      group: definition?.group ?? ("craft" as const),
      tests,
      custom,
      previousTested,
      added,
      systemFor,
      skillName: definition?.name ?? custom?.name ?? skillDisplayName(input.skillKey),
      route: resolveModel(template.route, input.modelKey),
      sandboxes: new MockSandboxProvider({ speed: Infinity, autoplay: false, holds: { autoResolveAfterMs: 1 } }),
      recording: RECORDINGS.find((r) => r.taskKind === (template.taskKinds[0] ?? "code")) ?? RECORDINGS[0]!,
      attribution: { businessId: input.businessId, agentId: agent.id },
    };
  }
  type PreparedSkill = Awaited<ReturnType<typeof prepareSkill>>;

  /** The system prompt of each arm: one, or two for a skill check (with and without the measured skill). */
  const armSystems = (p: PreparedSkill, measuredSkillKey?: string): string[] => (measuredSkillKey ? [p.systemFor(p.added), p.systemFor(p.added.filter((r) => r.skillKey !== measuredSkillKey))] : [p.systemFor(p.added)]);

  /** The candidate's call for one test: the same body whether it runs now or in a batch. */
  function candidateRequest(p: PreparedSkill, system: string, test: SkillTest) {
    return {
      route: p.template.route,
      system: [system, `## Training\nYou are being tested on "${p.skillName}". Available mock tools: ${test.task.mockTools.join(", ") || "none"}. Answer the task directly.`],
      messages: [{ role: "user" as const, content: `${test.task.prompt}\n\n\`\`\`json\n${JSON.stringify({ task: { id: test.id, title: test.task.title, kind: p.template.taskKinds[0] ?? "ops" }, fixtures: test.task.fixtures })}\n\`\`\`` }],
      modelOverride: p.route.modelKey,
      // The agent's whole system prompt (about 3k tokens) is the same on every test: written once, then read (audit BF-15).
      // The breakpoint sits on it, block 0, so the per-test block after it never forces a new write (WP-09 T9).
      cacheSystem: 0,
      scope: `training:${p.agent.id}`,
      attribution: { ...p.attribution, kind: "training" },
      // A refusal is the candidate's answer here, scored below, never an error that ends the run (WP-09 T5).
      allowRefusal: true,
    } satisfies CompleteRequest;
  }

  /** The sandbox runs the task's tests when the skill has any (mock: canned results per recording), then the deterministic checks. */
  async function checksFor(p: PreparedSkill, test: SkillTest, output: string, trainingRunId: string): Promise<Check[]> {
    let testsPassed: boolean | undefined;
    if (test.checks.some((c) => c.kind === "tests_pass")) {
      const sandbox = (await p.sandboxes.create({ businessId: p.attribution.businessId, taskId: `training-${test.id}`.slice(0, 120), sessionId: `${trainingRunId}:${test.id}`.slice(0, 200), recording: p.recording.key })) as MockSandbox;
      await sandbox.start();
      const res = await sandbox.exec("pnpm test");
      testsPassed = res.code === 0;
      await sandbox.stop();
    }
    let json: unknown;
    try {
      json = JSON.parse(output);
    } catch {
      json = undefined;
    }
    return runDeterministicChecks(test.checks, { output, json, testsPassed, policyViolations: [], toolCalls: [], sourceIds: Object.keys(test.task.fixtures) });
  }

  /**
   * No tests yet: a custom skill without a reviewed test set (BUILD §11.10 "founder reviews before it counts"), or a
   * library or file skill, which carries instructions and no tests. `testsRun` 0 tells `finalizeTrainingRun` to report
   * "No tests yet" and a promotion to leave the rating alone; `tested` only fills the results' column.
   */
  const noTestsOutcome = (p: PreparedSkill, skillKey: string): SkillTestsOutcome => ({ skillKey, group: p.group, testsRun: 0, meanScore: 0, tested: p.previousTested ?? p.template.baselineRating, previousTested: p.previousTested, costMinor: 0, costMicroMinor: 0, checksFailed: 0 });

  /** One skill's outcome from its arms' scores, and the marker row that says how many tests it had. */
  async function skillOutcome(p: PreparedSkill, input: SkillInput, withArm: ArmTally, withoutArm: ArmTally | null, idempotencyKey?: string): Promise<SkillTestsOutcome> {
    const { scores } = withArm;
    const costMicroMinor = withArm.costMicroMinor + (withoutArm?.costMicroMinor ?? 0);
    const checksFailed = withArm.checksFailed + (withoutArm?.checksFailed ?? 0);
    const testsRun = scores.length;
    const meanScore = scores.reduce((a, b) => a + b, 0) / Math.max(1, testsRun);
    // Stopped before any test ran: the rating stands where it was.
    const tested = testsRun > 0 ? ratingFromTested(meanScore) : (p.previousTested ?? p.template.baselineRating);
    // Every answer and every grader call was booked when it ran (`usageSink`, kind `tokens`): this row only says how many
    // tests the skill had, so it carries no cost (the run's total lives on `training_runs.cost_minor`, audit O-19).
    if (testsRun > 0) await repos.usage.record(deps.db, input.businessId, { agentId: p.agent.id, kind: "training", quantity: testsRun, unit: "tests", costMinor: 0, currency: CREDITS_CURRENCY, billedTo: p.business.modelBilling, occurredAt: deps.clock.now(), details: { trainingRunId: input.trainingRunId, skillKey: input.skillKey, label: "Estimate", costBookedPerCall: true }, ...(idempotencyKey ? { idempotencyKey } : {}) });
    // A skill check also rates the arm without the measured skill: the run's "old" figure, so a rating moves only when
    // the skill made the difference (WP-06 T10).
    const baselineTested = withoutArm && withoutArm.scores.length > 0 ? ratingFromTested(withoutArm.scores.reduce((a, b) => a + b, 0) / withoutArm.scores.length) : undefined;
    return { skillKey: input.skillKey, group: p.group, testsRun, meanScore: Math.round(meanScore * 1000) / 1000, tested, previousTested: p.previousTested, costMinor: microToMinor(costMicroMinor), costMicroMinor, checksFailed, ...(baselineTested === undefined ? {} : { baselineTested }) };
  }

  /** The batch path's stop check: true when nothing more may be submitted (the run is canceled first for a stop). */
  async function haltBatch(input: TrainingRunInput): Promise<boolean> {
    const halt = await haltFor(input);
    if (halt?.cancelWith) await cancelForStop(input, halt.cancelWith);
    return halt !== null;
  }

  /** Every candidate call of a batch run, rebuilt the same way by each activity: custom id `c-<skill>-<arm>-<test>`. */
  async function candidateItems(input: TrainingBatchInput) {
    const skills: { skillKey: string; p: PreparedSkill; arms: string[] }[] = [];
    const items: BatchItem[] = [];
    for (const [s, skillKey] of input.skillKeys.entries()) {
      const p = await prepareSkill({ ...input, skillKey });
      const arms = p.tests.length ? armSystems(p, input.measuredSkillKey) : [];
      for (const [a, system] of arms.entries()) for (const [i, test] of p.tests.entries()) items.push({ customId: `c-${s}-${a}-${i}`, request: candidateRequest(p, system, test) });
      skills.push({ skillKey, p, arms });
    }
    return { skills, items };
  }

  /** The collected answers with their checks, and a grader call (`g-<skill>-<arm>-<test>`) for each one not refused. */
  async function gradedTests(input: TrainingRunInput, built: Awaited<ReturnType<typeof candidateItems>>, candidates: readonly BatchItemResult[]) {
    const byId = new Map(candidates.map((c) => [c.customId, c]));
    const tests: { skill: number; arm: number; refused: boolean; checks: Check[]; costMicroMinor: number; gradeId: string }[] = [];
    const gradeItems: BatchItem[] = [];
    for (const [s, skill] of built.skills.entries()) {
      for (const a of skill.arms.keys()) {
        for (const [i, test] of skill.p.tests.entries()) {
          const id = `${s}-${a}-${i}`;
          const c = byId.get(`c-${id}`);
          const refused = c?.ok === false && c.kind === "refusal";
          // An answer that errored or expired is not a test result: it is left out, never scored 0.
          if (!c || (!c.ok && !refused)) continue;
          if (!c.ok || c.result.stopReason === "refusal") {
            tests.push({ skill: s, arm: a, refused: true, checks: [], costMicroMinor: c.ok ? c.result.cost.costMicroMinor : 0, gradeId: `g-${id}` });
            continue;
          }
          const checks = await checksFor(skill.p, test, c.result.text, input.trainingRunId);
          tests.push({ skill: s, arm: a, refused: false, checks, costMicroMinor: c.result.cost.costMicroMinor, gradeId: `g-${id}` });
          gradeItems.push({ customId: `g-${id}`, request: graderRequest(skill.skillKey, test, c.result.text, checks, skill.p.attribution) });
        }
      }
    }
    return { tests, gradeItems };
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
      // A skill check has no draft: it scores the live version with and without one skill.
      const check = run.kind === "skill_check";
      if (!run.toVersionId && !check) throw cannotStart("The run has no draft version to test.");
      const agentRow = await permanent(repos.agents.get(db, input.businessId, run.agentId));
      const candidateId = check ? agentRow.currentVersionId : run.toVersionId;
      if (!candidateId) throw cannotStart("The agent has no live version to check.");
      const [agent, draft] = [agentRow, await permanent(repos.agents.getVersion(db, input.businessId, candidateId))];
      if (check && !run.measuredSkillKey) throw cannotStart("The check names no skill to measure.");
      if (!check && draft.state !== "draft") throw cannotStart(draft.state === "live" ? "The candidate is the live version; training only ever scores a draft." : "The candidate is no longer a draft.");
      const live = run.fromVersionId ? await permanent(repos.agents.getVersion(db, input.businessId, run.fromVersionId)) : agent.currentVersionId ? await permanent(repos.agents.getVersion(db, input.businessId, agent.currentVersionId)) : null;
      const template = templateForAgent(agent);
      const existing = await repos.skills.listForAgent(db, input.businessId, agent.id);
      const skillKeys = run.skillKeys?.length ? run.skillKeys : existing.length > 0 ? existing.map((s) => s.skillKey) : template.skills;
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
        measuredSkillKey: check ? run.measuredSkillKey : null,
        retest: !check && live && draft.createdByKind === "system" && draft.modelKey !== live.modelKey ? { fromModelKey: live.modelKey, toModelKey: draft.modelKey } : null,
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
    async runSkillTests(input: SkillInput): Promise<SkillTestsOutcome> {
      const p = await prepareSkill(input);
      if (p.tests.length === 0) return noTestsOutcome(p, input.skillKey);
      // Exact costs (millionths of a cent) are summed and rounded once, so the run's total is not the sum of roundings.
      let halted: { cancelWith: string | null } | null = null;
      /** One pass over the test set with one system prompt: a skill check makes two (with and without the measured skill). */
      const runArm = async (system: string): Promise<ArmTally> => {
      let costMicroMinor = 0;
      let checksFailed = 0;
      const scores: number[] = [];
      const CONCURRENCY = 4;
      const queue = [...p.tests];
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
          const answer = await deps.models.complete(candidateRequest(p, system, test));
          costMicroMinor += answer.cost.costMicroMinor;
          // The candidate declined (the whole fallback chain said no): the test scores 0 and the grader is not called.
          if (answer.stopReason === "refusal") {
            scores.push(0);
            continue;
          }
          // 2 and 3. the sandbox runs the task's tests, then the deterministic checks, which are authoritative
          const checks = await checksFor(p, test, answer.text, input.trainingRunId);
          checksFailed += checks.filter((c) => !c.passed).length;
          // 4. the grader scores the rubric
          const graded = await deps.models.complete(graderRequest(input.skillKey, test, answer.text, checks, p.attribution));
          costMicroMinor += graded.cost.costMicroMinor;
          scores.push(scoreTest(graded.json.score, checks));
          try {
            const { Context } = await import("@temporalio/activity");
            Context.current().heartbeat({ skill: input.skillKey, done: scores.length, total: p.tests.length });
          } catch {
            /* outside Temporal */
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, p.tests.length) }, worker));
      return { scores, costMicroMinor, checksFailed };
      };
      const [withSystem, withoutSystem] = armSystems(p, input.measuredSkillKey);
      const withArm = await runArm(withSystem!);
      const withoutArm = withoutSystem !== undefined && !halted ? await runArm(withoutSystem) : null;
      const stoppedWith = (halted as { cancelWith: string | null } | null)?.cancelWith;
      if (stoppedWith) await cancelForStop(input, stoppedWith);
      return skillOutcome(p, input, withArm, withoutArm);
    },

    /**
     * The batch path (WP-09 T10): every candidate answer of the run in one half-price batch. Returns null, with nothing
     * submitted, when the team is stopped or the run already ended (the run is canceled for a stop), or when no skill has
     * tests.
     */
    async submitTrainingCandidates(input: TrainingBatchInput): Promise<{ batchId: string | null }> {
      if (await haltBatch(input)) return { batchId: null };
      const { items } = await candidateItems(input);
      if (items.length === 0) return { batchId: null };
      return { batchId: (await submitBatch(deps.models, items)).batchId };
    },

    async trainingBatchEnded(input: { batchId: string; businessId: string }): Promise<boolean> {
      return batchEnded(deps.models, input.batchId, input.businessId);
    },

    /**
     * Runs the deterministic checks on the collected answers and submits the grader calls as a second batch. Returns
     * null, with nothing submitted, when the run ended or the team stopped meanwhile, or when every candidate refused.
     */
    async submitTrainingGrades(input: TrainingBatchInput & { candidateBatchId: string }): Promise<{ batchId: string | null }> {
      if (await haltBatch(input)) return { batchId: null };
      const built = await candidateItems(input);
      const { gradeItems } = await gradedTests(input, built, await collectBatch(deps.models, input.candidateBatchId, built.items));
      if (gradeItems.length === 0) return { batchId: null };
      return { batchId: (await submitBatch(deps.models, gradeItems)).batchId };
    },

    /**
     * Scores every test from the two batches and books each skill's test count once (collecting again books nothing:
     * batch results carry their own idempotency keys, the marker row one per run and skill). A test whose candidate or
     * grade did not come back (errored, expired, or no grader batch because the run ended) is not counted.
     */
    async collectTrainingOutcomes(input: TrainingBatchInput & { candidateBatchId: string | null; graderBatchId: string | null }): Promise<SkillTestsOutcome[]> {
      const built = await candidateItems(input);
      const candidates = input.candidateBatchId ? await collectBatch(deps.models, input.candidateBatchId, built.items) : [];
      const { tests, gradeItems } = await gradedTests(input, built, candidates);
      const grades = new Map((input.graderBatchId && gradeItems.length ? await collectBatch(deps.models, input.graderBatchId, gradeItems) : []).map((g) => [g.customId, g]));
      const outcomes: SkillTestsOutcome[] = [];
      for (const [s, skill] of built.skills.entries()) {
        if (skill.p.tests.length === 0) {
          outcomes.push(noTestsOutcome(skill.p, skill.skillKey));
          continue;
        }
        const arms: ArmTally[] = skill.arms.map(() => ({ scores: [], costMicroMinor: 0, checksFailed: 0 }));
        for (const t of tests.filter((x) => x.skill === s)) {
          const arm = arms[t.arm]!;
          arm.costMicroMinor += t.costMicroMinor;
          if (t.refused) {
            arm.scores.push(0);
            continue;
          }
          const graded = grades.get(t.gradeId);
          if (!graded?.ok) continue;
          arm.costMicroMinor += graded.result.cost.costMicroMinor;
          arm.checksFailed += t.checks.filter((c) => !c.passed).length;
          arm.scores.push(scoreTest((graded.result.json as SkillGradeOutput).score, t.checks));
        }
        outcomes.push(await skillOutcome(skill.p, { ...input, skillKey: skill.skillKey }, arms[0]!, arms[1] ?? null, `training:${input.trainingRunId}:${skill.skillKey}`));
      }
      return outcomes;
    },

    /** Persist results on the run (never on the live version) and narrate through `training.completed`. */
    async finalizeTrainingRun(input: TrainingRunInput & { agentId: string; draftVersionId: string; liveVersionId: string | null; outcomes: SkillTestsOutcome[]; clubRuleFlags: LoadedTrainingRun["clubRuleFlags"]; startedAt: string; status?: "failed" | "cancelled"; error?: string; retest?: LoadedTrainingRun["retest"]; check?: boolean }): Promise<TrainingRunResult> {
      const { db } = deps;
      const run = await repos.training.get(db, input.businessId, input.trainingRunId);
      const results: TrainingRun["results"] = {};
      const skillDeltas: TrainingRunResult["skillDeltas"] = [];
      /** Skills the run found no tests for (a library or file skill): reported as such, never scored at the baseline. */
      const noTests: string[] = [];
      const costMinor = Math.max(0, microToMinor(input.outcomes.reduce((a, o) => a + (o.costMicroMinor ?? o.costMinor * MICRO_PER_MINOR), 0)));
      for (const o of input.outcomes) {
        const before = Math.max(1, Math.min(20, Math.round(o.baselineTested ?? o.previousTested ?? o.tested)));
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
      const intro = input.check ? "Skill check, with and without the skill: " : retest ? `Retest on ${MODEL_NAMES[retest.toModelKey]} after the model change from ${MODEL_NAMES[retest.fromModelKey]}: ` : "";
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
