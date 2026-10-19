/** The pool watchdog's decisions (no network: the probes are injected). */
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeDb, createDb, createPoolWatchdog, watchPoolOrExit } from "../index";

const url = "postgres://user:pass@127.0.0.1:1/founder_manager";
const dbs: ReturnType<typeof createDb>[] = [];
function pooled() {
  const db = createDb(url, { max: 1 });
  dbs.push(db);
  return db;
}
afterEach(async () => {
  vi.useRealTimers();
  for (const db of dbs.splice(0)) await closeDb(db);
});

const never = () => new Promise<never>(() => undefined);
const ok = () => Promise.resolve(1);

describe("createPoolWatchdog", () => {
  it("stays ok while the pool answers, and resets the strike count on an answer", async () => {
    let answers = true;
    const onWedged = vi.fn();
    const w = createPoolWatchdog({ db: pooled(), url, poolProbe: () => (answers ? ok() : Promise.reject(new Error("boom"))), directProbe: ok, strikes: 3, onWedged });
    expect((await w.check()).state).toBe("ok");
    answers = false;
    expect((await w.check())).toMatchObject({ state: "degraded", strikes: 1, lastError: "boom" });
    answers = true;
    expect((await w.check())).toMatchObject({ state: "ok", strikes: 0, lastError: null });
    expect(onWedged).not.toHaveBeenCalled();
    w.stop();
  });

  it("after the strikes, a database that answers outside the pool means the pool is wedged: reported once", async () => {
    vi.useFakeTimers();
    const onWedged = vi.fn();
    const direct = vi.fn(ok);
    const w = createPoolWatchdog({ db: pooled(), url, poolProbe: never, directProbe: direct, strikes: 3, probeTimeoutMs: 50, onWedged });
    for (let i = 1; i <= 2; i++) {
      const round = w.check();
      await vi.advanceTimersByTimeAsync(60);
      expect(await round).toMatchObject({ state: "degraded", strikes: i });
    }
    expect(direct).not.toHaveBeenCalled();
    let round = w.check();
    await vi.advanceTimersByTimeAsync(60);
    expect(await round).toMatchObject({ state: "wedged", strikes: 3 });
    expect(onWedged).toHaveBeenCalledTimes(1);
    expect(onWedged.mock.calls[0]?.[0]).toMatchObject({ state: "wedged", lastError: "no answer within 50 ms" });
    // Another miss keeps the state and does not report again.
    round = w.check();
    await vi.advanceTimersByTimeAsync(60);
    expect((await round).state).toBe("wedged");
    expect(onWedged).toHaveBeenCalledTimes(1);
    w.stop();
  });

  it("a database that does not answer outside the pool either is down, not wedged: nothing exits", async () => {
    const onWedged = vi.fn();
    const onDown = vi.fn();
    const w = createPoolWatchdog({ db: pooled(), url, poolProbe: () => Promise.reject(new Error("ECONNREFUSED")), directProbe: () => Promise.reject(new Error("ECONNREFUSED")), strikes: 2, onWedged, onDown });
    await w.check();
    expect((await w.check())).toMatchObject({ state: "down", strikes: 2, lastError: "outside the pool too: ECONNREFUSED" });
    expect(onWedged).not.toHaveBeenCalled();
    expect(onDown).toHaveBeenCalledTimes(1);
    w.stop();
  });

  it("without a connection string there is no outside probe, so a silent pool reads as down", async () => {
    const onWedged = vi.fn();
    const w = createPoolWatchdog({ db: pooled(), poolProbe: () => Promise.reject(new Error("x")), strikes: 1, onWedged });
    expect((await w.check()).state).toBe("down");
    expect(onWedged).not.toHaveBeenCalled();
    w.stop();
  });

  it("runs on its interval, one round at a time", async () => {
    vi.useFakeTimers();
    const probe = vi.fn(ok);
    const w = createPoolWatchdog({ db: pooled(), url, poolProbe: probe, directProbe: ok, intervalMs: 1_000, onWedged: () => undefined });
    expect(probe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3_050);
    expect(probe).toHaveBeenCalledTimes(3);
    w.stop();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it("is a no-op on PGlite (no pool to wedge)", async () => {
    const db = createDb("pglite::memory:");
    const w = createPoolWatchdog({ db, url: null, onWedged: () => undefined });
    expect((await w.check()).state).toBe("unwatched");
    w.stop();
    await closeDb(db);
  });
});

describe("watchPoolOrExit", () => {
  it("logs and exits with 1 on a wedged pool, after a delay for the log line; a database that is down is only logged", async () => {
    vi.useFakeTimers();
    const log = { error: vi.fn(), warn: vi.fn() };
    const exit = vi.fn();
    const w = watchPoolOrExit({ db: pooled(), url, service: "api", log, exit, exitDelayMs: 100, poolProbe: () => Promise.reject(new Error("x")), directProbe: ok, strikes: 1 });
    await w.check();
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ service: "api", pool: expect.objectContaining({ state: "wedged" }) }), expect.stringMatching(/exiting so the platform restarts/));
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(exit).toHaveBeenCalledWith(1);
    w.stop();

    const down = watchPoolOrExit({ db: pooled(), url, service: "api", log, exit, poolProbe: () => Promise.reject(new Error("x")), directProbe: () => Promise.reject(new Error("x")), strikes: 1 });
    await down.check();
    await down.check();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    down.stop();
  });
});
