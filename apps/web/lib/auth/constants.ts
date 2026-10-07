/** Cookie and token names shared by the proxy, the server helpers and the browser (no secrets here). */

/** Set by /auth/dev in development/test: the API and stream honour DEV_AUTH_USER_ID instead of a JWT. */
export const DEV_AUTH_COOKIE = "fm_dev_auth";
/** The literal bearer apps/api and apps/stream accept under DEV_AUTH_USER_ID (docs/DECISIONS.md). */
export const DEV_BEARER_TOKEN = "dev";
/** Last business the founder opened; `/` redirects there (BUILD §6.2). */
export const LAST_BUSINESS_COOKIE = "fm_last_business";
/** Sidebar collapsed state, per business (prefix + business id). */
export const SIDEBAR_COLLAPSED_PREFIX = "fm_sidebar_collapsed:";
/** Where the login page sends the founder back after a magic link. */
export const NEXT_PARAM = "next";

const ONE_YEAR = 60 * 60 * 24 * 365;

export const COOKIE_MAX_AGE_SECONDS = ONE_YEAR;
