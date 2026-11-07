/**
 * goal.current / goal.ensure / goal.approve / goal.requestChange — the business's goal (founder, 2026-11-07: "Your goal").
 * `ensure` is what Home calls once per visit (any member; idempotent; it writes only for a member who can write to the
 * Inbox); the decisions are the same as the Chief of Staff's note in the Inbox (services/goals.ts). A change request may
 * call the goal route, so it spends the planning allowance.
 */
import { z } from "zod";
import { approveGoal, ensureGoal, goalView, requestGoalChange } from "../services/goals";
import { modelLimited } from "../services/model-limits";
import { Id, businessProcedure, router, sectionWrite } from "../trpc";

const write = sectionWrite("inbox");

export const goalRouter = router({
  current: businessProcedure.query(({ ctx }) => ctx.rls((tx) => goalView(tx, ctx))),
  ensure: businessProcedure.mutation(async ({ ctx }) => {
    const result = await ensureGoal(ctx);
    return { ...result.views, proposedNow: result.proposed, achievedNow: result.achieved };
  }),
  approve: write.input(z.object({ goalId: Id })).mutation(async ({ ctx, input }) => {
    const result = await approveGoal(ctx, { goalId: input.goalId, via: "goal" });
    return { goal: result.goal, inboxItemId: result.answered?.item.id ?? null };
  }),
  requestChange: write
    .input(z.object({ goalId: Id, notes: z.string().trim().min(1).max(2000) }))
    .use(modelLimited("plan"))
    .mutation(async ({ ctx, input }) => {
      const result = await requestGoalChange(ctx, { goalId: input.goalId, notes: input.notes, via: "goal" });
      return { goal: result.goal, revised: result.revised?.goal ?? null, revisedItemId: result.revised?.item.id ?? null };
    }),
});
