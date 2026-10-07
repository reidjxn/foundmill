/**
 * The write path: normalised platform events → `events` + `outbox` in one transaction per event, idempotent on
 * (connector, external id), with conversion-kind events also recording their `conversions` row, a first-pass
 * journey and `customer.converted` (docs/ARCHITECTURE.md §5, BUILD §2.1 rule 4 "write through the outbox").
 *
 * Events go through `buildEvent` (catalogue validation) and `repos.events.write`, which fills the outbox row's
 * `business_id` — `writeEvent` from `@foundmill/events` inserts `outbox(event_id)` only, which migration 0011
 * rejects (the same workaround apps/api, apps/gateway and apps/composer use; fix belongs in the events package).
 */
import { repos, type Db, type Event } from "@foundmill/db";
import type { Executor } from "@foundmill/db/repos/_shared";
import { buildEvent, type PlatformEvent, type WriteEventInput } from "@foundmill/events";
import { NotFoundError, ValidationError, type Actor, type EventType } from "@foundmill/shared";
import { conversionFactsFor, recordConversionForEvent, type ConversionOutcome } from "./conversions";
import type { IngestLogger } from "./types";

export interface IngestedEvent {
  id: string;
  type: EventType;
  businessId: string;
  /** False when the (connector, external id) pair had been written before; nothing was inserted. */
  written: boolean;
  idempotencyKey: string;
  conversion: ConversionOutcome | null;
}

export interface IngestResult {
  events: IngestedEvent[];
  written: number;
  duplicates: number;
  /** Ids of every event row the call produced (source events and the `customer.converted` rows they triggered). */
  eventIds: string[];
}

export interface IngestOptions {
  /** `stripe`, `sendgrid`, `simulate:stripe`… — the first half of the idempotency key. */
  source: string;
  /** Actor stamped on derived events; the source event keeps the actor the connector set. */
  actor?: Actor;
  log?: IngestLogger;
}

/** The vendor-side reference that makes a delivery unique: payments carry their invoice/order id; everything else the deterministic event id. */
export function externalRefFor(event: PlatformEvent): string {
  switch (event.type) {
    case "payment.received":
      return `${event.payload.provider}:${event.payload.externalId}`;
    case "pr.merged":
      return `${event.payload.repo}#${event.payload.prNumber}:${event.payload.mergeCommitSha}`;
    default:
      return event.id;
  }
}

export const idempotencyKeyFor = (source: string, event: PlatformEvent): string => `${source}:${event.type}:${externalRefFor(event)}`.slice(0, 200);

/** `buildEvent` validation then `repos.events.write` (fills outbox.business_id). Returns the row. */
export async function writeEventRow(tx: Executor, input: WriteEventInput & { idempotencyKey?: string | null }): Promise<Event> {
  const event = buildEvent(input);
  return repos.events.write(tx, event.businessId, {
    id: event.id,
    type: event.type,
    actor: event.actor,
    entityIds: event.entityIds,
    payload: event.payload as Record<string, unknown>,
    occurredAt: event.occurredAt,
    idempotencyKey: input.idempotencyKey ?? null,
  });
}

/**
 * Write platform events through the outbox. Each event is its own transaction: a duplicate or an invalid payload
 * in one never blocks the others, and the HTTP answer reports per event. The business must exist (404 otherwise).
 */
export async function ingestPlatformEvents(db: Db, events: readonly PlatformEvent[], options: IngestOptions): Promise<IngestResult> {
  const out: IngestedEvent[] = [];
  const eventIds: string[] = [];
  const actor = options.actor ?? { kind: "webhook", id: options.source };
  for (const raw of events) {
    // Re-validate against the catalogue: a connector that drifted from the schema fails here, not in SQL.
    const event = buildEvent({ businessId: raw.businessId, type: raw.type, actor: raw.actor, payload: raw.payload, entityIds: raw.entityIds, occurredAt: raw.occurredAt, id: raw.id }) as PlatformEvent;
    await repos.businesses.get(db, event.businessId); // NotFoundError → 404 upstream
    const idempotencyKey = idempotencyKeyFor(options.source, event);
    const result = await db.transaction(async (tx) => {
      const existing = await findExisting(tx, event.businessId, event.id);
      if (existing) return { row: existing, written: false, conversion: null as ConversionOutcome | null };
      const row = await writeEventRow(tx, { businessId: event.businessId, type: event.type, actor: event.actor, entityIds: event.entityIds, occurredAt: event.occurredAt, payload: event.payload, id: event.id, idempotencyKey });
      if (row.id !== event.id) return { row, written: false, conversion: null as ConversionOutcome | null }; // same idempotency key, earlier row
      const facts = conversionFactsFor(event);
      const conversion = facts ? await recordConversionForEvent(tx, event, facts, actor, (t, input) => writeEventRow(t, input)) : null;
      return { row, written: true, conversion };
    });
    out.push({ id: result.row.id, type: result.row.type as EventType, businessId: event.businessId, written: result.written, idempotencyKey, conversion: result.conversion });
    eventIds.push(result.row.id);
    if (result.conversion) eventIds.push(result.conversion.convertedEventId);
    options.log?.info({ eventId: result.row.id, type: event.type, businessId: event.businessId, written: result.written, conversion: result.conversion?.conversion.id ?? null, source: options.source }, result.written ? "event ingested" : "duplicate delivery ignored");
  }
  return { events: out, written: out.filter((e) => e.written).length, duplicates: out.filter((e) => !e.written).length, eventIds };
}

async function findExisting(tx: Executor, businessId: string, eventId: string): Promise<Event | null> {
  try {
    return await repos.events.get(tx, businessId, eventId);
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}

export const isValidationError = (e: unknown): e is ValidationError => e instanceof ValidationError;
