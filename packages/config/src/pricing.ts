/**
 * Plans (BUILD §10.5; founder, Nov 17, 2026: docs/holistic-plan/WP-14-behavior-brief.md T14, answers A1, A2 and A12 to
 * A16). The keys are `free`, `pro` and `scale`; what a person reads is the plan's `name`: Try, Founder, Studio. A
 * fourth plan, Partner, is display data only (`PARTNER_PLAN`): it is by application and can never be chosen or bought.
 *
 * One switch decides what the numbers below do: `EARLY_ACCESS_STAGE`.
 * - `invite_only` (now): sign-up is by invitation, every plan reads "Free while in early access", nobody is charged a
 *   subscription, and no plan check applies: everyone has every feature in `PLAN_FEATURE_FROM` and any number of
 *   projects, so no invited tester loses what they use today. Agents at once and the models a plan reaches stay as each
 *   plan's own numbers (they are what the founder pays for on a tester's behalf).
 * - `open` (the day sign-up opens): Try is $5 a month, the first press of Continue needs it, and the checks apply.
 *
 * What differs by plan:
 * - `businesses`: how many projects an owner may hold, archived ones not counted (A14): Try 1, Founder up to 5, Studio
 *   any number. Checked when a new one is committed (packages/db `assertBusinessAllowance`); an owner over the limit
 *   keeps what they have.
 * - `includedCreditsMinor`: the month's team budget (A15): $5.00, $10.00, $50.00, the owner's, shared by all their
 *   projects (founder, Nov 19, 2026; packages/db `owner_credits`).
 * - `claudeModels`: Founder and Studio reach Opus and Sonnet on Foundmill's key without a credit pack; Try reaches them
 *   by a credit pack of `CREDIT_PACK_UNLOCK_MIN_MINOR` or more (from `open`), or on the founder's own Anthropic key,
 *   which works on every plan and is always offered (A3, A16).
 * - `maxConcurrentAgents`: Studio adds more agents at once; Try and Founder run the same number.
 * - the features in `PLAN_FEATURE_FROM`.
 *
 * People are free on every plan (founder, 2026-11-11): `seats` is "unlimited" and there is no seat anywhere in a plan.
 * The machinery stays (`tierSeatLimit`, packages/db `assertSeatAvailable`).
 */
export const EARLY_ACCESS_STAGES = ["invite_only", "open"] as const;
export type EarlyAccessStage = (typeof EARLY_ACCESS_STAGES)[number];
/**
 * The one switch (it is also #273's proposed `ENTRY_PLAN.opensSignUp`: there is no second value). Changing it to `open`
 * is a code change made in the same step as turning `SIGNUP_OPEN` on (docs/DEPLOY.md §4), and only once the
 * subscription checkout exists (WP-09 T16).
 */
export const EARLY_ACCESS_STAGE: EarlyAccessStage = "invite_only";

export const TIERS = {
  free: { name: "Try", modelBilling: "credits_or_byok", businesses: 1, maxConcurrentAgents: 4, channels: "all", seats: "unlimited", includedCreditsMinor: 500, claudeModels: false },
  pro: { name: "Founder", modelBilling: "credits_or_byok", businesses: 5, maxConcurrentAgents: 4, channels: "all", seats: "unlimited", includedCreditsMinor: 1000, claudeModels: true },
  scale: { name: "Studio", modelBilling: "credits_or_byok", businesses: "unlimited", maxConcurrentAgents: 64, channels: "all", seats: "unlimited", includedCreditsMinor: 5000, claudeModels: true, prioritySupport: true },
} as const;
export type TierKey = keyof typeof TIERS;
/** Lowest to highest: an owner's allowance follows the highest tier any business they own is on. */
export const TIER_ORDER: readonly TierKey[] = ["free", "pro", "scale"];

/** "Try", "Founder", "Studio": the only name of a plan a person reads. Never the key, never "free". */
export function planName(tier: TierKey): string {
  return TIERS[tier].name;
}

/** What every plan reads while sign-up is invite-only. Nothing says it stays free. */
export const EARLY_ACCESS_PRICE_LABEL = "Free while in early access" as const;
/** Beneath the plans while invite-only: the one promise made (founder, Nov 17, 2026, A12). */
export const INVITED_FOUNDERS_LINE = "Free while in early access. Founders invited now keep it free for good." as const;

/** Try's price from the day sign-up opens, in US cents a month (#273, #274). */
export const TRY_PRICE_MONTHLY_MINOR = 500;

/**
 * The entry plan (founder, Nov 17, 2026; WP-09 T16, WP-14 T14): $5.00 a month with $5.00 of credits a month, named Try.
 * One record that copy, the gate at the first AI run and billing read. Whether the checkout is offered is `PAID_ENTRY`
 * (WP-09 T16) and whether plan limits apply is `EARLY_ACCESS_STAGE`: both change in the same step (docs/DEPLOY.md §4).
 */
export const ENTRY_PLAN = { name: TIERS.free.name, tier: "free", priceMonthlyMinor: TRY_PRICE_MONTHLY_MINOR, includedCreditsMinor: TIERS.free.includedCreditsMinor } as const satisfies { name: string; tier: TierKey; priceMonthlyMinor: number; includedCreditsMinor: number };

/**
 * The Founder price test (A1, A13): two paired sets, in US cents a month. Founder's budget is the same in both (A15),
 * and credit packs cost the same in both.
 */
export const PRICE_SETS = { a: { pro: 1500, scale: 5000 }, b: { pro: 2500, scale: 10000 } } as const;
export type PriceSetKey = keyof typeof PRICE_SETS;
export const PRICE_SET_KEYS = ["a", "b"] as const satisfies readonly PriceSetKey[];
/**
 * The test's switch, off. While off no visitor is shown a figure. `listSet` is the set a person who was shown none is
 * charged from the day charging opens: the lower one, so nobody is ever charged more than a figure they could have
 * seen. The founder sets it before opening.
 */
export const PRICE_TEST: { enabled: boolean; listSet: PriceSetKey } = { enabled: false, listSet: "a" };
/** How a figure of the test is marked wherever it shows (the waitlist page, WP-14 T15). Nobody is charged it. */
export const INDICATIVE_PRICE_LABEL = "Indicative" as const;

/** Partner (A1): by application, a waitlist, no checkout. Display data only; it is not a `TierKey`. */
export const PARTNER_PLAN = {
  name: "Partner",
  priceMonthlyMinor: 25000,
  purchasable: false,
  byApplication: "By application",
  adds: "A monthly review of your project by experienced venture-backed founders and venture capital investors",
  opens: "Reviews begin once the plan opens. Joining the waitlist costs nothing and charges nothing.",
  action: "Join the Partner waitlist",
} as const;

/** Stable, even split of any string into the two sets (FNV-1a; the same visitor always gets the same set). */
function halfOf(seed: string): PriceSetKey {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
  return (h >>> 0) % 2 === 0 ? "a" : "b";
}

export interface IndicativePrices {
  set: PriceSetKey;
  label: typeof INDICATIVE_PRICE_LABEL;
  founderMinor: number;
  studioMinor: number;
  partnerMinor: number;
}

/**
 * The figures one visitor is shown, or null while the test is off. `kept` is the set stored with the visitor's
 * waitlist entry: a visitor keeps the set first given. `seed` is anything stable for the visitor.
 */
export function indicativePricesFor(seed: string, kept: PriceSetKey | null = null, test: { enabled: boolean } = PRICE_TEST): IndicativePrices | null {
  if (!test.enabled) return null;
  const set = kept ?? halfOf(seed);
  return { set, label: INDICATIVE_PRICE_LABEL, founderMinor: PRICE_SETS[set].pro, studioMinor: PRICE_SETS[set].scale, partnerMinor: PARTNER_PLAN.priceMonthlyMinor };
}

/** A plan's monthly list price in US cents in `set` (Try's is the same in both). */
export function listPriceMinor(tier: TierKey, set: PriceSetKey = PRICE_TEST.listSet, sets: Record<PriceSetKey, { pro: number; scale: number }> = PRICE_SETS): number {
  return tier === "free" ? TRY_PRICE_MONTHLY_MINOR : sets[set][tier];
}

export interface SubscriptionChargeInput {
  tier: TierKey;
  /** Joined while sign-up was invite-only (packages/db `owner_plans.invited_at`). */
  invited: boolean;
  /** The set this person was shown on the waitlist page, if any. */
  shownSet?: PriceSetKey | null;
  /** The first Founder or Studio price this owner paid, kept while they stay subscribed (`owner_plans.price_minor`). */
  stored?: { tier: TierKey; priceMinor: number } | null;
  stage?: EarlyAccessStage;
  sets?: Record<PriceSetKey, { pro: number; scale: number }>;
}

/**
 * What an owner is charged a month for `tier`, in US cents. The rules, in order:
 * - nothing while sign-up is invite-only: no subscription is charged before the stage is `open`;
 * - a person invited while it was invite-only is on Founder and never pays its fee (A12), so Try and Founder are 0 for
 *   them; Studio is charged in full (a reading: the promise names the Founder fee only);
 * - a stored price for this tier wins over the config, so a later price change never reaches a subscriber;
 * - otherwise the list price, never more than the figure the person was shown.
 */
export function subscriptionChargeMinor(input: SubscriptionChargeInput): number {
  if ((input.stage ?? EARLY_ACCESS_STAGE) !== "open") return 0;
  if (input.invited && input.tier !== "scale") return 0;
  if (input.stored && input.stored.tier === input.tier) return input.stored.priceMinor;
  const list = listPriceMinor(input.tier, PRICE_TEST.listSet, input.sets);
  return input.shownSet ? Math.min(list, listPriceMinor(input.tier, input.shownSet, input.sets)) : list;
}

/** Whether a subscription may be charged at all: never while sign-up is invite-only. */
export function subscriptionChargingOpen(stage: EarlyAccessStage = EARLY_ACCESS_STAGE): boolean {
  return stage === "open";
}

/** The plan an owner is on when charging opens: Founder for a person invited while sign-up was invite-only (A12). */
export function tierForInvited(tier: TierKey, invited: boolean, stage: EarlyAccessStage = EARLY_ACCESS_STAGE): TierKey {
  return invited && stage === "open" ? higherTier(tier, "pro") : tier;
}

/** "Free while in early access" now; "$5 / month" from the day sign-up opens. */
export function planPriceLabel(tier: TierKey, stage: EarlyAccessStage = EARLY_ACCESS_STAGE, set: PriceSetKey = PRICE_TEST.listSet): string {
  return stage === "open" ? `${usd(listPriceMinor(tier, set))} / month` : EARLY_ACCESS_PRICE_LABEL;
}

/** "$5", "$12.50": a US dollar price with cents only when it has them. */
function usd(minor: number): string {
  return `$${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: minor % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/**
 * What each plan includes beyond the team (A2): the plan a feature starts on. Try has the team and everything not
 * listed here. The product reads this table (`planIncludes`); Billing lists it.
 */
export const PLAN_FEATURES = ["vacation_mode", "card_sharing", "named_agents", "phone_inbox", "more_agents_at_once"] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];
export const PLAN_FEATURE_FROM: Record<PlanFeature, TierKey> = { vacation_mode: "pro", card_sharing: "pro", named_agents: "pro", phone_inbox: "pro", more_agents_at_once: "scale" };
export const PLAN_FEATURE_WORDS: Record<PlanFeature, string> = { vacation_mode: "Vacation mode", card_sharing: "Card sharing", named_agents: "Named agents", phone_inbox: "The phone Inbox", more_agents_at_once: "More agents at once" };

/** Whether a project on `tier` has `feature`. Everyone has everything until the stage is `open`. */
export function planIncludes(tier: TierKey, feature: PlanFeature, stage: EarlyAccessStage = EARLY_ACCESS_STAGE): boolean {
  return stage !== "open" || TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(PLAN_FEATURE_FROM[feature]);
}

/** The features `tier` adds over the plan below it, in the table's order. */
export function planAdds(tier: TierKey): PlanFeature[] {
  return PLAN_FEATURES.filter((f) => PLAN_FEATURE_FROM[f] === tier);
}

/** The lowest plan that includes `feature` (the plan a refusal names). */
export function planFor(feature: PlanFeature): TierKey {
  return PLAN_FEATURE_FROM[feature];
}

/**
 * Credit packs (#274, A16): from the day sign-up opens a pack of this size or more, bought by a project's owner, lets
 * a Try project choose Opus and Sonnet on Foundmill's key. Before then a top-up never changes the models.
 */
export const CREDIT_PACK_UNLOCK_MIN_MINOR = 2000;

/**
 * Credits, and every platform cost they pay for (model tokens, sandbox minutes, training), are kept in US dollar cents:
 * the currency model prices are listed in (packages/models `PRICING_CURRENCY`). A balance is never charged with an
 * amount in another currency, and credits are never shown in the business's own currency.
 */
export const CREDITS_CURRENCY = "USD" as const;

/** The top-up amounts the Billing tab offers, in US cents (founder D4, Nov 16, 2026: $5, $10, $25 and $50). */
export const TOP_UP_OPTIONS_MINOR = [500, 1000, 2500, 5000] as const;

/**
 * The markup on what the platform's keys cost (founder, Nov 17, 2026): every call on Foundmill's keys is charged against
 * credits at cost plus 30%, on every plan and pack, from day one (the invited testers and the included monthly budgets
 * too). A founder's own key is never marked up: the vendor bills them. The usage ledger keeps the true cost, and the
 * free plan's $600 cap and the cost report measure true cost; only the credit charge is marked up.
 */
export const CREDIT_MARKUP = 0.3;

/**
 * How much true cost `creditsMinor` of credits pays for (the inverse of `chargedMinor`, rounded down). Use it wherever
 * credits left become a spend limit measured at cost (a session's budget, the day's ceiling), so a session cannot spend
 * past what its credits cover.
 */
export function costCoveredMinor(creditsMinor: number): number {
  return Math.floor(creditsMinor / (1 + CREDIT_MARKUP));
}

/** What a call that cost `trueCost` (any unit: cents or millionths of a cent) charges against credits, rounded. */
export function chargedMinor(trueCost: number): number {
  return Math.round(trueCost * (1 + CREDIT_MARKUP));
}

/** Credit-pack prices from the day sign-up opens, in US cents (founder, Nov 17, 2026): $20 to $500. */
export const CREDIT_PACKS_MINOR = [2000, 5000, 10000, 25000, 50000] as const;

/**
 * The credits a pack carries, in US cents. The founder has not set the discount per size or the markup yet, so this is
 * a placeholder at face value (an Estimate): a pack carries as much credit as it costs. One table to change.
 */
/**
 * The team budget a pack adds, in US cents (founder, Nov 17, 2026): a bonus on top of the price, larger for bigger
 * packs, not a discount: $20 adds $20.00, $50 adds $52.50 (5%), $100 adds $110.00 (10%), $250 adds $287.50 (15%) and $500
 * adds $600.00 (20%).
 */
export const CREDIT_PACK_CREDITS_MINOR: Readonly<Record<(typeof CREDIT_PACKS_MINOR)[number], number>> = { 2000: 2000, 5000: 5250, 10000: 11000, 25000: 28750, 50000: 60000 };

/** The credits a pack of `priceMinor` carries, or null when that is not a pack's price. */
export function creditPackCreditsMinor(priceMinor: number): number | null {
  return (CREDIT_PACK_CREDITS_MINOR as Record<number, number>)[priceMinor] ?? null;
}

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

/** The month's team budget (USD cents) of a plan: Try $5.00, Founder $10.00, Studio $50.00 (founder, Nov 17, 2026, A15). */
export function includedCreditsMinor(tier: TierKey): number {
  return TIERS[tier].includedCreditsMinor;
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
 * Resting, and the last task always finishes (WP-14 T1; founder, Nov 17, 2026: never stop a team mid-task because a
 * balance ran out). Before a session on Foundmill's key starts, what is left of the month's budget is compared with a
 * reserve for it. Below the reserve the session does not start and the team rests; what is left stays in the balance.
 *
 * - `minMinor`: the reserve when the agent type has no history, and its floor. The same 10 cents under which a share of
 *   a capped round starts nothing (`MIN_SESSION_CAP_MINOR`, apps/orchestrator).
 * - `safetyFactor`: the reserve is the recent average cost of that agent type's sessions times this (the brief's 1.5).
 * - `sampleSessions`: how many of the type's latest finished sessions the average is taken over.
 * - `backstopCeilingMinor`: a session already running that outgrows its reserve still finishes, spending at most this
 *   much past an empty balance; then it stops. Booked to the usage ledger like everything else.
 *
 * `safetyFactor` and `backstopCeilingMinor` were approved by the founder on Nov 19, 2026 (1.5 and 50 cents). Estimates.
 */
export const SESSION_RESERVE = { minMinor: 10, safetyFactor: 1.5, sampleSessions: 20, backstopCeilingMinor: 50 } as const;

/** The reserve for one session, in US cents: the larger of the minimum and the type's recent average times the factor. */
export function sessionReserveMinor(recentAverageMinor: number | null, reserve: { minMinor: number; safetyFactor: number } = SESSION_RESERVE): number {
  return Math.max(reserve.minMinor, Math.ceil(Math.max(0, recentAverageMinor ?? 0) * reserve.safetyFactor));
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

/**
 * How many projects an owner on `tier` may hold, archived ones not counted (null = any number). Try 1, Founder up to 5,
 * Studio any number (founder, Nov 17, 2026, A14). It applies at every stage (founder, Nov 19, 2026): committing one more
 * past it is refused with a plain way on (change plan), and an owner over it keeps what they have.
 */
export function tierBusinessLimit(tier: TierKey): number | null {
  return planBusinesses(tier);
}

/** The plan's own number of projects, whatever the stage (null = any number). */
function planBusinesses(tier: TierKey): number | null {
  const limit: number | string = TIERS[tier].businesses;
  return typeof limit === "number" ? limit : null;
}

/** The lowest plan above `tier` that holds more projects than `owned`, or null when none does. */
export function planWithRoomFor(tier: TierKey, owned: number): TierKey | null {
  return TIER_ORDER.slice(TIER_ORDER.indexOf(tier) + 1).find((t) => (planBusinesses(t) ?? Infinity) > owned) ?? null;
}

/** How many people a business on `tier` may hold (null = unlimited; every plan, founder 2026-11-11: people are free). */
export function tierSeatLimit(tier: TierKey): number | null {
  const limit: number | string = TIERS[tier].seats;
  return typeof limit === "number" ? limit : null;
}

/**
 * Whether a project on `tier` carries the small "Built on Foundmill" mark on what its visitors see (docs/NETWORK.md F2;
 * founder, 2026-11-12): the free plan does, and a paid plan removes it completely, from the page, the line after a
 * follow, the confirmation email and page, and the share image.
 */
export function tierShowsBuiltOnMark(tier: TierKey): boolean {
  return tier === "free";
}

/**
 * Whether a business on `tier` gets the full set of models on Foundmill's key by its plan alone (founder, Nov 16, 2026,
 * WP-13; Nov 17, A15): Founder and Studio, not Try, whatever Try costs. `assertTierAvailable` (apps/api) keeps Founder
 * and Studio out of production until a plan can be bought.
 */
export function tierIsPaid(tier: TierKey): boolean {
  return TIERS[tier].claudeModels;
}

/** Who pays for a model call (packages/models `ModelFunding`, the same three values). */
export type ModelFundingKind = "paid_plan" | "free_plan" | "own_key";

/**
 * Who pays for a model call (WP-13): the business's own Anthropic key when it has one; Founder and Studio ("paid_plan"),
 * every model on Foundmill's key, and from `open` a Try project whose owner bought a credit pack; everyone else the
 * entry plan ("free_plan": the value's name is older than the plan's) (Haiku 5.5 on Foundmill's key, and GLM-5.3 Flash for agent sessions):
 * a free project, a person with no project (pass the highest tier among the projects they own, `businessAllowance`)
 * and a visitor who is signed out (`planTier: null`).
 */
export function modelFundingFor(input: { planTier: TierKey | null; modelBilling: "credits" | "byok" | null; creditPack?: boolean; stage?: EarlyAccessStage }): ModelFundingKind {
  if (input.modelBilling === "byok") return "own_key";
  if (input.planTier !== null && tierIsPaid(input.planTier)) return "paid_plan";
  // A16: from the day sign-up opens, a credit pack of `CREDIT_PACK_UNLOCK_MIN_MINOR` or more bought by the project's
  // owner opens every model to a Try project. Before then a top-up changes nothing here.
  if (input.planTier !== null && input.creditPack === true && (input.stage ?? EARLY_ACCESS_STAGE) === "open") return "paid_plan";
  return "free_plan";
}

/** The higher of two tiers. */
export function higherTier(a: TierKey, b: TierKey): TierKey {
  return TIER_ORDER.indexOf(a) >= TIER_ORDER.indexOf(b) ? a : b;
}
