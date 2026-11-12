/**
 * Autopilot state on `businesses` (0055; no table of its own, so the business policies apply). `set` is the founder's
 * switch and settings (owner or admin, audited by the caller); `pause` is a guard rail pausing it (the stop flag, used-up
 * credits, idle cycles; idempotent); `setNextAt` is the workflow's note of the next planned cycle. The decision logic is
 * pure and lives in @foundmill/shared (`decideAutopilot`); `loadAutopilotFacts` (../autopilot) gathers its inputs.
 */
import { AUTOPILOT_CADENCES, AUTOPILOT_LIMITS, type AutopilotPauseReason, type AutopilotSettings } from "@foundmill/shared";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { businesses, type Business } from "../schema";
import { MinorAmount, one, parseInput, type Executor } from "./_shared";

const L = AUTOPILOT_LIMITS;

export const AutopilotSettingsInput = z.object({
  cadence: z.enum(AUTOPILOT_CADENCES).optional(),
  dailyHour: z.number().int().min(L.dailyHour.min).max(L.dailyHour.max).optional(),
  maxCyclesPerDay: z.number().int().min(L.maxCyclesPerDay.min).max(L.maxCyclesPerDay.max).optional(),
  /** USD cents per UTC day (an Estimate); null: the credits left. */
  spendCeilingMinor: MinorAmount.nonnegative().nullable().optional(),
  maxIdleCycles: z.number().int().min(L.maxIdleCycles.min).max(L.maxIdleCycles.max).optional(),
  /** Autopilot's own limits (0084): cycles it starts itself per UTC day, and their spend in USD cents; null: none. */
  ownMaxCyclesPerDay: z.number().int().min(L.maxCyclesPerDay.min).max(L.maxCyclesPerDay.max).nullable().optional(),
  ownSpendCeilingMinor: MinorAmount.nonnegative().nullable().optional(),
});
export type AutopilotSettingsInput = z.input<typeof AutopilotSettingsInput>;

export const SetAutopilotInput = AutopilotSettingsInput.extend({ enabled: z.boolean().optional() });
export type SetAutopilotInput = z.input<typeof SetAutopilotInput>;

export interface SetAutopilotResult {
  business: Business;
  /** It was off or paused and is now on: the workflow must start. */
  turnedOn: boolean;
  /** It was on (or paused) and is now off. */
  turnedOff: boolean;
  /** A cadence, hour or limit is now different from what it was. */
  settingsChanged: boolean;
  /** The row before the change. */
  before: Pick<Business, "autopilotEnabled" | "autopilotPausedReason" | "autopilotCadence" | "autopilotDailyHour" | "autopilotMaxCyclesPerDay" | "autopilotSpendCeilingMinor" | "autopilotMaxIdleCycles" | "autopilotOwnMaxCyclesPerDay" | "autopilotOwnSpendCeilingMinor">;
}

const notArchived = isNull(businesses.archivedAt);

/** The settings columns of a business row, as the pure decision reads them. */
export function autopilotSettingsOf(b: Pick<Business, "autopilotCadence" | "autopilotDailyHour" | "autopilotMaxCyclesPerDay" | "autopilotSpendCeilingMinor" | "autopilotMaxIdleCycles"> & Partial<Pick<Business, "autopilotOwnMaxCyclesPerDay" | "autopilotOwnSpendCeilingMinor">>): AutopilotSettings {
  return {
    cadence: b.autopilotCadence,
    dailyHour: b.autopilotDailyHour,
    maxCyclesPerDay: b.autopilotMaxCyclesPerDay,
    spendCeilingMinor: b.autopilotSpendCeilingMinor === null ? null : Number(b.autopilotSpendCeilingMinor),
    maxIdleCycles: b.autopilotMaxIdleCycles,
    ownMaxCyclesPerDay: b.autopilotOwnMaxCyclesPerDay ?? null,
    ownSpendCeilingMinor: b.autopilotOwnSpendCeilingMinor === null || b.autopilotOwnSpendCeilingMinor === undefined ? null : Number(b.autopilotOwnSpendCeilingMinor),
  };
}

export const autopilotRepo = {
  /**
   * Turns Autopilot on or off and/or changes its settings. Turning it on (from off, or from a pause) clears the pause,
   * stamps `autopilot_changed_at` (the idle streak counts from there) and forgets the old planned time; turning it off
   * clears both. Settings alone leave the state as it is.
   */
  async set(db: Executor, businessId: string, input: SetAutopilotInput, at: Date = new Date()): Promise<SetAutopilotResult> {
    const v = parseInput(SetAutopilotInput, input, "autopilot");
    return db.transaction(async (tx) => {
      const rows = await tx.select().from(businesses).where(and(eq(businesses.id, businessId), notArchived)).for("update").limit(1);
      const row = one(rows, "business", businessId);
      const wasOn = row.autopilotEnabled;
      const turnedOn = v.enabled === true && (!wasOn || row.autopilotPausedReason !== null);
      const turnedOff = v.enabled === false && wasOn;
      const patch: Partial<typeof businesses.$inferInsert> = {};
      const sameMinor = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Number(a) === Number(b));
      const settingsChanged =
        (v.cadence !== undefined && v.cadence !== row.autopilotCadence) ||
        (v.dailyHour !== undefined && v.dailyHour !== row.autopilotDailyHour) ||
        (v.maxCyclesPerDay !== undefined && v.maxCyclesPerDay !== row.autopilotMaxCyclesPerDay) ||
        (v.spendCeilingMinor !== undefined && !sameMinor(v.spendCeilingMinor, row.autopilotSpendCeilingMinor)) ||
        (v.maxIdleCycles !== undefined && v.maxIdleCycles !== row.autopilotMaxIdleCycles) ||
        (v.ownMaxCyclesPerDay !== undefined && v.ownMaxCyclesPerDay !== row.autopilotOwnMaxCyclesPerDay) ||
        (v.ownSpendCeilingMinor !== undefined && !sameMinor(v.ownSpendCeilingMinor, row.autopilotOwnSpendCeilingMinor));
      if (v.cadence !== undefined) patch.autopilotCadence = v.cadence;
      if (v.dailyHour !== undefined) patch.autopilotDailyHour = v.dailyHour;
      if (v.maxCyclesPerDay !== undefined) patch.autopilotMaxCyclesPerDay = v.maxCyclesPerDay;
      if (v.spendCeilingMinor !== undefined) patch.autopilotSpendCeilingMinor = v.spendCeilingMinor;
      if (v.maxIdleCycles !== undefined) patch.autopilotMaxIdleCycles = v.maxIdleCycles;
      if (v.ownMaxCyclesPerDay !== undefined) patch.autopilotOwnMaxCyclesPerDay = v.ownMaxCyclesPerDay;
      if (v.ownSpendCeilingMinor !== undefined) patch.autopilotOwnSpendCeilingMinor = v.ownSpendCeilingMinor;
      if (v.enabled !== undefined) patch.autopilotEnabled = v.enabled;
      if (turnedOn || turnedOff) Object.assign(patch, { autopilotPausedReason: null, autopilotChangedAt: at, autopilotNextAt: null });
      const before = { autopilotEnabled: row.autopilotEnabled, autopilotPausedReason: row.autopilotPausedReason, autopilotCadence: row.autopilotCadence, autopilotDailyHour: row.autopilotDailyHour, autopilotMaxCyclesPerDay: row.autopilotMaxCyclesPerDay, autopilotSpendCeilingMinor: row.autopilotSpendCeilingMinor, autopilotMaxIdleCycles: row.autopilotMaxIdleCycles, autopilotOwnMaxCyclesPerDay: row.autopilotOwnMaxCyclesPerDay, autopilotOwnSpendCeilingMinor: row.autopilotOwnSpendCeilingMinor };
      if (Object.keys(patch).length === 0) return { business: row, turnedOn, turnedOff, settingsChanged, before };
      const updated = one(await tx.update(businesses).set(patch).where(eq(businesses.id, businessId)).returning(), "business", businessId);
      return { business: updated, turnedOn, turnedOff, settingsChanged, before };
    });
  },

  /**
   * A guard rail pauses Autopilot: only while it is on and not already paused (so the audit entry, the event and the
   * Inbox note happen once). Returns whether this call paused it.
   */
  async pause(db: Executor, businessId: string, reason: AutopilotPauseReason): Promise<boolean> {
    const rows = await db
      .update(businesses)
      .set({ autopilotPausedReason: reason, autopilotNextAt: null })
      .where(and(eq(businesses.id, businessId), eq(businesses.autopilotEnabled, true), isNull(businesses.autopilotPausedReason)))
      .returning({ id: businesses.id });
    return rows.length > 0;
  },

  /** The next planned cycle (an Estimate), for the Home chip; null clears it. */
  async setNextAt(db: Executor, businessId: string, at: Date | null): Promise<void> {
    await db.update(businesses).set({ autopilotNextAt: at }).where(and(eq(businesses.id, businessId), eq(businesses.autopilotEnabled, true)));
  },
};
