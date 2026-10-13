/**
 * founder.profile.get/update (BUILD §11.1 founder profile; AC-11.1.1 gate lives in apps/web on `profile === null`) and
 * founder.preferences.get/update: the signed-in person's own date and time format (account_preferences, 0022), the same
 * in every business. Any signed-in account may call them, with or without a business or a profile; both run as that
 * user under RLS, so a row is only ever their own. No event: preferences belong to the account, not to a business
 * (events and the audit log are business-scoped), and nothing reacts to them but the person's own screens.
 * founder.tableViews.get/save: the views a person saves on a data table (saved_table_views, 0041), for a business they
 * belong to or for the account-wide LIVE pages; RLS holds them to their own rows and their own businesses.
 */
import { freeDisplayName, liveModeOpen } from "@foundmill/config";
import { AccountPreferencesPatch, repos, withRls, FounderProfileInput, FounderProfilePatch, SaveTableViewsInput, TableViewsScope, type Db, type DbTx } from "@foundmill/db";
import { protectedProcedure, router } from "../trpc";

/** Runs fn as the signed-in user, so Postgres RLS holds every row it touches to that user. */
function asUser<T>(ctx: { db: Db; userId: string; email?: string | null }, fn: (tx: DbTx) => Promise<T>): Promise<T> {
  return withRls(ctx.db, { userId: ctx.userId, claims: ctx.email ? { email: ctx.email } : undefined }, fn);
}

export const founderRouter = router({
  profile: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      // Three independent reads: sent together, not one after another (each is a network round trip in production).
      const [profile, memberships, businesses] = await Promise.all([repos.founders.get(ctx.db, ctx.userId), repos.memberships.listForUser(ctx.db, ctx.userId), repos.businesses.listForUser(ctx.db, ctx.userId)]);
      // `features.liveMode`: whether LIVE is open here (the commit screen offers Live only then). `userId` is the account ID
      // a co-founder is added by (Settings › Members); the founder can always read their own.
      return { userId: ctx.userId, profile, complete: profile !== null, email: ctx.email, memberships, businesses, features: { liveMode: liveModeOpen(ctx.env) } };
    }),
    update: protectedProcedure.input(FounderProfilePatch).mutation(async ({ ctx, input }) => {
      const existing = await repos.founders.get(ctx.db, ctx.userId);
      if (existing) return repos.founders.update(ctx.db, ctx.userId, input);
      const created = FounderProfileInput.parse({ displayName: input.displayName ?? freeDisplayName(ctx.email?.split("@")[0]), ...input });
      return repos.founders.upsert(ctx.db, ctx.userId, created);
    }),
  }),
  preferences: router({
    /** The signed-in person's date and time format; the defaults (US, 12-hour) until they choose. */
    get: protectedProcedure.query(({ ctx }) => asUser(ctx, (tx) => repos.preferences.get(tx, ctx.userId))),
    /** Change the date format, the time format or both; returns the result. */
    update: protectedProcedure.input(AccountPreferencesPatch).mutation(({ ctx, input }) => asUser(ctx, (tx) => repos.preferences.update(tx, ctx.userId, input))),
  }),
  tableViews: router({
    /** The person's saved views and open view for one table; null until they change something there. */
    get: protectedProcedure.input(TableViewsScope).query(({ ctx, input }) => asUser(ctx, (tx) => repos.tableViews.get(tx, ctx.userId, input))),
    /** Replace the person's views and open view for one table (built-in views stay in code). */
    save: protectedProcedure.input(SaveTableViewsInput).mutation(({ ctx, input }) => asUser(ctx, (tx) => repos.tableViews.save(tx, ctx.userId, input))),
  }),
});
