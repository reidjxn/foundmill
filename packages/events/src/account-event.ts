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

/** Why a value is not an account event. The code is what a queue row's `last_error`, a dead letter and a log line carry. */
export const ACCOUNT_EVENT_PARSE_REASONS = ["invalid_envelope", "unknown_type", "business_scoped", "invalid_payload"] as const;
export type AccountEventParseReason = (typeof ACCOUNT_EVENT_PARSE_REASONS)[number];

interface IssueLike {
  code?: string;
  path?: readonly PropertyKey[];
}

/** The envelope's own field names: the only path words an error may repeat, because the schema wrote them, not the input. */
const ENVELOPE_FIELDS: ReadonlySet<string> = new Set(["id", "userId", "type", "occurredAt", "actor", "kind", "payload"]);

/**
 * Validation issues as text that is safe to store and to log: each issue's code and how deep it sits, at most five of
 * them. Never Zod's own message (a strict object's reads `Unrecognized key: "<the key>"`, and a key can be an email
 * address), never a path made of the input's keys, never a value. `known` lists path words that are the schema's own.
 */
export function issueReason(issues: readonly IssueLike[], known?: ReadonlySet<string>): string {
  const one = (issue: IssueLike): string => {
    const path = issue.path ?? [];
    const named = known && path.length > 0 && path.every((p) => typeof p === "string" && known.has(p));
    return `${String(issue.code ?? "invalid").replace(/[^a-z_]/gi, "")} at ${named ? path.join(".") : `depth ${path.length}`}`;
  };
  const shown = issues.slice(0, 5).map(one);
  return shown.join("; ") + (issues.length > shown.length ? `; and ${issues.length - shown.length} more` : "");
}

const issueCodes = (issues: readonly IssueLike[]) => issues.slice(0, 20).map((i) => ({ code: String(i.code ?? "invalid").replace(/[^a-z_]/gi, ""), depth: i.path?.length ?? 0 }));

/** A value that is not an account event: a reason code, and text that names rules and depths, never keys or values. */
export class AccountEventParseError extends ValidationError {
  readonly reason: AccountEventParseReason;
  constructor(reason: AccountEventParseReason, message: string, issues: readonly IssueLike[] = []) {
    super(message, { reason, issues: issueCodes(issues) });
    this.reason = reason;
  }
}

export type ParseAccountEventFailure = { ok: false; error: AccountEventParseError };
export type ParseAccountEventSuccess = { ok: true; value: AccountEvent };

/**
 * Validate a payload for an account-scoped type. Throws `AccountEventParseError` (`invalid_payload`), whose text holds
 * issue codes and depths only: what a person wrote, as a key or as a value, is never repeated in it.
 */
export function parseAccountPayload<T extends AccountEventType>(type: T, payload: unknown): AccountEventPayload<T> {
  const decl = (EVENTS as Record<string, EventDeclaration | undefined>)[type];
  if (!decl) throw new AccountEventParseError("unknown_type", "Unknown event type");
  const parsed = decl.schema.safeParse(payload);
  if (!parsed.success) throw new AccountEventParseError("invalid_payload", `Invalid payload for ${decl.type}: ${issueReason(parsed.error.issues)}`, parsed.error.issues);
  return parsed.data as AccountEventPayload<T>;
}

/**
 * Validate an unknown value (a row, a parsed Redis `json` field) as an account event: envelope, scope, then payload.
 * A failure's text is safe to store and to log (`issueReason`): it names the event type only once the catalog knows it.
 */
export function safeParseAccountEvent(raw: unknown): ParseAccountEventSuccess | ParseAccountEventFailure {
  const env = AccountEventEnvelope.safeParse(raw);
  if (!env.success) return { ok: false, error: new AccountEventParseError("invalid_envelope", `Invalid account event envelope: ${issueReason(env.error.issues, ENVELOPE_FIELDS)}`, env.error.issues) };
  const decl = (EVENTS as Record<string, EventDeclaration | undefined>)[env.data.type];
  if (!decl) return { ok: false, error: new AccountEventParseError("unknown_type", "Unknown event type") };
  if (decl.scope !== "account") return { ok: false, error: new AccountEventParseError("business_scoped", `${decl.type} is business-scoped and is never an account event`) };
  const payload = decl.schema.safeParse(env.data.payload);
  if (!payload.success) return { ok: false, error: new AccountEventParseError("invalid_payload", `Invalid payload for ${decl.type}: ${issueReason(payload.error.issues)}`, payload.error.issues) };
  return { ok: true, value: { ...env.data, payload: payload.data } as AccountEvent };
}

/** Like `safeParseAccountEvent` but throws `AccountEventParseError` (a `ValidationError`). */
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
