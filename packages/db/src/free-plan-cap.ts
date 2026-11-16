/**
 * The month's cap on what the free plan costs Foundmill (WP-13 T6; founder, Nov 16, 2026: $600 a month across Haiku 5.5
 * and GLM-5.3 Flash together, web search included). Free-plan spend is every model and search cost booked to the
 * platform's credits this calendar month (UTC) by a business on the free plan, plus the signed-out idea box's cards.
 * Calls a person makes before they have a project are booked from WP-09 T2 (`account_usage`) and join the sum then.
 *
 * States (founder D2): `open` below 80% of the cap; `slow` from 80%: a free account's model allowances are a quarter of
 * their usual size; `held` at the cap: free model calls are refused with `freeCapHeldMessage` until the month resets.
 * A paid plan and a founder's own key are never affected.
 */
import { freePlanSpendRepo } from "./repos/free-plan-spend";
import type { Executor } from "./repos/_shared";

export type FreeCapState = "open" | "slow" | "held";

/** The share of the cap at which free work slows down (founder D2, an Estimate to revisit with the cost report). */
export const FREE_CAP_SLOW_SHARE = 0.8;
/** How much of its usual allowance a free account keeps while the cap is `slow` (founder D2). */
export const FREE_CAP_SLOW_SCALE = 0.25;

/** The first instant of the month `at` falls in, UTC, and of the next one (when free AI is back). */
export function capMonth(at: Date): { start: Date; resetsAt: Date } {
  return { start: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)), resetsAt: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1)) };
}

/** What the free plan has cost this month, in millionths of a US cent (an Estimate at list prices). */
export function freePlanSpendMicro(db: Executor, since: Date): Promise<number> {
  return freePlanSpendRepo.spendMicro(db, since);
}

export function freeCapState(spentMicro: number, capCents: number): FreeCapState {
  const cap = Math.max(0, capCents) * 1_000_000;
  if (spentMicro >= cap) return "held";
  return spentMicro >= cap * FREE_CAP_SLOW_SHARE ? "slow" : "open";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** What a free account reads when the month's cap is reached (founder D2; US date, CLAUDE.md). */
export function freeCapHeldMessage(resetsAt: Date): string {
  return `Free AI is busy for the rest of the month. It is back on ${MONTHS[resetsAt.getUTCMonth()]} ${resetsAt.getUTCDate()}. To keep going now, connect your own Anthropic key.`;
}

export interface FreeCap {
  state: FreeCapState;
  spentMicro: number;
  capMicro: number;
  resetsAt: Date;
}

/** The cap's state with a short per-process cache (60 s), so a burst of free calls reads the database once. */
export function cachedFreeCap(db: Executor, options: { capCents: number; ttlMs?: number; now?: () => Date }): () => Promise<FreeCap> {
  const ttl = options.ttlMs ?? 60_000;
  const now = options.now ?? (() => new Date());
  let hit: { at: number; value: Promise<FreeCap> } | null = null;
  return () => {
    const at = now();
    if (hit && at.getTime() - hit.at < ttl) return hit.value;
    const { start, resetsAt } = capMonth(at);
    const value = freePlanSpendMicro(db, start).then((spentMicro) => ({ state: freeCapState(spentMicro, options.capCents), spentMicro, capMicro: options.capCents * 1_000_000, resetsAt }));
    hit = { at: at.getTime(), value };
    value.catch(() => (hit = null));
    return value;
  };
}

/** The cap as `enforceModelFunding` reads it (packages/models `FreeCapCheck`): the state and, when held, what to say. */
export function freeCapCheck(db: Executor, capCents: number): () => Promise<{ state: FreeCapState; heldMessage: string }> {
  const cap = cachedFreeCap(db, { capCents });
  return async () => {
    const c = await cap();
    return { state: c.state, heldMessage: freeCapHeldMessage(c.resetsAt) };
  };
}
