/**
 * 0144 — what a plan needs to know about its owner, and the Partner waitlist (WP-14 T14; founder, Nov 17, 2026).
 *
 * - `ownerPlans`: service connection only, every function (no client role reads or writes the table: a client that could
 *   write its own row could give itself the invited marker).
 * - `partnerWaitlist`: written on the service connection (the api checks the owner first); members read, a collaborator
 *   nothing.
 */
import { and, eq, sql } from "drizzle-orm";
import { ownerPlans, partnerWaitlist, type OwnerPlan, type PartnerWaitlistEntry, type StoredPriceTier } from "../schema/plans";
import { maybeOne, one, rowsOf, type Executor } from "./_shared";

export const ownerPlansRepo = {
  async get(db: Executor, userId: string): Promise<OwnerPlan | null> {
    return maybeOne(await db.select().from(ownerPlans).where(eq(ownerPlans.userId, userId)).limit(1));
  },

  /**
   * Marks a person as having joined while sign-up was invite-only, with the day their account was made. Kept once set:
   * a second call never moves the date. Call it only while the stage is `invite_only` (apps/api commit does).
   */
  async markInvited(db: Executor, userId: string): Promise<void> {
    await db.execute(sql`
      insert into owner_plans (user_id, invited_at) select id, created_at from auth.users where id = ${userId}
      on conflict (user_id) do update set invited_at = coalesce(owner_plans.invited_at, excluded.invited_at)`);
  },

  /**
   * The opening step (docs/DEPLOY.md §4): marks every account made before `cutoff`, the moment sign-up opens, that is not
   * marked yet. Returns how many it marked. Running it twice marks nobody twice.
   */
  async markInvitedBefore(db: Executor, cutoff: Date): Promise<number> {
    const result = await db.execute(sql`
      insert into owner_plans (user_id, invited_at) select id, created_at from auth.users where created_at < ${cutoff.toISOString()}::timestamptz
      on conflict (user_id) do update set invited_at = excluded.invited_at where owner_plans.invited_at is null
      returning user_id`);
    return rowsOf(result).length;
  },

  /**
   * Stores the first Founder or Studio price a person paid (US cents a month). While a price for that plan is stored it
   * is kept: the same call with another amount changes nothing, so a price change in config never reaches a subscriber.
   * A price for the other plan replaces it (the person changed plan). Returns the row as it now stands.
   */
  async storePrice(db: Executor, userId: string, input: { tier: StoredPriceTier; priceMinor: number; at?: Date }): Promise<OwnerPlan> {
    const at = input.at ?? new Date();
    return one(
      await db
        .insert(ownerPlans)
        .values({ userId, priceTier: input.tier, priceMinor: input.priceMinor, priceSetAt: at })
        .onConflictDoUpdate({
          target: ownerPlans.userId,
          set: {
            priceMinor: sql`case when ${ownerPlans.priceTier} = ${input.tier} then ${ownerPlans.priceMinor} else ${input.priceMinor} end`,
            priceSetAt: sql`case when ${ownerPlans.priceTier} = ${input.tier} then ${ownerPlans.priceSetAt} else ${at.toISOString()}::timestamptz end`,
            priceTier: input.tier,
          },
        })
        .returning(),
      "owner plan",
      userId,
    );
  },

  /** The person is no longer subscribed: the stored price goes, the invited marker stays. */
  async clearPrice(db: Executor, userId: string): Promise<void> {
    await db.update(ownerPlans).set({ priceTier: null, priceMinor: null, priceSetAt: null }).where(eq(ownerPlans.userId, userId));
  },
};

export const partnerWaitlistRepo = {
  /** The person's entry for this project, if they joined. */
  async entry(db: Executor, businessId: string, userId: string): Promise<PartnerWaitlistEntry | null> {
    return maybeOne(await db.select().from(partnerWaitlist).where(and(eq(partnerWaitlist.businessId, businessId), eq(partnerWaitlist.userId, userId))).orderBy(partnerWaitlist.createdAt).limit(1));
  },

  /** Records the owner, the project and their consent, once: joining again (or twice at once) returns the first entry. */
  async join(db: Executor, businessId: string, input: { userId: string; consentedAt?: Date }): Promise<{ entry: PartnerWaitlistEntry; created: boolean }> {
    const inserted = await db.insert(partnerWaitlist).values({ businessId, userId: input.userId, consentedAt: input.consentedAt ?? new Date() }).onConflictDoNothing({ target: [partnerWaitlist.businessId, partnerWaitlist.userId] }).returning();
    if (inserted[0]) return { entry: inserted[0], created: true };
    return { entry: one(await db.select().from(partnerWaitlist).where(and(eq(partnerWaitlist.businessId, businessId), eq(partnerWaitlist.userId, input.userId))).limit(1), "partner waitlist entry", businessId), created: false };
  },
};
