/**
 * Plan tier limits, enforced (BUILD §10.5 `TIERS`; DECISIONS 2026-10-12 "Tier limits are enforced"). Three checks, one
 * per limit, each read where the limit bites:
 *
 * - **Businesses per owner** (`idea.commit`): the plan tier is stored per business, so an owner's allowance follows the
 *   highest tier among the unarchived businesses they own (none: free). A new business always starts on free.
 * - **Seats** (`team.humans.invite`): every membership of the business is a seat, the owner included.
 * - **Concurrent agents** (cycle dispatch): agent sessions still open for the business, started within the last
 *   `OPEN_SESSION_WINDOW_HOURS` (an older open row is a session the orchestrator lost, not one using a slot).
 *
 * Refusals are `TierLimitError` (code `tier_limit`), which the web turns into an upgrade prompt.
 */
import { higherTier, tierBusinessLimit, TIERS, type TierKey } from "@foundmill/config";
import { TierLimitError } from "@foundmill/shared";
import { repos } from "./repos";
import { MAX_PAGE_SIZE, type Executor } from "./repos/_shared";

export const OPEN_SESSION_WINDOW_HOURS = 24;

const tierWord = (tier: TierKey) => tier.charAt(0).toUpperCase() + tier.slice(1);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export interface BusinessAllowance {
  /** The highest tier among the businesses the user owns (free when they own none). */
  tier: TierKey;
  /** Null: unlimited. */
  allowed: number | null;
  owned: number;
  /** The id of the business on `tier`, where the founder changes plan (null when they own none). */
  planBusinessId: string | null;
}

/** How many businesses `userId` owns (unarchived) against what their highest tier allows. */
export async function businessAllowance(db: Executor, userId: string): Promise<BusinessAllowance> {
  const owned = (await repos.businesses.listForUser(db, userId)).filter((b) => b.role === "owner");
  let tier: TierKey = "free";
  let planBusinessId: string | null = null;
  for (const b of owned) {
    if (planBusinessId !== null && higherTier(tier, b.planTier) === tier) continue;
    tier = b.planTier;
    planBusinessId = b.id;
  }
  return { tier, allowed: tierBusinessLimit(tier), owned: owned.length, planBusinessId };
}

/**
 * Refuses a new business once the owner holds as many as their tier allows. Call it inside the transaction that creates
 * the business: it takes a per-owner transaction lock first, so two commits by one owner cannot both pass the count.
 */
export async function assertBusinessAllowance(db: Executor, userId: string): Promise<BusinessAllowance> {
  await repos.businesses.lockOwnerBusinesses(db, userId);
  const a = await businessAllowance(db, userId);
  if (a.allowed !== null && a.owned >= a.allowed) {
    throw new TierLimitError(`The ${tierWord(a.tier)} plan holds ${plural(a.allowed, "business", "businesses")} and you already own ${a.owned}. Archive one, or move a business you own to a larger plan in Settings › Billing, to take charge of another.`, {
      limit: "businesses",
      tier: a.tier,
      allowed: a.allowed,
      used: a.owned,
      planBusinessId: a.planBusinessId,
    });
  }
  return a;
}

/** Seats the business uses (every membership) against its tier. */
export async function seatAllowance(db: Executor, business: { id: string; planTier: TierKey }): Promise<{ tier: TierKey; allowed: number; used: number }> {
  const used = (await repos.memberships.list(db, business.id)).length;
  return { tier: business.planTier, allowed: TIERS[business.planTier].seats, used };
}

/** Refuses an invitation once every seat of the business's tier is taken. */
export async function assertSeatAvailable(db: Executor, business: { id: string; planTier: TierKey }): Promise<void> {
  const s = await seatAllowance(db, business);
  if (s.used >= s.allowed) {
    throw new TierLimitError(`The ${tierWord(s.tier)} plan has ${plural(s.allowed, "seat", "seats")} and all of them are taken. Move this business to a larger plan in Settings › Billing to invite someone else.`, {
      limit: "seats",
      tier: s.tier,
      allowed: s.allowed,
      used: s.used,
      planBusinessId: business.id,
    });
  }
}

export interface ConcurrencyAllowance {
  /** `TIERS[tier].maxConcurrentAgents`. */
  limit: number;
  /** Agent sessions open right now (see the module comment). */
  running: number;
  /** How many more may start now (never below zero). */
  room: number;
}

/** The business's concurrent-agent limit, what already runs, and the room left (cycle dispatch, BUILD §9.4). */
export async function concurrencyAllowance(db: Executor, business: { id: string; planTier: TierKey }, now: Date = new Date()): Promise<ConcurrencyAllowance> {
  const since = now.getTime() - OPEN_SESSION_WINDOW_HOURS * 60 * 60 * 1000;
  // Newest first: past the page, every slot of even the largest tier is taken anyway.
  const open = await repos.agents.listSessions(db, business.id, { openOnly: true, limit: MAX_PAGE_SIZE });
  const limit = TIERS[business.planTier].maxConcurrentAgents;
  const running = open.items.filter((s) => s.startedAt.getTime() >= since).length;
  return { limit, running, room: Math.max(0, limit - running) };
}
