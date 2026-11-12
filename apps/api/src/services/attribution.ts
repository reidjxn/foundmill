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
 * NO EVENT ROW IS WRITTEN YET. `signup.attributed` is declared in packages/events with this row's whole content as its
 * payload, but `events` and `outbox` are business-scoped (`business_id` NOT NULL, relayed on `ev:{businessId}`, readable
 * by every member of that business), and a person creating their profile has no business. Writing it into the source
 * project's events would put a new person's account id in front of that project's members, and a person's profile has
 * no project at all. Until an account-level transport is decided, the row is the record: it holds everything the event
 * carries, and each row written is checked against the event's schema, so the events can be written from the rows later.
 */
import { repos, type Attribution, type Db } from "@foundmill/db";
import { parsePayload, type EventPayload } from "@foundmill/events";
import { parseVia } from "@foundmill/shared/via";
import type { ApiLogger } from "./log";

export interface AttributionDeps {
  /** The service connection. */
  db: Db;
  log: ApiLogger;
}

/** The `signup.attributed` payload a row stands for (the event is declared, not written yet: see the file comment). */
export function signupAttributedPayload(row: Pick<Attribution, "userId" | "sourceKind" | "sourceRef" | "sourceBusinessId" | "referrerUserId">): EventPayload<"signup.attributed"> {
  return parsePayload("signup.attributed", { userId: row.userId, sourceKind: row.sourceKind, sourceRef: row.sourceRef, sourceBusinessId: row.sourceBusinessId, referrerUserId: row.referrerUserId });
}

/**
 * Records what brought `userId`, when `via` is a reference that resolves and the account has none yet. Call it only
 * after the save that created the person's profile. Never throws and answers nothing.
 */
export async function recordSignupAttribution(deps: AttributionDeps, userId: string, via: unknown): Promise<void> {
  const ref = parseVia(via);
  if (!ref) return;
  try {
    await deps.db.transaction(async (tx) => {
      if (await repos.attributions.forUser(tx, userId)) return;
      const source = await repos.attributions.resolve(tx, ref);
      if (!source || source.referrerUserId === userId) return;
      // The row must be one the declared event can carry, before anything is written.
      signupAttributedPayload({ userId, sourceKind: source.kind, sourceRef: source.ref, sourceBusinessId: source.businessId, referrerUserId: source.referrerUserId });
      await repos.attributions.record(tx, userId, source);
      // When account-level events have a transport, `signup.attributed` is written here, in this transaction.
    });
  } catch (err) {
    // Never the error's message: a failed query's text carries its parameters, the reference among them.
    deps.log.warn({ userId, error: err instanceof Error ? err.name : "unknown" }, "signup attribution was not recorded");
  }
}
