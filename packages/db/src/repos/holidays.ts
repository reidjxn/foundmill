/**
 * holiday_periods — founder away, Chief of Staff in charge (BUILD §11.9 "holiday"; routers business.startHoliday/endHoliday).
 *
 * A vacation is running from `started_at` until it is ended (`ended_at`) or its date passes (`until_at`): a dated vacation
 * whose date went by is over even before its workflow writes the end, so Continue is never refused past the date the
 * founder chose (audit OL-08). At most one runs per business (0036's partial unique index; a second start is a
 * ConflictError naming the running one). Ending is idempotent: the vacation workflow and the api may both end the same
 * row, and the second call returns it (linking the away report when it has none yet).
 */
import { ConflictError } from "@foundmill/shared";
import { and, asc, desc, eq, gt, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { holidayPeriods, type HolidayPeriod } from "../schema";
import { Currency, changes, defined, Id, JsonObject, MinorAmount, one, parseInput, sqlState, type Executor } from "./_shared";

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
  .refine((v) => Boolean(v.untilAt) || Boolean(v.untilCondition), { message: "a vacation ends at a time or on a condition" });
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
/** Started, not ended, not archived (its date may have passed: see `current`). */
const open = () => and(isNotNull(holidayPeriods.startedAt), isNull(holidayPeriods.endedAt), isNull(holidayPeriods.archivedAt));

/** A vacation is already running: the second start of two at once, or a start while one runs. */
export class HolidayRunningError extends ConflictError {
  constructor(readonly holidayId: string | null) {
    super("A vacation is already running", { holidayId });
  }
}

export const holidaysRepo = {
  /** The running holiday (started, not ended, its `until` date not passed), or null. */
  async current(db: Executor, businessId: string, now: Date = new Date()): Promise<HolidayPeriod | null> {
    const rows = await db
      .select()
      .from(holidayPeriods)
      .where(and(eq(holidayPeriods.businessId, businessId), open(), or(isNull(holidayPeriods.untilAt), gt(holidayPeriods.untilAt, now))))
      .orderBy(desc(holidayPeriods.startedAt))
      .limit(1);
    return rows[0] ?? null;
  },

  /**
   * Every vacation not yet ended, across businesses, oldest first (the orchestrator's reconciler starts the workflow of
   * any that has none; one whose date passed is ended by that workflow with its report). Service role only.
   */
  async running(db: Executor, options: { limit?: number } = {}): Promise<Pick<HolidayPeriod, "id" | "businessId" | "untilAt" | "startedAt">[]> {
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 500), 1), 5000);
    return db.select({ id: holidayPeriods.id, businessId: holidayPeriods.businessId, untilAt: holidayPeriods.untilAt, startedAt: holidayPeriods.startedAt }).from(holidayPeriods).where(open()).orderBy(asc(holidayPeriods.startedAt)).limit(limit);
  },

  async list(db: Executor, businessId: string, limit = 50): Promise<HolidayPeriod[]> {
    return db.select().from(holidayPeriods).where(and(eq(holidayPeriods.businessId, businessId), isNull(holidayPeriods.archivedAt))).orderBy(desc(holidayPeriods.createdAt)).limit(limit);
  },

  async get(db: Executor, businessId: string, holidayId: string): Promise<HolidayPeriod> {
    return one(await db.select().from(holidayPeriods).where(scoped(businessId, holidayId)).limit(1), "vacation", holidayId);
  },

  /**
   * Starts a holiday; refuses (HolidayRunningError) while one is running, also when two starts race (the unique index).
   * A vacation whose date already passed but whose end was never written is closed at its date first.
   */
  async start(db: Executor, businessId: string, input: StartHolidayInput): Promise<HolidayPeriod> {
    const v = parseInput(StartHolidayInput, input, "vacation");
    const now = v.startedAt ?? new Date();
    try {
      return await insertRunning(db, businessId, v, now);
    } catch (err) {
      if (sqlState(err) !== "23505") throw err;
      throw new HolidayRunningError((await holidaysRepo.current(db, businessId, now))?.id ?? null);
    }
  },

  async update(db: Executor, businessId: string, holidayId: string, input: UpdateHolidayInput): Promise<HolidayPeriod> {
    const v = parseInput(UpdateHolidayInput, input, "vacation update");
    return one(await db.update(holidayPeriods).set(changes(v, "vacation")).where(scoped(businessId, holidayId)).returning(), "vacation", holidayId);
  },

  /**
   * Ends the holiday, optionally linking the "while you were away" report. Idempotent: a holiday already ended keeps its
   * end time and is returned as it is, with the report linked when it had none (the api ended it, then the workflow
   * wrote the report). NotFound only for an unknown id.
   */
  async end(db: Executor, businessId: string, holidayId: string, options: { reportInboxItemId?: string | null; endedAt?: Date } = {}): Promise<HolidayPeriod> {
    const o = parseInput(z.object({ reportInboxItemId: Id.nullable().optional(), endedAt: z.coerce.date().optional() }), options, "vacation end");
    const [ended] = await db
      .update(holidayPeriods)
      .set({ endedAt: o.endedAt ?? new Date(), ...(o.reportInboxItemId !== undefined ? { reportInboxItemId: o.reportInboxItemId } : {}) })
      .where(and(scoped(businessId, holidayId), isNull(holidayPeriods.endedAt)))
      .returning();
    if (ended) return ended;
    const row = await holidaysRepo.get(db, businessId, holidayId);
    if (o.reportInboxItemId && !row.reportInboxItemId) return holidaysRepo.setReport(db, businessId, holidayId, o.reportInboxItemId);
    return row;
  },

  async setReport(db: Executor, businessId: string, holidayId: string, reportInboxItemId: string): Promise<HolidayPeriod> {
    return one(await db.update(holidayPeriods).set({ reportInboxItemId }).where(scoped(businessId, holidayId)).returning(), "vacation", holidayId);
  },
};

/** `start` without the race mapping: closes a vacation whose date passed, refuses a running one, inserts. */
async function insertRunning(db: Executor, businessId: string, v: z.output<typeof StartHolidayInput>, now: Date): Promise<HolidayPeriod> {
  return db.transaction(async (tx) => {
    await tx
      .update(holidayPeriods)
      .set({ endedAt: sql`${holidayPeriods.untilAt}` })
      .where(and(eq(holidayPeriods.businessId, businessId), open(), lte(holidayPeriods.untilAt, now)));
    const running = await holidaysRepo.current(tx, businessId, now);
    if (running) throw new HolidayRunningError(running.id);
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
          startedAt: now,
          startedBy: v.startedBy ?? null,
        })
        .returning(),
      "vacation",
    );
  });
}
