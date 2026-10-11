/**
 * The signed-in person's date and time format (Settings › Preferences), mirrored into a cookie so the server renders
 * every signed-in page in that format on the first byte (no flash, no hydration mismatch). The account's row in
 * `account_preferences` is the truth (`founder.preferences.get`); the cookie is a copy the browser writes whenever the
 * preference is read or changed (components/providers/DateFormatHost.tsx), and the server reads it in the signed-in
 * layouts (lib/date-format.server.ts).
 *
 * The value names its owner ("day_first.24h.<user id>", "iso.12h.dev" under the development sign-in), so a browser
 * shared by two accounts never shows one person's format to the other: a cookie for someone else is ignored.
 * Shared by the server and the browser; no secrets.
 */
import { normalizeDateFormatPrefs, type DateFormatPrefs } from "@foundmill/dugout/lib/date-preferences";
import { COOKIE_MAX_AGE_SECONDS } from "./auth/constants";

export const DATE_FORMAT_COOKIE = "fm_date_format";

const OWNER_RE = /^(?:dev|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const VALUE_RE = /^(us|day_first|iso)\.(12h|24h)\.(.+)$/;

/** Who a cookie belongs to: the signed-in user id, or "dev" under the development sign-in (one fixed account). */
export function dateFormatOwner(auth: { userId: string | null; via: "supabase" | "dev" } | null | undefined): string | null {
  if (!auth) return null;
  if (auth.userId) return auth.userId;
  return auth.via === "dev" ? "dev" : null;
}

export function encodeDateFormatCookie(prefs: DateFormatPrefs, owner: string): string {
  const p = normalizeDateFormatPrefs(prefs);
  return `${p.date}.${p.time}.${owner}`;
}

/** The choice a cookie holds for `owner`, or null when it is missing, malformed or someone else's. */
export function decodeDateFormatCookie(value: string | null | undefined, owner: string | null): DateFormatPrefs | null {
  if (!value || !owner || !OWNER_RE.test(owner)) return null;
  const m = VALUE_RE.exec(value);
  if (!m || m[3]?.toLowerCase() !== owner.toLowerCase()) return null;
  return normalizeDateFormatPrefs({ date: m[1], time: m[2] });
}

/** The `document.cookie` assignment that stores `prefs` for `owner` for a year (browser only). */
export function dateFormatCookieString(prefs: DateFormatPrefs, owner: string, secure: boolean): string {
  return `${DATE_FORMAT_COOKIE}=${encodeDateFormatCookie(prefs, owner)}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax${secure ? "; secure" : ""}`;
}

/** The cookie's current value in this browser, or null. */
export function readDateFormatCookie(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === DATE_FORMAT_COOKIE) return rest.join("=");
  }
  return null;
}
