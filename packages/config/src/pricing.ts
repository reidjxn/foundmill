/**
 * Pricing tiers (BUILD §10.5). Prices and paid credit sizes are open decisions (§19): keep "TBD".
 *
 * Every limit here is enforced, not only shown (DECISIONS 2026-10-12 "Tier limits are enforced"): `businesses` when a
 * business is committed (counted per owner), `maxConcurrentAgents` when a cycle dispatches, `seats` when someone is
 * invited, and `includedCreditsMinor` as the platform credit each business on credits is granted every month, so a
 * business that runs on the platform's model key always has a balance that pauses it when it is used up.
 */
export const TIERS = {
  free: { priceMonthly: null, modelBilling: "credits_or_byok", businesses: 1, maxConcurrentAgents: 4, channels: "all", seats: 1, includedCreditsMinor: 500 },
  pro: { priceMonthly: "TBD", modelBilling: "credits_or_byok", businesses: 3, maxConcurrentAgents: 16, channels: "all", seats: 3, includedCreditsMinor: "TBD" },
  scale: { priceMonthly: "TBD", modelBilling: "credits_or_byok", businesses: "unlimited", maxConcurrentAgents: 64, channels: "all", seats: 10, includedCreditsMinor: "TBD", prioritySupport: true },
} as const;
export type TierKey = keyof typeof TIERS;
/** Lowest to highest: an owner's allowance follows the highest tier any business they own is on. */
export const TIER_ORDER: readonly TierKey[] = ["free", "pro", "scale"];
/** UI copy when a price is still an open decision. */
export const PRICE_TBA_LABEL = "Price to be announced" as const;

/**
 * Credits, and every platform cost they pay for (model tokens, sandbox minutes, training), are kept in US dollar cents:
 * the currency model prices are listed in (packages/models `PRICING_CURRENCY`). A balance is never charged with an
 * amount in another currency, and credits are never shown in the business's own currency.
 */
export const CREDITS_CURRENCY = "USD" as const;

/**
 * The platform credit (USD cents) a business on `tier` is granted each month. A paid tier whose size is still "TBD"
 * gets the free tier's allowance, so moving up a tier never lowers what is included.
 */
export function includedCreditsMinor(tier: TierKey): number {
  const included: number | string = TIERS[tier].includedCreditsMinor;
  return typeof included === "number" ? included : TIERS.free.includedCreditsMinor;
}

/**
 * How a new business on `tier` pays for model calls: on credits (its included credits) unless the tier requires the
 * founder's own key. Storing a key moves a business to `byok` (apps/api keys).
 */
export function initialModelBilling(tier: TierKey): "credits" | "byok" {
  const billing: string = TIERS[tier].modelBilling;
  return billing === "byok_required" ? "byok" : "credits";
}

/** How many businesses an owner on `tier` may hold (null = unlimited). */
export function tierBusinessLimit(tier: TierKey): number | null {
  const limit: number | string = TIERS[tier].businesses;
  return typeof limit === "number" ? limit : null;
}

/** The higher of two tiers. */
export function higherTier(a: TierKey, b: TierKey): TierKey {
  return TIER_ORDER.indexOf(a) >= TIER_ORDER.indexOf(b) ? a : b;
}
