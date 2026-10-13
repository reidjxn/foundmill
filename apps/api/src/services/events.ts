/**
 * Event writer used by the API. `@foundmill/events`' `writeEvent` inserts `outbox (event_id)` only, while the
 * schema's `outbox` carries a NOT NULL `business_id` (docs/DECISIONS.md "outbox carries business_id"), so the raw
 * insert fails on the real tables. Until the events package is fixed, the API validates the payload with the
 * catalogue (`buildEvent`) and writes the rows through `repos.events.write`, which fills both tables correctly.
 */
import { repos, type Executor } from "@foundmill/db";
import { buildEvent, type WriteEventInput } from "@foundmill/events";
import type { EventType } from "@foundmill/shared";

/** Validate against the catalogue, then write events + outbox in the caller's transaction. Returns the event id. */
export async function writeEventRow<T extends EventType>(tx: Executor, input: WriteEventInput<T>, idempotencyKey?: string): Promise<string> {
  const event = buildEvent(input);
  const row = await repos.events.write(tx, event.businessId, {
    id: event.id,
    type: event.type,
    actor: event.actor,
    entityIds: event.entityIds,
    payload: event.payload as Record<string, unknown>,
    occurredAt: event.occurredAt,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });
  return row.id;
}
