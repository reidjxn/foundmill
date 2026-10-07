/** training_runs — the Training screen lifecycle (BUILD §11.10; routers agent.training.*). */
import { ValidationError } from "@foundmill/shared";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { TRAINING_DECISIONS, TRAINING_STATUSES, trainingRuns, type TrainingRun } from "../schema";
import { agentsRepo } from "./agents";
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
