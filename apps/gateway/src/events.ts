/**
 * Event writes from the gateway. The payload is validated against the catalogue by `buildEvent` from
 * `@foundmill/events` (unknown type or malformed payload → ValidationError, nothing written), then the
 * validated event is inserted into `events` + `outbox` by `repos.events.write`, which fills the outbox row's
 * `business_id`. (`writeEvent` from the events package inserts the outbox row without `business_id`, which
 * the 0011 schema requires — a wave-1 mismatch recorded in the gateway report; this wrapper is the local workaround.)
 */
import { repos, type Event } from "@foundmill/db";
import { buildEvent, type WriteEventInput } from "@foundmill/events";
import type { Executor } from "@foundmill/db/repos/_shared";
import type { EventType } from "@foundmill/shared";

/** `idempotencyKey`: an event that may repeat is written once per key within its business (the existing row comes back). */
export async function writeGatewayEvent<T extends EventType>(tx: Executor, input: WriteEventInput<T>, idempotencyKey?: string): Promise<Event> {
  const event = buildEvent(input);
  return repos.events.write(tx, event.businessId, {
    id: event.id,
    type: event.type,
    actor: event.actor,
    entityIds: event.entityIds,
    payload: event.payload as Record<string, unknown>,
    occurredAt: event.occurredAt,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });
}
