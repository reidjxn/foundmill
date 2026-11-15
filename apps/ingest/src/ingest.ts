/**
 * The write path: normalised platform events → `events` + `outbox` in one transaction per event, idempotent on
 * (connector, external id), with conversion-kind events also linking the customer to the CRM (`customers.ts`) and
 * recording their `conversions` row and, when they win a customer, a first-pass journey and `customer.converted`
 * (docs/ARCHITECTURE.md §5, BUILD §2.1 rule 4 "write through the outbox"). The source event names the CRM record it
 * was linked to, so its entity links resolve. What happens after commit (narration, journeyBuild, playbooks) is
 * `followups.ts`.
 *
 * Events go through `buildEvent` (catalogue validation) and `repos.events.write`, which fills the outbox row's
 * `business_id` — `writeEvent` from `@foundmill/events` inserts `outbox(event_id)` only, which migration 0011
 * rejects (the same workaround apps/api, apps/gateway and apps/composer use; fix belongs in the events package).
 */
import { repos, type Db, type Event } from "@foundmill/db";
import type { Executor } from "@foundmill/db/repos/_shared";
import { buildEvent, type PlatformEvent, type WriteEventInput } from "@foundmill/events";
import { NotFoundError, ValidationError, type Actor, type EventType } from "@foundmill/shared";
import { linkContractSignature } from "./contracts";
import { conversionFactsFor, recordConversionForEvent, type ConversionOutcome } from "./conversions";
import { linkCustomer } from "./customers";
import { creditPostOutcome } from "./post-outcomes";
import type { IngestLogger } from "./types";

export interface IngestedEvent {
  id: string;
  type: EventType;
  businessId: string;
  /** The payload as written (playbook triggers match on it). */
  payload: Record<string, unknown>;
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
  /** Events left unwritten on purpose: a signature callback that names no signable contract of the business. */
  skipped: number;
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

/** The event with the connector's entity id replaced by the CRM record it was linked to (payload and `entityIds`). */
export function withLinkedEntity(event: PlatformEvent, connectorEntityId: string, entityId: string): PlatformEvent {
  if (connectorEntityId === entityId) return event;
  const entityIds = [...new Set(event.entityIds.map((id) => (id === connectorEntityId ? entityId : id)))];
  if (!entityIds.includes(entityId)) entityIds.unshift(entityId);
  return { ...event, entityIds, payload: { ...event.payload, entityId } } as PlatformEvent;
}

/**
 * Write platform events through the outbox. Each event is its own transaction: a duplicate or an invalid payload
 * in one never blocks the others, and the HTTP answer reports per event. The business must exist (404 otherwise).
 */
export async function ingestPlatformEvents(db: Db, events: readonly PlatformEvent[], options: IngestOptions): Promise<IngestResult> {
  const out: IngestedEvent[] = [];
  const eventIds: string[] = [];
  let skipped = 0;
  const actor = options.actor ?? { kind: "webhook", id: options.source };
  for (const raw of events) {
    // Re-validate against the catalogue: a connector that drifted from the schema fails here, not in SQL.
    const event = buildEvent({ businessId: raw.businessId, type: raw.type, actor: raw.actor, payload: raw.payload, entityIds: raw.entityIds, occurredAt: raw.occurredAt, id: raw.id }) as PlatformEvent;
    await repos.businesses.get(db, event.businessId); // NotFoundError → 404 upstream
    const idempotencyKey = idempotencyKeyFor(options.source, event);
    const result = await db.transaction(async (tx) => {
      const existing = await findExisting(tx, event.businessId, event.id);
      if (existing) return { row: existing, written: false, conversion: null as ConversionOutcome | null };
      // The customer is linked (or added to the CRM) before the event is written, so the event names the CRM record.
      const facts = conversionFactsFor(event);
      const linked = facts ? await linkCustomer(tx, event.businessId, { connectorEntityId: facts.entityId, provider: facts.provider, customer: facts.customer, kind: facts.kind, occurredAt: event.occurredAt, sourceEventId: event.id }) : null;
      // A signature request that names one of the business's contracts records that contract as signed and names it.
      const toWrite = facts && linked ? withLinkedEntity(event, facts.entityId, linked.entityId) : await linkContractSignature(tx, event);
      if (!toWrite) return null;
      const row = await writeEventRow(tx, { businessId: toWrite.businessId, type: toWrite.type, actor: toWrite.actor, entityIds: toWrite.entityIds, occurredAt: toWrite.occurredAt, payload: toWrite.payload, id: toWrite.id, idempotencyKey });
      if (row.id !== event.id) return { row, written: false, conversion: null as ConversionOutcome | null }; // same idempotency key, earlier row
      const conversion = facts ? await recordConversionForEvent(tx, toWrite, facts, actor, (t, input) => writeEventRow(t, input), linked?.entityId ?? null) : null;
      // A real reply or payment from a follower a shared post brought is credited to that post, in this transaction
      // (item 8; ./post-outcomes.ts). The row's own actor and payload decide: a simulated delivery credits nothing.
      await creditPostOutcome(writeEventRow, tx, { id: row.id, businessId: row.businessId, type: row.type, actor: row.actor as { kind: string; id: string }, payload: row.payload as Record<string, unknown>, occurredAt: row.occurredAt });
      return { row, written: true, conversion };
    });
    if (!result) {
      skipped += 1;
      options.log?.warn({ type: event.type, businessId: event.businessId, source: options.source }, "signature callback names no signable contract of the business; nothing written");
      continue;
    }
    out.push({ id: result.row.id, type: result.row.type as EventType, businessId: event.businessId, payload: result.row.payload as Record<string, unknown>, written: result.written, idempotencyKey, conversion: result.conversion });
    eventIds.push(result.row.id);
    if (result.conversion?.win) eventIds.push(result.conversion.win.convertedEventId);
    options.log?.info({ eventId: result.row.id, type: event.type, businessId: event.businessId, written: result.written, conversion: result.conversion?.conversion.id ?? null, firstPayment: result.conversion?.firstPayment ?? null, source: options.source }, result.written ? "event ingested" : "duplicate delivery ignored");
  }
  return { events: out, written: out.filter((e) => e.written).length, duplicates: out.filter((e) => !e.written).length, eventIds, skipped };
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
