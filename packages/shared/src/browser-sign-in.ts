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
