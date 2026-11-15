/**
 * The funnel's account facts the routers write (WP-02 T9): `idea.kept` when a person keeps their idea-box card, and
 * `idea.drafted` the first time cards are made for them. Each in its own short transaction after the change it records
 * (the change has its own), and idempotent by key, so a repeat writes nothing. A failure is logged with the account id
 * and the fact's name only, and never fails the request: these are counts for the nightly numbers (T10), not product.
 */
import type { Db } from "@foundmill/db";
import { writeAccountEvent } from "@foundmill/events";

interface FactDeps {
  db: Db;
  log?: { warn(obj: unknown, msg?: string): void };
}

async function safely(deps: FactDeps, userId: string, fact: string, write: () => Promise<unknown>): Promise<void> {
  try {
    await write();
  } catch (err) {
    deps.log?.warn({ userId, fact, reason: err instanceof Error && /^[A-Za-z]\w{0,63}$/.test(err.name) ? err.name : "unknown" }, "a funnel fact was not recorded");
  }
}

/** The person kept their idea-box card (once per card; the card's id is in the key, never the payload). */
export function recordIdeaKept(deps: FactDeps, userId: string, ideaId: string): Promise<void> {
  return safely(deps, userId, "idea.kept", () => deps.db.transaction((tx) => writeAccountEvent(tx, { userId, type: "idea.kept", actor: { kind: "user", id: userId }, payload: { from: "idea_box" }, idempotencyKey: `idea.kept:${ideaId}` })));
}

/** The first cards made for the person, from a set, a written idea or a kept idea-box card (once per account). */
export function recordFirstIdeas(deps: FactDeps, userId: string, source: "set" | "written" | "idea_box", cards: number): Promise<void> {
  const n = Math.max(1, Math.min(12, Math.round(cards)));
  return safely(deps, userId, "idea.drafted", () => deps.db.transaction((tx) => writeAccountEvent(tx, { userId, type: "idea.drafted", actor: { kind: "user", id: userId }, payload: { source, cards: n }, idempotencyKey: "idea.drafted:first" })));
}
