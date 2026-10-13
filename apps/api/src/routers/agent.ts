/**
 * agent.profile.get/update, agent.training.saveDraft/estimate/run/results/promote/discard/cancel/rollback,
 * agent.model.compare/set, agent.autonomy.set, agent.negotiation.set — all scoped actions accept `applyScope`
 * ("agent" | "type" | "all", BUILD §9.6 ApplyScopeDialog). BUILD §11.10; AC-11.10.1/2/5/6.
 */
import { AgentInstructions, detectClubRuleViolation, deriveTraits, getSkillTests, getTemplateByAgentType, redactHeldOut } from "@foundmill/agents";
import { CREDITS_CURRENCY, LIMITS } from "@foundmill/config";
import { UpdateAgentInput, repos, type Agent } from "@foundmill/db";
import { MODELS, meter, resolveModel } from "@foundmill/models";
import { ForbiddenError, MODEL_KEYS, ValidationError, type ModelKey } from "@foundmill/shared";
import { z } from "zod";
import { modelLimited } from "../services/model-limits";
import { changeAgentModels, routeOf, startModelRetests } from "../services/agent-model";
import { assertAgentsRunning } from "../services/stop-guard";
import { SIGNALS, WORKFLOWS, workflowIds } from "../services/temporal";
import { Id, audit, emit, router, sectionAdmin, sectionRead, sectionWrite, type BusinessContext } from "../trpc";

const read = sectionRead("team");
const write = sectionWrite("team");
/**
 * What widens what an agent may do on its own (autonomy, spend caps, negotiation, tool grants reaching the live version)
 * is an owner's or admin's call, like the business's mode (SEC-7): a member trains and edits, but never raises caps.
 */
const admin = sectionAdmin("team");
const isAdminRole = (ctx: Pick<BusinessContext, "role">) => ctx.role === "owner" || ctx.role === "admin";

export const ApplyScope = z.enum(["agent", "type", "all"]);
const Tools = z.array(z.object({ connectorKey: z.string().min(1), tools: z.array(z.string().min(1)).min(1) }));
/** Caps are bounded (`LIMITS.agentCapMaxMinor`): above it a spend is the founder's to approve, whatever the agent's cap. */
const CapMinor = z.number().int().nonnegative().max(LIMITS.agentCapMaxMinor, "That is above the most an agent may be allowed on its own; approve larger spends yourself");
const Autonomy = z.object({ mode: z.enum(["inherit", "lower", "higher"]).default("inherit"), spendCapMinor: CapMinor.optional(), approvalThresholdMinor: CapMinor.optional() });
const Negotiation = z.object({ enabled: z.boolean(), priceMinMinor: z.number().int().nonnegative().optional(), priceMaxMinor: z.number().int().nonnegative().optional(), walkAwayMinor: z.number().int().nonnegative().optional(), maxConcessionPct: z.number().min(0).max(100).optional(), topics: z.array(z.string().min(1)).default([]) });

async function scopedAgents(ctx: BusinessContext, agentId: string, scope: z.infer<typeof ApplyScope>): Promise<Agent[]> {
  const agent = await repos.agents.get(ctx.db, ctx.businessId, agentId);
  if (scope === "agent") return [agent];
  const all = await repos.agents.list(ctx.db, ctx.businessId, { limit: 500 });
  return scope === "all" ? all.items : all.items.filter((a) => a.agentType === agent.agentType);
}

/** What agent.profile.update may change; every other field has its own procedure and checks (strict: unknown keys are a 400). */
const ProfilePatch = UpdateAgentInput.pick({ name: true, role: true, descriptionMd: true, lineManagerId: true, wageCapMinor: true }).strict();

/** A version's tool grants as a comparable set of `connector:tool` ids. */
export function grantSet(tools: unknown): Set<string> {
  const out = new Set<string>();
  for (const g of Array.isArray(tools) ? tools : []) {
    const grant = g as { connectorKey?: unknown; tools?: unknown };
    if (typeof grant?.connectorKey !== "string" || !Array.isArray(grant.tools)) continue;
    for (const t of grant.tools) if (typeof t === "string") out.add(`${grant.connectorKey}:${t}`);
  }
  return out;
}

/** True when `next` grants something `live` does not (a removal narrows and is anyone's with team write). */
export function widensGrants(live: unknown, next: unknown): boolean {
  const before = grantSet(live);
  for (const g of grantSet(next)) if (!before.has(g) && !before.has(`${g.split(":")[0]}:*`) && !before.has("*:*")) return true;
  return false;
}


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
          wage: { ...spend, currency: CREDITS_CURRENCY, period, label: "Estimate" as const },
          departments: departments.filter((d) => agent.departmentIds.includes(d.id)).map((d) => ({ id: d.id, name: d.name, colourToken: d.colourToken })),
          lineManager: agent.lineManagerId ? await repos.agents.get(tx, ctx.businessId, agent.lineManagerId) : null,
          stars: { current: tested === null ? null : Math.max(1, Math.min(5, Math.round(tested / 4))), potential: potential === null ? null : Math.max(1, Math.min(5, Math.round(potential / 4))) },
          neverDoes: template?.neverDoes ?? [],
          route: routeOf(agent),
          modelLock: resolveModel(routeOf(agent)).locked,
        };
      }),
    ),
    /**
     * The profile's own fields (name, role, description, line manager, wage cap). Autonomy, negotiation, model, status
     * and departments have their own procedures and checks, so a patch carrying them is a 400. The wage cap bounds what
     * the agent may spend on models, so changing it is an owner's or admin's call.
     */
    update: write.input(z.object({ agentId: Id, patch: ProfilePatch })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        if (input.patch.wageCapMinor !== undefined && !isAdminRole(ctx)) throw new ForbiddenError("Only an owner or admin changes an agent's wage cap");
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
        // New tool grants become the session token's allowedTools once promoted: only an owner or admin grants them.
        if (input.tools && !isAdminRole(ctx) && widensGrants(current?.tools, input.tools)) throw new ForbiddenError("Only an owner or admin gives an agent new tools");
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
        // Metered at list prices, so in the price list's currency (USD), never the business's.
        return { tests, skills: skills.length, modelKey, costMinor: Math.round((perTest * tests) / 1_000_000), currency: CREDITS_CURRENCY, durationMinutes: Math.max(2, Math.min(5, Math.ceil(tests / 20))), label: "Estimate" as const };
      }),
    ),

    /** Queue a run on the orchestrator (`trainingRun`); the live version keeps working (AC-11.10.1). */
    run: write.input(z.object({ agentId: Id, versionId: Id })).use(modelLimited("training")).mutation(async ({ ctx, input }) => {
      await assertAgentsRunning(ctx, "a training run");
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

    /** Make a trained version live. A version that grants tools the live one does not is an owner's or admin's to promote. */
    promote: write.input(z.object({ runId: Id })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        if (!isAdminRole(ctx)) {
          const pending = await repos.training.get(tx, ctx.businessId, input.runId);
          const agent = await repos.agents.get(tx, ctx.businessId, pending.agentId);
          const [to, live] = await Promise.all([pending.toVersionId ? repos.agents.getVersion(tx, ctx.businessId, pending.toVersionId) : null, agent.currentVersionId ? repos.agents.getVersion(tx, ctx.businessId, agent.currentVersionId) : null]);
          if (to && widensGrants(live?.tools, to.tools)) throw new ForbiddenError("This version gives the agent new tools; an owner or admin promotes it");
        }
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
          // Predicted from the agent's metered model cost at list prices: US dollars, never the business's currency.
          currency: CREDITS_CURRENCY,
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
     * the new model (never the live version itself, AC-11.10.1), which Promote makes live. Its earlier retests not yet
     * decided are withdrawn (`superseded`), and a change back to the model its live version runs on queues none. While
     * the team is stopped the retests stay queued (`retestsWaitForResume`) and start when the agents resume.
     */
    set: write.input(z.object({ agentId: Id, modelKey: z.enum(MODEL_KEYS), applyScope: ApplyScope.default("agent") })).use(modelLimited("training")).mutation(async ({ ctx, input }) => {
      const targets = await scopedAgents(ctx, input.agentId, input.applyScope);
      const change = await ctx.rls(async (tx) => {
        const c = await changeAgentModels(tx, ctx.businessId, targets, input.modelKey as ModelKey, ctx.userId);
        await audit(tx, ctx, { action: "agent.model.set", target: { kind: "agent", id: input.agentId }, details: { modelKey: input.modelKey, applyScope: input.applyScope, updated: c.updated, skipped: c.skipped, retests: c.retests, superseded: c.superseded } });
        return c;
      });
      // Earlier retests of a model these agents no longer run were canceled above; those still running stop too.
      // The model itself changes while the team is stopped (it costs nothing), but a retest spends credits: it waits,
      // queued, until the agents resume (Resume agents, a new key or a top-up start it; killswitch.ts).
      const waitForResume = change.retests.length > 0 && (await repos.businesses.agentsStopped(ctx.db, ctx.businessId));
      const retests = await startModelRetests(ctx.temporal, ctx.businessId, change, { waitForResume });
      return { updated: change.updated, skipped: change.skipped, warnings: change.warnings, retests, superseded: change.superseded, retestsWaitForResume: waitForResume };
    }),
  }),

  autonomy: router({
    set: admin.input(z.object({ agentId: Id, autonomy: Autonomy, applyScope: ApplyScope.default("agent") })).mutation(async ({ ctx, input }) => {
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
    set: admin.input(z.object({ agentId: Id, negotiation: Negotiation, applyScope: ApplyScope.default("agent") })).mutation(async ({ ctx, input }) => {
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
