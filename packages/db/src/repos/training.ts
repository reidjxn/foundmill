/** training_runs — the Training screen lifecycle (BUILD §11.10; routers agent.training.*). */
import { ConflictError, MODEL_KEYS, ValidationError } from "@foundmill/shared";
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { TRAINING_DECISIONS, TRAINING_KINDS, TRAINING_STATUSES, agentVersions, trainingRuns, type AgentVersion, type TrainingRun, type TrainingRunSkillResult } from "../schema";
import { agentsRepo, type CreateAgentVersionInput } from "./agents";
import { skillsRepo, type AppliedSkillRating, type TestedRatingInput } from "./skills";
import { Currency, changes, defined, Id, MinorAmount, one, PageInput, parseInput, timeKeyset, toPage, type Executor, type Page } from "./_shared";

export const CreateTrainingRunInput = z.object({
  agentId: Id,
  fromVersionId: Id.nullable().optional(),
  toVersionId: Id.nullable().optional(),
  status: z.enum(TRAINING_STATUSES).default("queued"),
  costMinor: MinorAmount.default(0),
  /** The run's cost is model spend in US cents: left out, the column's USD default applies (0024). */
  currency: Currency.optional(),
  requestedBy: Id.nullable().optional(),
  /** A skill check scores the live version with and without one skill (0150); the others score a draft. */
  kind: z.enum(TRAINING_KINDS).default("training"),
  skillKeys: z.array(z.string().min(1)).min(1).max(3).nullable().optional(),
  measuredSkillKey: z.string().min(1).nullable().optional(),
});
export type CreateTrainingRunInput = z.input<typeof CreateTrainingRunInput>;

/** One skill's old → new on a run; `tests` 0 means the skill has no tests yet and was not scored (schema `TrainingRunSkillResult`). */
export const SkillResult = z.object({ old: z.number(), new: z.number(), tests: z.number().int().min(0).optional() });

/** True when the run scored the skill: a test count above zero, or a result from before the count was stored. */
export const scoredOnRun = (r: TrainingRunSkillResult): boolean => r.tests === undefined || r.tests > 0;

/** How many finished runs the potential looks back over (BUILD §11.10 "across the last 5 training runs"). */
export const POTENTIAL_WINDOW_RUNS = 5;

/** A decided run with the rating rows the decision wrote (empty for a discard). */
export type DecidedTrainingRun = TrainingRun & { ratings: AppliedSkillRating[] };

export const UpdateTrainingRunInput = z.object({
  status: z.enum(TRAINING_STATUSES).optional(),
  toVersionId: Id.nullable().optional(),
  costMinor: MinorAmount.optional(),
  results: z.record(z.string(), SkillResult).optional(),
  coachSummaryMd: z.string().optional(),
  startedAt: z.coerce.date().nullable().optional(),
  endedAt: z.coerce.date().nullable().optional(),
  watchUntil: z.coerce.date().nullable().optional(),
});
export type UpdateTrainingRunInput = z.input<typeof UpdateTrainingRunInput>;

export type TrainingStatus = (typeof TRAINING_STATUSES)[number];
/** A run in one of these is in flight: the Training tab shows it as active and holds the agent's Train button. */
export const ACTIVE_TRAINING_STATUSES = ["queued", "running", "grading"] as const satisfies readonly TrainingStatus[];

/** A model change's retest (`createModelRetest`): the system's draft copy of the live version and the run that scores it. */
export interface ModelRetest {
  run: TrainingRun;
  draft: AgentVersion;
}

/**
 * A model change's retest copy: a draft the system made from the live version to put the agent on another model. The
 * system's only other versions are an agent's first (version 1, set up with the business or a clone). Every other draft
 * (the founder's, the Coach's, a preview on another model) changes instructions or tools, never the agent's model.
 */
export const isModelRetestVersion = (v: Pick<AgentVersion, "createdByKind" | "version">): boolean => v.createdByKind === "system" && v.version > 1;

const scoped = (businessId: string, runId: string) => and(eq(trainingRuns.businessId, businessId), eq(trainingRuns.id, runId));

export const trainingRepo = {
  async list(db: Executor, businessId: string, filter: { agentId?: string; status?: (typeof TRAINING_STATUSES)[number] } & PageInput = {}): Promise<Page<TrainingRun>> {
    const p = parseInput(PageInput, filter, "page");
    const ks = timeKeyset<TrainingRun>(trainingRuns.createdAt, trainingRuns.id, (r) => ({ at: r.createdAt, id: r.id }));
    const rows = await db
      .select()
      .from(trainingRuns)
      .where(
        and(
          eq(trainingRuns.businessId, businessId),
          isNull(trainingRuns.archivedAt),
          filter.agentId ? eq(trainingRuns.agentId, filter.agentId) : undefined,
          filter.status ? eq(trainingRuns.status, filter.status) : undefined,
          ks.after(p.cursor),
        ),
      )
      .orderBy(...ks.orderBy)
      .limit(p.limit + 1);
    return toPage(rows, p, ks);
  },

  async get(db: Executor, businessId: string, runId: string): Promise<TrainingRun> {
    return one(await db.select().from(trainingRuns).where(scoped(businessId, runId)).limit(1), "training run", runId);
  },

  /** The latest run for an agent (the Training screen's "results" panel). */
  async latestForAgent(db: Executor, businessId: string, agentId: string): Promise<TrainingRun | null> {
    const rows = await db.select().from(trainingRuns).where(and(eq(trainingRuns.businessId, businessId), eq(trainingRuns.agentId, agentId), isNull(trainingRuns.archivedAt))).orderBy(desc(trainingRuns.createdAt)).limit(1);
    return rows[0] ?? null;
  },

  async create(db: Executor, businessId: string, input: CreateTrainingRunInput): Promise<TrainingRun> {
    const v = parseInput(CreateTrainingRunInput, input, "training run");
    const agent = await agentsRepo.get(db, businessId, v.agentId);
    return one(
      await db
        .insert(trainingRuns)
        .values({
          businessId,
          agentId: v.agentId,
          fromVersionId: v.fromVersionId === undefined ? agent.currentVersionId : v.fromVersionId,
          toVersionId: v.toVersionId ?? null,
          status: v.status,
          costMinor: v.costMinor,
          ...(v.currency ? { currency: v.currency } : {}),
          requestedBy: v.requestedBy ?? null,
          kind: v.kind,
          skillKeys: v.skillKeys ?? null,
          measuredSkillKey: v.measuredSkillKey ?? null,
        })
        .returning(),
      "training run",
    );
  },

  async update(db: Executor, businessId: string, runId: string, input: UpdateTrainingRunInput): Promise<TrainingRun> {
    const v = parseInput(UpdateTrainingRunInput, input, "training run update");
    return one(await db.update(trainingRuns).set(changes(v, "training run")).where(scoped(businessId, runId)).returning(), "training run", runId);
  },

  /**
   * `update`, but only while the run's status is one of `from`, in one statement, so a founder's cancel that lands
   * between a worker's read and its write is never overwritten. Null when the run had already moved on.
   */
  async transition(db: Executor, businessId: string, runId: string, from: readonly TrainingStatus[], input: UpdateTrainingRunInput): Promise<TrainingRun | null> {
    const v = parseInput(UpdateTrainingRunInput, input, "training run update");
    const rows = await db
      .update(trainingRuns)
      .set(defined(v))
      .where(and(scoped(businessId, runId), inArray(trainingRuns.status, [...from])))
      .returning();
    return rows[0] ?? null;
  },

  /**
   * The founder stops a queued or running run (agent.training.cancel). A run whose worker never picked it up would
   * otherwise stay queued, and hold the agent's Train button, for good.
   */
  async cancel(db: Executor, businessId: string, runId: string): Promise<TrainingRun> {
    const run = await trainingRepo.get(db, businessId, runId);
    const cancelled = await trainingRepo.transition(db, businessId, runId, ACTIVE_TRAINING_STATUSES, { status: "cancelled", endedAt: new Date() });
    if (!cancelled) throw new ValidationError("This training run has already finished", { runId, status: run.status });
    return cancelled;
  },

  /**
   * Stop all agents (BUILD §14): every run of the business still in flight (queued, running or grading) is canceled
   * with `coachSummaryMd`, in one statement; the caller stops their workflows. A worker's late write never overwrites
   * the cancel (`transition`), and what the tests already cost is kept by `finalizeTrainingRun`.
   */
  async cancelActive(db: Executor, businessId: string, input: { coachSummaryMd: string }): Promise<TrainingRun[]> {
    const v = parseInput(z.object({ coachSummaryMd: z.string().min(1) }), input, "training cancel");
    return db
      .update(trainingRuns)
      .set({ status: "cancelled", endedAt: new Date(), coachSummaryMd: v.coachSummaryMd })
      .where(and(eq(trainingRuns.businessId, businessId), isNull(trainingRuns.archivedAt), inArray(trainingRuns.status, [...ACTIVE_TRAINING_STATUSES])))
      .returning();
  },

  /**
   * A model change's retest (AC-11.10.5): a draft copy of the live version (instructions and tools) on the new model,
   * created by the system, and a queued run that scores it against the live version. The live version itself is never
   * the candidate (AC-11.10.1); promoting the run makes the copy live on the new model. The agent's earlier retests are
   * canceled first (`superseded`; the caller stops their workflows): those in flight or awaiting a decision test a
   * model the agent no longer runs (promoting one would quietly switch it back), and the old shape (the live version as
   * its own candidate) could never start. A founder's own training runs are left alone. `retest` is null when there is
   * nothing new to score: the agent has no live version to copy, or its live version already runs on the model (a
   * change back to it).
   */
  async createModelRetest(db: Executor, businessId: string, agentId: string, input: { modelKey: (typeof MODEL_KEYS)[number]; requestedBy?: string | null }): Promise<{ retest: ModelRetest | null; superseded: TrainingRun[] }> {
    const v = parseInput(z.object({ modelKey: z.enum(MODEL_KEYS), requestedBy: Id.nullable().optional() }), input, "model retest");
    return db.transaction(async (tx) => {
      const agent = await agentsRepo.get(tx, businessId, agentId);
      const ofAgent = and(eq(trainingRuns.businessId, businessId), eq(trainingRuns.agentId, agent.id));
      const retestCopies = tx
        .select({ id: agentVersions.id })
        .from(agentVersions)
        .where(and(eq(agentVersions.businessId, businessId), eq(agentVersions.agentId, agent.id), eq(agentVersions.createdByKind, "system"), gt(agentVersions.version, 1)));
      const inFlight = await tx
        .update(trainingRuns)
        .set({ status: "cancelled", endedAt: new Date() })
        .where(and(ofAgent, inArray(trainingRuns.status, [...ACTIVE_TRAINING_STATUSES]), or(inArray(trainingRuns.toVersionId, retestCopies), eq(trainingRuns.fromVersionId, trainingRuns.toVersionId))))
        .returning();
      // Results already in keep their end time; only the decision they wait for is withdrawn.
      const undecided = await tx
        .update(trainingRuns)
        .set({ status: "cancelled" })
        .where(and(ofAgent, eq(trainingRuns.status, "awaiting_decision"), isNull(trainingRuns.decision), inArray(trainingRuns.toVersionId, retestCopies)))
        .returning();
      const superseded = [...inFlight, ...undecided];
      if (!agent.currentVersionId) return { retest: null, superseded };
      const live = await agentsRepo.getVersion(tx, businessId, agent.currentVersionId);
      if (live.modelKey === v.modelKey) return { retest: null, superseded };
      const draft = await agentsRepo.createVersion(tx, businessId, agent.id, { instructions: live.instructions as CreateAgentVersionInput["instructions"], tools: live.tools, modelKey: v.modelKey, state: "draft", createdByKind: "system", createdBy: v.requestedBy ?? null });
      const run = await trainingRepo.create(tx, businessId, { agentId: agent.id, fromVersionId: live.id, toVersionId: draft.id, status: "queued", requestedBy: v.requestedBy ?? null, kind: "model_retest" });
      return { retest: { run, draft }, superseded };
    });
  },

  /**
   * Founder decision after grading: `promoted` makes the candidate version live (and starts the watch window) and
   * writes the run's scores onto the agent's ratings; `discarded` leaves the current version and the ratings in place.
   * Only runs awaiting a decision can be decided.
   *
   * Promoting changes the agent's model only for a model change's retest copy (`isModelRetestVersion`, which exists to
   * put the agent on that model). Any other draft keeps the model it was saved with, which can be one the agent has since
   * left (the model changed after the draft was saved, or the draft previewed another model): the agent keeps the model
   * it runs now (FU-T2-1).
   *
   * The ratings (BUILD §11.10 "never changes the live version until Promote"): every skill the run scored takes its
   * new tested rating, its displayed rating is re-blended with the proven one, and its potential becomes the best
   * tested score across the agent's last five finished runs, this one included. A skill with no tests yet (`tests` 0:
   * a library or file skill) and a skill the run did not cover keep their rows, so no rating is ever invented.
   */
  async decide(db: Executor, businessId: string, runId: string, decision: (typeof TRAINING_DECISIONS)[number], options: { watchUntil?: Date } = {}): Promise<DecidedTrainingRun> {
    const d = parseInput(z.enum(TRAINING_DECISIONS), decision, "training decision");
    return db.transaction(async (tx) => {
      const run = await trainingRepo.get(tx, businessId, runId);
      if (run.decision) throw new ValidationError("Training run already decided", { runId, decision: run.decision });
      if (run.status !== "awaiting_decision" && run.status !== "done") throw new ValidationError(`Training run is ${run.status}, not awaiting a decision`, { runId });
      if (d === "promoted" && !run.toVersionId && run.kind !== "skill_check") throw new ValidationError("Training run produced no candidate version", { runId });
      // The decision is claimed with one conditional update before anything else changes: of two at once (a double
      // click, two tabs) the second waits on the row, then finds it decided and is refused, so a run is promoted once.
      const claimed = await tx
        .update(trainingRuns)
        .set({ decision: d, status: "done", endedAt: run.endedAt ?? new Date(), watchUntil: d === "promoted" ? (options.watchUntil ?? run.watchUntil) : null })
        .where(and(scoped(businessId, runId), isNull(trainingRuns.decision), inArray(trainingRuns.status, ["awaiting_decision", "done"])))
        .returning();
      const decided = claimed[0];
      if (!decided) throw new ValidationError("Training run already decided", { runId });
      if (d !== "promoted") return { ...decided, ratings: [] };
      // A skill check has no candidate: accepting it only writes the ratings.
      if (run.toVersionId) {
        const candidate = await agentsRepo.getVersion(tx, businessId, run.toVersionId);
        await agentsRepo.promoteVersion(tx, businessId, run.agentId, candidate.id, { keepAgentModel: !isModelRetestVersion(candidate) });
      }
      const scored = Object.entries(decided.results).filter(([, r]) => scoredOnRun(r));
      if (scored.length === 0) return { ...decided, ratings: [] };
      const best = await trainingRepo.bestTestedInWindow(tx, businessId, run.agentId);
      const ratings = await skillsRepo.applyTestedRatings(
        tx,
        businessId,
        run.agentId,
        scored.map(([skillKey, r]): TestedRatingInput => ({ skillKey, tested: r.new, potential: Math.max(r.new, best.get(skillKey) ?? r.new) })),
      );
      return { ...decided, ratings };
    });
  },

  /**
   * The best tested score per skill across the agent's last `POTENTIAL_WINDOW_RUNS` finished runs with results, the
   * potential of BUILD §11.10 ("best tested score reached ... across the last 5 training runs"). Canceled and failed
   * runs are left out (their results are partial); a skill a run found no tests for does not count on that run.
   */
  async bestTestedInWindow(db: Executor, businessId: string, agentId: string): Promise<Map<string, number>> {
    const rows = await db
      .select({ results: trainingRuns.results })
      .from(trainingRuns)
      .where(and(eq(trainingRuns.businessId, businessId), eq(trainingRuns.agentId, agentId), isNull(trainingRuns.archivedAt), inArray(trainingRuns.status, ["done", "awaiting_decision"]), sql`${trainingRuns.results} <> '{}'::jsonb`))
      .orderBy(desc(sql`coalesce(${trainingRuns.endedAt}, ${trainingRuns.createdAt})`), desc(trainingRuns.id))
      .limit(POTENTIAL_WINDOW_RUNS);
    const best = new Map<string, number>();
    for (const row of rows) {
      for (const [skillKey, r] of Object.entries(row.results)) {
        if (!scoredOnRun(r)) continue;
        best.set(skillKey, Math.max(best.get(skillKey) ?? 0, r.new));
      }
    }
    return best;
  },

  /**
   * A rollback leaving `versionId` restores the ratings its promotion replaced (AC-11.10.6 "restores the previous live
   * version and its skills"): every skill that run scored takes its `old` tested rating back, displayed re-blended; the
   * potential reached stays (it was reached). Nothing to restore (no promoted run made the version live, or it scored
   * nothing) returns an empty list.
   */
  async revertPromotion(db: Executor, businessId: string, agentId: string, versionId: string): Promise<AppliedSkillRating[]> {
    const rows = await db
      .select()
      .from(trainingRuns)
      .where(and(eq(trainingRuns.businessId, businessId), eq(trainingRuns.agentId, agentId), eq(trainingRuns.toVersionId, versionId), eq(trainingRuns.decision, "promoted"), isNull(trainingRuns.archivedAt)))
      .orderBy(desc(sql`coalesce(${trainingRuns.endedAt}, ${trainingRuns.createdAt})`), desc(trainingRuns.id))
      .limit(1);
    const run = rows[0];
    if (!run) return [];
    const restore = Object.entries(run.results)
      .filter(([, r]) => scoredOnRun(r))
      .map(([skillKey, r]): TestedRatingInput => ({ skillKey, tested: Math.max(1, Math.min(20, Math.round(r.old))) }));
    return skillsRepo.applyTestedRatings(db, businessId, agentId, restore);
  },

  /**
   * Ends the seven-day watch of the agent's promoted runs (a rollback moved the agent off the version they made
   * live): their `watch_until` becomes now, so no banner offers a rollback the agent has already had.
   */
  async closeWatch(db: Executor, businessId: string, agentId: string): Promise<TrainingRun[]> {
    const now = new Date();
    return db
      .update(trainingRuns)
      .set({ watchUntil: now })
      .where(and(eq(trainingRuns.businessId, businessId), eq(trainingRuns.agentId, agentId), eq(trainingRuns.decision, "promoted"), gt(trainingRuns.watchUntil, now)))
      .returning();
  },

  /**
   * The founder's run of a draft (agent.training.run): refused (409) while another run of the same draft is queued,
   * running or grading, so a double click never pays for two runs. The draft's row is locked before the check, so two
   * requests at once cannot both pass it.
   */
  async createForDraft(db: Executor, businessId: string, input: CreateTrainingRunInput & { toVersionId: string }): Promise<TrainingRun> {
    return db.transaction(async (tx) => {
      await tx.select({ id: agentVersions.id }).from(agentVersions).where(and(eq(agentVersions.businessId, businessId), eq(agentVersions.id, input.toVersionId))).for("update");
      const active = await trainingRepo.activeForVersion(tx, businessId, input.toVersionId);
      if (active) throw new ConflictError("This draft is already being trained; wait for its results or cancel the run", { runId: active.id });
      return trainingRepo.create(tx, businessId, input);
    });
  },

  /** A run of this candidate version still queued, running or grading (one run per draft at a time), or null. */
  async activeForVersion(db: Executor, businessId: string, versionId: string): Promise<TrainingRun | null> {
    const rows = await db
      .select()
      .from(trainingRuns)
      .where(and(eq(trainingRuns.businessId, businessId), eq(trainingRuns.toVersionId, versionId), inArray(trainingRuns.status, [...ACTIVE_TRAINING_STATUSES])))
      .limit(1);
    return rows[0] ?? null;
  },
};
