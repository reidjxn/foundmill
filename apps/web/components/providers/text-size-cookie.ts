/**
 * The signed-in person's text size (Settings › Preferences › Guidance, `account_preferences.text_size`), mirrored into
 * a cookie the way the date format is (lib/date-format.ts), so the root layout renders `<html data-text="comfortable">`
 * on the first byte: no flash from standard to comfortable after the account answers, and no hydration mismatch. The
 * account's row is the truth (`founder.preferences.guidance`); the cookie is a copy the browser writes whenever the
 * preference is read or changed (GuidanceHost), and app/layout.tsx reads it.
 *
 * The value names its owner ("comfortable.<user id>", "standard.dev" under the development sign-in), so a browser
 * shared by two accounts never shows one person's text size to the other: a cookie for someone else is ignored.
 * Shared by the server and the browser; no secrets, no "use client".
 */
import { COOKIE_MAX_AGE_SECONDS } from "@/lib/auth/constants";

export const TEXT_SIZE_COOKIE = "fm_text_size";

export type TextSizeChoice = "standard" | "comfortable";

const OWNER_RE = /^(?:dev|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const VALUE_RE = /^(standard|comfortable)\.(.+)$/;

export function encodeTextSizeCookie(size: TextSizeChoice, owner: string): string {
  return `${size}.${owner}`;
}

/** The choice a cookie holds for `owner`, or null when it is missing, malformed or someone else's. */
export function decodeTextSizeCookie(value: string | null | undefined, owner: string | null | undefined): TextSizeChoice | null {
  if (!value || !owner || !OWNER_RE.test(owner)) return null;
  const m = VALUE_RE.exec(value);
  if (!m || m[2]?.toLowerCase() !== owner.toLowerCase()) return null;
  return m[1] as TextSizeChoice;
}

/** The `document.cookie` assignment that stores `size` for `owner` for a year (browser only). */
export function textSizeCookieString(size: TextSizeChoice, owner: string, secure: boolean): string {
  return `${TEXT_SIZE_COOKIE}=${encodeTextSizeCookie(size, owner)}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax${secure ? "; secure" : ""}`;
}

/** The cookie's current value in this browser, or null. */
export function readTextSizeCookie(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === TEXT_SIZE_COOKIE) return rest.join("=");
  }
  return null;
}
