import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
let base = "";
let server: ReturnType<typeof serve>;

beforeAll(async () => {
  hz = await createApiHarness({ prefix: "health" });
  const app = createApp(hz.deps);
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info: AddressInfo) => {
      base = `http://127.0.0.1:${info.port}`;
      resolve();
    });
  });
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await hz.close();
});

describe("HTTP surface on an ephemeral port", () => {
  it("GET /health reports reachability flags and never throws", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, service: "api", db: true, redis: false, temporal: false, composer: false, vault: true, modes: { integrations: "mock", models: "mock" } });
    expect(res.headers.get("x-request-id")).toBeTruthy();
    // The connectors switched live one by one, here and on the gateway (unreachable in this test, so null).
    expect(body.modes).toMatchObject({ liveConnectors: [] });
    expect(body.gateway).toBeNull();
  });

  it("GET /health answers 503 without the database, so Railway's healthcheck keeps traffic on the previous deployment", async () => {
    const down = createApp({ ...hz.deps, health: { ...hz.deps.health, db: async () => false } });
    const res = await down.request("/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, service: "api", db: false });
    // Redis, Temporal and the composer are optional: their absence alone never fails the check (they are down here).
    expect((await createApp(hz.deps).request("/health")).status).toBe(200);
  });

  it("GET /health answers 503 while a migration is missing, and says which count is behind (WP-11 T2)", async () => {
    const behind = createApp({ ...hz.deps, health: { ...hz.deps.health, schema: async () => ({ ready: false, applied: 95, expected: 96 }) } });
    const res = await behind.request("/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, db: true, schema: { applied: 95, expected: 96 } });
    // Without a schema probe (tests, the in-process caller) the schema counts as ready.
    const plain = await createApp(hz.deps).request("/health");
    expect(plain.status).toBe(200);
    expect(await plain.json()).toMatchObject({ ok: true, schema: { applied: null, expected: null } });
  });

  it("CORS allows the web origin and localhost:3000 with credentials", async () => {
    const res = await fetch(`${base}/trpc/health`, { method: "OPTIONS", headers: { origin: "http://localhost:3000", "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    const denied = await fetch(`${base}/trpc/health`, { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("serves tRPC over HTTP: public health query works, protected queries need a bearer token", async () => {
    const ok = await fetch(`${base}/trpc/health`);
    expect(ok.status).toBe(200);
    const json = (await ok.json()) as { result: { data: { json: { ok: boolean } } } };
    expect(json.result.data.json.ok).toBe(true);

    const anon = await fetch(`${base}/trpc/founder.profile.get`);
    expect(anon.status).toBe(401);
    const bad = await fetch(`${base}/trpc/founder.profile.get`, { headers: { authorization: "Bearer not-a-jwt" } });
    expect(bad.status).toBe(401);
  });

  it("procedures read the api's environment over HTTP, not the HTTP server's bindings", async () => {
    // @hono/trpc-server replaced ctx.env with Hono's `c.env` (the Node request/response), so every ctx.env read over
    // HTTP was undefined: Settings › Integrations crashed and mock-mode branches never ran.
    const owner = { userId: hz.A.ownerId, email: "owner@a.test", authenticatedAt: new Date() };
    const app = createApp({ ...hz.deps, auth: { resolve: async () => owner, verify: async () => owner } });
    const input = encodeURIComponent(JSON.stringify({ json: { businessId: hz.A.businessId } }));
    const res = await app.request(`/trpc/integrations.list?input=${input}`, { headers: { authorization: "Bearer test" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { data: { json: { mode: string; catalogue: { key: string; live: boolean }[] } } } };
    expect(body.result.data.json.mode).toBe("mock");
    expect(body.result.data.json.catalogue.find((c) => c.key === "github")).toMatchObject({ live: false });
  });

  it("unknown routes answer JSON 404", async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_found" });
  });
});
