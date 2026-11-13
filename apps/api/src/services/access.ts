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
 *     people who were here before open sign-up (a founder profile), then anyone with a confirmed address until the UTC
 *     day's new admissions reach SIGNUP_DAILY_CEILING (default 200; counted with a query at sign-in, under an advisory
 *     lock, never a timer). Past it a person is refused with `on_waitlist`.
 *
 * `decideAdmission` is the decision, pure and tested for every mode; `admitOrWait` gathers its facts, applies it (an
 * admission recorded once) and throws the refusal. An address counts only once confirmed: Supabase's "Confirm email"
 * must stay on (docs/DEPLOY.md §4); an anonymous sign-in, or an account whose address nobody proved they read, is never
 * admitted by the list or the ceiling. The refusals are FORBIDDEN, with `appCode`:
 *   - `not_invited`, `details.reason` `not_listed` or `email_unconfirmed`: the web's invite-only page
 *     (components/shell/NotInvitedPage.tsx);
 *   - `on_waitlist`, `details.reason` `ceiling`: the web's "You're on the list" panel (components/shell/ApiErrorPage.tsx).
 * Nothing here stores a person who waits: the waitlist itself (joining it, the email when there is a place) is the
 * retention team's. apps/stream and apps/collab refuse the same accounts' sockets (`liveChannelAdmit`: the list, or an
 * admission row).
 */
import { AppError, allowlisted, ON_WAITLIST_CODE, ON_WAITLIST_WORDS, parseSignupAllowlist, signupMode, type SignupAllowlist, type SignupMode } from "@foundmill/shared";
import { repos, type Db } from "@foundmill/db";

// The list itself is @foundmill/shared's (allowlist.ts): apps/stream and apps/collab admit people by the same rules.
export { allowlisted, parseSignupAllowlist, type SignupAllowlist } from "@foundmill/shared";

export const NOT_INVITED_CODE = "not_invited";
export const NOT_INVITED_MESSAGE = "This address is not on the invite list yet. Ask the person who invited you to add it, or sign in with an address that is on it.";
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
  env: { SIGNUP_ALLOWLIST?: string; SIGNUP_OPEN?: string; SIGNUP_DAILY_CEILING?: number; DEV_AUTH_USER_ID?: string };
  db: Db;
  /** One answer per HTTP request and person, so a batch asks once (a fresh map per request; absent in tests). */
  admissionMemo?: Map<string, Promise<void>>;
}

export interface AdmissionUser {
  userId: string;
  email: string | null;
  emailConfirmed?: boolean;
}

/** The refusal for each answer that is not "admit". */
function refusalFor(decision: Exclude<AdmissionDecision, { outcome: "admit" }>): AppError {
  if (decision.outcome === "wait") return new AppError(ON_WAITLIST_CODE, ON_WAITLIST_MESSAGE, 403, { reason: decision.reason });
  return decision.reason === "email_unconfirmed" ? new AppError(NOT_INVITED_CODE, EMAIL_UNCONFIRMED_MESSAGE, 403, { reason: "email_unconfirmed" }) : new AppError(NOT_INVITED_CODE, NOT_INVITED_MESSAGE, 403, { reason: "not_listed" });
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
    throw refusalFor(d);
  }
  if (admittedRecently(user.userId)) return;

  const now = new Date();
  const decision = await ctx.db.transaction(async (tx) => {
    const admitted = await repos.admissions.has(tx, user.userId);
    let facts: AdmissionFacts = { ...base, admitted };
    if (mode === "open" && !admitted && facts.emailConfirmed) {
      facts.existingPerson = await repos.admissions.hasProfile(tx, user.userId);
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
  if (decision.outcome !== "admit") throw refusalFor(decision);
  rememberAdmitted(user.userId);
}

/**
 * Whether the account is admitted right now, without writing anything (the one-click answer from an email, which acts
 * for a person who is not the caller): unrestricted, the bypass, a listed and confirmed address, an admission, or, under
 * open sign-up, a person from before.
 */
export async function isAdmittedNow(ctx: Pick<AdmissionContext, "env" | "db">, user: AdmissionUser): Promise<boolean> {
  const mode = signupMode(ctx.env);
  if (mode === "unrestricted") return true;
  if (ctx.env.DEV_AUTH_USER_ID && user.userId.toLowerCase() === ctx.env.DEV_AUTH_USER_ID.toLowerCase()) return true;
  const list = listFor(ctx.env.SIGNUP_ALLOWLIST);
  if (list && allowlisted(list, user.email)) return user.emailConfirmed === true;
  if (await repos.admissions.has(ctx.db, user.userId)) return true;
  return mode === "open" && (await repos.admissions.hasProfile(ctx.db, user.userId));
}

/**
 * The signed-in check without admission, for the one procedure that is how a person gets in (`invitation.accept`): a
 * confirmed address is required (never an anonymous sign-in), and nothing else.
 */
export function assertConfirmedSignIn(user: AdmissionUser): void {
  if (user.emailConfirmed !== true) throw new AppError(NOT_INVITED_CODE, EMAIL_UNCONFIRMED_MESSAGE, 403, { reason: "email_unconfirmed" });
}
