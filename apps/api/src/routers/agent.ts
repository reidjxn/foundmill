/**
 * agent.profile.get/update, agent.training.saveDraft/estimate/run/results/promote/discard/cancel/rollback,
 * agent.model.compare/set, agent.autonomy.set, agent.negotiation.set — all scoped actions accept `applyScope`
 * ("agent" | "type" | "all", BUILD §9.6 ApplyScopeDialog). BUILD §11.10; AC-11.10.1/2/5/6.
 */
import { AgentInstructions, CUSTOM_SKILL_TEST_COUNT, CustomSkillTestsOutput, HOUSE_STYLE, customSkillKey, detectClubRuleViolation, isCustomSkillKey, deriveTraits, getPrompt, getSkillDefinition, getSkillTests, getTemplateByAgentType, redactHeldOut, storedCustomTest } from "@foundmill/agents";
import { CREDITS_CURRENCY, LIMITS } from "@foundmill/config";
import { UpdateAgentInput, periodOf, repos, type Agent, type AgentVersion, type Executor } from "@foundmill/db";
import { MODELS, meter, resolveModel, type RouteKey } from "@foundmill/models";
import { ConflictError, ForbiddenError, isAdminRole as isAdminMembershipRole, MODEL_KEYS, ValidationError, type ModelKey } from "@foundmill/shared";
import { z } from "zod";
import { modelLimited } from "../services/model-limits";
import { changeAgentModels, routeOf, startModelRetests } from "../services/agent-model";
import { SkillChoice, addedSkillView, attachSkills, detachSkill, resolveSkillChoice } from "../services/skills";
import { shownToolGrants } from "../services/squad";
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
const isAdminRole = (ctx: Pick<BusinessContext, "role">) => isAdminMembershipRole(ctx.role);

export const ApplyScope = z.enum(["agent", "type", "all"]);
const Tools = z.array(z.object({ connectorKey: z.string().min(1), tools: z.array(z.string().min(1)).min(1) }));
/** Caps are bounded (`LIMITS.agentCapMaxMinor`): above it a spend is the founder's to approve, whatever the agent's cap. */
const CapMinor = z.number().int().nonnegative().max(LIMITS.agentCapMaxMinor, "That is above the most an agent may be allowed on its own; approve larger spends yourself");
const Autonomy = z.object({ mode: z.enum(["inherit", "lower", "higher"]).default("inherit"), spendCapMinor: CapMinor.optional(), approvalThresholdMinor: CapMinor.optional() });
const Negotiation = z.object({ enabled: z.boolean(), priceMinMinor: z.number().int().nonnegative().optional(), priceMaxMinor: z.number().int().nonnegative().optional(), walkAwayMinor: z.number().int().nonnegative().optional(), maxConcessionPct: z.number().min(0).max(100).optional(), topics: z.array(z.string().min(1)).default([]) });

/** The agents a scoped change applies to; a released agent keeps its profile as a record and takes no changes. */
async function scopedAgents(ctx: BusinessContext, agentId: string, scope: z.infer<typeof ApplyScope>): Promise<Agent[]> {
  const agent = await repos.agents.get(ctx.db, ctx.businessId, agentId);
  if (agent.archivedAt) throw new ValidationError(`${agent.name} has left the team; its profile is kept as a record`);
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

/**
 * The grants a version runs with, as the orchestrator reads them (`parseGrants`): a system-written version 1, or a
 * version with no tools, follows its template.
 */
function runningGrants(version: Pick<AgentVersion, "version" | "createdByKind" | "tools"> | undefined, templateTools: unknown): unknown {
  const followsTemplate = !version || (version.version === 1 && version.createdByKind === "system");
  if (followsTemplate || !Array.isArray(version.tools) || version.tools.length === 0) return templateTools ?? [];
  return version.tools;
}

/** Reference usage per test for the wage estimate: ~4k input / 1.2k output tokens plus an Opus grading pass. */
const REFERENCE_TEST_USAGE = { inputTokens: 4_000, outputTokens: 1_200, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
const REFERENCE_GRADE_USAGE = { inputTokens: 2_500, outputTokens: 400, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
/**
 * A typical month of work for an agent with no usage to go on yet (a new hire, the first days of a month): about 60
 * sessions of ~40k input and ~6k output tokens. Only ever shown as an Estimate, so model options still differ.
 */
const REFERENCE_SESSION_USAGE = { inputTokens: 40_000, outputTokens: 6_000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
const REFERENCE_SESSIONS_PER_MONTH = 60;

/**
 * How many tests a skill is scored on (held-out ones counted, never shown, AC-11.10.2): the platform catalog's, or a
 * custom skill's tests the founder reviewed. A key with neither has none (it does not count yet). Pass the service
 * connection, outside any RLS transaction: RLS hides held-out rows from app roles, so only it can count them (their
 * content never leaves this function).
 */
async function skillTestCount(db: Executor, businessId: string, agentType: string, skillKey: string): Promise<number> {
  if (!isCustomSkillKey(skillKey)) {
    try {
      return redactHeldOut(getSkillTests(skillKey, { includeHeldOut: true })).length;
    } catch {
      return 0;
    }
  }
  const definition = await repos.skills.findDefinition(db, businessId, agentType, skillKey);
  return definition ? (await repos.skills.listTests(db, businessId, definition.id, { reviewedOnly: true })).length : 0;
}

type SkillTestRow = Extract<Awaited<ReturnType<typeof repos.skills.listTests>>[number], { task: unknown }>;

/** A drafted custom test as the founder reviews it: its title, the task as assigned and the rubric lines. */
function reviewDraft(t: SkillTestRow): { id: string; title: string; prompt: string; rubric: string[] } {
  const task = (t.task ?? {}) as { title?: unknown; prompt?: unknown };
  const lines = ((t.rubric ?? {}) as { lines?: { criterion?: unknown }[] }).lines ?? [];
  return { id: t.id, title: String(task.title ?? ""), prompt: String(task.prompt ?? ""), rubric: lines.map((l) => String(l.criterion ?? "")).filter(Boolean) };
}

/** At least one visible test for the founder to review and one held out for training to score blind (the prompt asks for half). */
function withHeldOutSplit(tests: CustomSkillTestsOutput["tests"]): CustomSkillTestsOutput["tests"] {
  if (tests.some((t) => t.heldOut) && tests.some((t) => !t.heldOut)) return tests;
  return tests.map((t, i) => ({ ...t, heldOut: i % 2 === 1 }));
}

/** Agent negotiation has no runtime yet: the setting cannot be switched on (AC-11.14.3 arrives with LIVE B2B). */
export const NEGOTIATION_UNAVAILABLE = "Negotiation is not available yet; it arrives with LIVE business-to-business deals";

/** The profile's activity strip covers the last 30 days, today included. */
const RECENT_DAYS = 30;
const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "period is YYYY-MM");

export const agentRouter = router({
  profile: router({
    /**
     * The profile. `period` is the month the viewer is in (YYYY-MM, from their own time zone; billing months are UTC
     * calendar months) so the wage never jumps to next month's empty figure before the viewer's month ends; omitted, it
     * is the current UTC month, evaluated per request. The 30-day strip (`recent`, `metrics`) is computed from the
     * agent's own sessions, usage and approvals, so it agrees with the sessions listed and the wage.
     */
    get: read.input(z.object({ agentId: Id, period: Period.optional() })).query(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const agent = await repos.agents.get(tx, ctx.businessId, input.agentId);
        const period = input.period ?? periodOf(new Date());
        const to = new Date();
        const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) - (RECENT_DAYS - 1) * 86_400_000);
        const [storedVersions, skills, rolled, daily, runs, sessions, spend, departments] = await Promise.all([
          repos.agents.listVersions(tx, ctx.businessId, agent.id),
          repos.skills.listForAgent(tx, ctx.businessId, agent.id),
          repos.agents.metrics(tx, ctx.businessId, agent.id, { from: from.toISOString().slice(0, 10) }),
          repos.agents.dailyActivity(tx, ctx.businessId, agent.id, { from, to: new Date(to.getTime() + 1) }),
          repos.training.list(tx, ctx.businessId, { agentId: agent.id, limit: 20 }),
          repos.agents.listSessions(tx, ctx.businessId, { agentId: agent.id, limit: 10 }),
          repos.usage.agentSpend(tx, ctx.businessId, agent.id, period),
          repos.departments.list(tx, ctx.businessId),
        ]);
        const [tasks, lineManager] = await Promise.all([
          repos.tasks.summaries(tx, ctx.businessId, sessions.items.map((s) => s.taskId).filter((t): t is string => t !== null)),
          agent.lineManagerId ? repos.agents.byIds(tx, ctx.businessId, [agent.lineManagerId]).then((rows) => rows[0] ?? null) : null,
        ]);
        // The profile shows only tools that exist (`shownToolGrants`): a version stored before Nov 11, 2026 may still
        // hold grants on connectors that were never built. The rows keep what they hold; a draft saved from the Tools
        // tab starts from what is shown.
        const versions = storedVersions.map((v) => ({ ...v, tools: shownToolGrants(v.tools) }));
        const current = versions.find((v) => v.id === agent.currentVersionId) ?? null;
        const parsed = current ? AgentInstructions.safeParse(current.instructions) : null;
        const traits = parsed?.success ? deriveTraits(parsed.data) : [];
        const template = getTemplateByAgentType(agent.agentType) ?? null;
        // The business's own skills (custom, library, files) read under the name the founder gave or chose.
        const ownKeys = skills.filter((k) => !getSkillDefinition(k.skillKey)).map((k) => k.skillKey);
        const definitions = ownKeys.length ? (await repos.skills.listDefinitions(tx, ctx.businessId, { agentType: agent.agentType })).filter((d) => d.businessId === ctx.businessId && ownKeys.includes(d.skillKey)) : [];
        // The header's stars: the mean of the tested ratings, over the skills that have one (an untested library or
        // file skill is not a zero), and the best potential.
        const testedValues = skills.flatMap((k) => (k.tested === null ? [] : [Number(k.tested)]));
        const tested = testedValues.length ? testedValues.reduce((s, v) => s + v, 0) / testedValues.length : null;
        const potential = skills.length ? Math.max(...skills.map((k) => k.potential)) : null;
        // One row per day with activity; review findings come only from the nightly roll-up, the rest from the rows.
        const metrics = daily.map((d) => {
          const roll = rolled.find((m) => m.day === d.day);
          return { day: d.day, tasksDone: d.tasksDone, sessions: d.sessions, failed: d.failed, successRate: d.sessions ? d.tasksDone / d.sessions : null, reviewFindings: roll?.reviewFindings ?? 0, approvalsRejected: d.approvalsRejected, costMinor: d.costMinor };
        });
        const sum = (k: "tasksDone" | "sessions" | "failed" | "reviewFindings" | "approvalsRejected" | "costMinor") => metrics.reduce((s, m) => s + m[k], 0);
        const recent = { days: RECENT_DAYS, from: from.toISOString().slice(0, 10), tasksDone: sum("tasksDone"), sessions: sum("sessions"), failed: sum("failed"), successRate: sum("sessions") ? sum("tasksDone") / sum("sessions") : null, reviewFindings: sum("reviewFindings"), approvalsRejected: sum("approvalsRejected"), costMinor: sum("costMinor"), currency: CREDITS_CURRENCY, label: "Estimate" as const };
        const owner = lineManager ? null : await repos.memberships.owner(tx, ctx.businessId);
        return {
          agent,
          current,
          versions,
          skills: skills.map((k) => {
            const d = definitions.find((x) => x.skillKey === k.skillKey);
            // The name a person reads: the business's own definition, else the platform catalogue's ("Prioritization"), so a
            // client without the catalogue (the mobile app) never shows a key or a blank.
            return { ...k, name: d?.name ?? getSkillDefinition(k.skillKey)?.name ?? null, source: d?.source ?? (d?.custom ? ("custom" as const) : null) };
          }),
          traits,
          metrics,
          recent,
          trainingRuns: runs.items,
          sessions: sessions.items.map((s) => {
            const task = s.taskId ? tasks.find((t) => t.id === s.taskId) : undefined;
            return { ...s, task: task ? { id: task.id, title: task.title, status: task.status } : null };
          }),
          wage: { ...spend, currency: CREDITS_CURRENCY, period, label: "Estimate" as const },
          departments: departments.filter((d) => agent.departmentIds.includes(d.id)).map((d) => ({ id: d.id, name: d.name, colourToken: d.colourToken })),
          lineManager: lineManager ? { id: lineManager.id, name: lineManager.name, role: lineManager.role, personaKey: lineManager.personaKey, archivedAt: lineManager.archivedAt } : null,
          /** No agent line manager: the agent reports to the business's owner (the founder); "You" only for that person. */
          reportsToOwner: owner ? { userId: owner.userId, isViewer: owner.userId === ctx.userId } : null,
          stars: { current: tested === null ? null : Math.max(1, Math.min(5, Math.round(tested / 4))), potential: potential === null ? null : Math.max(1, Math.min(5, Math.round(potential / 4))) },
          neverDoes: template?.neverDoes ?? [],
          route: routeOf(agent),
          modelLock: resolveModel(routeOf(agent)).locked,
        };
      }),
    ),

    /**
     * The founder's edits to the profile (name, role, description, line manager, wage cap). Status, departments,
     * autonomy and negotiation have their own procedures and checks, so they are refused here (400), as is a patch
     * that changes nothing. A line manager must be a live agent of the business that does not report to this one.
     */
    update: write.input(z.object({ agentId: Id, patch: ProfilePatch })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const before = await repos.agents.get(tx, ctx.businessId, input.agentId);
        if (before.archivedAt) throw new ValidationError(`${before.name} has left the team; its profile is kept as a record`);
        if (input.patch.wageCapMinor !== undefined && !isAdminRole(ctx)) throw new ForbiddenError("Only an owner or admin changes an agent's wage cap");
        const agent = await repos.agents.update(tx, ctx.businessId, input.agentId, input.patch);
        await audit(tx, ctx, { action: "agent.profile.update", target: { kind: "agent", id: agent.id }, details: { fields: Object.keys(input.patch), ...(input.patch.lineManagerId !== undefined ? { lineManagerId: { from: before.lineManagerId, to: input.patch.lineManagerId } } : {}) } });
        return agent;
      }),
    ),
  }),

  training: router({
    /** Draft version from the structured editor; club-rule contradictions are flagged and have no effect (AC-11.10.4). */
    saveDraft: write.input(z.object({ agentId: Id, instructions: AgentInstructions, tools: Tools.optional(), modelKey: z.enum(MODEL_KEYS).optional(), comment: z.string().max(2000).optional() })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const agent = await repos.agents.get(tx, ctx.businessId, input.agentId);
        if (agent.archivedAt) throw new ValidationError(`${agent.name} has left the team; its profile is kept as a record`);
        const current = agent.currentVersionId ? await repos.agents.getVersion(tx, ctx.businessId, agent.currentVersionId) : null;
        const before = current ? AgentInstructions.safeParse(current.instructions) : null;
        // New tool grants become the session token's allowedTools once promoted: only an owner or admin grants them. Both
        // sides are read as sessions read them: an empty list (or a system-written version 1) means the template's tools.
        if (input.tools && !isAdminRole(ctx)) {
          const templateTools = getTemplateByAgentType(agent.agentType)?.tools;
          // The draft is a user-written version after the live one, never a system-written version 1.
          const draft = { version: (current?.version ?? 0) + 1, createdByKind: "user" as const, tools: input.tools };
          if (widensGrants(runningGrants(current ?? undefined, templateTools), runningGrants(draft, templateTools))) throw new ForbiddenError("Only an owner or admin gives an agent new tools");
        }
        const detection = detectClubRuleViolation(before?.success ? { before: before.data, after: input.instructions } : { before: input.instructions, after: input.instructions });
        const version = await repos.agents.createVersion(tx, ctx.businessId, agent.id, { instructions: input.instructions, tools: input.tools ?? (current?.tools as unknown[] | undefined) ?? [], modelKey: input.modelKey ?? agent.modelKey, state: "draft", createdByKind: "user", createdBy: ctx.userId });
        await audit(tx, ctx, { action: "agent.training.save_draft", target: { kind: "agent_version", id: version.id }, details: { agentId: agent.id, flagged: detection.flagged, violations: detection.violations.length, comment: input.comment ?? null } });
        return { version, violations: detection.violations, flagged: detection.flagged };
      }),
    ),

    /** Cost and duration estimate for a training run (labelled Estimate; held-out tests counted, never returned). */
    estimate: read.input(z.object({ agentId: Id, modelKey: z.enum(MODEL_KEYS).optional() })).query(async ({ ctx, input }) => {
      const { agent, skills } = await ctx.rls(async (tx) => {
        const agent = await repos.agents.get(tx, ctx.businessId, input.agentId);
        return { agent, skills: await repos.skills.listForAgent(tx, ctx.businessId, agent.id) };
      });
      const modelKey = input.modelKey ?? agent.modelKey;
      let tests = 0;
      for (const s of skills) tests += await skillTestCount(ctx.db, ctx.businessId, agent.agentType, s.skillKey);
      const perTest = meter(REFERENCE_TEST_USAGE, MODELS[modelKey]).costMicroMinor + meter(REFERENCE_GRADE_USAGE, MODELS.opus).costMicroMinor;
      return { tests, skills: skills.length, modelKey, costMinor: Math.round((perTest * tests) / 1_000_000), currency: CREDITS_CURRENCY, durationMinutes: Math.max(2, Math.min(5, Math.ceil(tests / 20))), label: "Estimate" as const };
    }),

    /**
     * Queue a run on the orchestrator (`trainingRun`); the live version keeps working (AC-11.10.1). One run per draft
     * at a time: a second request while one is queued, running or grading is refused (409), so a double click never
     * pays for two runs.
     */
    run: write.input(z.object({ agentId: Id, versionId: Id })).use(modelLimited("training")).mutation(async ({ ctx, input }) => {
      await assertAgentsRunning(ctx, "a training run");
      const run = await ctx.rls(async (tx) => {
        const agent = await repos.agents.get(tx, ctx.businessId, input.agentId);
        if (agent.archivedAt) throw new ValidationError(`${agent.name} has left the team`);
        const version = await repos.agents.getVersion(tx, ctx.businessId, input.versionId);
        if (version.agentId !== agent.id) throw new ValidationError("Version belongs to another agent");
        if (version.state !== "draft") throw new ValidationError("Only a draft version can be trained");
        const r = await repos.training.createForDraft(tx, ctx.businessId, { agentId: agent.id, fromVersionId: agent.currentVersionId, toVersionId: version.id, status: "queued", requestedBy: ctx.userId });
        await audit(tx, ctx, { action: "agent.training.run", target: { kind: "training_run", id: r.id }, details: { agentId: agent.id, versionId: version.id } });
        return r;
      });
      const workflow = await ctx.temporal.start(WORKFLOWS.trainingRun, { workflowId: workflowIds.training(run.id), args: [{ businessId: ctx.businessId, trainingRunId: run.id }] });
      return { run, workflow };
    }),

    /** Results old → new per skill; held-out tests are redacted (AC-11.10.2). */
    results: read.input(z.object({ runId: Id })).query(async ({ ctx, input }) => {
      const { run, skills, agent } = await ctx.rls(async (tx) => {
        const run = await repos.training.get(tx, ctx.businessId, input.runId);
        const [skills, agent] = await Promise.all([repos.skills.listForAgent(tx, ctx.businessId, run.agentId), repos.agents.get(tx, ctx.businessId, run.agentId)]);
        return { run, skills, agent };
      });
      const publicTests: Record<string, number> = {};
      for (const s of skills) publicTests[s.skillKey] = await skillTestCount(ctx.db, ctx.businessId, agent.agentType, s.skillKey);
      // `tests` 0: the run found no tests for the skill (a library or file skill), so it reads "No tests yet" and a
      // promotion leaves its rating alone; null on runs from before the count was stored.
      const deltas = Object.entries(run.results ?? {}).map(([skillKey, r]) => ({ skillKey, old: r.old, new: r.new, delta: r.new - r.old, drop: r.old - r.new > 1, tests: r.tests ?? null }));
      return { run, deltas, publicTestCounts: publicTests, coachSummaryMd: run.coachSummaryMd };
    }),

    /**
     * Make a trained version live and write the run's scores onto the agent's ratings (`repos.training.decide`). A
     * version that grants tools the live one does not is an owner's or admin's to promote. Written on the service
     * connection after the team-write check, as hiring and skill reviews are: the ratings live in `agent_skills`, which
     * app roles only read under RLS, and the promotion, its ratings, the event and the audit entry are one transaction.
     */
    promote: write.input(z.object({ runId: Id })).mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        await repos.memberships.get(tx, ctx.businessId, ctx.userId);
        if (!isAdminRole(ctx)) {
          const pending = await repos.training.get(tx, ctx.businessId, input.runId);
          const agent = await repos.agents.get(tx, ctx.businessId, pending.agentId);
          const [to, live] = await Promise.all([pending.toVersionId ? repos.agents.getVersion(tx, ctx.businessId, pending.toVersionId) : null, agent.currentVersionId ? repos.agents.getVersion(tx, ctx.businessId, agent.currentVersionId) : null]);
          const templateTools = getTemplateByAgentType(agent.agentType)?.tools;
          if (to && widensGrants(runningGrants(live ?? undefined, templateTools), runningGrants(to, templateTools))) throw new ForbiddenError("This version gives the agent new tools; an owner or admin promotes it");
        }
        const watchUntil = new Date(Date.now() + LIMITS.rollbackWatchDays * 86_400_000);
        const run = await repos.training.decide(tx, ctx.businessId, input.runId, "promoted", { watchUntil });
        const version = await repos.agents.getVersion(tx, ctx.businessId, run.toVersionId!);
        await emit(tx, ctx, { type: "agent.promoted", payload: { agentId: run.agentId, trainingRunId: run.id, fromVersionId: run.fromVersionId, toVersionId: version.id, version: version.version, watchUntil: watchUntil.toISOString(), rollback: false } });
        await audit(tx, ctx, { action: "agent.training.promote", target: { kind: "training_run", id: run.id }, details: { agentId: run.agentId, versionId: version.id, ratings: run.ratings.map((r) => ({ skillKey: r.skillKey, from: r.previousTested, to: r.tested, potential: r.potential })) } });
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

    /**
     * One-click rollback to the previous live version and its skills (AC-11.10.6): the ratings the promotion of the
     * version being left wrote go back to what they were (`repos.training.revertPromotion`). It also ends the seven-day
     * watch of that run, so no banner offers the same rollback again. On the service connection, as `promote` is.
     */
    rollback: write.input(z.object({ agentId: Id })).mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        await repos.memberships.get(tx, ctx.businessId, ctx.userId);
        const agent = await repos.agents.get(tx, ctx.businessId, input.agentId);
        const versions = await repos.agents.listVersions(tx, ctx.businessId, agent.id);
        const current = versions.find((v) => v.id === agent.currentVersionId);
        const previous = versions.filter((v) => v.id !== agent.currentVersionId && v.state === "retired" && (!current || v.version < current.version)).sort((a, b) => b.version - a.version)[0];
        if (!previous) throw new ValidationError("No previous live version to roll back to");
        // Rolling back can bring back tools an owner or admin took away: that widens the live grants, so it is theirs.
        if (!isAdminRole(ctx)) {
          const templateTools = getTemplateByAgentType(agent.agentType)?.tools;
          if (widensGrants(runningGrants(current, templateTools), runningGrants(previous, templateTools))) throw new ForbiddenError("The previous version gives the agent tools the live one does not; an owner or admin rolls it back");
        }
        const rolled = await repos.agents.rollback(tx, ctx.businessId, agent.id, previous.id);
        const restored = agent.currentVersionId ? await repos.training.revertPromotion(tx, ctx.businessId, agent.id, agent.currentVersionId) : [];
        const closed = await repos.training.closeWatch(tx, ctx.businessId, agent.id);
        const watchUntil = new Date(Date.now() + LIMITS.rollbackWatchDays * 86_400_000);
        await emit(tx, ctx, { type: "agent.promoted", payload: { agentId: agent.id, trainingRunId: null, fromVersionId: agent.currentVersionId, toVersionId: previous.id, version: previous.version, watchUntil: watchUntil.toISOString(), rollback: true } });
        await audit(tx, ctx, { action: "agent.training.rollback", target: { kind: "agent", id: agent.id }, details: { from: agent.currentVersionId, to: previous.id, watchesClosed: closed.map((r) => r.id), ratingsRestored: restored.map((r) => ({ skillKey: r.skillKey, from: r.previousTested, to: r.tested })) } });
        return rolled;
      }),
    ),
  }),

  /**
   * Custom skills (BUILD §11.10): the founder adds a skill by name, description and optional examples; Opus drafts a
   * test set (half held out) that waits for the founder's review; once reviewed the skill counts for the agent and its
   * training runs score it on the reviewed tests only. Held-out tests are never shown (AC-11.10.2).
   */
  skills: router({
    /** The business's custom skills for this agent's type, with their review state and, while awaiting review, the visible drafts. */
    custom: read.input(z.object({ agentId: Id })).query(async ({ ctx, input }) => {
      const { agent, skills } = await ctx.rls(async (tx) => {
        const agent = await repos.agents.get(tx, ctx.businessId, input.agentId);
        return { agent, skills: await repos.skills.listForAgent(tx, ctx.businessId, agent.id) };
      });
      // Counted on the service connection (RLS hides held-out rows from app roles); held-out content is never read here:
      // listTests without includeHeldOut returns them redacted. A definition with no tests at all is not a skill yet.
      const defs = (await repos.skills.listCustom(ctx.db, ctx.businessId, agent.agentType)).filter((d) => d.tests > 0);
      const out = [];
      for (const d of defs) {
        const awaiting = d.tests > d.reviewed;
        const drafts = awaiting ? (await repos.skills.listTests(ctx.db, ctx.businessId, d.id)).filter((t): t is SkillTestRow => !t.heldOut && "reviewedAt" in t && t.reviewedAt === null) : [];
        out.push({ definitionId: d.id, skillKey: d.skillKey, name: d.name, description: d.description, status: awaiting ? ("awaiting_review" as const) : ("counts" as const), onAgent: skills.some((s) => s.skillKey === d.skillKey), tests: d.reviewed, heldOut: d.heldOut, drafts: drafts.map(reviewDraft), draftsHeldOut: awaiting ? d.tests - d.reviewed - drafts.length : 0 });
      }
      return out;
    }),

    /** Add a custom skill: Opus drafts its tests (an Estimate-labeled model cost), which wait for the founder's review. */
    createCustom: write
      .input(z.object({ agentId: Id, name: z.string().trim().min(3).max(60), description: z.string().trim().min(20).max(1000), examples: z.array(z.string().trim().min(3).max(500)).max(5).default([]) }))
      .use(modelLimited("training"))
      .mutation(async ({ ctx, input }) => {
        const skillKey = customSkillKey(input.name);
        const { agent, mockTools } = await ctx.rls(async (tx) => {
          const agent = await repos.agents.get(tx, ctx.businessId, input.agentId);
          if (agent.archivedAt) throw new ValidationError(`${agent.name} has left the team`);
          const [existing, skills, version] = await Promise.all([repos.skills.findDefinition(tx, ctx.businessId, agent.agentType, skillKey), repos.skills.listForAgent(tx, ctx.businessId, agent.id), agent.currentVersionId ? repos.agents.getVersion(tx, ctx.businessId, agent.currentVersionId) : null]);
          if (existing || skills.some((s) => s.skillKey === skillKey)) throw new ConflictError(`${agent.name} already has a skill called "${input.name}"`, { skillKey });
          // Only connectors the agent really holds tools on: a version stored before Nov 11, 2026 may still name ones never built.
          const connectors = shownToolGrants(version?.tools).map((g) => g.connectorKey);
          return { agent, mockTools: [...new Set(["quarantine.read_untrusted", ...connectors.map((k) => `${k}.mock`)])] };
        });
        const template = getTemplateByAgentType(agent.agentType);
        const prompt = getPrompt("custom_skill_tests").render({ business_name: ctx.business.name, agent_role: agent.role || template?.role || agent.agentType, skill_name: input.name, skill_description: input.description, examples: input.examples.length ? input.examples : ["none"], task_count: CUSTOM_SKILL_TEST_COUNT, mock_tools: mockTools });
        const result = await ctx.models.complete({
          route: "coach",
          schema: CustomSkillTestsOutput,
          system: `You are the Coach: you write test sets that measure one skill of an agent, in a sandbox with mock tools only. ${HOUSE_STYLE}`,
          messages: [{ role: "user", content: prompt }],
          attribution: { businessId: ctx.businessId, agentId: agent.id, kind: "custom_skill_tests" },
        });
        const drafts = withHeldOutSplit(result.json.tests);
        // Written on the service connection after the team-write check, as hiring writes skills.
        const saved = await ctx.db.transaction(async (tx) => {
          const definition = await repos.skills.createCustomDefinition(tx, ctx.businessId, { agentType: agent.agentType, skillKey, name: input.name, description: input.description, group: "craft", custom: true });
          const tests: SkillTestRow[] = [];
          for (const d of drafts) tests.push(await repos.skills.createTest(tx, ctx.businessId, { skillDefinitionId: definition.id, ...storedCustomTest(d), reviewed: false }));
          await audit(tx, ctx, { action: "agent.skills.create_custom", target: { kind: "skill_definition", id: definition.id }, details: { agentId: agent.id, skillKey, tests: tests.length, examples: input.examples.length, costMinor: result.cost.costMinorInt } });
          return { definition, tests };
        });
        const visible = saved.tests.filter((t) => !t.heldOut);
        return { definitionId: saved.definition.id, skillKey, drafts: visible.map(reviewDraft), draftsHeldOut: saved.tests.length - visible.length, cost: { amountMinor: result.cost.costMinorInt, currency: CREDITS_CURRENCY, label: "Estimate" as const } };
      }),

    /**
     * The founder's review: the visible drafts kept (at least one) and every held-out test count from now on, the rest
     * are dropped; the skill joins the agent's skills at its template's baseline until a training run scores it.
     */
    review: write.input(z.object({ agentId: Id, definitionId: Id, keepTestIds: z.array(Id).min(1).max(30) })).mutation(async ({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        await repos.memberships.get(tx, ctx.businessId, ctx.userId);
        const agent = await repos.agents.get(tx, ctx.businessId, input.agentId);
        const definition = await repos.skills.getDefinition(tx, ctx.businessId, input.definitionId);
        if (!definition.custom || definition.businessId !== ctx.businessId || definition.agentType !== agent.agentType) throw new ValidationError("That custom skill belongs to another kind of agent");
        const reviewed = await repos.skills.reviewTests(tx, ctx.businessId, definition.id, input.keepTestIds);
        const baseline = getTemplateByAgentType(agent.agentType)?.baselineRating ?? 8;
        await repos.skills.upsertForAgent(tx, ctx.businessId, agent.id, [{ skillKey: definition.skillKey, group: definition.group, tested: null, proven: null, nLive: 0, displayed: baseline, potential: baseline }]);
        await audit(tx, ctx, { action: "agent.skills.review", target: { kind: "skill_definition", id: definition.id }, details: { agentId: agent.id, ...reviewed } });
        return { definitionId: definition.id, skillKey: definition.skillKey, ...reviewed };
      }),
    ),

    /**
     * Skills from the library or skill files on this agent (founder request 2026-10-16): what each one is, where it
     * came from and whether a training run has scored it yet. Its instructions reach the agent's prompt after the house
     * rules; the list shows their first lines.
     */
    added: read.input(z.object({ agentId: Id })).query(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const agent = await repos.agents.get(tx, ctx.businessId, input.agentId);
        return (await repos.skills.listAddedForAgent(tx, ctx.businessId, agent.id, agent.agentType)).map(addedSkillView);
      }),
    ),

    /**
     * Add skills from the library or skill files (screened again here, whatever the preview said). No model call: the
     * skill shows on the agent's attributes at once, untested until a training run scores it.
     */
    add: write.input(z.object({ agentId: Id, skills: z.array(SkillChoice).min(1).max(8) })).mutation(async ({ ctx, input }) => {
      const resolved = input.skills.map(resolveSkillChoice);
      return ctx.db.transaction(async (tx) => {
        await repos.memberships.get(tx, ctx.businessId, ctx.userId);
        const agent = await repos.agents.get(tx, ctx.businessId, input.agentId);
        if (agent.archivedAt) throw new ValidationError(`${agent.name} has left the team; its profile is kept as a record`);
        return (await attachSkills(tx, ctx, agent, resolved)).map(addedSkillView);
      });
    }),

    /** Take a library or file skill off the agent; its definition stays as the business's record. */
    remove: write.input(z.object({ agentId: Id, skillKey: z.string().min(1).max(80) })).mutation(async ({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        await repos.memberships.get(tx, ctx.businessId, ctx.userId);
        const agent = await repos.agents.get(tx, ctx.businessId, input.agentId);
        if (agent.archivedAt) throw new ValidationError(`${agent.name} has left the team; its profile is kept as a record`);
        const removed = await detachSkill(tx, ctx, agent, input.skillKey);
        return { removed: removed.skillKey };
      }),
    ),

    /** Discard a custom skill still awaiting review (its drafted tests go with it). */
    discard: write.input(z.object({ agentId: Id, definitionId: Id })).mutation(async ({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        await repos.memberships.get(tx, ctx.businessId, ctx.userId);
        const agent = await repos.agents.get(tx, ctx.businessId, input.agentId);
        const custom = (await repos.skills.listCustom(tx, ctx.businessId, agent.agentType)).find((d) => d.id === input.definitionId);
        if (!custom) throw new ValidationError("No custom skill of this agent's kind with that id");
        if (custom.reviewed > 0) throw new ValidationError("This skill already counts; it stays as a record of what was trained");
        await repos.skills.discardCustom(tx, ctx.businessId, custom.id);
        await audit(tx, ctx, { action: "agent.skills.discard", target: { kind: "skill_definition", id: custom.id }, details: { agentId: agent.id } });
        return { discarded: custom.id };
      }),
    ),
  }),

  model: router({
    /**
     * Predicted monthly wage per model (pricing config, Estimate, US cents); skill deltas come only from a real preview
     * run (null here). The prediction scales what the agent costs now: this month's spend, else its last 30 days, else
     * (a new hire, the first days of a month) a typical month of work, so the options always differ by model. `basis`
     * says which.
     */
    compare: read.input(z.object({ agentId: Id, period: Period.optional() })).query(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const agent = await repos.agents.get(tx, ctx.businessId, input.agentId);
        const route = routeOf(agent);
        const now = new Date();
        const [spend, last30] = await Promise.all([
          repos.usage.agentSpend(tx, ctx.businessId, agent.id, input.period ?? periodOf(now)),
          repos.agents.dailyActivity(tx, ctx.businessId, agent.id, { from: new Date(now.getTime() - RECENT_DAYS * 86_400_000), to: now }),
        ]);
        const last30Minor = last30.reduce((s, d) => s + d.costMinor, 0);
        const reference = meter(REFERENCE_TEST_USAGE, MODELS[agent.modelKey]).costMicroMinor || 1;
        const basis = spend.costMinor > 0 ? ("this_month" as const) : last30Minor > 0 ? ("last_30_days" as const) : ("typical_month" as const);
        const predict = (modelKey: ModelKey): number => {
          if (basis === "typical_month") return Math.round((meter(REFERENCE_SESSION_USAGE, MODELS[modelKey]).costMicroMinor * REFERENCE_SESSIONS_PER_MONTH) / 1_000_000);
          const ratio = meter(REFERENCE_TEST_USAGE, MODELS[modelKey]).costMicroMinor / reference;
          return Math.round((basis === "this_month" ? spend.costMinor : last30Minor) * ratio);
        };
        return {
          current: agent.modelKey,
          locked: resolveModel(route).locked,
          // Predicted from the agent's metered model cost at list prices: US dollars, never the business's currency.
          basis,
          currency: CREDITS_CURRENCY,
          options: MODEL_KEYS.map((modelKey) => {
            const r = resolveModel(route, modelKey);
            return { modelKey, modelId: MODELS[modelKey], allowed: !r.locked || r.modelKey === modelKey, warning: r.warning ?? null, predictedWageMinor: predict(modelKey), predictedSkillDelta: null, label: "Estimate" as const };
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
    /**
     * Off by default; when on, limits are mandatory and final terms/signing/payment stay hard-gated (BUILD §9.6). No
     * negotiation runtime exists yet (it arrives with LIVE B2B, AC-11.14.3), so switching it on is refused rather than
     * stored as a promise nothing keeps; the limits themselves may be saved, off, for when it does.
     */
    set: admin.input(z.object({ agentId: Id, negotiation: Negotiation, applyScope: ApplyScope.default("agent") })).mutation(async ({ ctx, input }) => {
      if (input.negotiation.enabled) throw new ValidationError(NEGOTIATION_UNAVAILABLE);
      const targets = await scopedAgents(ctx, input.agentId, input.applyScope);
      return ctx.rls(async (tx) => {
        for (const a of targets) await repos.agents.setNegotiation(tx, ctx.businessId, a.id, input.negotiation);
        await audit(tx, ctx, { action: "agent.negotiation.set", target: { kind: "agent", id: input.agentId }, details: { applyScope: input.applyScope, agents: targets.map((a) => a.id), enabled: input.negotiation.enabled } });
        return { updated: targets.map((a) => a.id) };
      });
    }),
  }),
});
