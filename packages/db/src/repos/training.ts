/** training_runs — the Training screen lifecycle (BUILD §11.10; routers agent.training.*). */
import { MODEL_KEYS, ValidationError } from "@foundmill/shared";
import { and, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { TRAINING_DECISIONS, TRAINING_STATUSES, agentVersions, trainingRuns, type AgentVersion, type TrainingRun } from "../schema";
import { agentsRepo, type CreateAgentVersionInput } from "./agents";
import { Currency, defined, Id, MinorAmount, one, PageInput, parseInput, timeKeyset, toPage, type Executor, type Page } from "./_shared";

export const CreateTrainingRunInput = z.object({
  agentId: Id,
  fromVersionId: Id.nullable().optional(),
  toVersionId: Id.nullable().optional(),
  status: z.enum(TRAINING_STATUSES).default("queued"),
  costMinor: MinorAmount.default(0),
  currency: Currency.optional(),
  requestedBy: Id.nullable().optional(),
});
export type CreateTrainingRunInput = z.input<typeof CreateTrainingRunInput>;

export const SkillResult = z.object({ old: z.number(), new: z.number() });

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
        })
        .returning(),
      "training run",
    );
  },

  async update(db: Executor, businessId: string, runId: string, input: UpdateTrainingRunInput): Promise<TrainingRun> {
    const v = parseInput(UpdateTrainingRunInput, input, "training run update");
    return one(await db.update(trainingRuns).set(defined(v)).where(scoped(businessId, runId)).returning(), "training run", runId);
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
      const run = await trainingRepo.create(tx, businessId, { agentId: agent.id, fromVersionId: live.id, toVersionId: draft.id, status: "queued", requestedBy: v.requestedBy ?? null });
      return { retest: { run, draft }, superseded };
    });
  },

  /**
   * Founder decision after grading: `promoted` makes the candidate version live (and starts the watch window),
   * `discarded` leaves the current version in place. Only runs awaiting a decision can be decided.
   */
  async decide(db: Executor, businessId: string, runId: string, decision: (typeof TRAINING_DECISIONS)[number], options: { watchUntil?: Date } = {}): Promise<TrainingRun> {
    const d = parseInput(z.enum(TRAINING_DECISIONS), decision, "training decision");
    return db.transaction(async (tx) => {
      const run = await trainingRepo.get(tx, businessId, runId);
      if (run.decision) throw new ValidationError("Training run already decided", { runId, decision: run.decision });
      if (run.status !== "awaiting_decision" && run.status !== "done") throw new ValidationError(`Training run is ${run.status}, not awaiting a decision`, { runId });
      if (d === "promoted") {
        if (!run.toVersionId) throw new ValidationError("Training run produced no candidate version", { runId });
        await agentsRepo.promoteVersion(tx, businessId, run.agentId, run.toVersionId);
      }
      return one(
        await tx
          .update(trainingRuns)
          .set({ decision: d, status: "done", endedAt: run.endedAt ?? new Date(), watchUntil: d === "promoted" ? (options.watchUntil ?? run.watchUntil) : null })
          .where(scoped(businessId, runId))
          .returning(),
        "training run",
        runId,
      );
    });
  },
};
