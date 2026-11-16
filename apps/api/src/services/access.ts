/**
 * Who may use the app, and the one decision of whether a signed-in person is admitted now or waits (docs/DEPLOY.md
 * §4; THESIS_REVIEW package 2.2; founder 2026-11-12). Supabase lets anyone with an inbox create an account, and every
 * signed-in account can drive model calls on the platform key, so a deployment that is not open to the public decides
 * here, on every signed-in request (`protectedProcedure`, trpc.ts), before any work.
 *
 * The modes (`signupMode`, @foundmill/shared allowlist.ts), switched by configuration alone:
 *   - `unrestricted` (no SIGNUP_ALLOWLIST, SIGNUP_OPEN off): everyone who can sign in, as before (local stacks, tests);
 *   - `invite_only` (SIGNUP_ALLOWLIST set): the addresses it names (`founder@example.com`, `@example.com`), and the
 *     accounts a valid invitation admitted (`invitation.accept`, services/invitations.ts, records the admission).
 *     Everyone else is refused with `not_invited` (`details.reason: "not_listed"`), as before;
 *   - `open` (SIGNUP_OPEN on, default off): the listed addresses without counting, the accounts already admitted, the
 *     people who were here before open sign-up (a founder profile created before the cutover, `existingBefore`), then
 *     anyone with a confirmed address until the UTC day's new admissions (open sign-up's and invitations') reach
 *     SIGNUP_DAILY_CEILING (default 200; counted with a query at sign-in, under an advisory lock, never a timer). Past it
 *     a person is refused with `on_waitlist`.
 *
 * An invitation admits a new account (`admitThroughInvitation`, inside `invitation.accept`'s transaction) only when its
 * inviter was let in by the list, by open sign-up (or the waitlist while open sign-up is on) or as a person from before
 * (never by an invitation, nor by the waitlist under invite-only: an account an
 * invitation let in cannot let others in), and at most `INVITATION_ADMISSIONS_PER_INVITER_PER_DAY` a UTC day per
 * inviter, counted under the same advisory lock. Under open sign-up an invitation's admission counts toward the day's
 * ceiling, and only an inviter the list or the time before let in may go past it, within
 * `INVITATION_ADMISSIONS_PAST_CEILING_PER_DAY` for everyone together; an inviter open sign-up let in waits at the
 * ceiling like any sign-up. An accepter who is already in needs none of that: the invitation then only adds the
 * membership.
 *
 * `decideAdmission` is the decision, pure and tested for every mode; `admitOrWait` gathers its facts, applies it (an
 * admission recorded once) and throws the refusal. An address counts only once confirmed: Supabase's "Confirm email"
 * must stay on (docs/DEPLOY.md §4); an anonymous sign-in, or an account whose address nobody proved they read, is never
 * admitted by the list or the ceiling. The refusals are FORBIDDEN, with `appCode`:
 *   - `not_invited`, `details.reason` `not_listed` or `email_unconfirmed`: the web's invite-only page
 *     (components/shell/NotInvitedPage.tsx);
 *   - `on_waitlist`, `details.reason` `ceiling`: the web's "You're on the list" panel (components/shell/ApiErrorPage.tsx).
 *   `not_listed` and `ceiling` also carry `details.waitlistEmails` (WAITLIST_EMAILS on and platform mail live): only
 *   then does the web's saved line promise the email.
 * Nothing here stores a person who waits: joining the waitlist is `waitlist.join` (routers/idea-box.ts), and letting
 * people in from it and the email when their place opens are the orchestrator's `waitlist-admissions` sweep (WP-03 T2),
 * which records each admission as `waitlist`, so step 3 lets them in on their next request. apps/stream and apps/collab refuse the same accounts' sockets (`liveChannelAdmit`: the list, or an
 * admission row).
 */
import { APP_NAME } from "@foundmill/config";
import { AppError, allowlisted, ON_WAITLIST_CODE, ON_WAITLIST_WORDS, parseSignupAllowlist, signupMode, type SignupAllowlist, type SignupMode, waitlistEmails } from "@foundmill/shared";
import { repos, type Db, type Executor } from "@foundmill/db";

// The list itself is @foundmill/shared's (allowlist.ts): apps/stream and apps/collab admit people by the same rules.
export { allowlisted, parseSignupAllowlist, type SignupAllowlist } from "@foundmill/shared";

export const NOT_INVITED_CODE = "not_invited";
export const NOT_INVITED_MESSAGE = `${APP_NAME} is letting new people in a few at a time so every project gets real agent work. Your place is not open yet.`;
export const EMAIL_UNCONFIRMED_MESSAGE = "This address is not confirmed yet. Open the link we sent to it, then sign in again.";
/** The refusal of a signed-in person open sign-up did not admit today (`appCode`), and what it says. */
export { ON_WAITLIST_CODE };
export const ON_WAITLIST_MESSAGE = `${ON_WAITLIST_WORDS.title} ${ON_WAITLIST_WORDS.body}`;

let memo: { raw: string | undefined; list: SignupAllowlist | null } | null = null;

/** The parsed list for an env value (parsed once per distinct value). */
function listFor(raw: string | undefined): SignupAllowlist | null {
  if (!memo || memo.raw !== raw) memo = { raw, list: parseSignupAllowlist(raw) };
  return memo.list;
}

/* ---- The decision ---- */

/** What the decision needs to know about one signed-in person. */
export interface AdmissionFacts {
  mode: SignupMode;
  /** The development bypass user (`DEV_AUTH_USER_ID`, development and test only): always admitted. */
  devUser: boolean;
  /** SIGNUP_ALLOWLIST names the address. */
  listed: boolean;
  /** The token shows its holder controls the address (auth.ts `emailConfirmedFromPayload`). */
  emailConfirmed: boolean;
  /** The api already admitted the account (`account_admissions`: an invitation, the ceiling, a person from before). */
  admitted: boolean;
  /** Open sign-up only: the account was a person here before (a founder profile). */
  existingPerson: boolean;
  /** Open sign-up only: accounts admitted under the ceiling since the start of the UTC day. */
  admittedToday: number;
  /** Open sign-up only: SIGNUP_DAILY_CEILING. */
  ceiling: number;
}

export type AdmissionDecision =
  /** In. `record`: the admission to write (null when the list, the bypass or an earlier admission already answers). */
  | { outcome: "admit"; record: null | "open" | "existing" }
  /** Open sign-up's ceiling for today is reached: refused with `on_waitlist`. */
  | { outcome: "wait"; reason: "ceiling" }
  /** Not in: an address not proved, or (invite-only) not listed and never admitted. */
  | { outcome: "refuse"; reason: "email_unconfirmed" | "not_listed" };

/**
 * Admit now or wait: the one decision, in this order.
 *   1. unrestricted: admit. The development bypass user: admit.
 *   2. a listed address: admit once it is confirmed, else refuse (`email_unconfirmed`), as before.
 *   3. an account the api already admitted (through an invitation, under the ceiling, a person from before): admit.
 *   4. invite-only: refuse (`not_listed`), as before. A valid invitation is how such a person gets in (step 3, after
 *      `invitation.accept`, which needs only a confirmed sign-in).
 *   5. open sign-up, an address not proved: refuse (`email_unconfirmed`).
 *   6. open sign-up: a person from before admits without counting (`existing`); otherwise admit while the day's count
 *      is under the ceiling (`open`), else wait (`ceiling`).
 */
export function decideAdmission(f: AdmissionFacts): AdmissionDecision {
  if (f.mode === "unrestricted" || f.devUser) return { outcome: "admit", record: null };
  if (f.listed) return f.emailConfirmed ? { outcome: "admit", record: null } : { outcome: "refuse", reason: "email_unconfirmed" };
  if (f.admitted) return { outcome: "admit", record: null };
  if (f.mode === "invite_only") return { outcome: "refuse", reason: "not_listed" };
  if (!f.emailConfirmed) return { outcome: "refuse", reason: "email_unconfirmed" };
  if (f.existingPerson) return { outcome: "admit", record: "existing" };
  if (f.admittedToday < f.ceiling) return { outcome: "admit", record: "open" };
  return { outcome: "wait", reason: "ceiling" };
}

/* ---- Applying it ---- */

/** The start of the UTC day `at` falls in: the window SIGNUP_DAILY_CEILING counts. */
export const utcDayStart = (at: Date): Date => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

/**
 * Accounts this process saw admitted through an admission row, so a person who is in costs no query on their next
 * request. Positive answers only, for a few minutes (an admission is never taken back by the product; an operator who
 * deletes one is honored within `ADMITTED_MEMO_MS`), and bounded. A person who is refused is asked again every request.
 */
const ADMITTED_MEMO_MS = 5 * 60_000;
const ADMITTED_MEMO_MAX = 50_000;
const admittedMemo = new Map<string, number>();
export function rememberAdmitted(userId: string, now = Date.now()): void {
  if (admittedMemo.size >= ADMITTED_MEMO_MAX) admittedMemo.clear();
  admittedMemo.set(userId.toLowerCase(), now + ADMITTED_MEMO_MS);
}
function admittedRecently(userId: string, now = Date.now()): boolean {
  const until = admittedMemo.get(userId.toLowerCase());
  if (until === undefined) return false;
  if (until < now) {
    admittedMemo.delete(userId.toLowerCase());
    return false;
  }
  return true;
}
/** Tests only: forget what this process remembered. */
export function forgetAdmittedMemo(): void {
  admittedMemo.clear();
}

export interface AdmissionContext {
  env: { SIGNUP_ALLOWLIST?: string; SIGNUP_OPEN?: string; SIGNUP_DAILY_CEILING?: number; SIGNUP_EXISTING_BEFORE?: string; DEV_AUTH_USER_ID?: string } & Parameters<typeof waitlistEmails>[0];
  db: Db;
  /** One answer per HTTP request and person, so a batch asks once (a fresh map per request; absent in tests). */
  admissionMemo?: Map<string, Promise<void>>;
}

export interface AdmissionUser {
  userId: string;
  email: string | null;
  emailConfirmed?: boolean;
}

/**
 * The cutover for "a person from before open sign-up": SIGNUP_EXISTING_BEFORE when set, else the moment migration 0093
 * ran (`admission_existing_before()`, read once per database and kept: it never changes).
 */
const storedCutover = new WeakMap<object, Promise<Date>>();
export async function existingBefore(ctx: Pick<AdmissionContext, "env" | "db">, exec: Executor = ctx.db): Promise<Date> {
  const raw = ctx.env.SIGNUP_EXISTING_BEFORE?.trim();
  if (raw) {
    const at = new Date(raw);
    if (!Number.isNaN(at.getTime())) return at;
  }
  // Kept per database (`ctx.db`); read on the caller's own connection (`exec`, a transaction when there is one).
  const key = ctx.db as object;
  let known = storedCutover.get(key);
  if (!known) {
    known = repos.admissions.existingBefore(exec);
    storedCutover.set(key, known);
    known.catch(() => storedCutover.delete(key));
  }
  return known;
}

/**
 * The refusal for each answer that is not "admit". The two that save the person's place carry `waitlistEmails`
 * (@foundmill/shared `waitlistEmails`): whether the web's saved line may promise the email the waitlist sends.
 */
function refusalFor(decision: Exclude<AdmissionDecision, { outcome: "admit" }>, env: AdmissionContext["env"]): AppError {
  if (decision.outcome === "wait") return new AppError(ON_WAITLIST_CODE, ON_WAITLIST_MESSAGE, 403, { reason: decision.reason, waitlistEmails: waitlistEmails(env) });
  return decision.reason === "email_unconfirmed" ? new AppError(NOT_INVITED_CODE, EMAIL_UNCONFIRMED_MESSAGE, 403, { reason: "email_unconfirmed" }) : new AppError(NOT_INVITED_CODE, NOT_INVITED_MESSAGE, 403, { reason: "not_listed", waitlistEmails: waitlistEmails(env) });
}

/**
 * Admits the signed-in person or throws the refusal (see the file comment). The cheap answers come first and touch no
 * database (the mode, the bypass, the list, this process's memory); then one transaction reads what is left and, under
 * open sign-up, writes the admission the decision makes, once. Nothing here runs on a timer.
 */
export function admitOrWait(ctx: AdmissionContext, user: AdmissionUser): Promise<void> {
  const memo = ctx.admissionMemo;
  const key = user.userId.toLowerCase();
  const cached = memo?.get(key);
  if (cached) return cached;
  const run = decideAndApply(ctx, user);
  if (memo) {
    memo.set(key, run);
    run.catch(() => undefined);
  }
  return run;
}

async function decideAndApply(ctx: AdmissionContext, user: AdmissionUser): Promise<void> {
  const mode = signupMode(ctx.env);
  const devUser = !!ctx.env.DEV_AUTH_USER_ID && user.userId.toLowerCase() === ctx.env.DEV_AUTH_USER_ID.toLowerCase();
  const list = listFor(ctx.env.SIGNUP_ALLOWLIST);
  const listed = !!list && allowlisted(list, user.email);
  const base: AdmissionFacts = { mode, devUser, listed, emailConfirmed: user.emailConfirmed === true, admitted: false, existingPerson: false, admittedToday: 0, ceiling: ctx.env.SIGNUP_DAILY_CEILING ?? 200 };
  // Answered without the database: unrestricted, the bypass, or the list (either way).
  if (mode === "unrestricted" || devUser || listed) {
    const d = decideAdmission(base);
    if (d.outcome === "admit") return;
    throw refusalFor(d, ctx.env);
  }
  if (admittedRecently(user.userId)) return;

  const now = new Date();
  const decision = await ctx.db.transaction(async (tx) => {
    const admitted = await repos.admissions.has(tx, user.userId);
    let facts: AdmissionFacts = { ...base, admitted };
    if (mode === "open" && !admitted && facts.emailConfirmed) {
      facts.existingPerson = await repos.admissions.hasProfile(tx, user.userId, await existingBefore(ctx, tx));
      if (!facts.existingPerson) {
        // The count and the admission it allows are one decision: two sign-ins at the last place cannot both take it.
        await repos.admissions.lockOpenCount(tx);
        facts = { ...facts, admittedToday: await repos.admissions.openSince(tx, utcDayStart(now)) };
      }
    }
    const d = decideAdmission(facts);
    if (d.outcome === "admit" && d.record) await repos.admissions.record(tx, { userId: user.userId, how: d.record });
    return d;
  });
  if (decision.outcome !== "admit") throw refusalFor(decision, ctx.env);
  rememberAdmitted(user.userId);
}

/**
 * Whether the account is admitted right now, without writing anything (the one-click answer from an email, which acts
 * for a person who is not the caller; an invitation's accept): unrestricted, the bypass, a listed and confirmed address,
 * an admission, or, under open sign-up, a person from before. `db` reads instead of `ctx.db` (a transaction).
 */
export async function isAdmittedNow(ctx: Pick<AdmissionContext, "env" | "db">, user: AdmissionUser, db: Executor = ctx.db): Promise<boolean> {
  const mode = signupMode(ctx.env);
  if (mode === "unrestricted") return true;
  if (ctx.env.DEV_AUTH_USER_ID && user.userId.toLowerCase() === ctx.env.DEV_AUTH_USER_ID.toLowerCase()) return true;
  const list = listFor(ctx.env.SIGNUP_ALLOWLIST);
  if (list && allowlisted(list, user.email)) return user.emailConfirmed === true;
  if (await repos.admissions.has(db, user.userId)) return true;
  return mode === "open" && user.emailConfirmed === true && (await repos.admissions.hasProfile(db, user.userId, await existingBefore(ctx, db)));
}

/* ---- An invitation as an admission ---- */

/** How many new accounts one inviter's invitations may let in per UTC day (an accepter who is already in never counts). */
export const INVITATION_ADMISSIONS_PER_INVITER_PER_DAY = 3;
/**
 * Open sign-up only: how many new accounts invitations may let in past the day's SIGNUP_DAILY_CEILING, across every
 * inviter, per UTC day. Only an inviter the list or the time before let in may use them (`inviterStanding` "trusted").
 */
export const INVITATION_ADMISSIONS_PAST_CEILING_PER_DAY = 50;

export const INVITATION_CANNOT_ADMIT_CODE = "invitation_cannot_admit";
export const INVITATION_CANNOT_ADMIT_MESSAGE = `This invitation can't let a new account into ${APP_NAME} by itself. Once your account is in, the same link works.`;
export const INVITATION_ADMISSIONS_LIMIT_CODE = "invitation_admissions_limit";
export const INVITATION_ADMISSIONS_LIMIT_MESSAGE = "The person who invited you has let in as many new people as one day allows. Try the same link again tomorrow.";

/**
 * On what standing `inviterUserId` lets a new account in through an invitation:
 *   - `trusted`: an account the list names (its address in `auth.users`), the development bypass user, or one admitted
 *     as a person from before (`existing`). Under open sign-up its invitations may go past the day's ceiling, within
 *     `INVITATION_ADMISSIONS_PAST_CEILING_PER_DAY` for everyone together;
 *   - `open`: admitted by open sign-up, or by the waitlist (`waitlist`) while open sign-up is on. It lets people in, but
 *     under open sign-up only while the day's ceiling has room, like any sign-up (every such account is an inviter, so
 *     past the ceiling it would grow the day's cap without end);
 *   - `none`: let in by an invitation, by the waitlist under invite-only (else each day's number would let in three
 *     times as many again by invitation, outside WAITLIST_ADMIT_PER_DAY), or never admitted. It adds people to its
 *     projects only when they are already in.
 */
export type InviterStanding = "trusted" | "open" | "none";
export async function inviterStanding(ctx: Pick<AdmissionContext, "env">, db: Executor, inviterUserId: string): Promise<InviterStanding> {
  if (ctx.env.DEV_AUTH_USER_ID && inviterUserId.toLowerCase() === ctx.env.DEV_AUTH_USER_ID.toLowerCase()) return "trusted";
  const list = listFor(ctx.env.SIGNUP_ALLOWLIST);
  if (list && allowlisted(list, await repos.founders.emailOf(db, inviterUserId))) return "trusted";
  const admission = await repos.admissions.forUser(db, inviterUserId);
  if (admission?.how === "existing") return "trusted";
  if (admission?.how === "open") return "open";
  // The waitlist's daily number is not open sign-up: it lets others in only while open sign-up is on (its ceiling then
  // bounds them), never under invite-only, where the list and its inviters are the only way in.
  if (admission?.how === "waitlist") return signupMode(ctx.env) === "open" ? "open" : "none";
  return "none";
}

/** Whether `inviterUserId` may let a new account in through an invitation at all (`inviterStanding` is not `none`). */
export async function inviterMayAdmit(ctx: Pick<AdmissionContext, "env">, db: Executor, inviterUserId: string): Promise<boolean> {
  return (await inviterStanding(ctx, db, inviterUserId)) !== "none";
}

export type InvitationAdmission = "already_in" | "admitted";

/**
 * The admission half of `invitation.accept`, inside its transaction (`tx`), so a refused or failed accept admits
 * nobody (see the file comment). An accepter who is already in: nothing to write (`already_in`). Otherwise, under the
 * advisory lock open sign-up's count is taken under, taken before any count, so two accepts at an inviter's last place
 * (or the day's last place) cannot both take it:
 *   - open sign-up, the day's ceiling not reached: the invitation's admission (`how = 'invitation'`) when the inviter may
 *     let people in and is under their daily number, else open sign-up's own (`how = 'open'`), as at sign-in;
 *   - open sign-up, the ceiling reached: only a `trusted` inviter under their daily number goes past it, while the day's
 *     admissions past the ceiling are under `INVITATION_ADMISSIONS_PAST_CEILING_PER_DAY`; anyone else waits
 *     (`on_waitlist`, the same words as at sign-in) and the invitation stays pending;
 *   - invite-only: the invitation's admission when the inviter may let people in and is under their daily number, else a
 *     refusal (`invitation_cannot_admit`, or `invitation_admissions_limit` for an inviter past their number).
 * Past the ceiling only invitations admit, so the day's admissions past it are the day's count less the ceiling: no
 * column or second count is needed.
 */
export async function admitThroughInvitation(
  ctx: Pick<AdmissionContext, "env" | "db">,
  tx: Executor,
  accepter: AdmissionUser,
  invitation: { id: string; invitedByUserId: string },
  now: Date = new Date(),
): Promise<InvitationAdmission> {
  if (await isAdmittedNow(ctx, accepter, tx)) return "already_in";
  const mode = signupMode(ctx.env);
  const standing = await inviterStanding(ctx, tx, invitation.invitedByUserId);
  const since = utcDayStart(now);
  await repos.admissions.lockOpenCount(tx);
  const underInviterNumber = standing !== "none" && (await repos.admissions.admittedByInviterSince(tx, invitation.invitedByUserId, since)) < INVITATION_ADMISSIONS_PER_INVITER_PER_DAY;
  const byInvitation = async (): Promise<InvitationAdmission> => {
    await repos.admissions.record(tx, { userId: accepter.userId, how: "invitation", invitationId: invitation.id });
    return "admitted";
  };
  if (mode === "open" && accepter.emailConfirmed === true) {
    const ceiling = ctx.env.SIGNUP_DAILY_CEILING ?? 200;
    const admittedToday = await repos.admissions.openSince(tx, since);
    const decision = decideAdmission({ mode, devUser: false, listed: false, emailConfirmed: true, admitted: false, existingPerson: false, admittedToday, ceiling });
    if (decision.outcome === "admit") {
      if (underInviterNumber) return byInvitation();
      await repos.admissions.record(tx, { userId: accepter.userId, how: "open" });
      return "admitted";
    }
    if (standing === "trusted" && underInviterNumber && admittedToday - ceiling < INVITATION_ADMISSIONS_PAST_CEILING_PER_DAY) return byInvitation();
    throw refusalFor(decision, ctx.env);
  }
  if (underInviterNumber) return byInvitation();
  throw standing !== "none" ? new AppError(INVITATION_ADMISSIONS_LIMIT_CODE, INVITATION_ADMISSIONS_LIMIT_MESSAGE, 429) : new AppError(INVITATION_CANNOT_ADMIT_CODE, INVITATION_CANNOT_ADMIT_MESSAGE, 403);
}

/**
 * The signed-in check without admission, for the one procedure that is how a person gets in (`invitation.accept`): a
 * confirmed address is required (never an anonymous sign-in), and nothing else.
 */
export function assertConfirmedSignIn(user: AdmissionUser): void {
  if (user.emailConfirmed !== true) throw new AppError(NOT_INVITED_CODE, EMAIL_UNCONFIRMED_MESSAGE, 403, { reason: "email_unconfirmed" });
}
