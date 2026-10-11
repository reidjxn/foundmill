import { EventEmitter } from "node:events";
import { Agent, createServer, request, type Server } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { drainHttpServer, flushLog, onShutdown, type ShutdownLog } from "./shutdown";

function memoryLog() {
  const lines: { level: string; obj: Record<string, unknown>; msg?: string }[] = [];
  const at = (level: string) => (obj: object, msg?: string) => void lines.push({ level, obj: obj as Record<string, unknown>, msg });
  const log: ShutdownLog = { info: at("info"), warn: at("warn"), error: at("error") };
  return { log, lines };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("onShutdown", () => {
  it("runs the steps in order on SIGTERM, logs each one and exits 0; a second signal does not start another run", async () => {
    const source = new EventEmitter();
    const exit = vi.fn();
    const order: string[] = [];
    const { log, lines } = memoryLog();
    const handle = onShutdown({
      service: "svc",
      log,
      source,
      exit,
      timeoutMs: 2_000,
      steps: [
        { name: "stop accepting", run: async () => void order.push("stop") },
        { name: "close db", run: () => void order.push("db") },
      ],
    });
    source.emit("SIGTERM");
    source.emit("SIGTERM");
    expect(handle.stopping).toBe(true);
    expect(await handle.shutdown("again")).toBe(0);
    expect(order).toEqual(["stop", "db"]);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(lines.map((l) => l.msg)).toEqual(["svc shutting down", "svc: already shutting down", "svc shutdown: stop accepting", "svc shutdown: close db", "svc shutdown complete"]);
    expect(lines[0]?.obj).toMatchObject({ reason: "SIGTERM", timeoutMs: 2_000 });
    handle.dispose();
  });

  it("a failing step is logged, the later steps still run, and the exit code is 1", async () => {
    const exit = vi.fn();
    const ran: string[] = [];
    const { log, lines } = memoryLog();
    const handle = onShutdown({
      service: "svc",
      log,
      source: new EventEmitter(),
      exit,
      steps: [
        { name: "drain", run: () => Promise.reject(new Error("boom")) },
        { name: "close redis", run: () => void ran.push("redis") },
      ],
    });
    expect(await handle.shutdown("SIGTERM")).toBe(1);
    expect(ran).toEqual(["redis"]);
    expect(exit).toHaveBeenCalledWith(1);
    expect(lines.find((l) => l.level === "error")?.obj).toMatchObject({ step: "drain", err: "boom" });
  });

  it("a step that never settles is cut off at the budget; what follows is skipped and the process still exits", async () => {
    const exit = vi.fn();
    const { log, lines } = memoryLog();
    const handle = onShutdown({
      service: "svc",
      log,
      source: new EventEmitter(),
      exit,
      timeoutMs: 150,
      steps: [
        { name: "hang", run: () => new Promise(() => undefined) },
        { name: "close db", run: () => undefined },
      ],
    });
    const started = Date.now();
    expect(await handle.shutdown("SIGTERM")).toBe(1);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(exit).toHaveBeenCalledWith(1);
    expect(lines.some((l) => l.level === "warn" && /hang did not finish in time/.test(l.msg ?? ""))).toBe(true);
    expect(lines.some((l) => /no time left for close db/.test(l.msg ?? ""))).toBe(true);
  });

  it("each step learns how much of the budget is left", async () => {
    const seen: number[] = [];
    const handle = onShutdown({
      service: "svc",
      log: memoryLog().log,
      source: new EventEmitter(),
      exit: () => undefined,
      timeoutMs: 1_000,
      steps: [
        { name: "a", run: async ({ remainingMs }) => void (seen.push(remainingMs), await sleep(100)) },
        { name: "b", run: ({ remainingMs }) => void seen.push(remainingMs) },
      ],
    });
    await handle.shutdown("SIGTERM");
    expect(seen[0]).toBeGreaterThan(950);
    expect(seen[1]).toBeLessThan(seen[0]! - 80);
  });

  it("a second SIGINT exits at once with 130 (Ctrl-C twice in development)", async () => {
    const source = new EventEmitter();
    const exit = vi.fn();
    const handle = onShutdown({ service: "svc", log: memoryLog().log, source, exit, steps: [{ name: "slow", run: () => sleep(200) }] });
    source.emit("SIGINT");
    source.emit("SIGINT");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(130));
    await handle.shutdown("SIGINT");
    handle.dispose();
  });

  it("flushes the logger before exiting, so the last lines are not lost", async () => {
    const events: string[] = [];
    const { log } = memoryLog();
    const flushing: ShutdownLog = { ...log, flush: (cb) => setTimeout(() => (events.push("flushed"), cb?.()), 20) };
    const handle = onShutdown({ service: "svc", log: flushing, source: new EventEmitter(), exit: (code) => void events.push(`exit ${code}`), steps: [] });
    await handle.shutdown("SIGTERM");
    expect(events).toEqual(["flushed", "exit 0"]);
  });

  it("flushLog gives up after its bound when the logger never calls back", async () => {
    const started = Date.now();
    await flushLog({ flush: () => undefined }, 50);
    expect(Date.now() - started).toBeLessThan(500);
    await flushLog({}); // no flush at all: resolves at once
  });

  it("dispose removes the signal handlers", () => {
    const source = new EventEmitter();
    const handle = onShutdown({ service: "svc", log: memoryLog().log, source, exit: () => undefined, steps: [] });
    expect(source.listenerCount("SIGTERM")).toBe(1);
    handle.dispose();
    expect(source.listenerCount("SIGTERM")).toBe(0);
    expect(source.listenerCount("SIGINT")).toBe(0);
  });
});

describe("drainHttpServer", () => {
  let server: Server | null = null;
  afterEach(async () => {
    server?.closeAllConnections();
    await new Promise<void>((r) => (server?.listening ? server.close(() => r()) : r()));
    server = null;
  });

  async function listen(handler: Parameters<typeof createServer>[1]): Promise<number> {
    server = createServer(handler);
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
    return (server.address() as AddressInfo).port;
  }

  /** GET over a keep-alive connection; resolves with the whole body once the response ends. */
  function get(port: number, path: string, agent: Agent): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path, agent }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (body += c));
        res.on("end", () => resolve(body));
        res.on("error", reject);
      });
      req.on("error", reject);
      req.end();
    });
  }

  const refused = (port: number) =>
    new Promise<string>((resolve) => {
      const s = connect(port, "127.0.0.1");
      s.on("connect", () => (s.destroy(), resolve("connected")));
      s.on("error", (e: NodeJS.ErrnoException) => resolve(e.code ?? "error"));
    });

  it("refuses new connections, lets a streamed answer finish in full, closes idle keep-alive sockets, then resolves", async () => {
    const port = await listen((req, res) => {
      if (req.url === "/stream") {
        res.writeHead(200, { "content-type": "text/plain" });
        let n = 0;
        const t = setInterval(() => {
          res.write(`chunk${n} `);
          n += 1;
          if (n === 6) {
            clearInterval(t);
            res.end("done");
          }
        }, 50);
        return;
      }
      res.end("ok");
    });
    const idleAgent = new Agent({ keepAlive: true });
    const streamAgent = new Agent({ keepAlive: true });
    expect(await get(port, "/", idleAgent)).toBe("ok"); // leaves an idle keep-alive socket
    const streamed = get(port, "/stream", streamAgent);
    await sleep(60); // the stream is under way

    const started = Date.now();
    const drained = drainHttpServer(server!, { timeoutMs: 5_000, pollMs: 20 });
    expect(await refused(port)).toBe("ECONNREFUSED");
    expect(await streamed).toBe("chunk0 chunk1 chunk2 chunk3 chunk4 chunk5 done");
    expect(await drained).toEqual({ forced: 0 });
    // Finished once the stream ended (about 300 ms), not after the 5 s keep-alive timeout of the idle sockets.
    expect(Date.now() - started).toBeLessThan(1_500);
    idleAgent.destroy();
    streamAgent.destroy();
  });

  it("cuts what is still open at the deadline and says how many connections it cut", async () => {
    const port = await listen((_req, res) => {
      res.writeHead(200);
      res.write("never ends");
    });
    const agent = new Agent({ keepAlive: true });
    const hung = get(port, "/", agent).catch((e: NodeJS.ErrnoException) => e.code ?? "error");
    await sleep(50);
    const started = Date.now();
    expect(await drainHttpServer(server!, { timeoutMs: 200 })).toEqual({ forced: 1 });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(await hung).toBe("ECONNRESET");
    agent.destroy();
  });
});
