import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_LISTEN_HOSTS, listenGateway, type RunningGateway } from "../index";

const running: RunningGateway[] = [];
afterEach(async () => {
  for (const r of running.splice(0)) await r.stop();
});

const app = new Hono().get("/health", (c) => c.json({ ok: true })) as unknown as Parameters<typeof listenGateway>[0];

describe("listenGateway", () => {
  it("tries the hosts in order and falls back when the address family is unavailable", async () => {
    const warnings: unknown[] = [];
    // 203.0.113.1 (TEST-NET-3) is never a local address, so the bind fails with EADDRNOTAVAIL and the next host is tried.
    const r = await listenGateway(app, { port: 0, hosts: ["203.0.113.1", "127.0.0.1"], log: { warn: (o) => warnings.push(o) } });
    running.push(r);
    expect(r.host).toBe("127.0.0.1");
    expect(r.port).toBeGreaterThan(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ host: "203.0.113.1", code: "EADDRNOTAVAIL", next: "127.0.0.1" });
    const res = await fetch(`${r.url}/health`);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects when no host accepts the bind and when the host list is empty", async () => {
    await expect(listenGateway(app, { port: 0, hosts: ["203.0.113.1"] })).rejects.toMatchObject({ code: "EADDRNOTAVAIL" });
    await expect(listenGateway(app, { port: 0, hosts: [] })).rejects.toThrow(/no address family/);
  });

  it("defaults to :: then 0.0.0.0 so Railway and IPv4-only containers boot the same binary", async () => {
    expect(DEFAULT_LISTEN_HOSTS).toEqual(["::", "0.0.0.0"]);
    const r = await listenGateway(app, { port: 0 });
    running.push(r);
    expect(["::", "0.0.0.0"]).toContain(r.host);
    expect(r.url).toMatch(/^http:\/\/localhost:\d+$/);
  });
});
