/**
 * Who pays for a model call (WP-13; founder, Nov 16, 2026), read from the call's attribution: the business's plan and
 * billing, else the person's (the highest tier among the projects they own, `businessAllowance`), else a visitor who
 * is signed out (the free plan). Each service passes the answer to `enforceModelFunding` (packages/models).
 *
 * `ownKeyServed`: whether the calling service can run a business's calls on that business's own Anthropic key (the
 * orchestrator and the gateway can; the api and the composer cannot until WP-13 T11 routes them through the gateway).
 * A service that cannot treats an own-key business as its plan says: a paid plan runs as routed, the free plan runs on
 * Haiku 5.5 on Foundmill's key, never on a model the founder has not paid for.
 */
import { modelFundingFor, type ModelFundingKind } from "@foundmill/config";
import type { Executor } from "./repos/_shared";
import { repos } from "./repos";
import { businessAllowance } from "./tiers";

export interface ModelFundingOptions {
  ownKeyServed: boolean;
}

export async function modelFundingOf(db: Executor, attribution: { businessId?: string; userId?: string } | undefined, options: ModelFundingOptions): Promise<ModelFundingKind> {
  if (attribution?.businessId) {
    const business = await repos.businesses.get(db, attribution.businessId, { includeArchived: true });
    const funding = modelFundingFor({ planTier: business.planTier, modelBilling: business.modelBilling });
    if (funding !== "own_key" || options.ownKeyServed) return funding;
    return modelFundingFor({ planTier: business.planTier, modelBilling: "credits" });
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
