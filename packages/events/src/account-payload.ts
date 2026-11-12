/**
 * What an account-scoped event may carry (docs/ARCHITECTURE.md §5 "Account events"; founder, 2026-11-12).
 *
 * An account event is a row in one person's private store. A fact about two people (a follow, an answer, a referral)
 * is written as one row per person it belongs to, each with a payload shaped for that reader. So a payload may name
 * another person only by something already public about them (a public handle), never by account id, email address or
 * any private field. The rule is held in four places, and this file is the first two:
 *
 *   1. at declaration (`assertAccountPayloadSchema`, run by `declareAccountEvent` when the catalog loads): the payload
 *      schema is a closed object of plain fields; no key names a person by an account or carries a contact detail or
 *      a credential; a UUID field exists only when the declaration lists it under `recordIds` (the id of a record,
 *      never of an account); no field is an email address; nothing is free-form (`z.record`, `z.unknown`, a loose
 *      object), because a free-form bag cannot be checked;
 *   2. at write (`assertAccountPayloadValues`, run by `writeAccountEvent`): the same key rule over the values as
 *      written, no email-shaped text, no UUID outside `recordIds`, and never the account id of anyone the fact is about
 *      (the row's own person, the other rows of the same fact, `otherAccountIds`), wherever it hides;
 *   3. in the database (migration `account_events`, trigger `fm_account_events_guard`): no account id of any account,
 *      whichever writer; the actor is the person themselves or the system;
 *   4. in the tests of each (`__tests__/account-payload.test.ts`, packages/db `rls/account-events.test.ts`).
 *
 * The row's own account is in the envelope (`userId`), so no payload needs it.
 */
import { ValidationError, type Actor } from "@foundmill/shared";
import type { z } from "zod";

/** A key that names a person by their account: `userId`, `fromUserId`, `follower_id`, `ownerIds`, … */
export const ACCOUNT_ID_KEY = /(user|account|owner|member|founder|person|people|profile|author|sender|recipient|follower|followed|followee|referrer|referred|inviter|invitee|asker|answerer|actor|viewer|reader|peer)_?ids?$/i;
/** A key that carries a contact detail or a credential. */
export const PRIVATE_DETAIL_KEY = /(e[-_]?mail|phone|mobile|password|secret|token|ip[-_]?address)/i;

const UUID_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const UUID_ONLY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_TEXT = /[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+/;

/** Why a key cannot be in an account event payload, or null when it can. */
export function accountPayloadKeyProblem(key: string): string | null {
  if (ACCOUNT_ID_KEY.test(key)) return `"${key}" names a person by an account: name another person by something public about them (a handle), and leave the row's own account to the envelope`;
  if (PRIVATE_DETAIL_KEY.test(key)) return `"${key}" carries a contact detail or a credential`;
  return null;
}

const refuse = (type: string, problem: string, details?: unknown): never => {
  throw new ValidationError(`Account event ${type}: ${problem}`, details ?? { type });
};

type AnyDef = { type: string; format?: string; checks?: { _zod?: { def?: { format?: string } } }[]; shape?: Record<string, z.ZodType>; catchall?: z.ZodType; element?: z.ZodType; innerType?: z.ZodType; options?: z.ZodType[] };
const defOf = (schema: z.ZodType): AnyDef => (schema as unknown as { def: AnyDef }).def;

function stringFormats(def: AnyDef): string[] {
  const formats = def.format ? [def.format] : [];
  for (const check of def.checks ?? []) if (check._zod?.def?.format) formats.push(check._zod.def.format);
  return formats;
}

/**
 * Checks a payload schema against the conventions above. Throws a plain `Error` (a programming mistake caught when the
 * catalog loads, not a request's validation error). `recordIds` lists the keys allowed to hold a UUID.
 */
export function assertAccountPayloadSchema(type: string, schema: z.ZodType, recordIds: readonly string[] = []): void {
  const fail = (path: string, problem: string): never => {
    throw new Error(`declareAccountEvent("${type}"): ${path || "payload"}: ${problem} (packages/events/src/account-payload.ts)`);
  };
  for (const key of recordIds) {
    const problem = accountPayloadKeyProblem(key);
    if (problem) fail(key, `recordIds cannot list it: ${problem}`);
  }
  const walk = (node: z.ZodType, path: string, key: string | null): void => {
    const def = defOf(node);
    switch (def.type) {
      case "object": {
        if (def.catchall && defOf(def.catchall).type !== "never") fail(path, "a loose object lets unchecked keys through; use z.object or z.strictObject");
        for (const [k, child] of Object.entries(def.shape ?? {})) {
          const problem = accountPayloadKeyProblem(k);
          if (problem) fail(path ? `${path}.${k}` : k, problem);
          walk(child, path ? `${path}.${k}` : k, k);
        }
        return;
      }
      case "array":
        return walk(def.element!, `${path}[]`, key);
      case "optional":
      case "nullable":
      case "default":
      case "readonly":
        return walk(def.innerType!, path, key);
      case "union":
        for (const option of def.options ?? []) walk(option, path, key);
        return;
      case "string": {
        const formats = stringFormats(def);
        if (formats.includes("email")) fail(path, "an email address is never in an account event");
        if ((formats.includes("guid") || formats.includes("uuid")) && !(key !== null && recordIds.includes(key))) {
          fail(path, "a UUID field must be listed in the declaration's recordIds (the id of a record, never of an account)");
        }
        return;
      }
      case "number":
      case "boolean":
      case "enum":
      case "literal":
      case "null":
        return;
      default:
        fail(path, `a ${def.type} field cannot be checked; use plain fields, or extend the checker on purpose`);
    }
  };
  if (defOf(schema).type !== "object") fail("", "the payload schema must be an object");
  walk(schema, "", null);
}

export interface AccountPayloadCheck {
  /** Keys allowed to hold a UUID (the declaration's `recordIds`). */
  recordIds?: readonly string[];
  /** Account ids the payload must never carry: the row's own person and everyone else the fact is about. */
  accountIds: readonly string[];
}

/**
 * Checks a payload as it is about to be written. Throws `ValidationError`; the error names the key and the rule, never
 * the value.
 */
export function assertAccountPayloadValues(type: string, payload: unknown, check: AccountPayloadCheck): void {
  const recordIds = check.recordIds ?? [];
  const accountIds = check.accountIds.map((id) => id.toLowerCase());
  const walk = (value: unknown, path: string, key: string | null): void => {
    if (typeof value === "string") {
      const lower = value.toLowerCase();
      if (accountIds.some((id) => lower.includes(id))) refuse(type, `${path} carries an account id; a payload never names a person by their account`, { type, path });
      if (EMAIL_TEXT.test(value)) refuse(type, `${path} carries an email address`, { type, path });
      if (UUID_TEXT.test(value) && !(key !== null && recordIds.includes(key) && UUID_ONLY.test(value))) {
        refuse(type, `${path} carries a UUID, and only the declaration's recordIds may`, { type, path });
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`, key));
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, child] of Object.entries(value as Record<string, unknown>)) {
        // A key can smuggle a value too. Checked first, and reported without the key itself.
        walk(k, `a key of ${path || "the payload"}`, null);
        const where = path ? `${path}.${k}` : k;
        const problem = accountPayloadKeyProblem(k);
        if (problem) refuse(type, `${where}: ${problem}`, { type, path: where });
        walk(child, where, k);
      }
    }
  };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) refuse(type, "the payload must be an object");
  walk(payload, "", null);
}

/**
 * Who an account event's row may name as its actor: the person themselves, or the system (by a name, never an id).
 * Anyone else (another person, an agent of someone's project, a webhook) would put a second party on a private row.
 */
export function assertAccountActor(type: string, actor: Actor | undefined, userId: string): void {
  if (!actor || typeof actor.kind !== "string" || typeof actor.id !== "string" || actor.id.length === 0) refuse(type, "actor must be { kind, id }");
  const a = actor as Actor;
  if (a.kind === "user") {
    if (a.id.toLowerCase() !== userId.toLowerCase()) refuse(type, "a user actor must be the person the row belongs to");
    return;
  }
  if (a.kind !== "system") refuse(type, `an account event's actor is the person themselves or the system, not "${a.kind}"`);
  if (UUID_TEXT.test(a.id) || EMAIL_TEXT.test(a.id)) refuse(type, "a system actor is named by a word (for example \"platform\"), never by an id or an address");
}
