/**
 * Records the business the founder opens: the `/` index and the LIVE pages open it next time
 * (lib/auth/current-business.ts). Written by the business shell on mount and at once by Switch business, the palette's
 * "Switch to" and Your businesses' Open, so the choice holds even if the founder leaves before the new business loads.
 * Client only.
 */
import { COOKIE_MAX_AGE_SECONDS, LAST_BUSINESS_COOKIE } from "./constants";

const BUSINESS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function rememberLastBusiness(businessId: string): void {
  if (!BUSINESS_ID.test(businessId) || typeof document === "undefined") return;
  document.cookie = `${LAST_BUSINESS_COOKIE}=${businessId}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}
