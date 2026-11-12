/**
 * The envelope of an account-scoped event (docs/ARCHITECTURE.md §5 "Account events"; founder, 2026-11-12): a fact
 * about one person, keyed by their account (`userId`) where a business event is keyed by `businessId`. It has no
 * `entityIds` (CRM records belong to a project) and no `narrated` flag (the Composer writes a project's Inbox).
 *
 * The types come from the one catalog (./catalogue): a declaration with `scope: "account"`. `parseAccountEvent` refuses
 * a business-scoped type, exactly as `parseEvent` refuses an account-scoped one.
 */
import { Actor, EventType, ValidationError, type AccountEventType } from "@foundmill/shared";
import { z } from "zod";
import { EVENTS, Id, IsoDateTime, type EventDeclaration, type EventPayload, type EventPayloadInput } from "./catalogue";

/** Payload type (output of the schema) for one account-scoped type. */
export type AccountEventPayload<T extends AccountEventType> = EventPayload<T>;
/** Payload type as accepted on input. */
export type AccountEventPayloadInput<T extends AccountEventType> = EventPayloadInput<T>;

export type AccountEvent<T extends AccountEventType = AccountEventType> = {
  [K in AccountEventType]: {
    id: string;
    /** The person the row belongs to: the only account that may read it. */
    userId: string;
    type: K;
    occurredAt: Date;
    /** The person themselves, or the system (never another person). */
    actor: Actor;
    payload: AccountEventPayload<K>;
  };
}[T];

/** Wire form: the Redis `json` field on `ae:{userId}`. */
export type AccountEventWire<T extends AccountEventType = AccountEventType> = Omit<AccountEvent<T>, "occurredAt"> & { occurredAt: string };

const OccurredAt = z.union([z.date(), IsoDateTime.transform((s) => new Date(s))]).refine((d) => !Number.isNaN(d.getTime()), "occurredAt must be a valid date");

/** Envelope without payload validation (the payload is validated per type by `parseAccountEvent`). */
export const AccountEventEnvelope = z.object({
  id: Id,
  userId: Id,
  type: EventType,
  occurredAt: OccurredAt,
  actor: Actor,
  payload: z.unknown(),
});

export type ParseAccountEventFailure = { ok: false; error: ValidationError };
export type ParseAccountEventSuccess = { ok: true; value: AccountEvent };

/** Validate an unknown value (a row, a parsed Redis `json` field) as an account event: envelope, scope, then payload. */
export function safeParseAccountEvent(raw: unknown): ParseAccountEventSuccess | ParseAccountEventFailure {
  const env = AccountEventEnvelope.safeParse(raw);
  if (!env.success) return { ok: false, error: new ValidationError(`Invalid account event envelope: ${z.prettifyError(env.error)}`, env.error.issues) };
  const decl = (EVENTS as Record<string, EventDeclaration | undefined>)[env.data.type];
  if (!decl) return { ok: false, error: new ValidationError(`Unknown event type "${env.data.type}"`, { type: env.data.type }) };
  if (decl.scope !== "account") return { ok: false, error: new ValidationError(`${env.data.type} is business-scoped and is never an account event`, { type: env.data.type }) };
  const payload = decl.schema.safeParse(env.data.payload);
  // The issues name paths and rules, not values: nothing a person wrote ends up in a log line or a dead letter.
  if (!payload.success) return { ok: false, error: new ValidationError(`Invalid payload for ${env.data.type}: ${z.prettifyError(payload.error)}`, payload.error.issues) };
  return { ok: true, value: { ...env.data, payload: payload.data } as AccountEvent };
}

/** Like `safeParseAccountEvent` but throws `ValidationError`. */
export function parseAccountEvent(raw: unknown): AccountEvent {
  const r = safeParseAccountEvent(raw);
  if (!r.ok) throw r.error;
  return r.value;
}

export function accountEventToWire<T extends AccountEventType>(event: AccountEvent<T>): AccountEventWire<T> {
  return { ...event, occurredAt: event.occurredAt.toISOString() } as AccountEventWire<T>;
}

/** Serialize for the Redis `json` field. Dates become ISO strings. */
export function serializeAccountEvent(event: AccountEvent): string {
  return JSON.stringify(accountEventToWire(event));
}

/** Narrow an account event to one type. */
export function isAccountEventOfType<T extends AccountEventType>(event: AccountEvent, type: T): event is AccountEvent<T> {
  return event.type === type;
}
