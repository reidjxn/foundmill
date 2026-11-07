/**
 * today.get — the business's front door (founder, 2026-11-07): the first notes of Needs you with their one-tap answers,
 * "This week and next" in plain sentences, and the week's spend in each currency (services/today.ts). Any member; each
 * part follows the reader's section access. The goal is `goal.current` / `goal.ensure`.
 */
import { todayView } from "../services/today";
import { businessProcedure, router } from "../trpc";

export const todayRouter = router({
  get: businessProcedure.query(({ ctx }) => todayView(ctx)),
});
