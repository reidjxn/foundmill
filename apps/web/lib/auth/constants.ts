/** Cookie and token names shared by the proxy, the server helpers and the browser (no secrets here). */

/** Set by /auth/dev in development/test: the API and stream honour DEV_AUTH_USER_ID instead of a JWT. */
export const DEV_AUTH_COOKIE = "fm_dev_auth";
/** The literal bearer apps/api and apps/stream accept under DEV_AUTH_USER_ID (docs/DECISIONS.md). */
export const DEV_BEARER_TOKEN = "dev";
/**
 * Set by /auth/dev?as=<uuid> in development/test beside DEV_AUTH_COOKIE: the account the dev bypass signs in as instead
 * of DEV_AUTH_USER_ID (the bearer becomes `dev:<uuid>`; lib/auth/dev-as.ts). Readable by the page's script.
 */
export const DEV_AS_COOKIE = "fm_dev_as";
/** The /auth/dev parameter naming that account. */
export const DEV_AS_PARAM = "as";
/** Last business the founder opened; `/` redirects there (BUILD §6.2). */
export const LAST_BUSINESS_COOKIE = "fm_last_business";
/** Sidebar collapsed state, per business (prefix + business id). */
export const SIDEBAR_COLLAPSED_PREFIX = "fm_sidebar_collapsed:";
/** Where the login page sends the founder back after a magic link. */
export const NEXT_PARAM = "next";
/**
 * Where the landing page's idea card goes once it is kept (the idea box's "Shape it in the Ideation Studio"):
 * `?then=studio` rides the thread sign-in → /start → /new/card/keep, and keeping the card opens the Studio. Absent, the
 * card's own page and then Commit, as before.
 */
export const KEEP_THEN_PARAM = "then";
export const KEEP_THEN_STUDIO = "studio";
/**
 * On /auth/callback: how the sign-in started (`google` for Continue with Google; absent for the email link), so a
 * failure is explained in the words of the method the founder used.
 */
export const SIGN_IN_VIA_PARAM = "via";

const ONE_YEAR = 60 * 60 * 24 * 365;

export const COOKIE_MAX_AGE_SECONDS = ONE_YEAR;
