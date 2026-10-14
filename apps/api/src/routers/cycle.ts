/** cycle.status / cycle.history / cycle.continueState — the shell's processing strip and Continue state (BUILD §5.4, §9.4). */
import { repos } from "@foundmill/db";
import { z } from "zod";
import { continueStateFor, cycleStatus, reconcileCycle } from "../services/cycle";
import { businessProcedure, router } from "../trpc";

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/**
 * A cycle whose workflow is gone is closed before the state is read, so Continue is never stuck on "processing". A
 * reader who cannot write (a viewer) or a Temporal outage just sees the state as it is.
 */
async function reconcileQuietly(ctx: Parameters<typeof reconcileCycle>[0]): Promise<void> {
  try {
    await reconcileCycle(ctx);
  } catch {
    /* reads never fail on the reconciler */
  }
}

export const cycleRouter = router({
  /** The running cycle (if any), active departments/agents, the last outcome and the next cycle number. */
  status: businessProcedure.query(async ({ ctx }) => {
    await reconcileQuietly(ctx);
    return ctx.rls((tx) => cycleStatus({ db: tx, businessId: ctx.businessId }));
  }),

  /** Continue button state computed server-side: holiday › blocked › win awaiting its Customer Update › processing › idle. */
  continueState: businessProcedure.query(async ({ ctx }) => {
    await reconcileQuietly(ctx);
    return ctx.rls((tx) => continueStateFor({ db: tx, businessId: ctx.businessId, userId: ctx.userId }));
  }),

  /** Past cycles, newest first (from `cycle.started` / `cycle.completed`). */
  history: businessProcedure.input(z.object({ limit: z.number().int().min(1).max(100).default(20) })).query(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const limit = input.limit;
      const page = await repos.events.list(tx, ctx.businessId, { type: ["cycle.started", "cycle.completed"], limit: Math.min(500, limit * 2 + 10) });
      const byId = new Map<string, { cycleId: string; cycleNumber: number | null; workflowId: string | null; trigger: string | null; startedAt: string | null; completedAt: string | null; outcome: string | null; tasksDispatched: number; tasksCompleted: number; inboxItemIds: string[]; durationMs: number | null }>();
      for (const e of [...page.items].reverse()) {
        const p = asRecord(e.payload);
        const cycleId = typeof p.cycleId === "string" ? p.cycleId : e.id;
        const row = byId.get(cycleId) ?? { cycleId, cycleNumber: null, workflowId: null, trigger: null, startedAt: null, completedAt: null, outcome: null, tasksDispatched: 0, tasksCompleted: 0, inboxItemIds: [], durationMs: null };
        row.cycleNumber = typeof p.cycleNumber === "number" ? p.cycleNumber : row.cycleNumber;
        row.workflowId = typeof p.workflowId === "string" ? p.workflowId : row.workflowId;
        if (e.type === "cycle.started") {
          row.startedAt = e.occurredAt.toISOString();
          row.trigger = typeof p.trigger === "string" ? p.trigger : null;
        } else {
          row.completedAt = e.occurredAt.toISOString();
          row.outcome = typeof p.outcome === "string" ? p.outcome : null;
          row.tasksDispatched = typeof p.tasksDispatched === "number" ? p.tasksDispatched : 0;
          row.tasksCompleted = typeof p.tasksCompleted === "number" ? p.tasksCompleted : 0;
          row.inboxItemIds = Array.isArray(p.inboxItemIds) ? (p.inboxItemIds as string[]) : [];
          row.durationMs = typeof p.durationMs === "number" ? p.durationMs : null;
        }
        byId.set(cycleId, row);
      }
      return { cycles: [...byId.values()].reverse().slice(0, limit) };
    }),
  ),
});
