/**
 * Who pays for a model call (WP-13; founder, Nov 16, 2026), read from the call's attribution: the business's plan and
 * billing, else the person's (the highest tier among the projects they own, `businessAllowance`), else a visitor who
 * is signed out (the free plan). Each service passes the answer to `enforceModelFunding` (packages/models).
 *
 * `ownKeyServed`: whether the calling client runs a business's calls on that business's own Anthropic key (the
 * orchestrator's per-business client; the api's and the composer's route to the gateway, WP-13 T11). A client that does
 * not (the platform side of those routers, web search) treats an own-key business as its plan says: a paid plan runs as
 * routed, the free plan on Haiku 5.5 on Foundmill's key, never on a model the founder has not paid for.
 */
import { CREDIT_PACK_UNLOCK_MIN_MINOR, EARLY_ACCESS_STAGE, modelFundingFor, tierIsPaid, type EarlyAccessStage, type ModelFundingKind } from "@foundmill/config";
import type { Executor } from "./repos/_shared";
import { repos } from "./repos";
import { businessAllowance } from "./tiers";

export interface ModelFundingOptions {
  ownKeyServed: boolean;
  /** The early-access stage (default the config's). Tests pass `open` to cover what applies from the day sign-up opens. */
  stage?: EarlyAccessStage;
}

export async function modelFundingOf(db: Executor, attribution: { businessId?: string; userId?: string } | undefined, options: ModelFundingOptions): Promise<ModelFundingKind> {
  if (attribution?.businessId) {
    const business = await repos.businesses.get(db, attribution.businessId, { includeArchived: true });
    const stage = options.stage ?? EARLY_ACCESS_STAGE;
    // From the day sign-up opens, a Try project whose owner bought a credit pack reaches every model (A16). Read only
    // then, and only for a plan that does not reach them by itself.
    const creditPack = stage === "open" && !tierIsPaid(business.planTier) && (await repos.checkouts.ownerHasPack(db, business.id, CREDIT_PACK_UNLOCK_MIN_MINOR));
    const funding = modelFundingFor({ planTier: business.planTier, modelBilling: business.modelBilling, creditPack, stage });
    if (funding !== "own_key" || options.ownKeyServed) return funding;
    return modelFundingFor({ planTier: business.planTier, modelBilling: "credits", creditPack, stage });
  }
  if (attribution?.userId) return modelFundingFor({ planTier: (await businessAllowance(db, attribution.userId)).tier, modelBilling: "credits" });
  return "free_plan";
}

/**
 * `modelFundingOf` with a short per-process cache (30 s, as the orchestrator caches a business's key), so a burst of
 * calls for one business or person reads the database once. A plan change reaches every service within the TTL.
 */
export function cachedModelFundingOf(db: Executor, options: ModelFundingOptions & { ttlMs?: number; now?: () => number }): (attribution: { businessId?: string; userId?: string } | undefined) => Promise<ModelFundingKind> {
  const ttl = options.ttlMs ?? 30_000;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; value: Promise<ModelFundingKind> }>();
  return (attribution) => {
    const key = attribution?.businessId ? `b:${attribution.businessId}` : attribution?.userId ? `u:${attribution.userId}` : "anon";
    if (key === "anon") return Promise.resolve("free_plan");
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttl) return hit.value;
    const value = modelFundingOf(db, attribution, options);
    cache.set(key, { at: now(), value });
    value.catch(() => cache.delete(key));
    return value;
  };
}
