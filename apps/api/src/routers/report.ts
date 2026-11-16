/**
 * report.create — a signed-in person reports a person, a public profile or a message (docs/NETWORK.md F21; 0112), and
 * may block the person in the same step. A `protectedProcedure` (admitted accounts: throwaway accounts on the waitlist
 * cannot pile reports on someone), and not behind `liveGate`, because stepping back never waits for the people layer.
 *
 * The answer is always `{ reported: true, blocked }`, with `blocked` echoing what was asked: an unknown handle, a profile that is not public, the reporter's own
 * account, a message in a thread they were never in and a second report of the same thing all store nothing and read
 * the same, so the procedure cannot be used to probe who exists. Limited per person per day in the shared store.
 *
 * operator.reports.* — the platform's review queue, for the accounts in `OPERATOR_USER_IDS` only (`operatorProcedure`).
 */
import { REPORT_RESOLUTIONS } from "@foundmill/shared/reports";
import { repos } from "@foundmill/db";
import { z } from "zod";
import { fileReport, ReportInput } from "../services/reports";
import { Id, operatorProcedure, protectedProcedure, publicProcedure, router } from "../trpc";

export const reportRouter = router({
  create: protectedProcedure
    .input(ReportInput)
    .mutation(({ ctx, input }) => fileReport(ctx, input)),
  /**
   * Whether /u/<handle> shows its Report control to this visitor: signed in, and not the page's own person. It says
   * nothing a signed-out visitor could not see (the page is public), and false for an unknown handle.
   */
  canReportProfile: publicProcedure
    .input(z.object({ handle: z.string().trim().min(1).max(64) }))
    .query(async ({ ctx, input }) => {
      if (!ctx.userId) return { canReport: false };
      const owner = await repos.reports.profileOwner(ctx.db, input.handle);
      return { canReport: owner !== null && owner !== ctx.userId };
    }),
});

export const operatorRouter = router({
  reports: router({
    /** Open reports, oldest first, each with when it is due, the names, the message as it reads now and the pattern. */
    list: operatorProcedure
      .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }).optional())
      .query(async ({ ctx, input }) => {
        const [open, counts] = await Promise.all([
          repos.reports.listOpen(ctx.db, { limit: input?.limit ?? 100 }),
          repos.reports.counts(ctx.db),
        ]);
        return { reports: open, counts };
      }),
    resolve: operatorProcedure
      .input(z.object({ reportId: Id, resolution: z.enum(REPORT_RESOLUTIONS) }))
      .mutation(async ({ ctx, input }) => {
        const row = await repos.reports.resolve(
          ctx.db,
          input.reportId,
          ctx.userId,
          input.resolution,
        );
        return { resolved: row !== null };
      }),
  }),
});
