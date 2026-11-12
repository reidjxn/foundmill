/**
 * Transactional outbox writer for account-scoped events (docs/ARCHITECTURE.md §5 "Account events"; migration
 * `account_events`). The sibling of ./writer: `writeAccountEvent(tx, input)` validates the payload against the catalog
 * and inserts one row into `account_events` and one into `account_outbox` using the caller's transaction, so the event
 * is committed if and only if the change it describes is committed. The account relay (./account-relay) publishes it
 * to `ae:{userId}` afterwards.
 *
 * What differs from the business writer:
 * - the row is keyed by a person (`userId`), not a business, and has no `entityIds` and no `narrated` flag;
 * - only an account-scoped type is accepted (the signature and a runtime check; `writeEvent` refuses these types);
 * - the two-person rule is checked before anything is written (../account-payload): the actor is the person themselves
 *   or the system, and the payload never carries the account id of anyone the fact is about, an email address, or a
 *   UUID outside the declaration's `recordIds`. A fact about two people is written with `writeAccountEvents`, one row
 *   per person, each payload shaped for its reader;
 * - `idempotencyKey` works on the real tables: a repeat for the same person returns the first event's id and writes
 *   nothing, without raising inside the caller's transaction (`on conflict do nothing`).
 *
 * Like ./writer this file speaks SQL through drizzle's `sql` tag and accepts anything with an `execute(sql)` method.
 */
import { sql, type SQL } from "drizzle-orm";
import { ValidationError, uuid, type AccountEventType, type Actor } from "@foundmill/shared";
import { assertAccountActor, assertAccountPayloadValues } from "../account-payload";
import type { AccountEvent, AccountEventPayloadInput } from "../account-event";
import { getEventDeclaration, parsePayload } from "../catalogue";
import type { Queryable } from "./writer";

export const ACCOUNT_EVENTS_TABLE = "account_events";
export const ACCOUNT_OUTBOX_TABLE = "account_outbox";

/** The longest idempotency key the table takes. */
export const ACCOUNT_IDEMPOTENCY_KEY_MAX = 200;

export interface WriteAccountEventInput<T extends AccountEventType = AccountEventType> {
  /** The person the fact belongs to: the only account that will ever read the row. */
  userId: string;
  type: T;
  /** The person themselves (`{ kind: "user", id: userId }`) or the system (`{ kind: "system", id: "<a word>" }`). */
  actor: Actor;
  payload: AccountEventPayloadInput<T>;
  /** Defaults to now. */
  occurredAt?: Date | string;
  /** Defaults to a new UUID. */
  id?: string;
  /** A repeat with the same key for the same person returns the first event's id and writes nothing. */
  idempotencyKey?: string | null;
  /**
   * Account ids of the other people the fact is about who get no row in this call (the other side of a follow written
   * elsewhere, the person a referral brought): the payload is refused if it carries any of them.
   */
  otherAccountIds?: readonly string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: unknown, what: string): asserts value is string {
  if (typeof value !== "string" || !UUID_RE.test(value)) throw new ValidationError(`${what} must be a UUID`, { field: what });
}

function toDate(value: Date | string | undefined): Date {
  if (value === undefined) return new Date();
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new ValidationError("occurredAt must be a valid date", { field: "occurredAt" });
  return d;
}

/** A built account event plus what only the writer needs (never published, never readable by the person). */
export type BuiltAccountEvent<T extends AccountEventType = AccountEventType> = AccountEvent<T> & { idempotencyKey: string | null };

/**
 * Validate an input and produce the full account event (id, defaults applied) without writing anything. Throws
 * `ValidationError` for an unknown type, a business-scoped type (`writeEvent` in ./writer is its writer), a malformed
 * payload, a non-UUID id, an actor that is another party, or a payload that breaks the two-person rule.
 * `alsoAbout` adds account ids the payload must not carry (the other rows of the same fact).
 */
export function buildAccountEvent<T extends AccountEventType>(input: WriteAccountEventInput<T>, alsoAbout: readonly string[] = []): BuiltAccountEvent<T> {
  const decl = getEventDeclaration(input.type); // throws on unknown type
  // The signature already refuses a business-scoped type; this holds an untyped caller (a cast, plain JavaScript) to it.
  if ((decl as { scope: string }).scope !== "account") {
    throw new ValidationError(`${String(input.type)} is business-scoped and is never written to a person's account events; write it with writeEvent`, { type: input.type });
  }
  assertUuid(input.userId, "userId");
  const id = input.id ?? uuid();
  assertUuid(id, "id");
  const others = [...(input.otherAccountIds ?? []), ...alsoAbout];
  for (const other of others) assertUuid(other, "otherAccountIds[]");
  assertAccountActor(decl.type, input.actor, input.userId);
  const payload = parsePayload(decl.type, input.payload);
  assertAccountPayloadValues(decl.type, payload, { recordIds: decl.recordIds, accountIds: [input.userId, ...others] });
  const idempotencyKey = input.idempotencyKey ?? null;
  if (idempotencyKey !== null && (typeof idempotencyKey !== "string" || idempotencyKey.length === 0 || idempotencyKey.length > ACCOUNT_IDEMPOTENCY_KEY_MAX)) {
    throw new ValidationError(`idempotencyKey must be 1 to ${ACCOUNT_IDEMPOTENCY_KEY_MAX} characters`, { field: "idempotencyKey" });
  }
  return {
    id,
    userId: input.userId.toLowerCase(),
    type: decl.type,
    occurredAt: toDate(input.occurredAt),
    actor: { kind: input.actor.kind, id: input.actor.kind === "user" ? input.actor.id.toLowerCase() : input.actor.id },
    payload,
    idempotencyKey,
  } as BuiltAccountEvent<T>;
}

/**
 * The event insert. With an idempotency key a repeat for the same person inserts nothing and returns no row (the
 * partial unique index `account_events_idempotency_idx`), instead of failing the caller's transaction.
 */
export function accountEventInsertSql(event: BuiltAccountEvent): SQL {
  return sql`insert into ${sql.identifier(ACCOUNT_EVENTS_TABLE)} (id, user_id, type, occurred_at, actor, payload, idempotency_key)
values (${event.id}::uuid, ${event.userId}::uuid, ${event.type}, ${event.occurredAt.toISOString()}::timestamptz, ${JSON.stringify(event.actor)}::jsonb, ${JSON.stringify(event.payload)}::jsonb, ${event.idempotencyKey})
on conflict (user_id, idempotency_key) where idempotency_key is not null do nothing
returning id as "id"`;
}

export function accountEventByKeySql(userId: string, idempotencyKey: string): SQL {
  return sql`select id as "id" from ${sql.identifier(ACCOUNT_EVENTS_TABLE)} where user_id = ${userId}::uuid and idempotency_key = ${idempotencyKey} limit 1`;
}

export function accountOutboxInsertSql(event: Pick<BuiltAccountEvent, "id" | "userId">): SQL {
  return sql`insert into ${sql.identifier(ACCOUNT_OUTBOX_TABLE)} (user_id, event_id) values (${event.userId}::uuid, ${event.id}::uuid)`;
}

/** postgres.js returns an array of rows, PGlite and node-postgres `{ rows }`. */
function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown }).rows)) return (result as { rows: Record<string, unknown>[] }).rows;
  return [];
}

async function insertBuilt(tx: Queryable, event: BuiltAccountEvent): Promise<string> {
  const inserted = rowsOf(await tx.execute(accountEventInsertSql(event)));
  if (inserted.length > 0) {
    await tx.execute(accountOutboxInsertSql(event));
    return event.id;
  }
  // Nothing inserted: this person already has an event with this key. Its outbox row was written with it.
  if (event.idempotencyKey === null) throw new Error("writeAccountEvent: the insert returned no row");
  const [existing] = rowsOf(await tx.execute(accountEventByKeySql(event.userId, event.idempotencyKey)));
  if (!existing || typeof existing.id !== "string") throw new Error("writeAccountEvent: an event with this idempotency key was reported and then not found");
  return existing.id;
}

/**
 * Write one account event through the account outbox inside the caller's transaction. Returns the event id (the first
 * event's id when `idempotencyKey` repeats).
 *
 * ```ts
 * await db.transaction(async (tx) => {
 *   const row = await repos.personProfiles.publish(tx, userId);
 *   await writeAccountEvent(tx, { userId, type: "profile.published", actor: { kind: "user", id: userId }, payload: { handle: row.handle } });
 * });
 * ```
 */
export async function writeAccountEvent<T extends AccountEventType>(tx: Queryable, input: WriteAccountEventInput<T>): Promise<string> {
  return insertBuilt(tx, buildAccountEvent(input) as BuiltAccountEvent);
}

/**
 * Write one fact that belongs to several people: one row per person, each with a payload shaped for that reader, in
 * the caller's transaction. Returns the ids in order. Every input is validated before the first insert, and no payload
 * may carry the account id of any person in the call (so one person's row never names the other by their account).
 * Each person appears once.
 */
export async function writeAccountEvents(tx: Queryable, inputs: readonly WriteAccountEventInput[]): Promise<string[]> {
  for (const input of inputs) assertUuid(input.userId, "userId");
  const people = inputs.map((i) => i.userId.toLowerCase());
  if (new Set(people).size !== people.length) throw new ValidationError("writeAccountEvents writes one row per person: a person appears twice", { field: "userId" });
  const events = inputs.map((input, i) => buildAccountEvent(input, people.filter((_, j) => j !== i)));
  const ids: string[] = [];
  for (const event of events) ids.push(await insertBuilt(tx, event));
  return ids;
}
