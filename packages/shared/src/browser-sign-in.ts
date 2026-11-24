/**
 * A saved sign-in to a website the team works in (the hosted browser) is deleted when the project has not used it for
 * `quietDays` (founder, Nov 22, 2026), after one note `warnDays` before, which the founder also gets by email (a
 * waiting decision). "Keep it" gives the sign-in another `quietDays` from the day of the answer.
 */
export const BROWSER_SIGN_IN = {
  quietDays: 30,
  warnDays: 7,
  keyPrefix: "browser_keep:",
  options: { keep: "browser_keep", letGo: "browser_let_go" },
} as const;

/** The site of a "keep this sign-in" note (its `decision.key`), or null for any other note. */
export function browserKeepSite(decision: unknown): string | null {
  const key = decision && typeof decision === "object" ? (decision as { key?: unknown }).key : null;
  if (typeof key !== "string" || !key.startsWith(BROWSER_SIGN_IN.keyPrefix)) return null;
  const site = key.slice(BROWSER_SIGN_IN.keyPrefix.length);
  return /^[a-z][a-z0-9_]{1,40}$/.test(site) ? site : null;
}

/** When a saved sign-in last used at `at` is deleted. */
export const browserSignInExpiry = (at: Date): Date => new Date(at.getTime() + BROWSER_SIGN_IN.quietDays * 86_400_000);

/**
 * A page the team met needs the founder (founder, Nov 24, 2026: "ok, user solves captchas, no auto-solving"): a bot
 * check, or a sign-in mid-task. The session waits; the founder solves it in the live view and answers the note, which
 * hands the page back to the team.
 */
export const BROWSER_CHECK_NOTE = {
  keyPrefix: "browser_check:",
  options: { done: "browser_check_done", stop: "browser_check_stop" },
} as const;

/** The site of a "the team needs you on this page" note (its `decision.key`), or null for any other note. */
export function browserCheckSite(decision: unknown): string | null {
  const key = decision && typeof decision === "object" ? (decision as { key?: unknown }).key : null;
  if (typeof key !== "string" || !key.startsWith(BROWSER_CHECK_NOTE.keyPrefix)) return null;
  const site = key.slice(BROWSER_CHECK_NOTE.keyPrefix.length);
  return /^[a-z][a-z0-9_]{1,40}$/.test(site) ? site : null;
}

export const browserCheckSubject = (siteName: string, need: "captcha" | "sign_in"): string => (need === "captcha" ? `${siteName} needs you to solve a check` : `${siteName} needs you to sign in`);
