/**
 * IndexNow for a project's Foundmill-hosted public page (founder, 2026-11-12).
 *
 * IndexNow proves a site's owner by a text file on the site that holds the key. A project page lives at
 * `<APP_URL>/p/<slug>`, so its key file is served at `<APP_URL>/p/<slug>/<key>.txt` and named as the submission's
 * `keyLocation`: the protocol then lets the key speak only for addresses under `/p/<slug>/` and the page itself, never
 * for another project on the same host. The key is the founder's own (entered in Settings › Integrations) and is
 * public by design; nothing here is a platform key. Plain data and pure functions, no Zod, so the web imports it.
 */
import { pageUrl } from "./project-page";

/** The protocol's key rule: 8 to 128 characters of letters, digits and dashes (indexnow.org/documentation, Nov 12, 2026). */
export const INDEXNOW_KEY_RE = /^[A-Za-z0-9-]{8,128}$/;

export const isIndexNowKey = (value: unknown): value is string => typeof value === "string" && INDEXNOW_KEY_RE.test(value);

/** The host of this deployment's public pages (`APP_URL`), lowercase, with its port when it has one; null when APP_URL is not a URL. */
export function hostedPagesHost(appUrl: string): string | null {
  try {
    return new URL(appUrl).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Where a hosted page's key file is served: `<APP_URL>/p/<slug>/<key>.txt`. */
export function hostedKeyFileUrl(appUrl: string, slug: string, key: string): string {
  return `${pageUrl(appUrl, slug)}/${key}.txt`;
}

/** The key a `/p/<slug>/<file>` request asks for (`<key>.txt`), or null when the file name is not a key file's. */
export function keyFromKeyFileName(fileName: string): string | null {
  if (!fileName.endsWith(".txt")) return null;
  const key = fileName.slice(0, -4);
  return isIndexNowKey(key) ? key : null;
}

/**
 * Whether `url` is an address a hosted page's key may be submitted for: the page itself (`/p/<slug>`) or anything
 * under it, on the same origin, with no credentials in it.
 */
export function hostedPageCovers(appUrl: string, slug: string, url: string): boolean {
  let target: URL;
  let page: URL;
  try {
    target = new URL(url);
    page = new URL(pageUrl(appUrl, slug));
  } catch {
    return false;
  }
  if (target.origin !== page.origin || target.username || target.password) return false;
  return target.pathname === page.pathname || target.pathname.startsWith(`${page.pathname}/`);
}
