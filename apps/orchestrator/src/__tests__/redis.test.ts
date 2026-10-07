import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { chooseRedisBackend, createRedisClient, probeRedis, REDIS_RETRY_CAP_MS } from "../redis";

const servers: Server[] = [];
const sockets = new Set<Socket>();
afterEach(async () => {
  for (const s of sockets) s.destroy();
  sockets.clear();
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
});

/** A TCP listener that accepts and never answers: what a half-up Redis or a firewall looks like. */
const silentPort = async (): Promise<number> => {
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return (server.address() as { port: number }).port;
};

describe("probeRedis", () => {
  it("reports a refused connection as unreachable without throwing", async () => {
    const probe = await probeRedis("redis://127.0.0.1:1", 1_000);
    expect(probe.ok).toBe(false);
    expect(probe.reason).toMatch(/ECONNREFUSED|connect/i);
  });

  it("gives up within the timeout when the socket opens but nothing answers", async () => {
    const port = await silentPort();
    const started = Date.now();
    const probe = await probeRedis(`redis://127.0.0.1:${port}`, 400);
    expect(probe.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("chooseRedisBackend", () => {
  const unreachable = { ok: false, reason: "ECONNREFUSED" };
  it("uses Redis when the probe answered", () => {
    const choice = chooseRedisBackend({ APP_ENV: "development", REDIS_URL: "redis://user:secret@localhost:6379" }, { ok: true, reason: null });
    expect(choice).toMatchObject({ kind: "redis", level: "info" });
    expect(choice.message).not.toContain("secret");
  });

  it("falls back to the in-memory stream + control bus in development and test, with a warning that says what is lost", () => {
    for (const APP_ENV of ["development", "test"]) {
      const choice = chooseRedisBackend({ APP_ENV, REDIS_URL: "redis://localhost:6379" }, unreachable);
      expect(choice.kind).toBe("memory");
      expect(choice.level).toBe("warn");
      expect(choice.message).toMatch(/in memory/);
      expect(choice.message).toMatch(/Start Redis/);
    }
  });

  it("keeps Redis (retrying) in staging and production and logs an error instead of exiting", () => {
    for (const APP_ENV of ["staging", "production"]) {
      const choice = chooseRedisBackend({ APP_ENV, REDIS_URL: "redis://redis.railway.internal:6379" }, unreachable);
      expect(choice).toMatchObject({ kind: "redis", level: "error" });
      expect(choice.message).toMatch(/capped backoff/);
    }
  });
});

describe("createRedisClient", () => {
  it("caps the reconnect backoff and logs identical errors once", async () => {
    const lines: { obj: unknown; msg?: string }[] = [];
    const client = createRedisClient("redis://127.0.0.1:1", {
      warn: (obj: unknown, msg?: string) => {
        lines.push({ obj, msg });
      },
      info: () => undefined,
    });
    try {
      const retry = (client.options as { retryStrategy?: (times: number) => number | null }).retryStrategy!;
      expect(retry(1)).toBe(200);
      expect(retry(1_000)).toBe(REDIS_RETRY_CAP_MS);
      client.emit("error", new Error("connect ECONNREFUSED 127.0.0.1:1"));
      client.emit("error", new Error("connect ECONNREFUSED 127.0.0.1:1"));
      client.emit("error", new Error("connect ETIMEDOUT"));
      expect(lines).toHaveLength(2);
      expect(lines[0]!.msg).toMatch(/capped backoff/);
    } finally {
      client.disconnect();
    }
  });
});
