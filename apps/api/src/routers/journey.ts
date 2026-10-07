/** journey.get/list/markViewed + daily rows and milestones for the Ribbon (BUILD §11.2, §11.4). */
import { JourneyListFilter, repos } from "@foundmill/db";
import { buildChapters, type Journey as JourneyRecord } from "@foundmill/journey";
import { z } from "zod";
import { Id, businessProcedure, router } from "../trpc";

const DayKey = z.string().date();

export const journeyRouter = router({
  /** One Match Day: the stored journey record (deterministic replay input, AC-11.4.3) with its conversion and touches. */
  get: businessProcedure.input(z.object({ journeyId: Id })).query(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const detail = await repos.journeys.get(tx, ctx.businessId, input.journeyId);
      const agents = detail.agents as JourneyRecord["agents"];
      return { ...detail, agents, speedHint: "full" as const };
    }),
  ),

  list: businessProcedure.input(JourneyListFilter).query(({ ctx, input }) => ctx.rls((tx) => repos.journeys.list(tx, ctx.businessId, input ?? {}))),

  markViewed: businessProcedure.input(z.object({ journeyId: Id })).mutation(({ ctx, input }) => ctx.rls((tx) => repos.journeys.markViewed(tx, ctx.businessId, input.journeyId))),

  /** Ribbon data: per-department daily rows, conversions, milestones and chapters for a day range. */
  ribbon: businessProcedure.input(z.object({ from: DayKey.optional(), to: DayKey.optional(), departmentId: Id.optional() })).query(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const from = input.from ?? new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
      const to = input.to ?? new Date().toISOString().slice(0, 10);
      const [rows, conversions, milestones] = await Promise.all([
        repos.journeys.dailyRange(tx, ctx.businessId, { from, to, departmentId: input.departmentId }),
        repos.journeys.listConversions(tx, ctx.businessId, { from: new Date(from), to: new Date(`${to}T23:59:59.999Z`), limit: 500 }),
        repos.journeys.listMilestones(tx, ctx.businessId, {}),
      ]);
      const kickoff = (ctx.business.committedAt ?? ctx.business.createdAt).toISOString().slice(0, 10);
      const chapters = buildChapters({ startDay: kickoff, today: to, horizonQuarters: 2 });
      return { rows, conversions: conversions.items, milestones, chapters, kickoff, today: to, forecastLabel: "Forecast" as const };
    }),
  ),

  roundup: businessProcedure.input(z.object({ day: DayKey })).query(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const from = new Date(`${input.day}T00:00:00.000Z`);
      const to = new Date(`${input.day}T23:59:59.999Z`);
      const conversions = await repos.journeys.listConversions(tx, ctx.businessId, { from, to, limit: 500 });
      return { day: input.day, conversions: conversions.items };
    }),
  ),
});
