/**
 * founder.businesses.list / allowance: the signed-in person's businesses for the top bar's Switch business, the palette
 * and Your businesses (/businesses), and the plan facts the Commit screen states before Take charge. Account-level like
 * founder.profile.get (no businessId). `list` runs as the user under RLS, so a row is only ever a business they belong
 * to. Read-only: no event, no audit.
 */
import { CREDITS_CURRENCY, includedCreditsMinor, liveModeOpen } from "@foundmill/config";
import { businessAllowance, includedCreditPool, periodOf, periodRange, repos, withRls, type Db, type DbTx } from "@foundmill/db";
import { protectedProcedure, router } from "../trpc";

/** Runs fn as the signed-in user, so Postgres RLS holds every row it touches to that user. */
function asUser<T>(ctx: { db: Db; userId: string; email?: string | null }, fn: (tx: DbTx) => Promise<T>): Promise<T> {
  return withRls(ctx.db, { userId: ctx.userId, claims: ctx.email ? { email: ctx.email } : undefined }, fn);
}

export const founderBusinessesRouter = router({
  /** Every business the person belongs to that is not archived, A to Z (the switcher puts the current one first). */
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await asUser(ctx, (tx) => repos.businesses.listSummariesForUser(tx, ctx.userId));
    // While LIVE is closed on this deployment a stored "live" reads as Personal everywhere (as business.get does).
    const live = liveModeOpen(ctx.env);
    return { businesses: live ? rows : rows.map((r) => ({ ...r, gameMode: "personal" as const })) };
  }),
  /**
   * The plan behind Commit: the business allowance (unlimited on every plan for now, founder 2026-10-16) and this
   * month's included-credit pool (SEC2 S6). The service connection, as commit uses: the pool counts the archived
   * businesses the founder created too. Only the caller's own rows are counted.
   */
  allowance: protectedProcedure.query(async ({ ctx }) => {
    const period = periodOf(new Date());
    const [a, pool] = await Promise.all([businessAllowance(ctx.db, ctx.userId), includedCreditPool(ctx.db, ctx.userId, period)]);
    return {
      tier: a.tier,
      businesses: { allowed: a.allowed, owned: a.owned },
      // A new business starts on the free tier: what it would be granted, and when the next month's grant opens.
      includedCredits: { period, places: pool.places, taken: pool.taken, amountMinor: includedCreditsMinor("free"), currency: CREDITS_CURRENCY, nextGrantAt: periodRange(period).to },
    };
  }),
});
