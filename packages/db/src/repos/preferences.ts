/**
 * account_preferences (0022) — account-scoped (userId first): how one signed-in person reads dates and times, in every
 * business. Routers founder.preferences.get/update. A person with no row reads the defaults (US dates, 12-hour times),
 * so reading never writes; the first change creates the row.
 */
import { DEFAULT_DATE_FORMAT_PREFS, DateFormatPreference, TimeFormatPreference, type DateFormatPrefs } from "@foundmill/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { accountPreferences } from "../schema";
import { defined, maybeOne, one, parseInput, type Executor } from "./_shared";

/** A change to one or both formats; at least one must be given. */
export const AccountPreferencesPatch = z
  .object({ date: DateFormatPreference.optional(), time: TimeFormatPreference.optional() })
  .strict()
  .refine((p) => p.date !== undefined || p.time !== undefined, { message: "Choose a date format or a time format" });
export type AccountPreferencesPatch = z.input<typeof AccountPreferencesPatch>;

const columns = { date: accountPreferences.dateFormat, time: accountPreferences.timeFormat };

export const preferencesRepo = {
  /** The person's formats, or the defaults when they never chose. */
  async get(db: Executor, userId: string): Promise<DateFormatPrefs> {
    const row = maybeOne(await db.select(columns).from(accountPreferences).where(eq(accountPreferences.userId, userId)).limit(1));
    return row ? { date: row.date, time: row.time } : { ...DEFAULT_DATE_FORMAT_PREFS };
  },

  /** Changes what was given and keeps the rest (creating the row on the first change); returns the result. */
  async update(db: Executor, userId: string, patch: AccountPreferencesPatch): Promise<DateFormatPrefs> {
    const v = parseInput(AccountPreferencesPatch, patch, "preferences");
    const set = defined({ dateFormat: v.date, timeFormat: v.time });
    const rows = await db
      .insert(accountPreferences)
      .values({ userId, ...set })
      .onConflictDoUpdate({ target: accountPreferences.userId, set })
      .returning(columns);
    const row = one(rows, "preferences", userId);
    return { date: row.date, time: row.time };
  },
};
