/**
 * Transactional outbox writer (BUILD §2.1 rule 4, docs/ARCHITECTURE.md §5).
 *
 * `writeEvent(tx, input)` validates the payload against the catalogue and inserts one row into `events`
 * and one into `outbox` using the caller's transaction, so the event is committed if and only if the
 * business change it describes is committed. The relay (`./relay`) publishes it to Redis afterwards.
 *
 * This file deliberately does not import `@foundmill/db`'s schema: it speaks SQL through drizzle's
 * `sql` tag against the table names in BUILD §7.2, and accepts anything with an `execute(sql)` method
 * (a drizzle `Db`, a drizzle transaction `tx`, or a test fake).
 */
import { sql, type SQL } from "drizzle-orm";
import { ValidationError, uuid, type Actor, type BusinessEventType } from "@foundmill/shared";
import {
  getEventDeclaration,
  parsePayload,
  type EventPayloadInput,
  type PlatformEvent,
} from "../catalogue";

/** The minimum surface of a drizzle database or transaction this package needs. */
export interface Queryable {
  execute(query: SQL): Promise<unknown>;
}

/** A `Queryable` that can also open a transaction (drizzle `Db` and `tx` both can). */
export interface TransactionalQueryable extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}

/** Table names from BUILD §7.2. */
export const EVENTS_TABLE = "events";
export const OUTBOX_TABLE = "outbox";

export interface WriteEventInput<T extends BusinessEventType = BusinessEventType> {
  businessId: string;
  type: T;
  actor: Actor;
  payload: EventPayloadInput<T>;
  /** CRM / platform entities the event is about (rendered as EntityLinks in the inbox). */
  entityIds?: readonly string[];
  /** Defaults to now. Webhook-sourced events pass the provider's timestamp. */
  occurredAt?: Date | string;
  /** Supply to make writes idempotent (e.g. derived from a webhook delivery id). Defaults to a new UUID. */
  id?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, what: string): void {
  if (!UUID_RE.test(value)) throw new ValidationError(`${what} must be a UUID`, { [what]: value });
}

function toDate(value: Date | string | undefined): Date {
  if (value === undefined) return new Date();
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime()))
    throw new ValidationError("occurredAt must be a valid date", { occurredAt: value });
  return d;
}

/**
 * Validate an input and produce the full PlatformEvent (id, defaults applied) without writing anything.
 * Throws `ValidationError` for an unknown type, an account-scoped type (a person's fact is never written to a
 * business: `writeAccountEvent` in ./account-writer is its writer), a malformed payload or a non-UUID id.
 */
export function buildEvent<T extends BusinessEventType>(input: WriteEventInput<T>): PlatformEvent<T> {
  const decl = getEventDeclaration(input.type); // throws on unknown type
  // The signature already refuses an account-scoped type; this holds an untyped caller (a cast, plain JavaScript) to it.
  if ((decl as { scope: string }).scope !== "business") {
    throw new ValidationError(`${input.type} is account-scoped and is never written to a business's events; write it with writeAccountEvent`, { type: input.type });
  }
  const payload = parsePayload(decl.type, input.payload);
  assertUuid(input.businessId, "businessId");
  const id = input.id ?? uuid();
  assertUuid(id, "id");
  const entityIds = [...(input.entityIds ?? [])];
  for (const e of entityIds) assertUuid(e, "entityIds[]");
  if (
    !input.actor ||
    typeof input.actor.kind !== "string" ||
    typeof input.actor.id !== "string" ||
    input.actor.id.length === 0
  ) {
    throw new ValidationError("actor must be { kind, id }", { actor: input.actor });
  }
  return {
    id,
    businessId: input.businessId,
    type: decl.type,
    occurredAt: toDate(input.occurredAt),
    actor: { kind: input.actor.kind, id: input.actor.id },
    entityIds,
    payload,
    narrated: false,
  } as PlatformEvent<T>;
}

/** The two statements `writeEvent` runs, exposed for tests and for batching. */
export function eventInsertSql(event: PlatformEvent): SQL {
  return sql`insert into ${sql.identifier(EVENTS_TABLE)} (id, business_id, type, occurred_at, actor, entity_ids, payload, narrated)
values (${event.id}::uuid, ${event.businessId}::uuid, ${event.type}, ${event.occurredAt.toISOString()}::timestamptz, ${JSON.stringify(event.actor)}::jsonb, ${entityIdsSql(event.entityIds)}, ${JSON.stringify(event.payload)}::jsonb, ${event.narrated})`;
}

export function outboxInsertSql(eventId: string): SQL {
  return sql`insert into ${sql.identifier(OUTBOX_TABLE)} (event_id) values (${eventId}::uuid)`;
}

/** `uuid[]` literal built from parameters so it works identically on postgres.js, node-postgres and PGlite. */
function entityIdsSql(ids: readonly string[]): SQL {
  if (ids.length === 0) return sql`'{}'::uuid[]`;
  return sql`array[${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]::uuid[]`;
}

/**
 * Write one event through the outbox inside the caller's transaction. Returns the event id.
 *
 * ```ts
 * await db.transaction(async (tx) => {
 *   await repos.payments.record(tx, businessId, ...);
 *   await writeEvent(tx, { businessId, type: "payment.received", actor: { kind: "webhook", id: "stripe" }, entityIds: [customerId], payload });
 * });
 * ```
 */
export async function writeEvent<T extends BusinessEventType>(
  tx: Queryable,
  input: WriteEventInput<T>,
): Promise<string> {
  const event = buildEvent(input);
  await tx.execute(eventInsertSql(event));
  await tx.execute(outboxInsertSql(event.id));
  return event.id;
}

/** Write several events in order within the same transaction. Returns their ids. All inputs are validated before the first insert. */
export async function writeEvents(
  tx: Queryable,
  inputs: readonly WriteEventInput[],
): Promise<string[]> {
  const events = inputs.map((i) => buildEvent(i));
  for (const event of events) {
    await tx.execute(eventInsertSql(event));
    await tx.execute(outboxInsertSql(event.id));
  }
  return events.map((e) => e.id);
}
