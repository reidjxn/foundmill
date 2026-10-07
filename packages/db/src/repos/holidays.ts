/** holiday_periods — founder away, Chief of Staff in charge (BUILD §11.9 "holiday"; routers business.startHoliday/endHoliday). */
import { ValidationError } from "@founder-manager/shared";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { holidayPeriods, type HolidayPeriod } from "../schema";
import { Currency, defined, Id, JsonObject, MinorAmount, one, parseInput, type Executor } from "./_shared";

export const StartHolidayInput = z
  .object({
    untilAt: z.coerce.date().nullable().optional(),
    untilCondition: JsonObject.nullable().optional(),
    authority: JsonObject.default({}),
    budgetCeilingMinor: MinorAmount.nullable().optional(),
    currency: Currency.optional(),
    wakeEvents: z.array(z.string()).default([]),
    startedBy: Id.nullable().optional(),
    startedAt: z.coerce.date().optional(),
  })
  .refine((v) => Boolean(v.untilAt) || Boolean(v.untilCondition), { message: "a holiday ends at a time or on a condition" });
export type StartHolidayInput = z.input<typeof StartHolidayInput>;

export const UpdateHolidayInput = z.object({
  untilAt: z.coerce.date().nullable().optional(),
  untilCondition: JsonObject.nullable().optional(),
  authority: JsonObject.optional(),
  budgetCeilingMinor: MinorAmount.nullable().optional(),
  wakeEvents: z.array(z.string()).optional(),
});
export type UpdateHolidayInput = z.input<typeof UpdateHolidayInput>;

const scoped = (businessId: string, id: string) => and(eq(holidayPeriods.businessId, businessId), eq(holidayPeriods.id, id));

export const holidaysRepo = {
  /** The running holiday (started, not ended), or null. */
  async current(db: Executor, businessId: string): Promise<HolidayPeriod | null> {
    const rows = await db
      .select()
      .from(holidayPeriods)
      .where(and(eq(holidayPeriods.businessId, businessId), isNotNull(holidayPeriods.startedAt), isNull(holidayPeriods.endedAt), isNull(holidayPeriods.archivedAt)))
      .orderBy(desc(holidayPeriods.startedAt))
      .limit(1);
    return rows[0] ?? null;
  },

  async list(db: Executor, businessId: string, limit = 50): Promise<HolidayPeriod[]> {
    return db.select().from(holidayPeriods).where(and(eq(holidayPeriods.businessId, businessId), isNull(holidayPeriods.archivedAt))).orderBy(desc(holidayPeriods.createdAt)).limit(limit);
  },

  async get(db: Executor, businessId: string, holidayId: string): Promise<HolidayPeriod> {
    return one(await db.select().from(holidayPeriods).where(scoped(businessId, holidayId)).limit(1), "holiday", holidayId);
  },

  /** Starts a holiday; refuses while one is running. */
  async start(db: Executor, businessId: string, input: StartHolidayInput): Promise<HolidayPeriod> {
    const v = parseInput(StartHolidayInput, input, "holiday");
    return db.transaction(async (tx) => {
      const running = await holidaysRepo.current(tx, businessId);
      if (running) throw new ValidationError("A holiday is already running", { holidayId: running.id });
      return one(
        await tx
          .insert(holidayPeriods)
          .values({
            businessId,
            untilAt: v.untilAt ?? null,
            untilCondition: v.untilCondition ?? null,
            authority: v.authority,
            budgetCeilingMinor: v.budgetCeilingMinor ?? null,
            ...(v.currency ? { currency: v.currency } : {}),
            wakeEvents: v.wakeEvents,
            startedAt: v.startedAt ?? new Date(),
            startedBy: v.startedBy ?? null,
          })
          .returning(),
        "holiday",
      );
    });
  },

  async update(db: Executor, businessId: string, holidayId: string, input: UpdateHolidayInput): Promise<HolidayPeriod> {
    const v = parseInput(UpdateHolidayInput, input, "holiday update");
    return one(await db.update(holidayPeriods).set(defined(v)).where(scoped(businessId, holidayId)).returning(), "holiday", holidayId);
  },

  /** Ends the holiday, optionally linking the "while you were away" report. */
  async end(db: Executor, businessId: string, holidayId: string, options: { reportInboxItemId?: string | null; endedAt?: Date } = {}): Promise<HolidayPeriod> {
    const o = parseInput(z.object({ reportInboxItemId: Id.nullable().optional(), endedAt: z.coerce.date().optional() }), options, "holiday end");
    return one(
      await db
        .update(holidayPeriods)
        .set({ endedAt: o.endedAt ?? new Date(), ...(o.reportInboxItemId !== undefined ? { reportInboxItemId: o.reportInboxItemId } : {}) })
        .where(and(scoped(businessId, holidayId), isNull(holidayPeriods.endedAt)))
        .returning(),
      "running holiday",
      holidayId,
    );
  },

  async setReport(db: Executor, businessId: string, holidayId: string, reportInboxItemId: string): Promise<HolidayPeriod> {
    return one(await db.update(holidayPeriods).set({ reportInboxItemId }).where(scoped(businessId, holidayId)).returning(), "holiday", holidayId);
  },
};
