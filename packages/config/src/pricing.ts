/**
 * Pricing tiers (BUILD §10.5). Prices and paid credit sizes are open decisions (§19): keep "TBD".
 *
 * Every limit here is enforced, not only shown (DECISIONS 2026-10-12 "Tier limits are enforced"): `businesses` when a
 * business is committed (counted per owner), `maxConcurrentAgents` when a cycle dispatches, `seats` when someone is
 * invited, and `includedCreditsMinor` as the platform credit each business on credits is granted every month, so a
 * business that runs on the platform's model key always has a balance that pauses it when it is used up.
 *
 * Business limits are lifted on every plan until paid plans launch (founder, 2026-10-16). The allowance machinery stays
 * (`tierBusinessLimit`, packages/db `assertBusinessAllowance`): put a number back in `businesses` to bring a limit back.
 * The included-credit pool is its own number (`includedCreditBusinesses`, SEC2 S6), so lifting the business limit never
 * hands out more free credits.
 *
 * People are free on every plan (founder, 2026-11-11; CLAUDE.md "the words for people"): `seats` is "unlimited", so a
 * cofounder or collaborator is never a plan limit and plans differ by agent work only. The machinery stays
 * (`tierSeatLimit`, packages/db `assertSeatAvailable`), as for businesses.
 */
export const TIERS = {
  free: { priceMonthly: null, modelBilling: "credits_or_byok", businesses: "unlimited", includedCreditBusinesses: 1, maxConcurrentAgents: 4, channels: "all", seats: "unlimited", includedCreditsMinor: 500 },
  pro: { priceMonthly: "TBD", modelBilling: "credits_or_byok", businesses: "unlimited", includedCreditBusinesses: 3, maxConcurrentAgents: 16, channels: "all", seats: "unlimited", includedCreditsMinor: "TBD" },
  scale: { priceMonthly: "TBD", modelBilling: "credits_or_byok", businesses: "unlimited", includedCreditBusinesses: "unlimited", maxConcurrentAgents: 64, channels: "all", seats: "unlimited", includedCreditsMinor: "TBD", prioritySupport: true },
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
 * What a second of a sandbox costs the platform, in millionths of a US cent (an Estimate, audit BILL-11 / O-32). E2B
 * bills per second of vCPU and memory at its list prices ($0.000014 per vCPU-second, $0.0000045 per GiB-second); the
 * default template is 2 vCPU and 512 MiB, so $0.00003025 a second (about $0.11 an hour). A Docker sandbox runs on the
 * platform's own host and a mock replay runs nowhere: both are booked at 0.
 */
export const SANDBOX_MICRO_MINOR_PER_SECOND = { e2b: 3_025, docker: 0, mock: 0 } as const satisfies Record<string, number>;
export type SandboxPricingMode = keyof typeof SANDBOX_MICRO_MINOR_PER_SECOND;

/** The Estimate for `ms` of a sandbox in `mode`, in millionths of a US cent (sum these, round once). */
export function sandboxCostMicroMinor(mode: SandboxPricingMode, ms: number): number {
  return Math.round((Math.max(0, ms) / 1000) * SANDBOX_MICRO_MINOR_PER_SECOND[mode]);
}

/**
 * The platform credit (USD cents) a business on `tier` is granted each month. A paid tier whose size is still "TBD"
 * gets the free tier's allowance, so moving up a tier never lowers what is included.
 */
export function includedCreditsMinor(tier: TierKey): number {
  const included: number | string = TIERS[tier].includedCreditsMinor;
  return typeof included === "number" ? included : TIERS.free.includedCreditsMinor;
}

/**
 * Low credits (credit saver). When a month's spendable credits fall below the line, routine work moves to a lower-cost
 * model (each route's `lowCredits` in packages/models routing.ts) while founder-facing and high-stakes work keeps its
 * own, so the team does not stop dead a few calls before the pause at zero.
 *
 * The line is the larger of a share of the month's included credits and a small floor:
 * - `LOW_CREDITS_SHARE` (20 %): on the free plan's $5 that is $1, the last fifth of the month, where a founder with
 *   little money most needs the team to keep going.
 * - `LOW_CREDITS_FLOOR_MINOR` ($1): a month that started with nothing included (the founder's pool went to another
 *   business) or a small top-up still gets the saver before the pause, and a larger plan's line never drops below it.
 * A top-up raises the balance above the line again, and the saver lifts by itself.
 */
export const LOW_CREDITS_SHARE = 0.2;
export const LOW_CREDITS_FLOOR_MINOR = 100;

/** The low-credits line in USD cents for a month that includes `includedMinor` (see `LOW_CREDITS_SHARE`). */
export function lowCreditsThresholdMinor(includedMinor: number): number {
  return Math.max(LOW_CREDITS_FLOOR_MINOR, Math.round(Math.max(0, includedMinor) * LOW_CREDITS_SHARE));
}

/** Whether `spendableMinor` is in the saver's band: something left, but below the line. Zero is the pause, not this. */
export function creditsAreLow(spendableMinor: number, includedMinor: number): boolean {
  return spendableMinor > 0 && spendableMinor < lowCreditsThresholdMinor(includedMinor);
}

/**
 * The first round of work of a free project on Foundmill's credits (WP-09 T11, founder D6, Nov 16, 2026): its sessions
 * run one at a time under this cap, in US cents, so round 1 fits the $5.00 allowance's first-session target ($1.50,
 * D1) less what the first day spends outside sessions. An Estimate until the cost report's `firstDayPerProject` sets it.
 */
export const FIRST_CYCLE_SESSION_CAP_MINOR = 75;

/** What cycle 1 starts with, wherever it starts (commit, an approval, Continue): a free project on credits is capped; others start as before. */
export function firstCycleInput(input: { modelBilling: "credits" | "byok"; tier: TierKey }): { budgetCapMinor?: number; maxConcurrent?: number } {
  return input.tier === "free" && input.modelBilling === "credits" ? { budgetCapMinor: FIRST_CYCLE_SESSION_CAP_MINOR, maxConcurrent: 1 } : {};
}

/**
 * How a new business on `tier` pays for model calls: on credits (its included credits) unless the tier requires the
 * founder's own key. Storing a key moves a business to `byok` (apps/api keys).
 */
export function initialModelBilling(tier: TierKey): "credits" | "byok" {
  const billing: string = TIERS[tier].modelBilling;
  return billing === "byok_required" ? "byok" : "credits";
}

/** How many businesses an owner on `tier` may hold (null = unlimited; every plan for now, founder 2026-10-16). */
export function tierBusinessLimit(tier: TierKey): number | null {
  const limit: number | string = TIERS[tier].businesses;
  return typeof limit === "number" ? limit : null;
}

/** How many people a business on `tier` may hold (null = unlimited; every plan, founder 2026-11-11: people are free). */
export function tierSeatLimit(tier: TierKey): number | null {
  const limit: number | string = TIERS[tier].seats;
  return typeof limit === "number" ? limit : null;
}

/**
 * How many of a founder's businesses get the tier's included credits each month (null = every one): the founder's
 * monthly pool (SEC2 S6), its own number so it never grows with the business limit.
 */
export function tierIncludedCreditPlaces(tier: TierKey): number | null {
  const places: number | string = TIERS[tier].includedCreditBusinesses;
  return typeof places === "number" ? places : null;
}

/**
 * Whether a project on `tier` carries the small "Built on Foundmill" mark on what its visitors see (docs/NETWORK.md F2;
 * founder, 2026-11-12): the free plan does, and a paid plan removes it completely, from the page, the line after a
 * follow, the confirmation email and page, and the share image.
 */
export function tierShowsBuiltOnMark(tier: TierKey): boolean {
  return tier === "free";
}

/** The higher of two tiers. */
export function higherTier(a: TierKey, b: TierKey): TierKey {
  return TIER_ORDER.indexOf(a) >= TIER_ORDER.indexOf(b) ? a : b;
}
