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
 *      written, no email-shaped text, nothing shaped like an id outside `recordIds`, and never the account id of
 *      anyone the fact is about (the row's own person, the other rows of the same fact, `otherAccountIds`);
 *   3. in the database (migration `account_events`, trigger `fm_account_events_guard`): no account id of any account,
 *      whichever writer; the actor is exactly `{ kind, id }`, the person themselves or the system by a word;
 *   4. in the tests of each (`__tests__/account-payload.test.ts`, packages/db `rls/account-events.test.ts`).
 *
 * **What "carries an account id" means, and what it cannot mean.** One value (a string, or a key) is read without its
 * punctuation, so an id is found however it is spelled: with hyphens, without, with hyphens elsewhere, in capitals,
 * with Unicode dashes or fullwidth characters, with spaces, dots, colons or underscores between its parts, in braces,
 * behind a prefix, inside a sentence. The id of someone the fact is about is refused in any such spelling (and through
 * any other separator); so is anything merely shaped like an id (32 letters a to f and digits in a row once that
 * punctuation is out) unless the key is a declared record id holding one plain UUID. What no
 * check here or in the database can see is an id cut into pieces across several values (`{ a: "0a1b…", b: "…4e5f" }`):
 * the schema conventions (closed objects, plain fields, declared record ids) are what stand against that.
 *
 * **Errors say which rule and how deep, never what.** A refusal names the event type (a catalog name), a rule code and
 * the depth of the value; not the key and not the value, because a key can be anything the caller was handed. The
 * declaration-time errors are different: they name the schema's own keys, which a developer wrote.
 *
 * The row's own account is in the envelope (`userId`), so no payload needs it.
 */
import { ValidationError, type Actor } from "@foundmill/shared";
import type { z } from "zod";

/** A key that names a person by their account: `userId`, `fromUserId`, `follower_id`, `ownerIds`, … */
export const ACCOUNT_ID_KEY = /(user|account|owner|member|founder|person|people|profile|author|sender|recipient|follower|followed|followee|referrer|referred|inviter|invitee|asker|answerer|actor|viewer|reader|peer)_?ids?$/i;
/** A key that carries a contact detail or a credential. */
export const PRIVATE_DETAIL_KEY = /(e[-_]?mail|phone|mobile|password|secret|token|ip[-_]?address)/i;
/** A system actor's name: a lowercase word (`platform`, `public-page`, `notify:email`), never an id. The database's check repeats it. */
export const SYSTEM_ACTOR_ID = /^[a-z][a-z0-9_.:-]{0,62}$/;

const UUID_ONLY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_TEXT = /[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+/;
/** Every dash a person might type for a hyphen: U+2010 to U+2015, the minus sign, the small and fullwidth hyphens. */
const DASHES = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;
const ID_RUN = /[0-9a-f]{32}/;

/**
 * Text as the id checks read it: compatibility forms folded (fullwidth letters and digits), lower case, and the
 * punctuation an id is written with taken out (the hyphen, every Unicode dash, white space, the dot, the colon and the
 * underscore). An id then reads as its 32 letters and digits, however it was punctuated. The database's
 * `fm_account_id_text` does the same, without the compatibility folding and for the plain space only.
 */
export function accountIdText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(DASHES, "-").replace(/[-\s._:]/g, "");
}

/** Only the letters a to f and the digits of a text, so an id is found through any separator at all. */
const hexOnly = (value: string): string => value.normalize("NFKC").toLowerCase().replace(/[^0-9a-f]/g, "");

/** Whether a text is, or contains, something shaped like an id (32 letters a to f and digits once its punctuation is out). */
export function looksLikeAnId(value: string): boolean {
  return ID_RUN.test(accountIdText(value));
}

/** Why a key cannot be in an account event payload, or null when it can. For schemas: the text names the key. */
export function accountPayloadKeyProblem(key: string): string | null {
  if (ACCOUNT_ID_KEY.test(key)) return `"${key}" names a person by an account: name another person by something public about them (a handle), and leave the row's own account to the envelope`;
  if (PRIVATE_DETAIL_KEY.test(key)) return `"${key}" carries a contact detail or a credential`;
  return null;
}

/** The rules a payload or an actor can break when it is written. The code is what logs and dead letters carry. */
export const ACCOUNT_RULES = {
  not_object: "the payload must be an object",
  account_id: "carries an account id; a payload never names a person by their account",
  id_shaped: "carries something shaped like an id, and only the declaration's recordIds may hold one, as one plain UUID",
  email: "carries an email address",
  account_key: "is a key that names a person by an account",
  private_key: "is a key for a contact detail or a credential",
  actor_shape: "the actor must be exactly { kind, id }",
  actor_other_person: "a user actor must be the person the row belongs to",
  actor_kind: "an account event's actor is the person themselves or the system",
  actor_not_a_word: "a system actor is named by a lowercase word (for example \"platform\"), never by an id or an address",
} as const;
export type AccountRule = keyof typeof ACCOUNT_RULES;

/** A broken rule: the event type, the rule's code and how deep in the payload, never the key or the value. */
export class AccountRuleError extends ValidationError {
  readonly rule: AccountRule;
  constructor(type: string, rule: AccountRule, where?: { depth: number; part: "key" | "value" }) {
    const subject = where ? `a ${where.part} at depth ${where.depth} ` : "";
    super(`Account event ${type}: ${subject}${ACCOUNT_RULES[rule]}`, { type, rule, ...(where ?? {}) });
    this.rule = rule;
  }
}

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
 * Checks a payload as it is about to be written. Throws `AccountRuleError` (a `ValidationError`): the rule's code and
 * the depth, never the key or the value.
 */
export function assertAccountPayloadValues(type: string, payload: unknown, check: AccountPayloadCheck): void {
  const recordIds = check.recordIds ?? [];
  // An account id as its 32 letters and digits: found in a value through any punctuation.
  const accountIds = check.accountIds.map(hexOnly).filter((id) => id.length === 32);
  const text = (value: string, depth: number, part: "key" | "value", key: string | null): void => {
    const hex = hexOnly(value);
    if (accountIds.some((id) => hex.includes(id))) throw new AccountRuleError(type, "account_id", { depth, part });
    if (EMAIL_TEXT.test(value.normalize("NFKC"))) throw new AccountRuleError(type, "email", { depth, part });
    // One plain UUID under a declared record id is the only id-shaped text a payload holds.
    const declared = part === "value" && key !== null && recordIds.includes(key) && UUID_ONLY.test(value);
    if (!declared && looksLikeAnId(value)) throw new AccountRuleError(type, "id_shaped", { depth, part });
  };
  const walk = (value: unknown, depth: number, key: string | null): void => {
    if (typeof value === "string") return text(value, depth, "value", key);
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth, key);
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, child] of Object.entries(value as Record<string, unknown>)) {
        // A key can smuggle a value too.
        text(k, depth + 1, "key", null);
        if (ACCOUNT_ID_KEY.test(k)) throw new AccountRuleError(type, "account_key", { depth: depth + 1, part: "key" });
        if (PRIVATE_DETAIL_KEY.test(k)) throw new AccountRuleError(type, "private_key", { depth: depth + 1, part: "key" });
        walk(child, depth + 1, k);
      }
    }
  };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new AccountRuleError(type, "not_object");
  walk(payload, 0, null);
}

/**
 * Who an account event's row may name as its actor: the person themselves, or the system by a lowercase word (never an
 * id, however it is spelled). Anyone else (another person, an agent of someone's project, a webhook) would put a second
 * party on a private row. Exactly `{ kind, id }`: nothing else rides in the actor.
 */
export function assertAccountActor(type: string, actor: Actor | undefined, userId: string): void {
  if (!actor || typeof actor !== "object" || typeof actor.kind !== "string" || typeof actor.id !== "string" || actor.id.length === 0 || Object.keys(actor).some((k) => k !== "kind" && k !== "id")) {
    throw new AccountRuleError(type, "actor_shape");
  }
  if (actor.kind === "user") {
    if (actor.id.toLowerCase() !== userId.toLowerCase()) throw new AccountRuleError(type, "actor_other_person");
    return;
  }
  if (actor.kind !== "system") throw new AccountRuleError(type, "actor_kind");
  if (!SYSTEM_ACTOR_ID.test(actor.id) || looksLikeAnId(actor.id) || EMAIL_TEXT.test(actor.id)) throw new AccountRuleError(type, "actor_not_a_word");
}
