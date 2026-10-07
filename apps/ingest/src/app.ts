/**
 * HTTP surface (docs/ARCHITECTURE.md §1, §17). `createIngestApp(deps)` is pure so tests boot it on an ephemeral
 * port: `GET /health`, `POST /webhooks/:connector[/:businessId]`, and — development/staging only —
 * `GET /simulate` + `POST /simulate/:eventName`.
 */
import { APP_NAME } from "@foundmill/config";
import { AppError } from "@foundmill/shared";
import { Hono } from "hono";
import { repos } from "@foundmill/db";
import { ackBody, handleWebhook, mountedWebhooks, type MountedWebhook } from "./webhooks";
import { runSimulation, SimulateBody, simulationCatalogue } from "./simulate";
import { INGEST_SERVICE, type IngestDeps } from "./types";

type Variables = { requestId: string };

export type IngestApp = Hono<{ Variables: Variables }>;

export interface CreatedIngestApp {
  app: IngestApp;
  mounted: MountedWebhook[];
}

const NIL_BUSINESS = "00000000-0000-0000-0000-000000000000";

export function createIngestApp(deps: IngestDeps): CreatedIngestApp {
  const app: IngestApp = new Hono<{ Variables: Variables }>();
  const mounted = mountedWebhooks(deps);
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
        nonceStore: deps.nonces.kind,
        replayWindowSeconds: deps.replayWindowSeconds,
        simulate: deps.simulateEnabled,
        webhooks: mounted.map((m) => ({ connector: m.connector, path: m.path })),
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

  if (deps.simulateEnabled) {
    app.get("/simulate", (c) => c.json({ enabled: true, env: deps.env.APP_ENV, simulations: simulationCatalogue(deps) }));
    app.post("/simulate/:eventName", async (c) => {
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        throw new AppError("validation", "Body must be JSON", 400);
      }
      const parsed = SimulateBody.safeParse(raw);
      if (!parsed.success) throw new AppError("validation", "Invalid request body", 400, parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
      const eventName = c.req.param("eventName") ?? "";
      const r = await runSimulation(deps, eventName, parsed.data);
      return c.json({
        ok: true,
        eventName: r.eventName,
        connector: r.connector,
        written: r.result.written,
        duplicates: r.result.duplicates,
        eventIds: r.result.eventIds,
        events: r.result.events.map((e) => ({ id: e.id, type: e.type, written: e.written, conversionId: e.conversion?.conversion.id ?? null, journeyId: e.conversion?.journey.id ?? null, nthOfKind: e.conversion?.nthOfKind ?? null, fullMatchDay: e.conversion?.fullMatchDay ?? null })),
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
