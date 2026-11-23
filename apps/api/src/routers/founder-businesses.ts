/**
 * founder.businesses.list / allowance: the signed-in person's businesses for the top bar's Switch business, the palette
 * and Your businesses (/businesses), and the plan facts the Commit screen states before Take charge. Account-level like
 * founder.profile.get (no businessId). `list` runs as the user under RLS, so a row is only ever a business they belong
 * to. Read-only: no event, no audit.
 */
import { CREDITS_CURRENCY, liveModeOpen } from "@foundmill/config";
import { businessAllowance, ownerBudget, periodOf, periodRange, repos, withRls, type Db, type DbTx } from "@foundmill/db";
import { protectedProcedure, router } from "../trpc";

/** Runs fn as the signed-in user, so Postgres RLS holds every row it touches to that user. */
function asUser<T>(ctx: { db: Db; userId: string; email?: string | null }, fn: (tx: DbTx) => Promise<T>): Promise<T> {
  return withRls(ctx.db, { userId: ctx.userId, claims: ctx.email ? { email: ctx.email } : undefined }, fn);
}

export const founderBusinessesRouter = router({
  /**
   * Every business the person belongs to that is not archived, A to Z (the switcher puts the current one first). A
   * row's `isExample` marks an example membership (0065, "Explore an example"): Your businesses lists those under
   * their own heading, and nothing counts them as a business of the founder's own.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await asUser(ctx, (tx) => repos.businesses.listSummariesForUser(tx, ctx.userId));
    // While LIVE is closed on this deployment a stored "live" reads as Personal everywhere (as business.get does).
    const live = liveModeOpen(ctx.env);
    return { businesses: live ? rows : rows.map((r) => ({ ...r, gameMode: "personal" as const })) };
  }),
  /**
   * The plan behind Commit: the project allowance (Try 1, Founder up to 5, Studio any number, founder Nov 17, 2026) and
   * this month's included team budget, the owner's one, shared by all their projects (founder, Nov 19, 2026). The service
   * connection, as commit uses. Only the caller's own rows are counted.
   */
  allowance: protectedProcedure.query(async ({ ctx }) => {
    const period = periodOf(new Date());
    const [a, budget] = await Promise.all([businessAllowance(ctx.db, ctx.userId), ownerBudget(ctx.db, ctx.userId, period)]);
    return {
      tier: a.tier,
      businesses: { allowed: a.allowed, owned: a.owned },
      // What the owner's plan includes a month and what is left of it, shared by every project, and when the next opens.
      includedCredits: { period, monthlyMinor: budget.monthlyMinor, remainingMinor: budget.balanceMinor, currency: CREDITS_CURRENCY, nextGrantAt: periodRange(period).to },
    };
  }),
});
