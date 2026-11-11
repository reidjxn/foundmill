/**
 * HTTP surface (docs/ARCHITECTURE.md §1, §17). `createIngestApp(deps)` is pure so tests boot it on an ephemeral
 * port: `GET /health`, `POST /webhooks/:connector[/:businessId]`, `POST /billing/stripe` (Foundmill's own billing:
 * paid credit top-ups, billing.ts), and — development/staging only, behind the service token apps/api mints (SEC-2) —
 * `GET /simulate` + `POST /simulate/:eventName`.
 */
import { APP_NAME, simulatePanelHonoured } from "@foundmill/config";
import { PLATFORM_MAIL_CONFIRM_PATH, PLATFORM_MAIL_EVENTS_PATH, PLATFORM_MAIL_INBOUND_PATH, PLATFORM_MAIL_UNSUBSCRIBE_PATH } from "@foundmill/connectors";
import { AppError, UnauthorizedError } from "@foundmill/shared";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { repos } from "@foundmill/db";
import { ackBody, handleWebhook, webhookMounts, type MountedWebhook } from "./webhooks";
import { BILLING_WEBHOOK_PATH, handleBillingWebhook } from "./billing";
import { handleFollowConfirm, handlePlatformInbound, handlePlatformMailEvents, handlePlatformUnsubscribe, PLATFORM_MAIL_EVENTS_MAX_BYTES, PLATFORM_MAIL_INBOUND_MAX_BYTES } from "./platform-mail";
import { runSimulation, SimulateBody, simulateRoutesMounted, simulationCatalogue } from "./simulate";
import { bearerToken, verifySimulateToken, type SimulateTokenClaims } from "./simulate-token";
import { INGEST_SERVICE, type IngestDeps } from "./types";

type Variables = { requestId: string; simulateToken: SimulateTokenClaims };

export type IngestApp = Hono<{ Variables: Variables }>;

export interface CreatedIngestApp {
  app: IngestApp;
  mounted: MountedWebhook[];
}

const NIL_BUSINESS = "00000000-0000-0000-0000-000000000000";

export function createIngestApp(deps: IngestDeps): CreatedIngestApp {
  const app: IngestApp = new Hono<{ Variables: Variables }>();
  const { mounted, refused } = webhookMounts(deps);
  const { log } = deps;

  app.use("*", async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    const started = Date.now();
    await next();
    if (c.req.path !== "/health") log.info({ requestId, method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - started }, "request");
  });

  app.get("/", (c) => c.json({ name: APP_NAME, service: INGEST_SERVICE, ok: true }));

  app.get("/health", async (c) => {
    let db = false;
    try {
      // Any scoped read proves the connection; the nil business simply has no rows.
      await repos.events.countByType(deps.db, NIL_BUSINESS);
      db = true;
    } catch (e) {
      log.warn({ err: (e as Error).message }, "health: database unreachable");
    }
    return c.json(
      {
        ok: db,
        service: INGEST_SERVICE,
        db,
        env: deps.env.APP_ENV,
        mode: deps.mode,
        // The store answering now ("memory" while a Redis store falls back), and the one configured.
        nonceStore: deps.nonces.inUse ?? deps.nonces.kind,
        nonceStoreConfigured: deps.nonces.kind,
        replayWindowSeconds: deps.replayWindowSeconds,
        simulate: deps.simulateEnabled,
        webhooks: mounted.map((m) => ({ connector: m.connector, path: m.path, mode: m.mode })),
        // Mock verifiers use secrets committed to the repository: never mounted outside development and test.
        refusedMockWebhooks: refused,
        time: deps.now().toISOString(),
      },
      db ? 200 : 503,
    );
  });

  const webhookRoute = async (segment: string, businessId: string | null, req: Request): Promise<Response> => {
    const outcome = await handleWebhook(deps, mounted, { segment, businessId, req });
    const target = mounted.find((m) => m.segment === segment);
    const ack = ackBody(target?.connector ?? segment, outcome);
    return new Response(ack.text, { status: outcome.status, headers: { "content-type": ack.contentType === "text/plain" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8" } });
  };
  app.post("/webhooks/:connector", (c) => webhookRoute(c.req.param("connector"), null, c.req.raw));
  app.post("/webhooks/:connector/:businessId", (c) => webhookRoute(c.req.param("connector"), c.req.param("businessId"), c.req.raw));
  app.post(BILLING_WEBHOOK_PATH, async (c) => {
    const outcome = await handleBillingWebhook(deps, c.req.raw);
    return c.json(outcome.body, outcome.status);
  });
  // A project's Foundmill sending address (platform-mail.ts): one endpoint each, the project resolved from the content.
  // A larger body is a 413 before it is read, whatever its Content-Length says (a chunked one is counted as it arrives).
  const tooLarge = (maxSize: number) => bodyLimit({ maxSize, onError: (c) => c.json({ ok: false, error: "payload_too_large", message: `Request body is larger than ${Math.round(maxSize / (1024 * 1024))} MB` }, 413) });
  app.use(PLATFORM_MAIL_INBOUND_PATH, tooLarge(PLATFORM_MAIL_INBOUND_MAX_BYTES));
  app.use(PLATFORM_MAIL_EVENTS_PATH, tooLarge(PLATFORM_MAIL_EVENTS_MAX_BYTES));
  app.post(PLATFORM_MAIL_INBOUND_PATH, async (c) => {
    const outcome = await handlePlatformInbound(deps, c.req.raw);
    return c.json(outcome.body, outcome.status);
  });
  app.post(PLATFORM_MAIL_EVENTS_PATH, async (c) => {
    const outcome = await handlePlatformMailEvents(deps, c.req.raw);
    return c.json(outcome.body, outcome.status);
  });
  const unsubscribe = async (req: Request) => {
    const outcome = await handlePlatformUnsubscribe(deps, req);
    return new Response(outcome.html, { status: outcome.status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" } });
  };
  app.get(PLATFORM_MAIL_UNSUBSCRIBE_PATH, (c) => unsubscribe(c.req.raw));
  app.post(PLATFORM_MAIL_UNSUBSCRIBE_PATH, (c) => unsubscribe(c.req.raw));
  // The link in a follow confirmation email (package 1.6, double opt-in): the same page and headers as unsubscribe.
  const confirm = async (req: Request) => {
    const outcome = await handleFollowConfirm(deps, req);
    return new Response(outcome.html, { status: outcome.status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" } });
  };
  app.get(PLATFORM_MAIL_CONFIRM_PATH, (c) => confirm(c.req.raw));
  app.post(PLATFORM_MAIL_CONFIRM_PATH, (c) => confirm(c.req.raw));

  if (simulateRoutesMounted(deps)) {
    // SEC-2: the service token is verified before anything else happens (the body is not even read), so a request
    // without one has no side effects. A missing secret fails closed: every request is refused.
    const requireSimulateToken: MiddlewareHandler<{ Variables: Variables }> = async (c, next) => {
      const token = bearerToken(c.req.header("authorization"));
      if (!token) throw new UnauthorizedError("A simulate service token is required (Settings → Integrations → Simulate goes through the API)");
      const claims = verifySimulateToken(deps.simulateTokenSecret, token, deps.now);
      if (!simulatePanelHonoured({ appEnv: deps.env.APP_ENV, flag: deps.simulateEnabled, serviceTokenVerified: true })) throw new AppError("not_found", "No route for simulate in this environment", 404);
      c.set("simulateToken", claims);
      await next();
    };
    app.use("/simulate", requireSimulateToken);
    app.use("/simulate/*", requireSimulateToken);

    app.get("/simulate", (c) => c.json({ enabled: true, env: deps.env.APP_ENV, businessId: c.get("simulateToken").businessId, simulations: simulationCatalogue(deps) }));
    app.post("/simulate/:eventName", async (c) => {
      const token = c.get("simulateToken");
      if (!token) throw new UnauthorizedError("A simulate service token is required");
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        throw new AppError("validation", "Body must be JSON", 400);
      }
      const parsed = SimulateBody.safeParse(raw);
      if (!parsed.success) throw new AppError("validation", "Invalid request body", 400, parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
      const eventName = c.req.param("eventName") ?? "";
      const r = await runSimulation(deps, eventName, parsed.data, token);
      return c.json({
        ok: true,
        eventName: r.eventName,
        connector: r.connector,
        written: r.result.written,
        duplicates: r.result.duplicates,
        eventIds: r.result.eventIds,
        events: r.result.events.map((e) => ({
          id: e.id,
          type: e.type,
          written: e.written,
          conversionId: e.conversion?.conversion.id ?? null,
          entityId: e.conversion?.entityId ?? null,
          firstPayment: e.conversion ? e.conversion.firstPayment : null,
          journeyId: e.conversion?.win?.journey.id ?? null,
          nthOfKind: e.conversion?.win?.nthOfKind ?? null,
          fullMatchDay: e.conversion?.win?.fullMatchDay ?? null,
        })),
        label: "Simulated",
      });
    });
  }

  app.notFound((c) => c.json({ ok: false, error: "not_found", message: `No route for ${c.req.method} ${c.req.path}` }, 404));

  app.onError((err, c) => {
    if (err instanceof AppError) {
      const status = (err.status >= 400 && err.status < 600 ? err.status : 500) as 400 | 401 | 403 | 404 | 409 | 422 | 500 | 503;
      return c.json({ ok: false, error: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) }, status);
    }
    log.error({ requestId: c.get("requestId"), err: err.message, stack: err.stack }, "unhandled error");
    return c.json({ ok: false, error: "internal", message: "Internal error" }, 500);
  });

  return { app, mounted };
}
