/**
 * import.start / import.status / import.sources — Door B (BUILD §11.1, AC-11.1.5). Account-scoped: the import runs
 * before a business exists; with `businessId` (member required) the sources are stored on the business and the
 * orchestrator's `importBusiness` workflow runs when Temporal is reachable.
 *
 * import.prepareConcept / import.continue — "Continue to Commit" without the wait (audit P7): the Import screen asks
 * for the concept card as soon as the report is on screen; Continue saves the card drafted ahead (services/import-concept.ts).
 *
 * import.readAgain — Read now in Product › Sources: the business's import sources the gateway did not read (not
 * connected yet, refused, failed) are read again by `importBusiness` once the founder has connected them.
 */
import { repos } from "@foundmill/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { IMPORT_SOURCES, IMPORT_SOURCE_KEYS, SourceConfig, importJobKey, importStatus, readImportSourcesAgain, startImport } from "../services/import";
import { continueImport, prepareImportConcept } from "../services/import-concept";
import { Id, adminProcedure, audit, protectedProcedure, router } from "../trpc";

const JobInput = z.object({ jobId: z.string().min(8).max(8192) });

export const importRouter = router({
  /** The catalogue the picker renders (labels, which input each source needs, which connector reads it). */
  sources: protectedProcedure.query(() => IMPORT_SOURCE_KEYS.map((k) => ({ ...IMPORT_SOURCES[k], readOnly: true as const }))),

  start: protectedProcedure.input(z.object({ businessId: Id.nullable().optional(), sources: z.array(SourceConfig).min(1).max(IMPORT_SOURCE_KEYS.length), stepMs: z.number().int().min(1).max(10_000).optional() })).mutation(async ({ ctx, input }) => {
    if (input.businessId) {
      const membership = await repos.memberships.get(ctx.db, input.businessId, ctx.userId);
      if (!membership || !["owner", "admin"].includes(membership.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Only an owner or admin can import into this business" });
    }
    const result = await startImport({ db: ctx.db, temporal: ctx.temporal, key: importJobKey(ctx.env) }, { userId: ctx.userId, businessId: input.businessId ?? null, sources: input.sources, stepMs: input.stepMs });
    if (input.businessId) {
      await repos.audit.append(ctx.db, input.businessId, { actorKind: "user", actorId: ctx.userId, action: "import.start", target: { kind: "import_job", id: result.job.id.slice(0, 64) }, details: { mode: result.job.mode, workflowId: result.job.workflowId, sources: input.sources.map((s) => s.key) } });
    }
    return result;
  }),

  status: protectedProcedure.input(JobInput).query(async ({ ctx, input }) => {
    const result = await importStatus({ db: ctx.db, key: importJobKey(ctx.env) }, input.jobId, ctx.userId);
    if (result.job.businessId) {
      const membership = await repos.memberships.get(ctx.db, result.job.businessId, ctx.userId);
      if (!membership) throw new TRPCError({ code: "NOT_FOUND", message: "import job not found" });
    }
    return result;
  }),

  /** Owner/admin: read again the import sources that were not read (BAD_REQUEST for one that was read or is not an import). */
  readAgain: adminProcedure.input(z.object({ sourceIds: z.array(Id).min(1).max(IMPORT_SOURCE_KEYS.length) })).mutation(async ({ ctx, input }) => {
    const result = await readImportSourcesAgain({ db: ctx.db, temporal: ctx.temporal }, ctx.businessId, input.sourceIds);
    await audit(ctx.db, ctx, { action: "import.read_again", target: { kind: "source", id: result.sourceIds[0]! }, details: { sourceIds: result.sourceIds, workflowId: result.workflow.workflowId, queued: result.workflow.queued } });
    return result;
  }),

  /**
   * Drafts the concept card for a finished sign-up import while the founder reads the report (held in memory, never
   * saved until `continue`). Idempotent per job; answers at once with "drafting" or "ready".
   */
  prepareConcept: protectedProcedure.input(JobInput).mutation(({ ctx, input }) => prepareImportConcept({ db: ctx.db, models: ctx.models, limits: ctx.limits, key: importJobKey(ctx.env) }, input.jobId, ctx.userId)),

  /** "Continue to Commit": the card drafted ahead (or drafted now), saved as the founder's idea and linked to the import. */
  continue: protectedProcedure.input(JobInput).mutation(({ ctx, input }) => continueImport({ db: ctx.db, models: ctx.models, limits: ctx.limits, key: importJobKey(ctx.env) }, input.jobId, ctx.userId)),
});
