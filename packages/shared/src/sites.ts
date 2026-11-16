/**
 * Foundmill Sites (WP-07): a small static site per project, built by the team, served by apps/sites at
 * `<slug>.<SITES_DOMAIN>` and previewed at `p-<token>.<SITES_DOMAIN>`. Off everywhere while SITES_DOMAIN is unset.
 */
import { pageSlugProblem } from "./project-page";

/** Limits on one release and on publishing (Estimates: a page, a form and a button fit far inside them). */
export const SITE_LIMITS = {
  maxFiles: 200,
  maxTotalBytes: 10 * 1024 * 1024,
  maxFileBytes: 2 * 1024 * 1024,
  publishesPerDay: 20,
  /** Previews served per site, newest first (the founder, Nov 16, 2026); 0119 `site_resolve` repeats it. */
  previewsServed: 3,
} as const;

/** The only files a site serves, by extension, with the content type apps/sites sends. No scripts. */
export const SITE_FILE_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

/** The content type for a site path, or null when the type is not served. */
export function siteFileType(path: string): string | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0 || dot < path.lastIndexOf("/")) return null;
  return SITE_FILE_TYPES[path.slice(dot).toLowerCase()] ?? null;
}

/** Labels kept for the platform itself on the sites domain. */
export const SITE_RESERVED_SLUGS: readonly string[] = ["www", "api", "app", "mail", "admin", "preview", "status", "report", "assets", "static"];

/** The label prefix of a preview host (`p-<token>`); no site address may start with it. */
export const SITE_PREVIEW_PREFIX = "p-";

/** Why a slug cannot be a site address, in the founder's words, or null when it can. */
export function siteSlugProblem(slug: string): string | null {
  const page = pageSlugProblem(slug);
  if (page) return page;
  if (SITE_RESERVED_SLUGS.includes(slug)) return "That address is kept for the product itself. Try another one.";
  if (slug.startsWith(SITE_PREVIEW_PREFIX)) return `A site address cannot start with "${SITE_PREVIEW_PREFIX}". Try another one.`;
  return null;
}

/** Local development serves sites over plain http (`sites.localhost`); every real domain is https. */
const siteScheme = (domain: string): string => (domain === "localhost" || domain.endsWith(".localhost") ? "http" : "https");

/** The live site's address: `https://<slug>.<domain>/`. */
export function siteUrl(domain: string, slug: string): string {
  return `${siteScheme(domain)}://${slug}.${domain}/`;
}

/** A release's preview address: `https://p-<token>.<domain>/`. */
export function sitePreviewUrl(domain: string, token: string): string {
  return `${siteScheme(domain)}://${SITE_PREVIEW_PREFIX}${token}.${domain}/`;
}

/** The sites domain, or null when the feature is off. */
export const sitesDomain = (env: { SITES_DOMAIN?: string | undefined }): string | null => env.SITES_DOMAIN?.trim().toLowerCase() || null;

/** Sites are on only where SITES_DOMAIN is set; unset means nothing in the product mentions a site. */
export const sitesEnabled = (env: { SITES_DOMAIN?: string | undefined }): boolean => sitesDomain(env) !== null;

/**
 * Why `sitesDomain` may not be used beside the product at `appUrl`, or null. A site carries text written by agents for
 * strangers, so it never shares the product's host or a parent or child of it (cookies, mail and search reputation).
 */
export function sitesDomainProblem(sitesDomainValue: string, appUrl: string): string | null {
  let appHost: string;
  try {
    appHost = new URL(appUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  const d = sitesDomainValue.toLowerCase();
  const related = (a: string, b: string): boolean => a === b || a.endsWith(`.${b}`);
  if (related(d, appHost) || related(appHost, d)) return `SITES_DOMAIN must be a domain of its own, not ${appHost} or a subdomain or parent of it`;
  return null;
}
