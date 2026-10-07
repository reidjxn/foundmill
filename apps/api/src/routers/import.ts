/**
 * import.start / import.status / import.sources — Door B (BUILD §11.1, AC-11.1.5). Account-scoped: the import runs
 * before a business exists; with `businessId` (member required) the sources are stored on the business and the
 * orchestrator's `importBusiness` workflow runs when Temporal is reachable.
 */
import { repos } from "@foundmill/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { IMPORT_SOURCES, IMPORT_SOURCE_KEYS, SourceConfig, importStatus, startImport } from "../services/import";
import { Id, protectedProcedure, router } from "../trpc";

export const importRouter = router({
  /** The catalogue the picker renders (labels, which input each source needs, which connector reads it). */
  sources: protectedProcedure.query(() => IMPORT_SOURCE_KEYS.map((k) => ({ ...IMPORT_SOURCES[k], readOnly: true as const }))),

  start: protectedProcedure.input(z.object({ businessId: Id.nullable().optional(), sources: z.array(SourceConfig).min(1).max(IMPORT_SOURCE_KEYS.length), stepMs: z.number().int().min(1).max(10_000).optional() })).mutation(async ({ ctx, input }) => {
    if (input.businessId) {
      const membership = await repos.memberships.get(ctx.db, input.businessId, ctx.userId);
      if (!membership || !["owner", "admin"].includes(membership.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Only an owner or admin can import into this business" });
    }
    const result = await startImport({ db: ctx.db, temporal: ctx.temporal }, { businessId: input.businessId ?? null, sources: input.sources, stepMs: input.stepMs });
    if (input.businessId) {
      await repos.audit.append(ctx.db, input.businessId, { actorKind: "user", actorId: ctx.userId, action: "import.start", target: { kind: "import_job", id: result.job.id.slice(0, 64) }, details: { mode: result.job.mode, workflowId: result.job.workflowId, sources: input.sources.map((s) => s.key) } });
    }
    return result;
  }),

  status: protectedProcedure.input(z.object({ jobId: z.string().min(8).max(8192) })).query(async ({ ctx, input }) => {
    const result = await importStatus({ db: ctx.db }, input.jobId);
    if (result.job.businessId) {
      const membership = await repos.memberships.get(ctx.db, result.job.businessId, ctx.userId);
      if (!membership) throw new TRPCError({ code: "NOT_FOUND", message: "import job not found" });
    }
    return result;
  }),
});
