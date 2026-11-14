/**
 * services/tx-gate.ts: one request can never take the whole pool (the api's pool wedge, 2026-11-12).
 *
 * The pool here is a model of postgres.js's: M slots, first come first served; a transaction holds a slot until its
 * callback settles, a probe (the watchdog's `select 1`, a relay's idle tick) needs a slot for an instant. The first
 * case reproduces what production did, without the gate: three batches of ten procedures on a pool of ten leave the
 * probe waiting. The rest show the same load through the gate: the probe always answers, clients that close their
 * request early leave nothing behind, and the gate never blocks for good.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { createTransactionGate, gateLimitsFor, RequestClosedError, Semaphore, ungated } from "../services/tx-gate";
import { createApiHarness, type ApiHarness } from "./harness";

const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A pool of `size` slots with a first-in, first-out queue, like postgres.js's. */
function fakePool(size: number) {
  let free = size;
  const queue: (() => void)[] = [];
  const stats = { started: 0, peakHeld: 0 };
  const take = (): Promise<void> =>
    new Promise((resolve) => {
      const grant = () => {
        free -= 1;
        stats.peakHeld = Math.max(stats.peakHeld, size - free);
        resolve();
      };
      if (free > 0) grant();
      else queue.push(grant);
    });
  const give = () => {
    free += 1;
    queue.shift()?.();
  };
  return {
    stats,
    get held() {
      return size - free;
    },
    /** A transaction: a slot for as long as `fn` runs. */
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      await take();
      stats.started += 1;
      try {
        return await fn();
      } finally {
        give();
      }
    },
    /** The watchdog's probe: resolves to how long it waited for a slot. */
    async probe(): Promise<number> {
      const from = Date.now();
      await take();
      give();
      return Date.now() - from;
    },
  };
}

/** One HTTP request: `procedures` transactions started together, each `workMs` long. */
function batch(db: { transaction: <T>(fn: () => Promise<T>) => Promise<T> }, procedures: number, workMs: number): Promise<PromiseSettledResult<void>[]> {
  return Promise.allSettled(Array.from({ length: procedures }, () => db.transaction(() => tick(workMs))));
}

describe("without the gate (what production did)", () => {
  it("three batches of ten procedures hold every connection of a pool of ten and the watchdog's probe waits behind them", async () => {
    const pool = fakePool(10);
    const requests = [batch(pool, 10, 60), batch(pool, 10, 60), batch(pool, 10, 60)];
    await tick(5);
    expect(pool.held).toBe(10);
    const waited = await pool.probe();
    // Behind twenty queued transactions: the probe gets a slot only once a whole batch has finished.
    expect(waited).toBeGreaterThanOrEqual(40);
    await Promise.all(requests);
  });
});

describe("the transaction gate", () => {
  it("limits follow the pool: all but a reserve of four for requests, four for one request", () => {
    expect(gateLimitsFor(10)).toEqual({ total: 6, perRequest: 4 });
    expect(gateLimitsFor(20)).toEqual({ total: 16, perRequest: 4 });
    expect(gateLimitsFor(5)).toEqual({ total: 1, perRequest: 1 });
  });

  it("the same three batches never hold more than six connections, one request never more than four, and the probe answers at once", async () => {
    const pool = fakePool(10);
    const gate = createTransactionGate(gateLimitsFor(10));
    const one = gate.forRequest(pool);
    const first = batch(one, 10, 30);
    await tick(5);
    expect(pool.held).toBe(4);
    const others = [batch(gate.forRequest(pool), 10, 30), batch(gate.forRequest(pool), 10, 30)];
    const waits: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      waits.push(await pool.probe());
      expect(pool.held).toBeLessThanOrEqual(6);
      await tick(10);
    }
    const results = (await Promise.all([first, ...others])).flat();
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(pool.stats.started).toBe(30);
    expect(pool.stats.peakHeld).toBeLessThanOrEqual(7); // six transactions and the probe
    expect(Math.max(...waits)).toBeLessThan(20);
    expect(gate.stats()).toMatchObject({ held: 0, waiting: 0, peak: 6, timeouts: 0, total: 6, perRequest: 4 });
  });

  it("a request the client closed starts no further transactions, and what it held comes back", async () => {
    const pool = fakePool(10);
    const gate = createTransactionGate(gateLimitsFor(10));
    const closed = new AbortController();
    const abandoned = batch(gate.forRequest(pool, closed.signal), 10, 40);
    await tick(5);
    // The client gives up 5 ms in (the phone app's early closes) and sends the batch again.
    closed.abort();
    const again = batch(gate.forRequest(pool), 10, 10);
    const results = await abandoned;
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(4);
    const refused = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(refused).toHaveLength(6);
    expect(refused.every((r) => r.reason instanceof RequestClosedError)).toBe(true);
    expect((await again).every((r) => r.status === "fulfilled")).toBe(true);
    // Four of the closed request and ten of its second attempt ran; the six that were still waiting never did.
    expect(pool.stats.started).toBe(14);
    expect(pool.held).toBe(0);
    expect(gate.stats()).toMatchObject({ held: 0, waiting: 0 });
    // A request already closed when it arrives starts nothing at all.
    const late = await batch(gate.forRequest(pool, closed.signal), 3, 1);
    expect(late.every((r) => r.status === "rejected")).toBe(true);
    expect(pool.stats.started).toBe(14);
  });

  it("many rounds of batches with early closes: the pool always recovers and the probe never waits long", async () => {
    const pool = fakePool(10);
    const gate = createTransactionGate(gateLimitsFor(10));
    let worst = 0;
    for (let round = 0; round < 15; round += 1) {
      const closes = [new AbortController(), new AbortController()];
      const running = [batch(gate.forRequest(pool, closes[0]!.signal), 10, 8), batch(gate.forRequest(pool, closes[1]!.signal), 8, 8), batch(gate.forRequest(pool), 10, 8)];
      await tick(2);
      closes[round % 2]!.abort();
      worst = Math.max(worst, await pool.probe());
      await Promise.all(running);
      expect(pool.held).toBe(0);
    }
    expect(worst).toBeLessThan(20);
    expect(pool.stats.peakHeld).toBeLessThanOrEqual(7);
    expect(gate.stats()).toMatchObject({ held: 0, waiting: 0, timeouts: 0 });
  });

  it("a transaction opened inside a gated one passes straight through (no wait on a permit its caller holds)", async () => {
    const pool = fakePool(10);
    const gate = createTransactionGate({ total: 2, perRequest: 1 });
    const db = gate.forRequest(pool);
    // One permit for the request, and the outer transaction holds it: the inner one must not wait for it.
    const order: string[] = [];
    await db.transaction(async () => {
      order.push("outer");
      await db.transaction(async () => {
        order.push("inner");
      });
    });
    expect(order).toEqual(["outer", "inner"]);
    expect(gate.stats()).toMatchObject({ held: 0, peak: 1 });
  });

  it("a wait is bounded: after it the transaction starts without a permit, and the gate says so", async () => {
    const pool = fakePool(10);
    const told: string[] = [];
    const gate = createTransactionGate({ total: 1, perRequest: 1, waitMs: 20, onTimeout: (which) => told.push(which) });
    let finish: () => void = () => undefined;
    // A transaction that does not finish (the leak the gate must not turn into a standstill).
    const stuck = gate.forRequest(pool).transaction(() => new Promise<void>((resolve) => (finish = resolve)));
    await tick(2);
    const from = Date.now();
    await gate.forRequest(pool).transaction(() => tick(1));
    expect(Date.now() - from).toBeGreaterThanOrEqual(18);
    expect(told).toEqual(["total"]);
    expect(gate.stats().timeouts).toBe(1);
    finish();
    await stuck;
    expect(gate.stats()).toMatchObject({ held: 0, waiting: 0 });
  });

  it("everything but `transaction` is the database itself", () => {
    const db = { name: "db", select: () => "rows", transaction: async () => undefined };
    const view = createTransactionGate({ total: 2, perRequest: 2 }).forRequest(db);
    expect(view.select()).toBe("rows");
    expect(view.name).toBe("db");
    expect(Object.getPrototypeOf(view)).toBe(db);
  });

  it("work a request leaves running gets the database behind its view, which a closed request does not stop", async () => {
    const pool = fakePool(4);
    const closed = new AbortController();
    const view = createTransactionGate({ total: 2, perRequest: 2 }).forRequest(pool, closed.signal);
    closed.abort();
    await expect(view.transaction(async () => undefined)).rejects.toBeInstanceOf(RequestClosedError);
    expect(ungated(view)).toBe(pool);
    await expect(ungated(view).transaction(async () => "done")).resolves.toBe("done");
    // Anything that is not a request's view is itself.
    expect(ungated(pool)).toBe(pool);
  });
});

describe("Semaphore", () => {
  it("grants in arrival order and gives a permit back only once", async () => {
    const s = new Semaphore(1);
    const a = await s.acquire(1_000);
    const order: number[] = [];
    const b = s.acquire(1_000).then((p) => (order.push(1), p));
    const c = s.acquire(1_000).then((p) => (order.push(2), p));
    a.release();
    a.release();
    const first = await b;
    expect(s.held).toBe(1);
    first.release();
    (await c).release();
    expect(order).toEqual([1, 2]);
    expect(s.held).toBe(0);
  });
});

/**
 * Through the app: one HTTP batch of ten procedures, each of which opens its own RLS transaction. Counted where the
 * request's transactions reach the database (before PGlite serializes them), so the count is what a pool would hold.
 */
describe("an HTTP batch through the gate", () => {
  let hz: ApiHarness;
  const READS = ["business.get", "department.list", "inbox.list", "finance.overview", "cycle.status", "cycle.continueState", "team.agents.list", "product.roadmap.list", "product.foundations.get", "billing.plan"];

  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "tx-gate" });
  }, 120_000);
  afterAll(() => hz?.close());

  /** The harness's database with its transactions counted, and an app over it with or without the gate. */
  function counted(gated: boolean) {
    const count = { inFlight: 0, peak: 0, started: 0 };
    const base = hz.db;
    const db = Object.create(base, {
      transaction: {
        value: async (...args: unknown[]) => {
          count.inFlight += 1;
          count.started += 1;
          count.peak = Math.max(count.peak, count.inFlight);
          try {
            return await (base.transaction as (...a: unknown[]) => Promise<unknown>).apply(base, args);
          } finally {
            count.inFlight -= 1;
          }
        },
      },
    }) as typeof base;
    const owner = { userId: hz.A.ownerId, email: null, authenticatedAt: new Date() };
    const gate = gated ? createTransactionGate(gateLimitsFor(10)) : null;
    const app = createApp({ ...hz.deps, db, txGate: gate, auth: { ...hz.deps.auth, resolve: async () => owner, verify: async () => owner } });
    const input = Object.fromEntries(READS.map((_, i) => [String(i), { json: { businessId: hz.A.businessId } }]));
    const send = (signal?: AbortSignal) => app.request(`/trpc/${READS.join(",")}?batch=1&input=${encodeURIComponent(JSON.stringify(input))}`, { headers: { authorization: "Bearer x" }, ...(signal ? { signal } : {}) });
    return { count, gate, send };
  }

  it("without the gate, one batch of ten opens ten transactions at once", async () => {
    const { count, send } = counted(false);
    const res = await send();
    expect(res.status).toBe(200);
    expect(count.peak).toBeGreaterThanOrEqual(10);
  });

  it("with it, the same batch holds four at a time and every procedure still answers", async () => {
    const { count, gate, send } = counted(true);
    const res = await send();
    expect(res.status).toBe(200);
    expect(((await res.json()) as Array<{ error?: unknown }>).filter((r) => r.error)).toEqual([]);
    expect(count.peak).toBe(4);
    expect(count.started).toBeGreaterThanOrEqual(10);
    expect(gate!.stats()).toMatchObject({ held: 0, waiting: 0, peak: 4, timeouts: 0 });
  });

  it("two batches at once hold six between them, the pool's ten less the reserve", async () => {
    const { count, gate, send } = counted(true);
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(count.peak).toBe(6);
    expect(gate!.stats()).toMatchObject({ held: 0, waiting: 0, peak: 6 });
  });

  it("a batch the client closes early leaves no permit behind, and the next batch answers in full", async () => {
    const { count, gate, send } = counted(true);
    for (const closeAfterMs of [0, 2, 10]) {
      const closed = new AbortController();
      const abandoned = Promise.resolve(send(closed.signal)).catch(() => null);
      await tick(closeAfterMs);
      closed.abort();
      await abandoned;
    }
    // Whatever the closed batches had started has finished; nothing of theirs waits or holds a permit.
    await tick(50);
    expect(count.inFlight).toBe(0);
    expect(gate!.stats()).toMatchObject({ held: 0, waiting: 0, timeouts: 0 });
    const res = await send();
    expect(res.status).toBe(200);
    expect(((await res.json()) as Array<{ error?: unknown }>).filter((r) => r.error)).toEqual([]);
  });
});
