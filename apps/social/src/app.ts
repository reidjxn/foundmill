/**
 * HTTP surface of the LIVE social service (docs/ARCHITECTURE.md §1 apps/social; BUILD §7.3, §11.14).
 *
 * Phase 4 skeleton: `/health`, `GET /v1/public-profiles` over the `public_profiles` view only (built from LIVE,
 * committed, non-archived businesses and founders who opted in — Personal businesses never enter it, §7.3), and
 * the Phase 4 routers (connections, messages, communities, leaderboards, negotiation) mounted as explicit 501s so
 * the routes exist, are documented and cannot be mistaken for silent 404s. Nothing here touches the database
 * except through `repos.social`.
 */
import { APP_NAME, FLAGS } from "@foundmill/config";
import { repos, type Db } from "@foundmill/db";
import { AppError } from "@foundmill/shared";
import { Hono } from "hono";
import { z } from "zod";

export const SOCIAL_SERVICE = "social" as const;

/** Routers that arrive with Phase 4 (BUILD §16.5). Each answers 501 with the same body shape until then. */
export const PHASE4_ROUTERS = [
  { path: "/v1/connections", feature: "connections", summary: "Connection requests, acceptance and blocking between founders." },
  { path: "/v1/messages", feature: "messages", summary: "Human-to-human message threads (agents may draft, never send without Send)." },
  { path: "/v1/communities", feature: "communities", summary: "Cohort, category, geography and private communities with feeds, members and events." },
  { path: "/v1/leaderboards", feature: "leaderboards", summary: "League tables over verified integration metrics with divisions and monthly promotion/relegation." },
  { path: "/v1/negotiation", feature: "negotiation", summary: "B2B negotiation threads between agents within founder-set limits; final terms are a hard-gate founder task." },
] as const;
export type Phase4Feature = (typeof PHASE4_ROUTERS)[number]["feature"];

export const PublicProfilesQuery = z.object({
  /** Name search (pg_trgm similarity + prefix) — required unless `businessId` is given. */
  q: z.string().trim().min(1).max(120).optional(),
  /** One business's public profile. */
  businessId: z.guid().optional(),
  kind: z.enum(["business", "founder"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PublicProfilesQuery = z.input<typeof PublicProfilesQuery>;

export interface SocialLogger {
  info(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface AppOptions {
  env?: { APP_ENV: string; INTEGRATIONS_MODE: string; MODEL_MODE: string };
  log?: SocialLogger;
  now?: () => Date;
}

type Variables = { requestId: string };

export function createApp(db: Db, options: AppOptions = {}) {
  const app = new Hono<{ Variables: Variables }>();
  const log = options.log;
  const now = options.now ?? (() => new Date());

  app.use("*", async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    c.header("cache-control", "no-store");
    const started = Date.now();
    await next();
    if (log && c.req.path !== "/health") log.info({ requestId, method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - started }, "request");
  });

  app.get("/", (c) => c.json({ name: APP_NAME, service: SOCIAL_SERVICE, ok: true, phase: 4, routers: PHASE4_ROUTERS.map((r) => ({ path: r.path, status: 501 })) }));

  app.get("/health", (c) =>
    c.json({
      ok: true,
      app: APP_NAME,
      service: SOCIAL_SERVICE,
      liveMode: FLAGS.liveMode,
      env: options.env?.APP_ENV ?? null,
      modes: { integrations: options.env?.INTEGRATIONS_MODE ?? null, models: options.env?.MODEL_MODE ?? null },
      time: now().toISOString(),
    }),
  );

  /**
   * Public profiles: the only read this service performs today. The `public_profiles` view selects LIVE, committed,
   * non-archived businesses (and public founder profiles of their owners/admins), so Personal businesses are
   * excluded in SQL, not by a filter here (AC-11.12.2 spirit, §7.3).
   */
  app.get("/v1/public-profiles", async (c) => {
    const parsed = PublicProfilesQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!parsed.success) throw new AppError("validation", "Invalid query", 400, parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    const { q, businessId, kind, limit } = parsed.data;
    if (businessId) {
      const profile = await repos.social.publicProfile(db, businessId);
      if (!profile) return c.json({ error: "not_found", message: `No public profile for business ${businessId}` }, 404);
      return c.json({ profiles: [profile], source: "public_profiles", label: `On ${APP_NAME}` });
    }
    if (!q) throw new AppError("validation", "Provide `q` (name search) or `businessId`", 400);
    const profiles = await repos.social.searchPublic(db, q, { limit, kind });
    return c.json({ profiles, source: "public_profiles", label: `On ${APP_NAME}`, query: { q, kind: kind ?? null, limit } });
  });

  // Phase 4 routers: present, documented, not implemented.
  for (const router of PHASE4_ROUTERS) {
    const notImplemented = (c: { json: (body: unknown, status: 501) => Response; req: { method: string; path: string } }) =>
      c.json(
        {
          error: "not_implemented",
          feature: router.feature,
          phase: 4,
          message: `${router.summary} Arrives with Phase 4 (BUILD §11.14, §16.5); ${c.req.method} ${c.req.path} is not available yet.`,
        },
        501,
      );
    app.all(router.path, notImplemented);
    app.all(`${router.path}/*`, notImplemented);
  }

  app.notFound((c) => c.json({ error: "not_found", message: `No route ${c.req.method} ${c.req.path}` }, 404));

  app.onError((err, c) => {
    if (err instanceof AppError) {
      if (err.status >= 500) log?.error({ err: err.message, code: err.code, requestId: c.get("requestId") }, "request failed");
      return c.json({ error: err.code, message: err.message, details: err.details ?? null }, err.status as 400);
    }
    log?.error({ err: err.message, stack: err.stack, requestId: c.get("requestId") }, "unhandled error");
    return c.json({ error: "internal", message: "Internal error" }, 500);
  });

  return app;
}

export type SocialApp = ReturnType<typeof createApp>;
