/**
 * The second dev account (docs/DECISIONS.md "Development auth bypass"; the Playwright stack's example viewer): in
 * development and test only, `/auth/dev?as=<uuid>` signs the browser in as that auth user instead of
 * DEV_AUTH_USER_ID. The id rides in its own cookie beside the dev cookie (`DEV_AS_COOKIE`), and every bearer the web
 * sends becomes `dev:<uuid>`, which apps/api and apps/stream map to that user in development and test only (the plain
 * `dev` keeps meaning DEV_AUTH_USER_ID). Outside development and test nothing here does anything: the route answers
 * 404, the cookie is never read, and both services refuse a dev token anyway.
 *
 * The cookie is readable by the page's script on purpose (not httpOnly): the browser builds its own bearer from it,
 * as it sends the literal `dev` today. It is no secret: in these environments the bypass accepts any dev token.
 *
 * Imported by the browser and by the server: no server-only imports here.
 */
import { DEV_AS_COOKIE, DEV_BEARER_TOKEN } from "./constants";
import { isDevLike } from "@/lib/env";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The account id a dev-as value names (lowercase), or null for anything that is not a UUID. */
export function parseDevAsUserId(value: string | null | undefined): string | null {
  const v = typeof value === "string" ? value.trim() : "";
  return UUID_RE.test(v) ? v.toLowerCase() : null;
}

/** The bearer for the dev bypass: `dev` for DEV_AUTH_USER_ID, `dev:<uuid>` for another account. */
export function devBearerFor(asUserId: string | null | undefined): string {
  const id = parseDevAsUserId(asUserId);
  return id ? `${DEV_BEARER_TOKEN}:${id}` : DEV_BEARER_TOKEN;
}

/** The dev-as id in a `Cookie` header or `document.cookie` string, or null. */
export function readDevAsCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== DEV_AS_COOKIE) continue;
    let raw = part.slice(eq + 1).trim();
    try {
      raw = decodeURIComponent(raw);
    } catch {
      return null;
    }
    return parseDevAsUserId(raw);
  }
  return null;
}

/**
 * The dev bearer the browser sends when it has no session (lib/trpc.ts `resolveBearer`, lib/stream-client.ts): `dev`,
 * or `dev:<uuid>` after `/auth/dev?as=<uuid>`. Null outside development and test, where there is no dev bypass.
 */
export function devBearerToken(cookieString: string | null = typeof document === "undefined" ? null : document.cookie): string | null {
  if (!isDevLike()) return null;
  return devBearerFor(readDevAsCookie(cookieString));
}
