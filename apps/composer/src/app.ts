/**
 * HTTP surface (docs/ARCHITECTURE.md §11). JSON in, JSON out; Zod on every body; `AppError`s map to their status;
 * nothing here touches the database directly. `createApp(service)` is pure so tests boot it on an ephemeral port.
 */
import { APP_NAME } from "@foundmill/config";
import type { ModelLogger } from "@foundmill/models";
import { AppError } from "@foundmill/shared";
import { Hono } from "hono";
import { z } from "zod";
import { QUARTER_RE } from "./chapter";
import type { ComposerService } from "./service";

const Id = z.guid();

export const NarrateBody = z.object({ businessId: Id, eventIds: z.array(Id).min(1).max(50) });
export const RefreshBody = z.object({ businessId: Id });
export const CommentaryBody = z.object({ businessId: Id, journeyId: Id });
export const ChapterTitleBody = z
  .object({ businessId: Id, quarter: z.string().regex(QUARTER_RE).optional(), chapterId: z.string().regex(QUARTER_RE).optional() })
  .transform((v) => ({ businessId: v.businessId, quarter: v.quarter ?? v.chapterId }));

export interface AppOptions {
  env?: { APP_ENV: string; INTEGRATIONS_MODE: string; MODEL_MODE: string };
  log?: ModelLogger;
}

type Variables = { requestId: string };

export function createApp(service: ComposerService, options: AppOptions = {}) {
  const app = new Hono<{ Variables: Variables }>();
  const log = options.log;

  app.use("*", async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    const started = Date.now();
    await next();
    if (log && c.req.path !== "/health") log.info({ requestId, method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - started }, "request");
  });

  app.get("/", (c) => c.json({ name: APP_NAME, service: "composer", ok: true }));

  app.get("/health", async (c) => {
    const db = await service.healthy();
    return c.json({ ok: db, service: "composer", db, env: options.env?.APP_ENV ?? null, modes: { integrations: options.env?.INTEGRATIONS_MODE ?? null, models: options.env?.MODEL_MODE ?? null }, time: new Date().toISOString() });
  });

  const body = async <T>(c: { req: { json(): Promise<unknown> } }, schema: z.ZodType<T>): Promise<T> => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw new AppError("validation", "Body must be JSON", 400);
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new AppError("validation", "Invalid request body", 400, parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    return parsed.data;
  };

  app.post("/v1/narrate", async (c) => {
    const { businessId, eventIds } = await body(c, NarrateBody);
    const r = await service.narrate(businessId, eventIds);
    return c.json({ inboxItemId: r.item.id, item: r.item, eventIds: r.eventIds, reasked: r.reasked, entityIds: r.entityIds, draftEntityIds: r.draftEntityIds, cost: { amountMinor: r.costMinor, label: "Estimate" }, model: r.model, durationMs: r.durationMs });
  });

  app.post("/v1/refresh", async (c) => {
    const { businessId } = await body(c, RefreshBody);
    const r = await service.refresh(businessId);
    return c.json({ inboxItemId: r.item.id, item: r.item, slot: r.slot, source: r.source, debounced: r.debounced, buffer: r.buffer, cost: { amountMinor: r.costMinor, label: "Estimate" }, durationMs: r.durationMs });
  });

  app.post("/v1/commentary", async (c) => {
    const { businessId, journeyId } = await body(c, CommentaryBody);
    const r = await service.commentary(businessId, journeyId);
    return c.json({ journeyId: r.journeyId, headline: r.headline, lines: r.lines, stripped: r.stripped, cost: { amountMinor: r.costMinor, label: "Estimate" }, model: r.model });
  });

  app.post("/v1/chapter-title", async (c) => {
    const { businessId, quarter } = await body(c, ChapterTitleBody);
    const r = await service.chapterTitle(businessId, quarter);
    return c.json({ quarter: r.quarter, label: r.label, title: r.title, subtitle: r.subtitle, mood: r.mood, source: r.source, facts: r.facts, cost: { amountMinor: r.costMinor, label: "Estimate" } });
  });

  app.get("/v1/exhibits", (c) => c.json({ queries: service.exhibits() }));

  app.get("/v1/exhibits/:id", async (c) => {
    const businessId = Id.safeParse(c.req.query("businessId"));
    if (!businessId.success) throw new AppError("validation", "businessId query parameter must be a UUID", 400);
    const data = await service.exhibit(businessId.data, c.req.param("id"));
    if (!data) return c.json({ error: "not_found", message: `No named query ${c.req.param("id")}` }, 404);
    return c.json(data);
  });

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

export type ComposerApp = ReturnType<typeof createApp>;
