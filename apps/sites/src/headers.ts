/**
 * The response headers of every site response (WP-07 T4). A site is static and runs no script: the policy below is
 * what enforces that, whatever a release contains. No response ever sets a cookie.
 */

export type SiteKind = "live" | "preview";

export interface SiteHeaderOptions {
  kind: SiteKind;
  /** Production adds Strict-Transport-Security. */
  production: boolean;
  /**
   * The product's own origin (APP_URL). A preview may be framed by the Site tab there, and only there; a live site is
   * never framed.
   */
  appOrigin: string | null;
}

/** The Content-Security-Policy of a site response. */
export function siteCsp(options: Pick<SiteHeaderOptions, "kind" | "appOrigin">): string {
  const frameAncestors = options.kind === "preview" && options.appOrigin ? options.appOrigin : "'none'";
  return [
    "default-src 'none'",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    `frame-ancestors ${frameAncestors}`,
  ].join("; ");
}

/** The fixed header set for a site response (content type and caching are added per file). */
export function siteHeaders(options: SiteHeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Security-Policy": siteCsp(options),
    "X-Content-Type-Options": "nosniff",
    // A preview's host carries its token: never send it on to a site the preview links to.
    "Referrer-Policy": options.kind === "preview" ? "no-referrer" : "strict-origin-when-cross-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
  if (options.production) headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  if (options.kind === "preview") {
    headers["X-Robots-Tag"] = "noindex, nofollow";
    headers["Cache-Control"] = "no-store";
  }
  return headers;
}

/** Caching of a live file: HTML for a minute (a publish shows quickly), everything else for an hour with its hash. */
export function liveCacheHeaders(isHtml: boolean, sha256: string): Record<string, string> {
  return isHtml ? { "Cache-Control": "public, max-age=60" } : { "Cache-Control": "public, max-age=3600", ETag: `"${sha256}"` };
}

/** The origin of a URL, or null when it is not one. */
export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
