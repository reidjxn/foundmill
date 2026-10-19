/** createDb/createServiceDb construction and env handling (no network: nothing is connected until a query runs). */
import { createServer, type Server, type Socket } from "node:net";
import { resetEnvCache } from "@foundmill/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeDb, createDb, createServiceDb, keepPoolWarm, MIGRATIONS_DIR, postgresConnection, warmPool, type Db } from "../index";

afterEach(() => {
  delete process.env.DATABASE_URL;
  resetEnvCache();
});

describe("createDb", () => {
  it("builds a Drizzle database over postgres.js without connecting, and closes cleanly", async () => {
    const db = createDb("postgres://user:pass@127.0.0.1:1/founder_manager", { max: 1 });
    expect(db.$client).toBeDefined();
    expect(typeof db.transaction).toBe("function");
    await closeDb(db);
  });
  it("rejects an empty connection string", () => {
    expect(() => createDb("")).toThrow(/connection string/);
  });
  it("createServiceDb reads DATABASE_URL through loadEnv and fails loudly when unset", async () => {
    resetEnvCache();
    expect(() => createServiceDb()).toThrow(/DATABASE_URL/);
    process.env.DATABASE_URL = "postgres://user:pass@127.0.0.1:1/founder_manager";
    resetEnvCache();
    const db = createServiceDb({ max: 1 });
    await closeDb(db);
  });
  it("turns prepared statements off for every transaction pooler, and never sends client-only parameters to the server", async () => {
    // Supabase's shared pooler and its dedicated pooler (port 6543) run PgBouncer in transaction mode.
    expect(postgresConnection("postgresql://u:p@aws-0-eu-north-1.pooler.supabase.com:6543/postgres?sslmode=require")).toEqual({ url: "postgresql://u:p@aws-0-eu-north-1.pooler.supabase.com:6543/postgres?sslmode=require", transactionPooler: true });
    expect(postgresConnection("postgresql://u:p@db.abcd.supabase.co:6543/postgres").transactionPooler).toBe(true);
    expect(postgresConnection("postgresql://u:p@db.abcd.supabase.co:5432/postgres").transactionPooler).toBe(false);
    // A Prisma-style URL: `pgbouncer=true` marks the pooler but would reach Postgres as an unknown startup parameter.
    const prisma = postgresConnection("postgresql://u:p@db.abcd.supabase.co:5432/postgres?pgbouncer=true&connection_limit=1&sslmode=require");
    expect(prisma).toEqual({ url: "postgresql://u:p@db.abcd.supabase.co:5432/postgres?sslmode=require", transactionPooler: true });
    const db = createDb("postgres://user:pass@127.0.0.1:1/founder_manager?pgbouncer=true&sslmode=disable", { max: 1 });
    const options = (db.$client as unknown as { options: { prepare: boolean; connection: Record<string, unknown> } }).options;
    expect(options.prepare).toBe(false);
    expect(options.connection).not.toHaveProperty("pgbouncer");
    await closeDb(db);
  });
  it("never renews a direct connection, never closes an idle one, bounds statements and idle transactions server-side, and gives a connect five seconds", async () => {
    const db = createDb("postgres://user:pass@127.0.0.1:1/founder_manager", { max: 2 });
    const options = (db.$client as unknown as { options: { max_lifetime: unknown; idle_timeout: unknown; connect_timeout: number; connection: Record<string, string> } }).options;
    // Until 2026-10-15 postgres.js's defaults applied: 30-60 minutes, so a quiet half hour left every connection cold.
    // Since 2026-10-19 a direct connection is never renewed at all: renewal during use lost the connection for good.
    expect(options.max_lifetime).toBeNull();
    expect(options.idle_timeout ?? null).toBeNull();
    expect(options.connect_timeout).toBe(5);
    expect(options.connection).toMatchObject({ statement_timeout: "300000", idle_in_transaction_session_timeout: "120000" });
    await closeDb(db);
    const custom = createDb("postgres://user:pass@127.0.0.1:1/founder_manager", { max: 1, maxLifetime: 3600, connectTimeout: 2, statementTimeoutMs: null, idleInTransactionTimeoutMs: 1000 });
    const o = (custom.$client as unknown as { options: { max_lifetime: unknown; connect_timeout: number; connection: Record<string, string> } }).options;
    expect(o.max_lifetime).toBe(3600);
    expect(o.connect_timeout).toBe(2);
    expect(o.connection).toMatchObject({ idle_in_transaction_session_timeout: "1000" });
    expect(o.connection).not.toHaveProperty("statement_timeout");
    await closeDb(custom);
  });
  it("through a transaction pooler, renews each connection after six to seven hours of its own and sends no startup parameters", async () => {
    const db = createDb("postgres://user:pass@127.0.0.1:6543/founder_manager", { max: 2 });
    const options = (db.$client as unknown as { options: { max_lifetime: unknown; connection: Record<string, string> } }).options;
    expect(typeof options.max_lifetime).toBe("function");
    const lifetimes = Array.from({ length: 50 }, () => (options.max_lifetime as () => number)());
    expect(Math.min(...lifetimes)).toBeGreaterThanOrEqual(6 * 3600);
    expect(Math.max(...lifetimes)).toBeLessThanOrEqual(7 * 3600);
    expect(new Set(lifetimes).size).toBeGreaterThan(1);
    expect(options.connection).not.toHaveProperty("statement_timeout");
    expect(options.connection).not.toHaveProperty("idle_in_transaction_session_timeout");
    await closeDb(db);
  });
  it("fails a connect that stalls after the connect timeout instead of hanging for 30 seconds", async () => {
    // A server that accepts the TCP connection and never answers the startup message (a stalled pooler).
    const sockets: Socket[] = [];
    const server: Server = createServer((socket) => void sockets.push(socket));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const db = createDb(`postgres://user:pass@127.0.0.1:${port}/founder_manager`, { max: 1, connectTimeout: 1 });
    const started = Date.now();
    try {
      await expect((db.$client as unknown as { unsafe(q: string): Promise<unknown> }).unsafe("select 1")).rejects.toMatchObject({ code: "CONNECT_TIMEOUT" });
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      await closeDb(db);
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("exposes MIGRATIONS_DIR pointing at packages/db/migrations", () => {
    expect(MIGRATIONS_DIR.replace(/\\/g, "/")).toMatch(/packages\/db\/migrations$/);
  });
});

describe("warmPool / keepPoolWarm", () => {
  const stub = (fail = false) => {
    const unsafe = vi.fn((query: string) => (fail ? Promise.reject(new Error("connection refused")) : Promise.resolve([{ query }])));
    return { db: { $client: { unsafe } } as unknown as Db, unsafe };
  };

  it("sends that many `select 1` at once (postgres.js gives each to an idle connection, else opens one) and says how many answered", async () => {
    const { db, unsafe } = stub();
    expect(await warmPool(db, 3)).toBe(3);
    expect(unsafe.mock.calls).toEqual([["select 1"], ["select 1"], ["select 1"]]);
    const errors: unknown[] = [];
    expect(await warmPool(stub(true).db, 2, (err) => errors.push(err))).toBe(0);
    expect(errors).toHaveLength(1);
    // Nothing to warm: a database without a pool, or none asked for.
    expect(await warmPool({} as Db, 3)).toBe(0);
    expect(await warmPool(db, 0)).toBe(0);
  });

  it("is a no-op on PGlite, one in-process connection", async () => {
    const db = createDb("pglite::memory:");
    expect(await warmPool(db, 4)).toBe(0);
    await closeDb(db);
  });

  it("a probe that never answers counts as failed after the timeout and is reported as a possibly wedged pool", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const unsafe = vi.fn(() => (++calls % 2 === 0 ? new Promise<never>(() => undefined) : Promise.resolve([{}])));
      const db = { $client: { unsafe } } as unknown as Db;
      const errors: Error[] = [];
      const round = warmPool(db, 4, (err) => errors.push(err as Error), 1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await round).toBe(2);
      expect(errors.map((e) => e.message)).toEqual(["2 of 4 warm-up queries did not answer within 1000 ms: a pooled connection may be wedged"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not start a round while the previous one is still waiting", async () => {
    vi.useFakeTimers();
    try {
      const unsafe = vi.fn(() => new Promise<never>(() => undefined));
      const db = { $client: { unsafe } } as unknown as Db;
      const warmer = keepPoolWarm(db, { connections: 2, intervalMs: 1_000, probeTimeoutMs: 5_000 });
      await vi.advanceTimersByTimeAsync(3_000);
      expect(unsafe).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(unsafe).toHaveBeenCalledTimes(4);
      warmer.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("warms at once and again on every interval until stopped", async () => {
    vi.useFakeTimers();
    try {
      const { db, unsafe } = stub();
      const warmer = keepPoolWarm(db, { connections: 2, intervalMs: 60_000 });
      expect(await warmer.ready).toBe(2);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(unsafe).toHaveBeenCalledTimes(4);
      warmer.stop();
      await vi.advanceTimersByTimeAsync(180_000);
      expect(unsafe).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });
});
