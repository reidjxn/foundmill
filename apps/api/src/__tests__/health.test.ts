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

  it("unknown routes answer JSON 404", async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_found" });
  });
});
