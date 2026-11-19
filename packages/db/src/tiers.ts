/**
 * Plan tier limits, enforced (BUILD §10.5 `TIERS`; DECISIONS 2026-10-12 "Tier limits are enforced"). Three checks, one
 * per limit, each read where the limit bites:
 *
 * - **Projects per owner** (`idea.commit`): Try 1, Founder up to 5, Studio any number, archived ones not counted
 *   (founder, Nov 17, 2026, A14), at every stage (Nov 19, 2026)
 *  . An owner over the limit keeps what they have and is told which
 *   plan allows another. The plan tier is stored per business, so an owner's allowance follows the highest tier among
 *   the unarchived businesses they own (none: free). A new business always starts on free.
 *   The same tier sizes the founder's monthly pool of included credits (`includedCreditPool`, SEC2 S6), which keeps
 *   its own number (`includedCreditBusinesses`).
 * - **Seats** (`team.humans.invite`): every membership of the business is a seat, the owner included.
 * - **Concurrent agents** (cycle dispatch, `dev.tasks.start` and every session the orchestrator opens): agent sessions
 *   still open for the business, started within the last `OPEN_SESSION_WINDOW_HOURS` (an older open row is a session
 *   the orchestrator lost, not one using a slot).
 *
 * Refusals are `TierLimitError` (code `tier_limit`), which the web turns into an upgrade prompt.
 */
import { higherTier, planName, planWithRoomFor, tierBusinessLimit, tierIncludedCreditPlaces, tierSeatLimit, TIERS, type TierKey } from "@foundmill/config";
import { TierLimitError } from "@foundmill/shared";
import { repos } from "./repos";
import { MAX_PAGE_SIZE, type Executor } from "./repos/_shared";

export const OPEN_SESSION_WINDOW_HOURS = 24;

const tierWord = planName;
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

export interface BusinessAllowanceOptions {
  /**
   * The project limit of a tier (default `tierBusinessLimit`). Tests pass the limits
   * that apply from the day sign-up opens.
   */
  limitFor?: (tier: TierKey) => number | null;
}

/** How many businesses `userId` owns (unarchived) against what their highest tier allows. */
export async function businessAllowance(db: Executor, userId: string, options: BusinessAllowanceOptions = {}): Promise<BusinessAllowance> {
  // The projects the person started (`owner`), not the ones they joined as a cofounder: people are free on every plan,
  // so joining someone's project never uses up a person's own allowance (CLAUDE.md, founder 2026-11-11).
  const owned = (await repos.businesses.listForUser(db, userId)).filter((b) => b.role === "owner");
  let tier: TierKey = "free";
  let planBusinessId: string | null = null;
  for (const b of owned) {
    if (planBusinessId !== null && higherTier(tier, b.planTier) === tier) continue;
    tier = b.planTier;
    planBusinessId = b.id;
  }
  return { tier, allowed: (options.limitFor ?? tierBusinessLimit)(tier), owned: owned.length, planBusinessId };
}

/**
 * Refuses a new business once the owner holds as many as their tier allows. Call it inside the transaction that creates
 * the business: it takes a per-owner transaction lock first, so two commits by one owner cannot both pass the count.
 */
export async function assertBusinessAllowance(db: Executor, userId: string, options: BusinessAllowanceOptions = {}): Promise<BusinessAllowance> {
  await repos.businesses.lockOwnerBusinesses(db, userId);
  const a = await businessAllowance(db, userId, options);
  if (a.allowed !== null && a.owned >= a.allowed) {
    const larger = planWithRoomFor(a.tier, a.owned);
    const way = larger ? `${tierWord(larger)} ${TIERS[larger].businesses === "unlimited" ? "holds any number" : `holds up to ${TIERS[larger].businesses}`}: change plan in Settings › Billing to take charge of another, or archive one.` : "Archive one to take charge of another.";
    throw new TierLimitError(`${tierWord(a.tier)} holds ${plural(a.allowed, "project", "projects")} and you have ${a.owned}. You keep ${a.owned === 1 ? "it" : "them all"}. ${way}`, {
      limit: "businesses",
      tier: a.tier,
      allowed: a.allowed,
      used: a.owned,
      planBusinessId: a.planBusinessId,
    });
  }
  return a;
}

export interface IncludedCreditPool {
  /** The founder's tier: the highest among the unarchived businesses they own (free when they own none). */
  tier: TierKey;
  /** The month, "2026-10". */
  period: string;
  /** How many of their businesses the tier's included credits cover each month (null: every one). */
  places: number | null;
  /** How many places this period's grants already took (businesses the founder created, archived ones included). */
  taken: number;
}

/**
 * The founder's monthly pool of included credits (SEC2 S6): their tier, how many businesses it covers and how many
 * places this period's grants already took. Read-only; `includedCreditsFor` (billing.ts) applies the same rule when it
 * grants.
 */
export async function includedCreditPool(db: Executor, userId: string, period: string): Promise<IncludedCreditPool> {
  const [{ tier }, taken] = await Promise.all([businessAllowance(db, userId), repos.usage.includedCreditPlacesTaken(db, userId, period)]);
  return { tier, period, places: tierIncludedCreditPlaces(tier), taken };
}

export interface SeatAllowanceOptions {
  /**
   * The people limit of a tier (default `tierSeatLimit`: unlimited on every plan, people are free). Tests pass a number
   * to keep the refusal covered should a limit ever return.
   */
  limitFor?: (tier: TierKey) => number | null;
}

/** The people of the business (every membership) against its tier. `allowed` null: unlimited. */
export async function seatAllowance(db: Executor, business: { id: string; planTier: TierKey }, options: SeatAllowanceOptions = {}): Promise<{ tier: TierKey; allowed: number | null; used: number }> {
  const used = (await repos.memberships.list(db, business.id)).length;
  return { tier: business.planTier, allowed: (options.limitFor ?? tierSeatLimit)(business.planTier), used };
}

/** Refuses adding a person once a tier's people limit is reached. No plan has one (founder, 2026-11-11). */
export async function assertSeatAvailable(db: Executor, business: { id: string; planTier: TierKey }, options: SeatAllowanceOptions = {}): Promise<void> {
  const s = await seatAllowance(db, business, options);
  if (s.allowed !== null && s.used >= s.allowed) {
    throw new TierLimitError(`${tierWord(s.tier)} has room for ${plural(s.allowed, "person", "people")} and all of them are here. Move this business to a larger plan in Settings › Billing to add someone else.`, {
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

/**
 * Refuses one more agent session once every concurrent agent the tier holds is working: a task started by hand
 * (`dev.tasks.start`) and every session the orchestrator opens (a cycle's dispatch, a plan's task) count against the
 * same limit as the cycle. The count is read just before the session row is written, so two starts landing in the same
 * instant can both pass; the credits ceiling, not this count, is what bounds spend.
 */
export async function assertConcurrencyRoom(db: Executor, business: { id: string; planTier: TierKey }, now: Date = new Date()): Promise<ConcurrencyAllowance> {
  const c = await concurrencyAllowance(db, business, now);
  if (c.room <= 0) {
    throw new TierLimitError(`${tierWord(business.planTier)} runs ${plural(c.limit, "agent", "agents")} at once and all of them are working. Start this task when one finishes, or move this business to a larger plan in Settings › Billing.`, {
      limit: "concurrent_agents",
      tier: business.planTier,
      allowed: c.limit,
      used: c.running,
      planBusinessId: business.id,
    });
  }
  return c;
}
