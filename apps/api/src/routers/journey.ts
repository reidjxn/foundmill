/**
 * journey.get/list/markViewed + daily rows and milestones for the Ribbon (BUILD §11.2, §11.4), and
 * journey.showMilestone / journey.hideMilestone: an owner or an admin shows a reached milestone on the project's page
 * or takes it off (services/milestones.ts; migration 0089), audited, with `milestone.shown` / `milestone.hidden`
 * through the outbox in the same transaction.
 */
import { JourneyListFilter, NO_DEPARTMENT_ID, repos } from "@foundmill/db";
import { buildChapters, compareByTimeThenId, shouldPlayFullMatchDay } from "@foundmill/journey";
import { addDaysToDay, dayKeyIn, dayRangeIn } from "@foundmill/shared";
import { loadRedactionSource, redactValue } from "../services/inbox-redaction";
import { attributionSummary, buildJourneyRecord } from "../services/journey";
import { journeyWalls, wallConversion, wallJourneyDetail, wallRibbon } from "../services/journey-walls";
import { hideMilestone, showMilestone } from "../services/milestones";
import { shareUpdate, unshareUpdate, updateCardState } from "../services/update-cards";
import { UPDATE_CARD_NOTE_MAX } from "@foundmill/shared/update-cards";
import { z } from "zod";
import { Id, businessProcedure, router, sectionAdmin, sectionRead } from "../trpc";

const DayKey = z.string().date();
/** Customer Updates and their conversions are the Distribution section's; money and names follow the Finance and CRM walls. */
const read = sectionRead("distribution");
/** Showing a milestone puts it on the project's public page: the right that publishes that page (`page.publish`). */
const showOnPage = sectionAdmin("product");

const DAY_MS = 86_400_000;
/** How far the Ribbon reaches: ten years back for `from`, two years ahead for `to` (the forecast horizon is shorter). */
export const RIBBON_MAX_PAST_DAYS = 3653;
export const RIBBON_MAX_FUTURE_DAYS = 731;

const dayOffset = (days: number, now = Date.now()) => new Date(now + days * DAY_MS).toISOString().slice(0, 10);

/**
 * A ribbon range: `from` no earlier than ten years back, `to` no later than two years ahead, and `from` not after
 * `to`. Anything else is a BAD_REQUEST, never a chapter walk of centuries (a 500).
 */
export const RibbonInput = z
  .object({ from: DayKey.optional(), to: DayKey.optional(), departmentId: Id.optional(), slim: z.boolean().optional() })
  .superRefine((v, issue) => {
    const earliest = dayOffset(-RIBBON_MAX_PAST_DAYS);
    const latest = dayOffset(RIBBON_MAX_FUTURE_DAYS);
    for (const key of ["from", "to"] as const) {
      const day = v[key];
      if (day && (day < earliest || day > latest)) issue.addIssue({ code: "custom", path: [key], message: `Pick a day between ${earliest} and ${latest}` });
    }
    if (v.from && v.to && v.from > v.to) issue.addIssue({ code: "custom", path: ["from"], message: "The start of the range comes after its end" });
  });

/** The range a ribbon reads: the last year to today (in the business's own zone) unless given. */
export function ribbonRange(input: { from?: string; to?: string }, now = Date.now(), zone: string | null = null): { from: string; to: string } {
  const to = input.to ?? dayKeyIn(now, zone);
  const yearAgo = dayKeyIn(now - 365 * DAY_MS, zone);
  const from = input.from ?? (yearAgo < to ? yearAgo : to);
  return { from, to };
}

/**
 * Chapters whose quarter has ended (before `today`, whatever range is on screen) and that have no stored title yet,
 * newest first: the ones to ask the composer about, two at a time.
 */
export function untitledEndedChapters(chapters: readonly { id: string; endsOn: string }[], titles: Record<string, string>, today = dayOffset(0), max = 2): { id: string }[] {
  return chapters.filter((c) => c.endsOn < today && !titles[c.id]).reverse().slice(0, max);
}

export const journeyRouter = router({
  /**
   * One Customer Update: the stored row with its conversion, touches and entity, plus `journey`, the full
   * `@foundmill/journey` Journey record (channels, captain, standout agent, stats, nth of kind, consent / partial
   * journey, attribution model, xC model source) built server-side so the replay is deterministic (AC-11.4.3).
   */
  get: read.input(z.object({ journeyId: Id })).query(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const detail = await repos.journeys.get(tx, ctx.businessId, input.journeyId);
      const record = await buildJourneyRecord(tx, ctx.businessId, detail);
      return wallJourneyDetail(tx, ctx.businessId, { ...detail, agents: record.journey.agents, journey: record.journey, journeyTouches: record.touches, conversionCount: record.conversionCount, acquisitionCostLabel: record.acquisitionCostLabel, speedHint: record.journey.fullMatchDay ? ("full" as const) : ("highlights" as const) }, journeyWalls(ctx.membership));
    }),
  ),

  list: read.input(JourneyListFilter).query(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const page = await repos.journeys.list(tx, ctx.businessId, input ?? {});
      const walls = journeyWalls(ctx.membership);
      if (!walls.finance && !walls.crm) return page;
      // The commentary names the customer and quotes the money, so a list row is redacted like the detail (audit ARB-12).
      const entityIds = page.items.flatMap((j) => (j.conversion.entityId ? [j.conversion.entityId] : []));
      const source = await loadRedactionSource(tx, ctx.businessId, { finance: walls.finance, crm: walls.crm }, entityIds);
      return {
        ...page,
        items: page.items.map((j) => ({ ...j, commentary: redactValue(j.commentary, source, { ids: j.conversion.entityId ? [j.conversion.entityId] : [], customer: true }), conversion: wallConversion(j.conversion, walls) })),
      };
    }),
  ),

  /**
   * The journey of a conversion, or null when the win has none (yet): links that only know the conversion (Ribbon
   * markers, CRM activity, milestones) resolve through this, whatever the age of the win.
   */
  forConversion: read.input(z.object({ conversionId: Id })).query(({ ctx, input }) =>
    ctx.rls(async (tx) => ({ journeyId: (await repos.journeys.forConversion(tx, ctx.businessId, input.conversionId))?.id ?? null })),
  ),

  /**
   * The Attribution screen's model in use (BUILD §11.4): labeled conversions over the whole history on the basis
   * `chooseModel` and the journey builder use, and every Customer Update with the partial ones (consent not granted).
   */
  attribution: read.query(({ ctx }) => ctx.rls((tx) => attributionSummary(tx, ctx.businessId))),

  markViewed: read.input(z.object({ journeyId: Id })).mutation(({ ctx, input }) => ctx.rls((tx) => repos.journeys.markViewed(tx, ctx.businessId, input.journeyId))),

  /**
   * Ribbon data: per-department daily rows, conversions, milestones and chapters for a day range. `slim` leaves out the
   * per-conversion detail (`conversions` is empty) for readers that only need the daily rows, the milestones and how
   * many conversions there were (`conversionCount`): the Home status strip, department cards and day-one check share
   * one slim query. Home's for every member: what a section wall hides is taken out (services/journey-walls.ts).
   */
  ribbon: businessProcedure.input(RibbonInput).query(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      // Days are the business's own (0041): "today" and the conversion window follow its time zone, as journey_daily does.
      const zone = ctx.business.timeZone;
      const { from, to } = ribbonRange(input, Date.now(), zone);
      const range = dayRangeIn(from, to, zone);
      const firstDay = dayKeyIn(ctx.business.committedAt ?? ctx.business.createdAt, zone);
      // Customers (first payments) as one server figure each, whatever range is on screen (one number per fact,
      // DECISIONS 2026-11-10): this week is the business's last 7 days with today, the week before the 7 before, and
      // the total is every first payment, the count the customer milestones are reached at.
      const today = dayKeyIn(Date.now(), zone);
      const [rows, conversions, milestones, counts, quarters, titles, weekCounts, previousCounts, allCounts] = await Promise.all([
        repos.journeys.dailyRange(tx, ctx.businessId, { from, to, departmentId: input.departmentId }),
        // Customers won (and signups, activations): a renewal or a repeat order is revenue in the daily rows, not a marker.
        input.slim ? Promise.resolve({ items: [] }) : repos.journeys.listConversions(tx, ctx.businessId, { ...range, firstPayment: true, limit: 500 }),
        repos.journeys.listMilestones(tx, ctx.businessId, {}),
        repos.journeys.countConversions(tx, ctx.businessId, range),
        // Chapters cover the business's whole life whatever range is on screen: its totals per quarter, from kick-off.
        repos.journeys.quarterTotals(tx, ctx.businessId, { from: firstDay < to ? firstDay : to, to }),
        repos.journeys.chapterTitles(tx, ctx.businessId),
        repos.journeys.countConversions(tx, ctx.businessId, dayRangeIn(addDaysToDay(today, -6), today, zone)),
        repos.journeys.countConversions(tx, ctx.businessId, dayRangeIn(addDaysToDay(today, -13), addDaysToDay(today, -7), zone)),
        repos.journeys.countConversions(tx, ctx.businessId, {}),
      ]);
      const customers = { today, thisWeek: weekCounts.payment ?? 0, previousWeek: previousCounts.payment ?? 0, total: allCounts.payment ?? 0 };
      const conversionCount = Object.values(counts).reduce((n, c) => n + c, 0);
      const walls = journeyWalls(ctx.membership);
      // Behind a Finance wall a chapter is built without money, so neither its totals nor its provisional title
      // ("Growth", "A tough quarter": revenue against the quarter before) say what the revenue did.
      const quarterRows = walls.finance ? quarters.map((q) => ({ ...q, spendMinor: 0, revenueMinor: 0 })) : quarters;
      const chapters = buildChapters({
        startDay: firstDay,
        today: to,
        horizonQuarters: 2,
        daily: quarterRows.map((q) => ({ ...q, departmentId: null, agentHours: Number(q.agentHours) })),
        milestones: milestones.map((m) => ({ kind: m.kind, label: m.label, achievedAt: m.achievedAt.toISOString(), ref: m.ref ?? null, visibility: m.visibility, trophyKey: null })),
        titles,
      });
      // An ended quarter without its Opus title yet: ask the composer (it stores the title; this read never waits).
      for (const c of untitledEndedChapters(chapters, titles, dayKeyIn(new Date(), zone))) ctx.composer.requestChapterTitle(ctx.businessId, c.id);
      // `kickoff` is the wave-2 key the Ribbon reads; `firstDay` is the vocabulary-rule name.
      // The Ribbon (packages/dugout journey types) reads ISO strings; drizzle hands back Date objects for tstz columns.
      // The matview keys the business-wide row by the nil uuid and returns numeric/bigint columns as strings; the
      // Ribbon and the revenue widgets read `departmentId: null` and numbers.
      const dailyRows = rows.map((r) => ({ ...r, departmentId: r.departmentId === NO_DEPARTMENT_ID ? null : r.departmentId, agentHours: Number(r.agentHours), spendMinor: Number(r.spendMinor), revenueMinor: Number(r.revenueMinor) }));
      const labelled = conversions.items.length ? await repos.journeys.labelConversions(tx, ctx.businessId, conversions.items) : [];
      return wallRibbon({ rows: dailyRows, conversions: labelled.map((c) => ({ ...c, occurredAt: c.occurredAt.toISOString() })), conversionCount, milestones: milestones.map((m) => ({ ...m, achievedAt: m.achievedAt.toISOString() })), chapters, customers, kickoff: firstDay, firstDay, today: to, forecastLabel: "Forecast" as const }, walls);
    }),
  ),

  /** Shows a reached milestone on the project's page: a line of its story (`/p/<slug>/story`) and a card (`/m/<id>`). */
  showMilestone: showOnPage.input(z.object({ milestoneId: Id })).mutation(({ ctx, input }) => showMilestone(ctx, input)),
  /** Takes a shown milestone off the page; its card answers not found. */
  hideMilestone: showOnPage.input(z.object({ milestoneId: Id })).mutation(({ ctx, input }) => hideMilestone(ctx, input)),

  /** Whether one Customer Update can be shared as a card, what the card would show, and the card while it is shared (WP-14 T9). */
  updateCard: read.input(z.object({ journeyId: Id })).query(({ ctx, input }) => updateCardState(ctx, input)),
  /** Shares one Customer Update as a public card (`/m/update/<id>`): the founder's own press, each time. */
  shareUpdate: showOnPage.input(z.object({ journeyId: Id, note: z.string().max(UPDATE_CARD_NOTE_MAX * 4).nullish() })).mutation(({ ctx, input }) => shareUpdate(ctx, input)),
  /** Stops sharing: the card is deleted and its address answers not found. */
  unshareUpdate: showOnPage.input(z.object({ journeyId: Id })).mutation(({ ctx, input }) => unshareUpdate(ctx, input)),

  roundup: read.input(z.object({ day: DayKey })).query(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const { from, to } = dayRangeIn(input.day, input.day, ctx.business.timeZone);
      const conversions = await repos.journeys.listConversions(tx, ctx.businessId, { from, to, firstPayment: true, limit: 500 });
      // Every conversion of one day, named, for the Ribbon's hover card and day digest (the ribbon query only carries the latest 500).
      const labelled = await repos.journeys.labelConversions(tx, ctx.businessId, conversions.items);
      // The volume rule (BUILD §11.4): after the 100th of a kind, a win below the 75th percentile (and not high-value) rolls
      // into the day's results table instead of getting a full Customer Update. Numbered from what the business had before the day.
      const [before, p75] = await Promise.all([repos.journeys.countConversions(tx, ctx.businessId, { to: new Date(from.getTime() - 1) }), repos.journeys.paymentPercentile75(tx, ctx.businessId)]);
      const counts = { ...before };
      const rolledUp: string[] = [];
      const named = labelled.map((c) => ({ ...c, occurredAt: c.occurredAt.toISOString() }));
      for (const c of [...named].sort(compareByTimeThenId)) {
        counts[c.kind] += 1;
        if (!shouldPlayFullMatchDay(c.kind, counts[c.kind], c.amountMinor, c.kind === "payment" ? p75 : null, false)) rolledUp.push(c.id);
      }
      const walls = journeyWalls(ctx.membership);
      return { day: input.day, conversions: named.map((c) => wallConversion(c, walls)), rolledUp };
    }),
  ),
});
