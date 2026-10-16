/**
 * The last-business cookie (LAST_BUSINESS_COOKIE): `/`, the login bounce and the sign-in callback send a signed-in
 * founder straight to that business's Home without asking the API (lib/auth/redirects.ts). The business layout still
 * checks the profile and the membership; when the business is gone it sends the founder to `staleBusinessPath`, where
 * the proxy clears the cookie and `/` picks again. The business shell writes it on mount, and Switch business, the
 * palette's "Switch to" and Your businesses' Open write it at once (`rememberLastBusiness`), so the choice holds even if
 * the founder leaves before the new business loads. Pure apart from `rememberLastBusiness` (browser only), so the proxy,
 * route handlers and tests share it.
 */
import { routes } from "@foundmill/widgets/shared/routes";
import { COOKIE_MAX_AGE_SECONDS, LAST_BUSINESS_COOKIE } from "./constants";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `/?stale=<id>`: the business layout's report that the cookie's business no longer opens. */
export const STALE_BUSINESS_PARAM = "stale";

/** The cookie's value when it is a business id, else null. */
export function parseLastBusinessId(value: string | null | undefined): string | null {
  return value && UUID_RE.test(value) ? value : null;
}

/** The Home of the business the cookie names, or null without a usable cookie. */
export function lastBusinessHome(value: string | null | undefined): string | null {
  const id = parseLastBusinessId(value);
  return id ? routes.home(id) : null;
}

/** Where the business layout sends a founder whose last-business cookie names `businessId`, a business they cannot open. */
export function staleBusinessPath(businessId: string): string {
  return `/?${STALE_BUSINESS_PARAM}=${encodeURIComponent(businessId)}`;
}

/** Records `businessId` as the business to open next time (browser only; anything but a business id is ignored). */
export function rememberLastBusiness(businessId: string): void {
  if (!parseLastBusinessId(businessId) || typeof document === "undefined") return;
  document.cookie = `${LAST_BUSINESS_COOKIE}=${businessId}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}
