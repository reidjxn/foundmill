/**
 * agent.profile.get/update, agent.training.saveDraft/estimate/run/results/promote/discard/cancel/rollback,
 * agent.model.compare/set, agent.autonomy.set, agent.negotiation.set — all scoped actions accept `applyScope`
 * ("agent" | "type" | "all", BUILD §9.6 ApplyScopeDialog). BUILD §11.10; AC-11.10.1/2/5/6.
 */
import { AgentInstructions, detectClubRuleViolation, deriveTraits, getSkillTests, getTemplateByAgentType, redactHeldOut } from "@foundmill/agents";
import { LIMITS } from "@foundmill/config";
import { UpdateAgentInput, repos, type Agent } from "@foundmill/db";
import { MODELS, meter, resolveModel, type RouteKey } from "@foundmill/models";
import { MODEL_KEYS, ValidationError, type ModelKey } from "@foundmill/shared";
import { z } from "zod";
import { SIGNALS, WORKFLOWS, workflowIds } from "../services/temporal";
import { Id, audit, emit, router, sectionRead, sectionWrite, type BusinessContext } from "../trpc";

const read = sectionRead("team");
const write = sectionWrite("team");

export const ApplyScope = z.enum(["agent", "type", "all"]);
const Tools = z.array(z.object({ connectorKey: z.string().min(1), tools: z.array(z.string().min(1)).min(1) }));
const Autonomy = z.object({ mode: z.enum(["inherit", "lower", "higher"]).default("inherit"), spendCapMinor: z.number().int().nonnegative().optional(), approvalThresholdMinor: z.number().int().nonnegative().optional() });
const Negotiation = z.object({ enabled: z.boolean(), priceMinMinor: z.number().int().nonnegative().optional(), priceMaxMinor: z.number().int().nonnegative().optional(), walkAwayMinor: z.number().int().nonnegative().optional(), maxConcessionPct: z.number().min(0).max(100).optional(), topics: z.array(z.string().min(1)).default([]) });

async function scopedAgents(ctx: BusinessContext, agentId: string, scope: z.infer<typeof ApplyScope>): Promise<Agent[]> {
  const agent = await repos.agents.get(ctx.db, ctx.businessId, agentId);
  if (scope === "agent") return [agent];
  const all = await repos.agents.list(ctx.db, ctx.businessId, { limit: 500 });
  return scope === "all" ? all.items : all.items.filter((a) => a.agentType === agent.agentType);
}

const routeOf = (agent: Agent): RouteKey => getTemplateByAgentType(agent.agentType)?.route ?? "worker";

/** Reference usage per test for the wage estimate: ~4k input / 1.2k output tokens plus an Opus grading pass. */
const REFERENCE_TEST_USAGE = { inputTokens: 4_000, outputTokens: 1_200, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
const REFERENCE_GRADE_USAGE = { inputTokens: 2_500, outputTokens: 400, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };

export const agentRouter = router({
  profile: router({
    get: read.input(z.object({ agentId: Id })).query(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const agent = await repos.agents.get(tx, ctx.businessId, input.agentId);
        const period = new Date().toISOString().slice(0, 7);
        const [versions, skills, metrics, runs, sessions, spend, departments] = await Promise.all([
          repos.agents.listVersions(tx, ctx.businessId, agent.id),
          repos.skills.listForAgent(tx, ctx.businessId, agent.id),
          repos.agents.metrics(tx, ctx.businessId, agent.id, {}),
          repos.training.list(tx, ctx.businessId, { agentId: agent.id, limit: 20 }),
          repos.agents.listSessions(tx, ctx.businessId, { agentId: agent.id, limit: 10 }),
          repos.usage.agentSpend(tx, ctx.businessId, agent.id, period),
          repos.departments.list(tx, ctx.businessId),
        ]);
        const current = versions.find((v) => v.id === agent.currentVersionId) ?? null;
        const parsed = current ? AgentInstructions.safeParse(current.instructions) : null;
        const traits = parsed?.success ? deriveTraits(parsed.data) : [];
        const template = getTemplateByAgentType(agent.agentType) ?? null;
        const tested = skills.length ? skills.reduce((s, k) => s + Number(k.tested ?? 0), 0) / skills.length : null;
        const potential = skills.length ? Math.max(...skills.map((k) => k.potential)) : null;
        return {
          agent,
          current,
          versions,
          skills,
          traits,
          metrics,
          trainingRuns: runs.items,
          sessions: sessions.items,
          wage: { ...spend, period, label: "Estimate" as const },
          departments: departments.filter((d) => agent.departmentIds.includes(d.id)).map((d) => ({ id: d.id, name: d.name, colourToken: d.colourToken })),
          lineManager: agent.lineManagerId ? await repos.agents.get(tx, ctx.businessId, agent.lineManagerId) : null,
          stars: { current: tested === null ? null : Math.max(1, Math.min(5, Math.round(tested / 4))), potential: potential === null ? null : Math.max(1, Math.min(5, Math.round(potential / 4))) },
          neverDoes: template?.neverDoes ?? [],
          route: routeOf(agent),
          modelLock: resolveModel(routeOf(agent)).locked,
        };
      }),
    ),
    update: write.input(z.object({ agentId: Id, patch: UpdateAgentInput })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const agent = await repos.agents.update(tx, ctx.businessId, input.agentId, input.patch);
        await audit(tx, ctx, { action: "agent.profile.update", target: { kind: "agent", id: agent.id }, details: { fields: Object.keys(input.patch) } });
        return agent;
      }),
    ),
  }),

  training: router({
    /** Draft version from the structured editor; club-rule contradictions are flagged and have no effect (AC-11.10.4). */
    saveDraft: write.input(z.object({ agentId: Id, instructions: AgentInstructions, tools: Tools.optional(), modelKey: z.enum(MODEL_KEYS).optional(), comment: z.string().max(2000).optional() })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const agent = await repos.agents.get(tx, ctx.businessId, input.agentId);
        const current = agent.currentVersionId ? await repos.agents.getVersion(tx, ctx.businessId, agent.currentVersionId) : null;
        const before = current ? AgentInstructions.safeParse(current.instructions) : null;
        const detection = detectClubRuleViolation(before?.success ? { before: before.data, after: input.instructions } : { before: input.instructions, after: input.instructions });
        const version = await repos.agents.createVersion(tx, ctx.businessId, agent.id, { instructions: input.instructions, tools: input.tools ?? (current?.tools as unknown[] | undefined) ?? [], modelKey: input.modelKey ?? agent.modelKey, state: "draft", createdByKind: "user", createdBy: ctx.userId });
        await audit(tx, ctx, { action: "agent.training.save_draft", target: { kind: "agent_version", id: version.id }, details: { agentId: agent.id, flagged: detection.flagged, violations: detection.violations.length, comment: input.comment ?? null } });
        return { version, violations: detection.violations, flagged: detection.flagged };
      }),
    ),

    /** Cost and duration estimate for a training run (labelled Estimate; held-out tests counted, never returned). */
    estimate: read.input(z.object({ agentId: Id, modelKey: z.enum(MODEL_KEYS).optional() })).query(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const agent = await repos.agents.get(tx, ctx.businessId, input.agentId);
        const skills = await repos.skills.listForAgent(tx, ctx.businessId, agent.id);
        const modelKey = input.modelKey ?? agent.modelKey;
        let tests = 0;
        for (const s of skills) tests += getSkillTests(s.skillKey, { includeHeldOut: true }).length;
        const perTest = meter(REFERENCE_TEST_USAGE, MODELS[modelKey]).costMicroMinor + meter(REFERENCE_GRADE_USAGE, MODELS.opus).costMicroMinor;
        return { tests, skills: skills.length, modelKey, costMinor: Math.round((perTest * tests) / 1_000_000), durationMinutes: Math.max(2, Math.min(5, Math.ceil(tests / 20))), label: "Estimate" as const };
      }),
    ),

    /** Queue a run on the orchestrator (`trainingRun`); the live version keeps working (AC-11.10.1). */
    run: write.input(z.object({ agentId: Id, versionId: Id })).mutation(async ({ ctx, input }) => {
      const run = await ctx.rls(async (tx) => {
        const agent = await repos.agents.get(tx, ctx.businessId, input.agentId);
        const version = await repos.agents.getVersion(tx, ctx.businessId, input.versionId);
        if (version.agentId !== agent.id) throw new ValidationError("Version belongs to another agent");
        if (version.state !== "draft") throw new ValidationError("Only a draft version can be trained");
        const r = await repos.training.create(tx, ctx.businessId, { agentId: agent.id, fromVersionId: agent.currentVersionId, toVersionId: version.id, status: "queued", requestedBy: ctx.userId });
        await audit(tx, ctx, { action: "agent.training.run", target: { kind: "training_run", id: r.id }, details: { agentId: agent.id, versionId: version.id } });
        return r;
      });
      const workflow = await ctx.temporal.start(WORKFLOWS.trainingRun, { workflowId: workflowIds.training(run.id), args: [{ businessId: ctx.businessId, trainingRunId: run.id }] });
      return { run, workflow };
    }),

    /** Results old → new per skill; held-out tests are redacted (AC-11.10.2). */
    results: read.input(z.object({ runId: Id })).query(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const run = await repos.training.get(tx, ctx.businessId, input.runId);
        const skills = await repos.skills.listForAgent(tx, ctx.businessId, run.agentId);
        const publicTests = Object.fromEntries(skills.map((s) => [s.skillKey, redactHeldOut(getSkillTests(s.skillKey, { includeHeldOut: true })).length]));
        const results = (run.results ?? {}) as Record<string, { old: number; new: number }>;
        const deltas = Object.entries(results).map(([skillKey, r]) => ({ skillKey, old: r.old, new: r.new, delta: r.new - r.old, drop: r.old - r.new > 1 }));
        return { run, deltas, publicTestCounts: publicTests, coachSummaryMd: run.coachSummaryMd };
      }),
    ),

    promote: write.input(z.object({ runId: Id })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const watchUntil = new Date(Date.now() + LIMITS.rollbackWatchDays * 86_400_000);
        const run = await repos.training.decide(tx, ctx.businessId, input.runId, "promoted", { watchUntil });
        const version = await repos.agents.getVersion(tx, ctx.businessId, run.toVersionId!);
        await emit(tx, ctx, { type: "agent.promoted", payload: { agentId: run.agentId, trainingRunId: run.id, fromVersionId: run.fromVersionId, toVersionId: version.id, version: version.version, watchUntil: watchUntil.toISOString(), rollback: false } });
        await audit(tx, ctx, { action: "agent.training.promote", target: { kind: "training_run", id: run.id }, details: { agentId: run.agentId, versionId: version.id } });
        return run;
      }),
    ),

    discard: write.input(z.object({ runId: Id })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const run = await repos.training.decide(tx, ctx.businessId, input.runId, "discarded");
        await audit(tx, ctx, { action: "agent.training.discard", target: { kind: "training_run", id: run.id }, details: { agentId: run.agentId } });
        return run;
      }),
    ),

    /**
     * Stop a queued or running run. The row is canceled at once, so a run no worker will pick up (Temporal down, a
     * worker lost) never holds the agent's Train button; a workflow still running gets `stop` and finishes the tests in
     * flight. The live version is untouched.
     */
    cancel: write.input(z.object({ runId: Id })).mutation(async ({ ctx, input }) => {
      const run = await ctx.rls(async (tx) => {
        const r = await repos.training.cancel(tx, ctx.businessId, input.runId);
        await audit(tx, ctx, { action: "agent.training.cancel", target: { kind: "training_run", id: r.id }, details: { agentId: r.agentId, versionId: r.toVersionId } });
        return r;
      });
      const workflow = await ctx.temporal.signal(workflowIds.training(run.id), SIGNALS.stop);
      return { run, workflow };
    }),

    /** One-click rollback to the previous live version (AC-11.10.6). */
    rollback: write.input(z.object({ agentId: Id })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const agent = await repos.agents.get(tx, ctx.businessId, input.agentId);
        const versions = await repos.agents.listVersions(tx, ctx.businessId, agent.id);
        const current = versions.find((v) => v.id === agent.currentVersionId);
        const previous = versions.filter((v) => v.id !== agent.currentVersionId && v.state === "retired" && (!current || v.version < current.version)).sort((a, b) => b.version - a.version)[0];
        if (!previous) throw new ValidationError("No previous live version to roll back to");
        const rolled = await repos.agents.rollback(tx, ctx.businessId, agent.id, previous.id);
        const watchUntil = new Date(Date.now() + LIMITS.rollbackWatchDays * 86_400_000);
        await emit(tx, ctx, { type: "agent.promoted", payload: { agentId: agent.id, trainingRunId: null, fromVersionId: agent.currentVersionId, toVersionId: previous.id, version: previous.version, watchUntil: watchUntil.toISOString(), rollback: true } });
        await audit(tx, ctx, { action: "agent.training.rollback", target: { kind: "agent", id: agent.id }, details: { from: agent.currentVersionId, to: previous.id } });
        return rolled;
      }),
    ),
  }),

  model: router({
    /** Predicted wage delta per model (pricing config, Estimate); skill deltas come only from a real preview run. */
    compare: read.input(z.object({ agentId: Id })).query(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const agent = await repos.agents.get(tx, ctx.businessId, input.agentId);
        const route = routeOf(agent);
        const spend = await repos.usage.agentSpend(tx, ctx.businessId, agent.id, new Date().toISOString().slice(0, 7));
        const reference = meter(REFERENCE_TEST_USAGE, MODELS[agent.modelKey]).costMicroMinor || 1;
        return {
          current: agent.modelKey,
          locked: resolveModel(route).locked,
          options: MODEL_KEYS.map((modelKey) => {
            const r = resolveModel(route, modelKey);
            const ratio = meter(REFERENCE_TEST_USAGE, MODELS[modelKey]).costMicroMinor / reference;
            return { modelKey, modelId: MODELS[modelKey], allowed: !r.locked || r.modelKey === modelKey, warning: r.warning ?? null, predictedWageMinor: Math.round(spend.costMinor * ratio), predictedSkillDelta: null, label: "Estimate" as const };
          }),
        };
      }),
    ),

    /**
     * Change the model for the agent, every agent of its type, or all; locked routes are skipped; retests are queued
     * (AC-11.10.5). The change applies at once; each changed agent's retest scores a draft copy of its live version on
     * the new model (never the live version itself, AC-11.10.1), which Promote makes live.
     */
    set: write.input(z.object({ agentId: Id, modelKey: z.enum(MODEL_KEYS), applyScope: ApplyScope.default("agent") })).mutation(async ({ ctx, input }) => {
      const targets = await scopedAgents(ctx, input.agentId, input.applyScope);
      const updated: string[] = [];
      const skipped: { agentId: string; reason: string }[] = [];
      const warnings: string[] = [];
      const retests: string[] = [];
      const superseded: string[] = [];
      await ctx.rls(async (tx) => {
        for (const agent of targets) {
          const r = resolveModel(routeOf(agent), input.modelKey as ModelKey);
          if (r.locked && r.modelKey !== input.modelKey) {
            skipped.push({ agentId: agent.id, reason: r.warning ?? "this work is locked to one model" });
            continue;
          }
          if (r.warning) warnings.push(`${agent.name}: ${r.warning}`);
          await repos.agents.setModel(tx, ctx.businessId, agent.id, input.modelKey);
          updated.push(agent.id);
          // An agent already on this model has nothing new to retest.
          if (agent.modelKey === input.modelKey) continue;
          const retest = await repos.training.createModelRetest(tx, ctx.businessId, agent.id, { modelKey: input.modelKey, requestedBy: ctx.userId });
          if (!retest) continue;
          retests.push(retest.run.id);
          superseded.push(...retest.superseded.map((r) => r.id));
        }
        await audit(tx, ctx, { action: "agent.model.set", target: { kind: "agent", id: input.agentId }, details: { modelKey: input.modelKey, applyScope: input.applyScope, updated, skipped, retests, superseded } });
      });
      // Earlier retests of a model these agents no longer run were canceled above; their workflows stop too.
      if (superseded.length) await ctx.temporal.signalMany(superseded.map((runId) => workflowIds.training(runId)), SIGNALS.stop);
      const workflows = await Promise.all(retests.map((runId) => ctx.temporal.start(WORKFLOWS.trainingRun, { workflowId: workflowIds.training(runId), args: [{ businessId: ctx.businessId, trainingRunId: runId }] })));
      return { updated, skipped, warnings, retests: retests.map((runId, i) => ({ runId, workflow: workflows[i]! })), superseded };
    }),
  }),

  autonomy: router({
    set: write.input(z.object({ agentId: Id, autonomy: Autonomy, applyScope: ApplyScope.default("agent") })).mutation(async ({ ctx, input }) => {
      const targets = await scopedAgents(ctx, input.agentId, input.applyScope);
      return ctx.rls(async (tx) => {
        for (const a of targets) await repos.agents.setAutonomy(tx, ctx.businessId, a.id, { ...(a.autonomy as Record<string, unknown>), ...input.autonomy });
        await audit(tx, ctx, { action: "agent.autonomy.set", target: { kind: "agent", id: input.agentId }, details: { applyScope: input.applyScope, agents: targets.map((a) => a.id), autonomy: input.autonomy } });
        return { updated: targets.map((a) => a.id) };
      });
    }),
  }),

  negotiation: router({
    /** Off by default; when on, limits are mandatory and final terms/signing/payment stay hard-gated (BUILD §9.6). */
    set: write.input(z.object({ agentId: Id, negotiation: Negotiation, applyScope: ApplyScope.default("agent") })).mutation(async ({ ctx, input }) => {
      if (input.negotiation.enabled && (input.negotiation.walkAwayMinor === undefined || (input.negotiation.priceMinMinor === undefined && input.negotiation.priceMaxMinor === undefined))) {
        throw new ValidationError("Set a walk-away and a price limit before enabling negotiation");
      }
      const targets = await scopedAgents(ctx, input.agentId, input.applyScope);
      return ctx.rls(async (tx) => {
        for (const a of targets) await repos.agents.setNegotiation(tx, ctx.businessId, a.id, input.negotiation);
        await audit(tx, ctx, { action: "agent.negotiation.set", target: { kind: "agent", id: input.agentId }, details: { applyScope: input.applyScope, agents: targets.map((a) => a.id), enabled: input.negotiation.enabled } });
        return { updated: targets.map((a) => a.id) };
      });
    }),
  }),
});
