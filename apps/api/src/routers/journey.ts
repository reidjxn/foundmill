/** journey.get/list/markViewed + daily rows and milestones for the Ribbon (BUILD §11.2, §11.4). */
import { JourneyListFilter, repos } from "@foundmill/db";
import { buildChapters } from "@foundmill/journey";
import { buildJourneyRecord } from "../services/journey";
import { z } from "zod";
import { Id, businessProcedure, router } from "../trpc";

const DayKey = z.string().date();

export const journeyRouter = router({
  /**
   * One Customer Update: the stored row with its conversion, touches and entity, plus `journey`, the full
   * `@foundmill/journey` Journey record (channels, captain, standout agent, stats, nth of kind, consent / partial
   * journey, attribution model, xC model source) built server-side so the replay is deterministic (AC-11.4.3).
   */
  get: businessProcedure.input(z.object({ journeyId: Id })).query(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const detail = await repos.journeys.get(tx, ctx.businessId, input.journeyId);
      const record = await buildJourneyRecord(tx, ctx.businessId, detail);
      return { ...detail, agents: record.journey.agents, journey: record.journey, journeyTouches: record.touches, conversionCount: record.conversionCount, acquisitionCostLabel: record.acquisitionCostLabel, speedHint: record.journey.fullMatchDay ? ("full" as const) : ("highlights" as const) };
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
      const firstDay = (ctx.business.committedAt ?? ctx.business.createdAt).toISOString().slice(0, 10);
      const chapters = buildChapters({ startDay: firstDay, today: to, horizonQuarters: 2 });
      // `kickoff` is the wave-2 key the Ribbon reads; `firstDay` is the vocabulary-rule name.
      return { rows, conversions: conversions.items, milestones, chapters, kickoff: firstDay, firstDay, today: to, forecastLabel: "Forecast" as const };
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
