/**
 * Who or what brought a new person (docs/NETWORK.md §5 "Attribution is part of every loop", §11; migration 0086).
 * Every public address accepts `?via=<reference>` (@foundmill/shared/via: `p.<slug>` a project's public page,
 * `u.<handle>` a person's public profile); the web keeps the first one a visitor arrives with in a cookie and hands it
 * to `founder.profile.update` on the save that creates the person's profile. This records it, once per account.
 *
 * The rules, all of them silent (the caller's answer is the same whatever happens here, so a reference cannot be used to
 * ask whether a page or a person exists, or whether an account was already attributed):
 *   - only on the save that creates the profile (the caller says so), and only while the account has no attribution;
 *   - a value that is not a reference, and a reference that names nothing public right now, record nothing. What is
 *     public is decided by the two public views alone (`repos.attributions.resolve`): a published page of a committed,
 *     open, real business, never a sample one, or a public profile;
 *   - nobody brings themselves: when the person credited is the new person, nothing is recorded;
 *   - a failure here never fails the profile save: it is logged without the value and the person carries on.
 * The raw value is never logged: it is whatever a stranger typed into an address.
 *
 * Runs on the service connection: the table and both public views are the service role's only.
 *
 * **The events.** One sign-up that a public address brought is a fact about two people, so it is written as two
 * account events (docs/ARCHITECTURE.md §5 "Account events", the two-person rule), in the transaction that inserts the
 * `attributions` row and only when that insert wrote a row:
 *   - `signup.attributed` in the new person's own account events: "you arrived through this public page or profile";
 *   - `referral.arrived` in the credited person's, when there is one: "someone signed up through your page or profile".
 * Both payloads are `{ sourceKind, sourceRef }` (the slug or handle as it arrived: public, it was in an address) and
 * nothing else. Neither carries an account id or the project's id, and the credited person's row says nothing about
 * who signed up; its time is the attribution's own and nothing finer (see `referral.arrived` in packages/events for
 * what that time can and cannot tell its reader). The actor of both is the system by a word: the new person is never
 * the actor on the credited person's row. Nothing is written to a business's `events` or `outbox`.
 *
 * **The row never depends on its events.** The `attributions` row is the record credit is later paid from, and it can
 * be written once only (the save that creates the profile happens once), so the events go in a savepoint inside the
 * row's transaction: both are written with the row, or the row is written without them and a warning says so with the
 * new person's account id and a reason code (the rule refused, or `write_failed`), never the reference and never the
 * credited person. One case is known: an address shaped like an id (a slug of 32 letters a to f and digits) is refused
 * in any account event. Because each idempotency key is built from the row's own id, the events can be written from
 * the rows later, and a repeat writes nothing.
 */
import { repos, type Attribution, type Db } from "@foundmill/db";
import { AccountEventParseError, AccountRuleError, writeAccountEvents, type WriteAccountEventInput } from "@foundmill/events";
import { parseVia } from "@foundmill/shared/via";
import type { ApiLogger } from "./log";

export interface AttributionDeps {
  /** The service connection. */
  db: Db;
  log: ApiLogger;
}

/** Who both rows name as their actor: the api's own recording, by a word. Never a person, so never the other person. */
export const ATTRIBUTION_ACTOR = { kind: "system", id: "attribution" } as const;

/**
 * The idempotency key of each row, built from the `attributions` row's own id (the id of a record, random, read by the
 * services only) and never from an account id: the credited person's key says nothing about the new person, and the
 * two keys differ, so they cannot collide even if one account were ever both people. `idempotency_key` is a column no
 * client role reads.
 */
export const attributionEventKeys = (attributionId: string) => ({ signup: `attribution:${attributionId}:signup`, referral: `attribution:${attributionId}:referral` }) as const;

/**
 * The account events one `attributions` row stands for: the new person's, then the credited person's when there is
 * one. The same two public fields for both and nothing else; both at the row's own time.
 */
export function attributionEvents(row: Pick<Attribution, "id" | "userId" | "sourceKind" | "sourceRef" | "referrerUserId" | "createdAt">): WriteAccountEventInput[] {
  const keys = attributionEventKeys(row.id);
  const facts = { sourceKind: row.sourceKind, sourceRef: row.sourceRef };
  const signup: WriteAccountEventInput<"signup.attributed"> = { userId: row.userId, type: "signup.attributed", actor: ATTRIBUTION_ACTOR, payload: { ...facts }, occurredAt: row.createdAt, idempotencyKey: keys.signup };
  if (!row.referrerUserId) return [signup];
  const referral: WriteAccountEventInput<"referral.arrived"> = { userId: row.referrerUserId, type: "referral.arrived", actor: ATTRIBUTION_ACTOR, payload: { ...facts }, occurredAt: row.createdAt, idempotencyKey: keys.referral };
  return [signup, referral];
}

/** Why a row's events were skipped, as a code: the rule or the reason of the refusal, or `write_failed`. */
const skipReason = (err: unknown): string => (err instanceof AccountRuleError ? err.rule : err instanceof AccountEventParseError ? err.reason : "write_failed");

/**
 * Records what brought `userId`, when `via` is a reference that resolves and the account has none yet, with its account
 * events (see the file comment). Call it only after the save that created the person's profile. Never throws and
 * answers nothing.
 */
export async function recordSignupAttribution(deps: AttributionDeps, userId: string, via: unknown): Promise<void> {
  const ref = parseVia(via);
  if (!ref) return;
  try {
    await deps.db.transaction(async (tx) => {
      if (await repos.attributions.forUser(tx, userId)) return;
      const source = await repos.attributions.resolve(tx, ref);
      if (!source || source.referrerUserId === userId) return;
      // Null when the account already has a row (another save got there first, and wrote the events with it).
      const row = await repos.attributions.record(tx, userId, source);
      if (!row) return;
      try {
        // `writeAccountEvents` checks every row before the first insert (no payload may carry either person's account
        // id), and the savepoint takes back a first row whose second failed: both events, or neither.
        const events = attributionEvents(row);
        await tx.transaction((savepoint) => writeAccountEvents(savepoint, events));
      } catch (err) {
        // A code only: an error's own text can repeat a statement's parameters, the reference and both ids among them.
        deps.log.warn({ userId, reason: skipReason(err) }, "signup attribution recorded without its account events");
      }
    });
  } catch (err) {
    // Never the error's message: a failed query's text carries its parameters, the reference among them.
    deps.log.warn({ userId, error: err instanceof Error ? err.name : "unknown" }, "signup attribution was not recorded");
  }
}
