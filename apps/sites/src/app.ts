/**
 * apps/sites (WP-07 T4): serves project sites at `<slug>.<SITES_DOMAIN>` and release previews at
 * `p-<token>.<SITES_DOMAIN>`. Static only: it reads bytes through two database functions and answers the `/_fm/*`
 * routes it owns. It holds no secret, sets no cookie, and runs as a database login that can execute the site
 * functions and nothing else. `createSitesApp(deps)` is pure so tests boot it with fakes or a test database.
 */
import { APP_NAME, tierShowsBuiltOnMark, type TierKey } from "@foundmill/config";
import { FOLLOW_ERRORS, followEmailProblem } from "@foundmill/shared/project-page";
import { siteFileType } from "@foundmill/shared/sites";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { liveCacheHeaders, originOf, siteHeaders, type SiteKind } from "./headers";
import { FOLLOW_CHECK_INBOX_PAGE, FOLLOW_PREVIEW_PAGE, followFormPage, followRefusedPage, NOT_FOUND_PAGE, REPORT_DETAIL_MAX, REPORT_REASONS, reportAnswerPage, reportFormPage, SERVER_ERROR_PAGE, siteFooter, TAKEN_DOWN_PAGE, withFooter } from "./pages";

export const SITES_SERVICE = "sites";

/** What `site_resolve` answers for a host's first label. */
export interface ResolvedSite {
  /** Null for a taken-down site. */
  releaseId: string | null;
  businessId: string;
  kind: SiteKind | "taken_down";
  planTier: TierKey;
}

export interface SiteFile {
  content: Uint8Array;
  sha256: string;
  size: number;
}

export type ReportOutcome = "recorded" | "limited" | "invalid" | "unknown";

export interface SitesLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
}

/** What the api answers a site's sign-up (`publicPage.follow` with `via: "site"`). */
export type FollowSubmitAnswer = { ok: true } | { refused: string };

export interface SitesFollowApi {
  /** The consent sentence for a live site (`publicPage.siteConsent`), or null when it takes no sign-ups. */
  consent(slug: string): Promise<{ consentText: string } | null>;
  submit(input: { slug: string; email: string; consent: boolean; website: string | null; turnstile: string | null }): Promise<FollowSubmitAnswer>;
}

export interface SitesDeps {
  env: { APP_ENV: string; APP_URL: string; SITES_DOMAIN: string | null };
  resolve(label: string): Promise<ResolvedSite | null>;
  readFile(releaseId: string, path: string): Promise<SiteFile | null>;
  report(label: string, reason: string, detail: string): Promise<ReportOutcome>;
  /** The api calls of a site's sign-up form (WP-07 T6). */
  follow: SitesFollowApi;
  /** Turnstile's public site key for the sign-up page; null uses the mock token on development and test stacks. */
  turnstileSiteKey: string | null;
  /** Answers /health's database check. */
  ping(): Promise<boolean>;
  log: SitesLogger;
}

/** The token the api's mock bot check passes on development and test stacks (`FOLLOW_MOCK_TURNSTILE_TOKEN`). */
export const FOLLOW_MOCK_TOKEN = "mock-ok";
const EMAIL = /^[^\s@<>()"',;:\\]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/** A form post to the platform's routes is small. */
export const FORM_MAX_BYTES = 4 * 1024;

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** The host's first label when the host is `<label>.<domain>` (any port), else null. */
export function siteLabel(host: string | undefined, domain: string | null): string | null {
  if (!host || !domain) return null;
  const name = host.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  const suffix = `.${domain}`;
  if (!name.endsWith(suffix)) return null;
  const label = name.slice(0, -suffix.length);
  return LABEL.test(label) ? label : null;
}

/**
 * The release path a request path asks for, or null when it may not be served: decoded once, no `..`, no empty or
 * dot-started segment (no dotfiles), no backslash or control character. `/` and a trailing slash mean `index.html`.
 */
export function sitePath(requestPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  // eslint-disable-next-line no-control-regex
  if (!decoded.startsWith("/") || /[\\\u0000-\u001f\u007f]/.test(decoded)) return null;
  let path = decoded.slice(1);
  if (path === "" || path.endsWith("/")) path = `${path}index.html`;
  const segments = path.split("/");
  if (segments.some((s) => s === "" || s.startsWith("."))) return null;
  return path;
}

const asText = (bytes: Uint8Array): string => new TextDecoder("utf-8").decode(bytes);

export function createSitesApp(deps: SitesDeps): Hono {
  const app = new Hono();
  const { env, log } = deps;
  const production = env.APP_ENV === "production";
  const appOrigin = originOf(env.APP_URL);

  const plain = (c: Context, status: 404 | 405 | 410 | 413 | 500, html: string, kind: SiteKind = "live"): Response => {
    const res = c.html(html, status);
    for (const [k, v] of Object.entries(siteHeaders({ kind, production, appOrigin }))) res.headers.set(k, v);
    if (!res.headers.has("Cache-Control")) res.headers.set("Cache-Control", "no-store");
    return res;
  };

  // An error still answers with the site header set, and says nothing about the cause.
  app.onError((e, c) => {
    log.warn({ err: e.message, path: c.req.path }, "site request failed");
    return plain(c, 500, SERVER_ERROR_PAGE);
  });

  app.get("/health", async (c) => {
    let db = false;
    try {
      db = await deps.ping();
    } catch (e) {
      log.warn({ err: (e as Error).message }, "health: database unreachable");
    }
    return c.json({ ok: db, service: SITES_SERVICE, db, enabled: env.SITES_DOMAIN !== null }, db ? 200 : 503);
  });

  /** The site behind the request's host, or a finished response. */
  const siteOf = async (c: Context): Promise<{ label: string; site: ResolvedSite & { releaseId: string; kind: SiteKind } } | Response> => {
    const label = siteLabel(c.req.header("host"), env.SITES_DOMAIN);
    if (!label) return plain(c, 404, NOT_FOUND_PAGE);
    const site = await deps.resolve(label);
    if (!site) return plain(c, 404, NOT_FOUND_PAGE);
    if (site.kind === "taken_down" || !site.releaseId) return plain(c, 410, TAKEN_DOWN_PAGE);
    return { label, site: { ...site, releaseId: site.releaseId, kind: site.kind } };
  };

  const htmlPage = (c: Context, kind: SiteKind, html: string, status: 200 | 400 | 429 = 200): Response => {
    const res = c.html(html, status);
    for (const [k, v] of Object.entries(siteHeaders({ kind, production, appOrigin }))) res.headers.set(k, v);
    res.headers.set("Cache-Control", "no-store");
    return res;
  };

  // The report form: on every published site, every plan (a safety control, not a plan feature; WP-07 D3).
  app.get("/_fm/report", async (c) => {
    const found = await siteOf(c);
    if (found instanceof Response) return found;
    return htmlPage(c, found.site.kind, reportFormPage());
  });

  app.post("/_fm/report", bodyLimit({ maxSize: FORM_MAX_BYTES, onError: (c) => plain(c, 413, NOT_FOUND_PAGE) }), async (c) => {
    const found = await siteOf(c);
    if (found instanceof Response) return found;
    let reason: string;
    let detail: string;
    try {
      const form = await c.req.parseBody();
      reason = typeof form.reason === "string" ? form.reason : "";
      detail = typeof form.detail === "string" ? form.detail.slice(0, REPORT_DETAIL_MAX) : "";
    } catch {
      return htmlPage(c, found.site.kind, reportAnswerPage("invalid"), 400);
    }
    if (!REPORT_REASONS.some((r) => r.value === reason)) return htmlPage(c, found.site.kind, reportAnswerPage("invalid"), 400);
    const outcome = await deps.report(found.label, reason, detail);
    if (outcome === "unknown") return plain(c, 404, NOT_FOUND_PAGE);
    if (outcome !== "recorded") log.info({ outcome }, "site report not recorded");
    return htmlPage(c, found.site.kind, reportAnswerPage(outcome), outcome === "limited" ? 429 : outcome === "invalid" ? 400 : 200);
  });

  // A site's sign-up form (WP-07 T6): the agent's <form action="/_fm/follow"> brings the visitor here with an address;
  // the platform's own page asks for consent (an unticked box), the hidden field and the bot check, and only then calls
  // the api's follow path, the same one the public page uses. Nothing else the visitor typed is read.
  const followHeaders = (kind: SiteKind): Record<string, string> => {
    const base = siteHeaders({ kind, production, appOrigin });
    if (deps.turnstileSiteKey && kind === "live") base["Content-Security-Policy"] = `${base["Content-Security-Policy"]}; script-src https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'none'`;
    return { ...base, "Cache-Control": "no-store" };
  };
  const followPage = (c: Context, kind: SiteKind, html: string, status: 200 | 400 | 404 = 200): Response => {
    const res = c.html(html, status);
    for (const [k, v] of Object.entries(followHeaders(kind))) res.headers.set(k, v);
    return res;
  };
  const mockToken = !deps.turnstileSiteKey && (env.APP_ENV === "development" || env.APP_ENV === "test") ? FOLLOW_MOCK_TOKEN : null;
  const emailOf = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const email = value.trim().toLowerCase();
    return !followEmailProblem(email) && EMAIL.test(email) ? email : null;
  };
  const formLimit = bodyLimit({ maxSize: FORM_MAX_BYTES, onError: (c) => plain(c, 413, NOT_FOUND_PAGE) });

  app.post("/_fm/follow", formLimit, async (c) => {
    const found = await siteOf(c);
    if (found instanceof Response) return found;
    if (found.site.kind === "preview") return followPage(c, "preview", FOLLOW_PREVIEW_PAGE);
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const email = emailOf((form as Record<string, unknown>).email);
    if (!email) return followPage(c, "live", followRefusedPage(FOLLOW_ERRORS.email), 400);
    const consent = await deps.follow.consent(found.label);
    if (!consent) return followPage(c, "live", followRefusedPage(FOLLOW_ERRORS.closed), 404);
    return followPage(c, "live", followFormPage({ email, consentText: consent.consentText, turnstileSiteKey: deps.turnstileSiteKey, mockToken }));
  });

  app.get("/_fm/follow", (c) => plain(c, 405, NOT_FOUND_PAGE));
  app.get("/_fm/follow/confirm", (c) => plain(c, 405, NOT_FOUND_PAGE));

  app.post("/_fm/follow/confirm", formLimit, async (c) => {
    const found = await siteOf(c);
    if (found instanceof Response) return found;
    if (found.site.kind === "preview") return followPage(c, "preview", FOLLOW_PREVIEW_PAGE);
    const form = (await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>;
    const email = emailOf(form.email);
    if (!email) return followPage(c, "live", followRefusedPage(FOLLOW_ERRORS.email), 400);
    if (form.consent !== "yes") return followPage(c, "live", followRefusedPage(FOLLOW_ERRORS.consent), 400);
    const str = (v: unknown, max: number): string | null => (typeof v === "string" ? v.slice(0, max) : null);
    const answer = await deps.follow.submit({ slug: found.label, email, consent: true, website: str(form.website, 500), turnstile: str(form["cf-turnstile-response"], 4096) });
    // The same answer whatever happened, unless the address or the bot check was refused.
    return "ok" in answer ? followPage(c, "live", FOLLOW_CHECK_INBOX_PAGE) : followPage(c, "live", followRefusedPage(answer.refused), 400);
  });

  // Other platform paths are added by later tasks (the sign-up form, pay buttons); none is served from a release.
  app.all("/_fm/*", (c) => plain(c, 404, NOT_FOUND_PAGE));

  // Site files: GET (and HEAD, which Hono answers from GET without the body).
  app.get("*", async (c) => {
    const found = await siteOf(c);
    if (found instanceof Response) return found;
    const { site } = found;
    const path = sitePath(c.req.path);
    if (!path) return plain(c, 404, NOT_FOUND_PAGE, site.kind);
    let served = path;
    let file = siteFileType(path) ? await deps.readFile(site.releaseId, path) : null;
    // `/about` may be a folder: `/about/index.html`.
    if (!file && !path.includes(".", path.lastIndexOf("/"))) {
      served = `${path}/index.html`;
      file = await deps.readFile(site.releaseId, served);
    }
    let status: 200 | 404 = 200;
    if (!file) {
      served = "404.html";
      file = await deps.readFile(site.releaseId, served);
      status = 404;
      if (!file) return plain(c, 404, NOT_FOUND_PAGE, site.kind);
    }
    const type = siteFileType(served);
    if (!type) return plain(c, 404, NOT_FOUND_PAGE, site.kind);
    const isHtml = type.startsWith("text/html");
    // An SVG opened as a page would carry no footer (no report link): it is served only as an image.
    if (type.startsWith("image/svg") && ["document", "iframe", "frame", "object", "embed"].includes(c.req.header("sec-fetch-dest") ?? "")) return plain(c, 404, NOT_FOUND_PAGE, site.kind);
    const headers: Record<string, string> = { ...siteHeaders({ kind: site.kind, production, appOrigin }), "Content-Type": type };
    if (site.kind === "live") Object.assign(headers, liveCacheHeaders(isHtml, file.sha256));
    if (isHtml) {
      const markHref = tierShowsBuiltOnMark(site.planTier) ? env.APP_URL : null;
      return new Response(withFooter(asText(file.content), siteFooter(APP_NAME, markHref)), { status, headers });
    }
    if (status === 200 && site.kind === "live" && c.req.header("if-none-match") === `"${file.sha256}"`) return new Response(null, { status: 304, headers });
    return new Response(file.content as BodyInit, { status, headers });
  });

  app.all("*", (c) => {
    const res = plain(c, 405, NOT_FOUND_PAGE);
    res.headers.set("Allow", "GET, HEAD");
    return res;
  });

  return app;
}
