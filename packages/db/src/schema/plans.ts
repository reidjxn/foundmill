/**
 * 0144 — plans and prices (WP-14 T14).
 *   - `ownerPlans`: account-scoped, one row per person: the invited marker (`invitedAt`: joined while sign-up was
 *     invite-only, never billed the Founder fee) and the first Founder or Studio price paid, kept while subscribed.
 *     Service role only.
 *   - `partnerWaitlist`: business-scoped: an owner asked to hear when the Partner plan opens, with consent. Services
 *     write; members read, a collaborator nothing.
 */
import { char, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { id, minor, timestamps, tstz } from "./_common";
import { businessId } from "./_refs";

/** The plans a price can be stored for (Try's price is the same for everyone). */
export const STORED_PRICE_TIERS = ["pro", "scale"] as const;
export type StoredPriceTier = (typeof STORED_PRICE_TIERS)[number];

export const ownerPlans = pgTable("owner_plans", {
  id: id(),
  userId: uuid("user_id").notNull().unique("owner_plans_user_id_key").references(() => authUsers.id, { onDelete: "cascade" }),
  invitedAt: tstz("invited_at"),
  priceTier: text("price_tier", { enum: STORED_PRICE_TIERS }),
  /** US cents a month. */
  priceMinor: minor("price_minor"),
  currency: char("currency", { length: 3 }).notNull().default("USD"),
  priceSetAt: tstz("price_set_at"),
  ...timestamps(),
});
export type OwnerPlan = typeof ownerPlans.$inferSelect;

export const partnerWaitlist = pgTable(
  "partner_waitlist",
  {
    id: id(),
    businessId: businessId(),
    userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    consentedAt: tstz("consented_at").notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("partner_waitlist_business_id_user_id_key").on(t.businessId, t.userId), index("partner_waitlist_user_id_idx").on(t.userId)],
);
export type PartnerWaitlistEntry = typeof partnerWaitlist.$inferSelect;
