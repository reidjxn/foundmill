/**
 * The gateway opens its rate-limit Redis connection before it serves (GPC-07): with the offline queue off, ioredis
 * refuses a command sent while the lazy client is still connecting, and the first tool call used to be that command.
 * /health reports the store actually in use.
 */
import { describe, expect, it, vi } from "vitest";
import { createGatewayApp } from "../app";
import { connectRedis } from "../index";
import { setupGateway } from "./harness";

describe("connectRedis", () => {
  it("connects a waiting client before the first call", async () => {
    const redis = { status: "wait" as string, connect: vi.fn(async () => void (redis.status = "ready")) };
    const log = { info: vi.fn(), warn: vi.fn() };
    expect(await connectRedis(redis as never, log)).toBe(true);
    expect(redis.connect).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("logs and carries on when Redis does not answer (the store counts in memory meanwhile)", async () => {
    const redis = { status: "wait", connect: vi.fn(() => new Promise<void>(() => undefined)) };
    const log = { info: vi.fn(), warn: vi.fn() };
    expect(await connectRedis(redis as never, log, 50)).toBe(false);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});

describe("GET /health", () => {
  it("reports the rate-limit store in use, not the one configured", async () => {
    const g = await setupGateway();
    try {
      let inUse: "memory" | "redis" = "redis";
      const app = createGatewayApp(g.deps, { sessionTokenSecret: "s".repeat(32), rateLimitStoreKind: () => inUse });
      expect(await (await app.request("/health")).json()).toMatchObject({ rateLimitStore: "redis" });
      inUse = "memory";
      expect(await (await app.request("/health")).json()).toMatchObject({ rateLimitStore: "memory" });
    } finally {
      await g.close();
    }
  });
});
