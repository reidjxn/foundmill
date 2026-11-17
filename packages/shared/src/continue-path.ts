/**
 * The paths a "continue on a computer" link may carry (WP-03 T3): a person on a small screen who meets a desktop-only
 * page asks for an email with a link to it, and opens it on a computer. Checked by the api before it asks and again by
 * the gateway before it builds `APP_URL + path`, so the email only ever links to Foundmill's own signed-in pages: a
 * project's pages, the studio, onboarding and the person's home. No query, no hash, no other host.
 */
export const CONTINUE_PATH_MAX = 200;

export const CONTINUE_PATH_RE = /^\/(b\/[0-9a-f-]{36}(\/[a-z0-9-]+){0,4}|new(\/[a-z0-9-]+){0,3}|onboarding|home)$/i;

export function isContinuePath(path: string): boolean {
  return typeof path === "string" && path.length <= CONTINUE_PATH_MAX && CONTINUE_PATH_RE.test(path);
}
