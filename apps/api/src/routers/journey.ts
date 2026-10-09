/** journey.get/list/markViewed + daily rows and milestones for the Ribbon (BUILD §11.2, §11.4). */
import { JourneyListFilter, NO_DEPARTMENT_ID, repos } from "@foundmill/db";
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

  /**
   * Ribbon data: per-department daily rows, conversions, milestones and chapters for a day range. `slim` leaves out the
   * per-conversion detail (`conversions` is empty) for readers that only need the daily rows, the milestones and how
   * many conversions there were (`conversionCount`): the Home status strip, department cards and day-one check share
   * one slim query.
   */
  ribbon: businessProcedure.input(z.object({ from: DayKey.optional(), to: DayKey.optional(), departmentId: Id.optional(), slim: z.boolean().optional() })).query(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const from = input.from ?? new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
      const to = input.to ?? new Date().toISOString().slice(0, 10);
      const range = { from: new Date(from), to: new Date(`${to}T23:59:59.999Z`) };
      const [rows, conversions, milestones, counts] = await Promise.all([
        repos.journeys.dailyRange(tx, ctx.businessId, { from, to, departmentId: input.departmentId }),
        input.slim ? Promise.resolve({ items: [] }) : repos.journeys.listConversions(tx, ctx.businessId, { ...range, limit: 500 }),
        repos.journeys.listMilestones(tx, ctx.businessId, {}),
        repos.journeys.countConversions(tx, ctx.businessId, range),
      ]);
      const conversionCount = Object.values(counts).reduce((n, c) => n + c, 0);
      const firstDay = (ctx.business.committedAt ?? ctx.business.createdAt).toISOString().slice(0, 10);
      const chapters = buildChapters({ startDay: firstDay, today: to, horizonQuarters: 2 });
      // `kickoff` is the wave-2 key the Ribbon reads; `firstDay` is the vocabulary-rule name.
      // The Ribbon (packages/dugout journey types) reads ISO strings; drizzle hands back Date objects for tstz columns.
      // The matview keys the business-wide row by the nil uuid and returns numeric/bigint columns as strings; the
      // Ribbon and the revenue widgets read `departmentId: null` and numbers.
      const dailyRows = rows.map((r) => ({ ...r, departmentId: r.departmentId === NO_DEPARTMENT_ID ? null : r.departmentId, agentHours: Number(r.agentHours), spendMinor: Number(r.spendMinor), revenueMinor: Number(r.revenueMinor) }));
      const labelled = conversions.items.length ? await repos.journeys.labelConversions(tx, ctx.businessId, conversions.items) : [];
      return { rows: dailyRows, conversions: labelled.map((c) => ({ ...c, occurredAt: c.occurredAt.toISOString() })), conversionCount, milestones: milestones.map((m) => ({ ...m, achievedAt: m.achievedAt.toISOString() })), chapters, kickoff: firstDay, firstDay, today: to, forecastLabel: "Forecast" as const };
    }),
  ),

  roundup: businessProcedure.input(z.object({ day: DayKey })).query(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const from = new Date(`${input.day}T00:00:00.000Z`);
      const to = new Date(`${input.day}T23:59:59.999Z`);
      const conversions = await repos.journeys.listConversions(tx, ctx.businessId, { from, to, limit: 500 });
      // Every conversion of one day, named, for the Ribbon's hover card and day digest (the ribbon query only carries the latest 500).
      const labelled = await repos.journeys.labelConversions(tx, ctx.businessId, conversions.items);
      return { day: input.day, conversions: labelled.map((c) => ({ ...c, occurredAt: c.occurredAt.toISOString() })) };
    }),
  ),
});
