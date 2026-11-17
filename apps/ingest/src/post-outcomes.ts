/**
 * Real outcomes credited to the team post they came through (item 8, approved by the network session Nov 13, 2026;
 * packages/db `postAttributions`). In the transaction that records the outcome, with `post.outcome_attributed` (ids
 * only, never narrated, never counted: the outcome's own event is what the north star counts):
 *
 * - a follow: `/mail/confirm` wrote `page.followed` (double opt-in) and the signup kept a post link (platform-mail.ts);
 * - a reply: a `lead.replied` delivered by a vendor (actor `webhook`), positive or neutral, not simulated, from a
 *   follower whose follow was credited to a post in the last 30 days, once per follower;
 * - a payment: a `payment.received` delivered by a vendor, not simulated, from such a follower, once per follower. A pay
 *   button that carries the post's code (`client_reference_id=s.<code>`) is not on main yet: `paymentPostCode` is the
 *   seam that will read it, and reads nothing until then.
 *
 * The replier's or payer's contact id is read here, inside the business's transaction, and never stored.
 */
import { repos, type Executor, type PostCredit } from "@foundmill/db";
import type { WriteEventInput } from "@foundmill/events";

/** The outbox writer the caller uses (ingest.ts `writeEventRow`), passed in so this file imports none of ingest.ts. */
export type WriteOutboxEvent = (
  tx: Executor,
  input: WriteEventInput & { idempotencyKey?: string | null },
) => Promise<unknown>;

/** The event fields read here. */
export interface OutcomeEventLike {
  id: string;
  businessId: string;
  type: string;
  actor: { kind: string; id: string };
  payload: Record<string, unknown>;
  occurredAt: Date | string;
}

/** Replies that read as "it worked": a person answered. Unsubscribes, spam reports, auto-replies and refusals do not. */
const REPLIES_THAT_COUNT: ReadonlySet<string> = new Set(["positive", "neutral"]);

/** Anything the Simulate panel or a mock produced never counts (the same rule as the weekly "What worked"). */
export function isSimulatedOutcome(e: Pick<OutcomeEventLike, "actor" | "payload">): boolean {
  if (e.actor.kind === "system" && e.actor.id === "simulate") return true;
  return "simulated" in e.payload && e.payload.simulated !== false;
}

/** A real outcome a vendor delivered: actor `webhook`, nothing simulated about it. */
const fromVendor = (e: OutcomeEventLike): boolean =>
  e.actor.kind === "webhook" && !isSimulatedOutcome(e);

/**
 * The post code a payment carries (the pay button's `client_reference_id=s.<code>`, set from the `fm_post` cookie for
 * the business's own page). The payment link is not on main yet, so no payment carries one; this returns null until it
 * does, and then reads the reference here and nowhere else.
 */
export function paymentPostCode(_event: OutcomeEventLike): string | null {
  return null;
}

/** Writes the credit's event (`post.outcome_attributed`) through the outbox in the caller's transaction. */
export async function writeCreditEvent(
  write: WriteOutboxEvent,
  tx: Executor,
  businessId: string,
  credit: PostCredit,
  at: Date | string,
): Promise<void> {
  await write(tx, {
    businessId,
    type: "post.outcome_attributed",
    actor: { kind: "system", id: "post-attribution" },
    payload: {
      linkId: credit.linkId,
      assetId: credit.assetId,
      network: credit.network,
      outcomeKind: credit.outcomeKind,
      outcomeEventId: credit.outcomeEventId,
    },
    occurredAt: at,
    idempotencyKey: `post.outcome_attributed:${credit.outcomeEventId}`,
  });
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * A reply or a payment just written (in its own transaction): credited to a post when it qualifies (see the file
 * comment). Returns the credit, or null. Anything else (another type, a simulated or system event, a negative reply)
 * credits nothing.
 */
export async function creditPostOutcome(
  write: WriteOutboxEvent,
  tx: Executor,
  event: OutcomeEventLike,
): Promise<PostCredit | null> {
  if (!fromVendor(event)) return null;
  const at = event.occurredAt instanceof Date ? event.occurredAt : new Date(event.occurredAt);
  const entityId = str(event.payload.entityId);
  let credit: PostCredit | null;
  if (event.type === "lead.replied") {
    if (!entityId || !REPLIES_THAT_COUNT.has(String(event.payload.sentiment))) return null;
    credit = await repos.postAttributions.creditReply(tx, {
      businessId: event.businessId,
      entityId,
      outcomeEventId: event.id,
      at,
    });
  } else if (event.type === "payment.received") {
    credit = await repos.postAttributions.creditPayment(tx, {
      businessId: event.businessId,
      entityId,
      outcomeEventId: event.id,
      at,
      postCode: paymentPostCode(event),
    });
  } else return null;
  if (credit) await writeCreditEvent(write, tx, event.businessId, credit, at);
  return credit;
}
