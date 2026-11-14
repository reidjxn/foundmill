/**
 * "I am 18 or older", for the whole product, confirmed once at sign-up (CLAUDE.md, founder 2026-11-11;
 * docs/THESIS_REVIEW.md package 2.2). The record is the account's (`adult_confirmations`, 0100): the person's own
 * statement with the database's time, the source of truth for every check that asks, the network's and going LIVE's
 * included (`network_attestations` is kept in step with it). Nobody who confirmed once is asked again.
 *
 * Where it is asked:
 *   - a new account, on the save that creates its profile (`founder.profile.update` with `confirmAdult: true`; the
 *     `adult_confirmation` step of ./person-created records it). Without it, or an earlier confirmation, the profile is
 *     not created;
 *   - an invitee, on `invitation.accept` (`confirmAdult: true`), before the membership is added;
 *   - a person who was here before this record existed, once, the next time they arrive (`founder.adult.confirm`);
 *   - starting a project (`idea.commit`): an account that has not confirmed cannot start one.
 * The refusal is FORBIDDEN with `appCode` `adult_unconfirmed` (`ADULT_UNCONFIRMED_CODE`), the one code the web and the
 * phone app recognize to show the confirmation.
 *
 * Every write runs as the person under RLS (`withRls`): they insert only their own row, and the time is the database's.
 */
import { APP_NAME } from "@foundmill/config";
import { repos, withRls, type Db, type Executor } from "@foundmill/db";
import { AppError } from "@foundmill/shared";

export const ADULT_UNCONFIRMED_CODE = "adult_unconfirmed";
export const ADULT_UNCONFIRMED_MESSAGE = `${APP_NAME} is for people 18 or older. Confirm that you are 18 or older to continue.`;

/** The refusal of a step that needs the confirmation when the person has not given it. */
export const adultUnconfirmed = (): AppError => new AppError(ADULT_UNCONFIRMED_CODE, ADULT_UNCONFIRMED_MESSAGE, 403);

/** When the person confirmed that they are 18 or older, or null. */
export function adultConfirmedAt(db: Executor, userId: string): Promise<Date | null> {
  return repos.adults.confirmedAt(db, userId);
}

/**
 * Records the person's confirmation, as them under RLS (their own row; the database sets the time). The first one
 * stands: a second call writes nothing and answers the first time.
 */
export async function recordAdultConfirmation(db: Db, userId: string): Promise<{ confirmedAt: Date; created: boolean }> {
  return withRls(db, { userId }, (tx) => repos.adults.confirm(tx, userId));
}

/**
 * The step needs the confirmation: `confirm` (the person ticked "I am 18 or older" on the screen that asked) records
 * it, an earlier one answers, and otherwise the step is refused with `adult_unconfirmed`.
 */
export async function requireAdult(db: Db, userId: string, confirm: boolean | undefined): Promise<void> {
  if (confirm === true) {
    await recordAdultConfirmation(db, userId);
    return;
  }
  if (!(await adultConfirmedAt(db, userId))) throw adultUnconfirmed();
}
