import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createStreamRedis, probeRedis, REDIS_RETRY_CAP_MS, unreachableMessage } from "../redis";

const servers: Server[] = [];
const sockets = new Set<Socket>();
afterEach(async () => {
  for (const s of sockets) s.destroy();
  sockets.clear();
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
});

/** A TCP listener that accepts and never answers (a half-up Redis, a firewall). */
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
  it("reports a refused connection without throwing", async () => {
    const probe = await probeRedis("redis://127.0.0.1:1", 1_000);
    expect(probe.ok).toBe(false);
    expect(probe.reason).toMatch(/ECONNREFUSED|connect/i);
  });

  it("gives up within the timeout when nothing answers", async () => {
    const port = await silentPort();
    const started = Date.now();
    expect((await probeRedis(`redis://127.0.0.1:${port}`, 400)).ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("unreachableMessage", () => {
  it("names the consequence and the remedy and redacts credentials", () => {
    const msg = unreachableMessage("redis://default:hunter2@redis.railway.internal:6379", { ok: false, reason: "ECONNREFUSED" });
    expect(msg).toMatch(/unhealthy/);
    expect(msg).toMatch(/Start Redis/);
    expect(msg).not.toContain("hunter2");
  });
});

describe("createStreamRedis", () => {
  it("caps the reconnect backoff and logs identical errors once, then the recovery", () => {
    const lines: { level: string; msg?: string }[] = [];
    const client = createStreamRedis("redis://127.0.0.1:1", {
      warn: (_obj: unknown, msg?: string) => {
        lines.push({ level: "warn", msg });
      },
      info: (_obj: unknown, msg?: string) => {
        lines.push({ level: "info", msg });
      },
    });
    try {
      const retry = (client.options as { retryStrategy?: (times: number) => number | null }).retryStrategy!;
      expect(retry(1)).toBe(200);
      expect(retry(10_000)).toBe(REDIS_RETRY_CAP_MS);
      client.emit("error", new Error("connect ECONNREFUSED 127.0.0.1:1"));
      client.emit("error", new Error("connect ECONNREFUSED 127.0.0.1:1"));
      client.emit("error", new Error("connect ECONNREFUSED 127.0.0.1:1"));
      client.emit("ready");
      client.emit("error", new Error("connect ECONNREFUSED 127.0.0.1:1"));
      expect(lines.map((l) => l.level)).toEqual(["warn", "info", "warn"]);
      expect(lines[1]!.msg).toBe("redis reconnected");
    } finally {
      client.disconnect();
    }
  });
});
