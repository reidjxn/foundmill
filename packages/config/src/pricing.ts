/** Pricing tiers (BUILD §10.5). Prices and credit sizes are open decisions (§19): keep "TBD". */
export const TIERS = {
  free: { priceMonthly: null, modelBilling: "byok_required", businesses: 1, maxConcurrentAgents: 4, channels: "all", seats: 1 },
  pro: { priceMonthly: "TBD", modelBilling: "credits_or_byok", businesses: 3, maxConcurrentAgents: 16, channels: "all", seats: 3, includedCreditsMinor: "TBD" },
  scale: { priceMonthly: "TBD", modelBilling: "credits_or_byok", businesses: "unlimited", maxConcurrentAgents: 64, channels: "all", seats: 10, includedCreditsMinor: "TBD", prioritySupport: true },
} as const;
export type TierKey = keyof typeof TIERS;
/** UI copy when a price is still an open decision. */
export const PRICE_TBA_LABEL = "Price to be announced" as const;
