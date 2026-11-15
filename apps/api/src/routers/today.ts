/**
 * today.get — the business's front door (founder, 2026-11-07): the first notes of Needs you with their one-tap answers,
 * "This week and next" in plain sentences, and the week's spend in each currency (services/today.ts). Any member; each
 * part follows the reader's section access. The goal is `goal.current` / `goal.ensure`.
 */
import { sinceLastVisitFor, streakFor, todayView, visitFor } from "../services/today";
import { businessProcedure, router } from "../trpc";

export const todayRouter = router({
  get: businessProcedure.query(({ ctx }) => todayView(ctx)),
  /** "Since you were last here" (retention plan, 2026-11-11): null on a first session or when nothing happened. */
  sinceLastVisit: businessProcedure.query(({ ctx }) => sinceLastVisitFor(ctx)),
  /** The founder's daily streak here (days in a row they opened the business; vacation days frozen). */
  streak: businessProcedure.query(({ ctx }) => streakFor(ctx)),
  /** Both of the above in one read and one transaction: what the web's Today asks for. */
  visit: businessProcedure.query(({ ctx }) => visitFor(ctx)),
});
