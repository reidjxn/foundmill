/**
 * Event emission for orchestrator activities.
 *
 * `buildEvent` from @foundmill/events validates the payload against the catalogue (unknown type / malformed payload
 * fail here, never at read time); the row itself goes through `repos.events.write`, which inserts `events` + `outbox`
 * with the business id the outbox migration requires (the gateway took the same route; see docs/WAVE1_REPORTS.md).
 */
import { repos, type Executor } from "@foundmill/db";
import { buildEvent, type WriteEventInput } from "@foundmill/events";
import type { EventType } from "@foundmill/shared";

export interface EmittedEvent {
  id: string;
  type: EventType;
}

export async function emitEvent<T extends EventType>(db: Executor, input: WriteEventInput<T>): Promise<EmittedEvent> {
  const event = buildEvent(input);
  const row = await repos.events.write(db, event.businessId, {
    id: event.id,
    type: event.type,
    actor: event.actor,
    entityIds: event.entityIds,
    payload: event.payload as Record<string, unknown>,
    occurredAt: event.occurredAt,
  });
  return { id: row.id, type: row.type as EventType };
}

export const systemActor = { kind: "system", id: "orchestrator" } as const;
export const agentActor = (agentId: string) => ({ kind: "agent", id: agentId }) as const;
