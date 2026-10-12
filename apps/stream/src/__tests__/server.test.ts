/**
 * Server behaviour over real sockets on ephemeral ports: the Gate 0 "outbox → stream round trip", membership
 * denial, idempotent sub/unsub, ping/pong, bad frames, 401 on a bad token, /health, coalescing to 20 frames/s,
 * heartbeat timeouts, Redis reader reconnects and graceful shutdown.
 */
import { createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { MemoryRedis, publishSessionEvent, runOutboxRelay, writeEvent, type RedisArg, type SessionEvent } from "@foundmill/events";
import { FakeDb } from "@foundmill/events/testing/fake-db";
import { EVENT_FIXTURES, FIXTURE_ENTITY_ID, fixtureId } from "@foundmill/events/testing/fixtures";
import { afterEach, describe, expect, it } from "vitest";
import { createTokenVerifier } from "../auth";
import { businessChannel, CLOSE_CODES, sessionChannel } from "../protocol";
import { BUSINESS_A, BUSINESS_B, devToken, openSocket, SESSION_A, SESSION_A2, SESSION_B, sleep, startTestServer, USER_A, USER_B, waitFor, type TestServer, type TestSocket } from "./helpers";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function boot(opts: Parameters<typeof startTestServer>[0] = {}): Promise<TestServer> {
  const t = await startTestServer(opts);
  cleanups.push(() => t.close());
  return t;
}

async function connect(t: TestServer, userId = USER_A): Promise<TestSocket> {
  const s = await openSocket(t.url, devToken(userId));
  cleanups.push(() => s.close());
  return s;
}

const note = (text: string): SessionEvent => ({ kind: "note", at: new Date().toISOString(), level: "info", source: "agent", text });

describe("Gate 0: outbox → relay → redis → socket round trip", () => {
  it("delivers an event committed through the outbox to a subscribed tab as the same JSON", async () => {
    const db = new FakeDb();
    const t = await boot();
    const relay = runOutboxRelay(db, t.redis, { intervalMs: 5 });
    cleanups.push(() => relay.stop());

    const sock = await connect(t);
    sock.sub(businessChannel(BUSINESS_A));
    await waitFor(() => t.server.hub.readerCount === 1, 2_000, "reader started");

    const eventId = await db.transaction((tx) =>
      writeEvent(tx, {
        businessId: BUSINESS_A,
        type: "payment.received",
        actor: { kind: "webhook", id: "stripe" },
        entityIds: [FIXTURE_ENTITY_ID],
        payload: EVENT_FIXTURES["payment.received"],
        occurredAt: "2026-10-05T09:00:00.000Z",
        id: fixtureId("roundtrip-stream"),
      }),
    );

    await waitFor(() => sock.events.length === 1, 3_000, "event delivered");
    const frame = sock.events[0]!;
    expect(frame.ch).toBe(businessChannel(BUSINESS_A));
    expect(frame.e).toMatchObject({ id: eventId, businessId: BUSINESS_A, type: "payment.received", occurredAt: "2026-10-05T09:00:00.000Z" });
    expect((frame.e as { payload: { amount: unknown } }).payload.amount).toEqual({ amountMinor: 4900, currency: "EUR" });
    expect(t.metrics.get("events_in_total")).toBe(1);
    expect(t.metrics.get("frames_out_total")).toBe(1);

    // A rolled-back write never reaches the tab.
    await expect(
      db.transaction(async (tx) => {
        await writeEvent(tx, { businessId: BUSINESS_A, type: "cycle.started", actor: { kind: "system", id: "t" }, payload: EVENT_FIXTURES["cycle.started"] });
        throw new Error("business change failed");
      }),
    ).rejects.toThrow(/business change failed/);
    await sleep(40);
    expect(sock.events).toHaveLength(1);
  });

  it("only streams events published after the subscription ($ tail) and fans one stream out to every socket", async () => {
    const t = await boot();
    await publishSessionEvent(t.redis, SESSION_A, note("before anyone subscribed"));
    const a = await connect(t);
    const b = await connect(t);
    a.sub(sessionChannel(SESSION_A));
    b.sub(sessionChannel(SESSION_A));
    await waitFor(() => t.server.subscriptions().every((s) => s.channels.length === 1), 2_000, "both subscribed");
    expect(t.server.hub.readerCount).toBe(1); // one reader shared by two sockets
    await publishSessionEvent(t.redis, SESSION_A, note("live"));
    await waitFor(() => a.events.length === 1 && b.events.length === 1, 2_000, "both got the live event");
    expect((a.events[0]!.e as SessionEvent).kind).toBe("note");
    expect((a.events[0]!.e as { text: string }).text).toBe("live");
    expect(b.events[0]).toEqual(a.events[0]);
    await a.close();
    expect(t.server.hub.readerCount).toBe(1);
    await b.close();
    await waitFor(() => t.server.hub.readerCount === 0, 2_000, "reader stopped when the last socket left");
  });
});

describe("membership", () => {
  it("denies a subscription to another business or its sessions with an err frame and streams nothing", async () => {
    const t = await boot();
    const sock = await connect(t, USER_B);
    sock.sub(businessChannel(BUSINESS_A));
    sock.sub(sessionChannel(SESSION_A));
    sock.sub(businessChannel(BUSINESS_B));
    await waitFor(() => sock.errors.length === 2 && t.server.subscriptions()[0]?.channels.length === 1, 2_000, "two denials, one allowed");
    expect(sock.errors.map((e) => [e.ch, e.code])).toEqual([
      [businessChannel(BUSINESS_A), "forbidden"],
      [sessionChannel(SESSION_A), "forbidden"],
    ]);
    expect(t.server.subscriptions()[0]!.channels).toEqual([businessChannel(BUSINESS_B)]);
    // Only the allowed channel is acknowledged as live; a tab never trusts a denied one.
    await waitFor(() => sock.subscribed.length === 1, 2_000, "ack");
    expect(sock.subscribed).toEqual([businessChannel(BUSINESS_B)]);
    await publishSessionEvent(t.redis, SESSION_A, note("secret"));
    await publishSessionEvent(t.redis, SESSION_B, note("mine"));
    await sleep(60);
    expect(sock.events).toHaveLength(0);
    expect(t.metrics.get("subscriptions_denied_total")).toBe(2);
    expect(t.server.hub.keys()).toEqual([businessChannel(BUSINESS_B)]);
  });

  it("rejects malformed channels and caps subscriptions per socket", async () => {
    const t = await boot({ options: { maxSubscriptionsPerSocket: 2 } });
    const sock = await connect(t);
    sock.sub("ev:*");
    sock.sub(businessChannel(BUSINESS_A));
    sock.sub(sessionChannel(SESSION_A));
    sock.sub(sessionChannel(fixtureId("session-c")));
    await waitFor(() => sock.errors.length === 2, 2_000, "two errors");
    expect(sock.errors[0]).toMatchObject({ code: "invalid_channel", ch: "ev:*" });
    expect(sock.errors[1]).toMatchObject({ code: "too_many_subscriptions" });
  });

  it("refuses the upgrade with 401 when the token does not verify and no dev bypass exists", async () => {
    const pair = await generateKeyPair("ES256");
    const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k", alg: "ES256" }] });
    const t = await boot({ auth: createTokenVerifier({ appEnv: "production", jwks }) });
    await expect(openSocket(t.url, "not-a-token")).rejects.toThrow(/401/);
    await expect(openSocket(t.url, null)).rejects.toThrow(/401/);
    expect(t.metrics.get("auth_failures_total")).toBe(2);
    expect(t.server.connections).toBe(0);
  });
});

describe("protocol handling", () => {
  it("answers ping with pong, treats sub as idempotent and stops streaming after unsub", async () => {
    const t = await boot();
    const sock = await connect(t);
    sock.send({ t: "ping" });
    await waitFor(() => sock.frames.some((f) => (f as { t?: string }).t === "pong"), 2_000, "pong");
    sock.sub(sessionChannel(SESSION_A));
    sock.sub(sessionChannel(SESSION_A));
    sock.sub(sessionChannel(SESSION_A));
    await waitFor(() => t.server.subscriptions()[0]?.channels.length === 1, 2_000, "subscribed once");
    // Each sub is acknowledged (a repeat of a live channel again, so a tab that re-asks after an error learns it is live).
    await waitFor(() => sock.subscribed.length >= 1, 2_000, "ack");
    sock.sub(sessionChannel(SESSION_A));
    await waitFor(() => sock.subscribed.length >= 2, 2_000, "second ack");
    expect(new Set(sock.subscribed)).toEqual(new Set([sessionChannel(SESSION_A)]));
    await publishSessionEvent(t.redis, SESSION_A, note("one"));
    await waitFor(() => sock.events.length === 1, 2_000, "one event");
    expect(sock.events).toHaveLength(1); // not duplicated by the repeated subs
    sock.unsub(sessionChannel(SESSION_A));
    await waitFor(() => t.server.subscriptions()[0]?.channels.length === 0, 2_000, "unsubscribed");
    await publishSessionEvent(t.redis, SESSION_A, note("two"));
    await sleep(60);
    expect(sock.events).toHaveLength(1);
    expect(t.metrics.get("subscriptions_open")).toBe(0);
  });

  it("counts a sub without a focus field as focused, focus:false as unfocused, and follows focus frames (RES-12)", async () => {
    const t = await boot();
    const sock = await connect(t);
    sock.sub(sessionChannel(SESSION_A)); // what both clients send for the focused tile
    sock.sub(sessionChannel(SESSION_A2), false);
    await waitFor(() => t.server.subscriptions()[0]?.channels.length === 2, 2_000, "both subscribed");
    expect(t.server.subscriptions()[0]!.focused).toEqual([sessionChannel(SESSION_A)]);
    sock.send({ t: "focus", ch: sessionChannel(SESSION_A), focused: false });
    sock.send({ t: "focus", ch: sessionChannel(SESSION_A2), focused: true });
    await waitFor(() => t.server.subscriptions()[0]!.focused.join() === sessionChannel(SESSION_A2), 2_000, "focus moved");
  });

  it("reports malformed frames and closes the socket after too many", async () => {
    const t = await boot({ options: { maxBadFrames: 3 } });
    const sock = await connect(t);
    sock.ws.send("not json");
    sock.ws.send(JSON.stringify({ t: "publish", ch: "x" }));
    await waitFor(() => sock.errors.length === 2, 2_000, "two bad_frame errors");
    expect(sock.errors.every((e) => e.code === "bad_frame")).toBe(true);
    sock.ws.send("{}");
    const closed = await sock.closed;
    expect(closed.code).toBe(CLOSE_CODES.policyViolation);
    expect(t.metrics.get("bad_frames_total")).toBe(3);
  });

  it("serves health with counters on the same port and 404s elsewhere", async () => {
    const t = await boot();
    const sock = await connect(t);
    sock.sub(sessionChannel(SESSION_A));
    await waitFor(() => t.server.subscriptions()[0]?.channels.length === 1, 2_000, "subscribed");
    const res = await fetch(`http://127.0.0.1:${t.port}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; app: string; service: string; redis: boolean; metrics: { gauges: Record<string, number>; counters: Record<string, number> } };
    expect(body).toMatchObject({ ok: true, app: "Foundmill", service: "stream", redis: true });
    expect(body.metrics.gauges).toMatchObject({ connections_open: 1, subscriptions_open: 1, readers_open: 1 });
    expect(body.metrics.counters.connections_total).toBe(1);
    const missing = await fetch(`http://127.0.0.1:${t.port}/nope`);
    expect(missing.status).toBe(404);
  });
});

describe("coalescing and backpressure", () => {
  it("coalesces a burst into at most 20 frames per second without losing or reordering events", async () => {
    const t = await boot();
    const sock = await connect(t);
    sock.sub(sessionChannel(SESSION_A));
    await waitFor(() => t.server.hub.readerCount === 1, 2_000, "reader");
    const N = 400;
    const start = Date.now();
    for (let i = 0; i < N; i++) await publishSessionEvent(t.redis, SESSION_A, note(`burst ${i}`));
    await waitFor(() => sock.events.length === N, 5_000, "all events");
    const elapsedS = (Date.now() - start) / 1000;
    // Event frames only (the subscription's ack is a control frame written outside the queue).
    const frames = sock.frames.filter((f) => (f as { t?: string }).t === undefined).length;
    expect(frames).toBeLessThanOrEqual(Math.ceil(elapsedS * 20) + 2);
    expect(frames).toBeLessThan(N / 4); // bursts were batched into array frames
    expect(t.metrics.get("batches_out_total")).toBeGreaterThan(0);
    expect(sock.events.map((f) => (f.e as { text: string }).text)).toEqual(Array.from({ length: N }, (_, i) => `burst ${i}`));
    expect(t.metrics.get("events_dropped_total")).toBe(0);
  });

  it("sends the first event of an idle socket immediately rather than waiting for a tick", async () => {
    // One frame per second makes the tick 1 s, so "sent at once" and "waited for the tick" are 500 ms apart even on a
    // loaded CI runner (a 45 ms bound against the default 50 ms tick failed under load).
    const t = await boot({ options: { queue: { framesPerSecond: 1 } } });
    const sock = await connect(t);
    sock.sub(sessionChannel(SESSION_A));
    await waitFor(() => t.server.hub.readerCount === 1, 2_000, "reader");
    const t0 = performance.now();
    await publishSessionEvent(t.redis, SESSION_A, note("fast"));
    await waitFor(() => sock.events.length === 1, 2_000, "event");
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe("liveness", () => {
  it("terminates a socket that stops answering pings", async () => {
    const t = await boot({ options: { heartbeatMs: 60 } });
    const sock = await connect(t);
    // Pausing the TCP socket means the client never sees the server's ping and so never pongs.
    (sock.ws as unknown as { _socket: { pause(): void } })._socket.pause();
    await waitFor(() => t.metrics.get("heartbeat_timeouts_total") === 1, 2_000, "heartbeat timeout");
    await waitFor(() => t.server.connections === 0, 2_000, "socket removed");
    // The paused client never reads the server's FIN; drop it so the cleanup does not wait on ws's 30 s close timeout.
    sock.ws.terminate();
    await sock.closed;
  });

  it("closes every socket with 1001 on shutdown and refuses new upgrades", async () => {
    const t = await boot();
    const sock = await openSocket(t.url, devToken(USER_A));
    sock.sub(sessionChannel(SESSION_A));
    await waitFor(() => t.server.hub.readerCount === 1, 2_000, "reader");
    await t.close();
    const closed = await sock.closed;
    expect(closed.code).toBe(CLOSE_CODES.goingAway);
    expect(t.server.hub.readerCount).toBe(0);
    expect(t.server.connections).toBe(0);
    await expect(openSocket(t.url, devToken(USER_A))).rejects.toThrow();
  });
});

describe("redis reader reconnect", () => {
  it("retries after read errors and resumes from the last seen id without a gap", async () => {
    const base = new MemoryRedis();
    let failing = false;
    let failures = 0;
    class FlakyRedis extends MemoryRedis {
      override async xread(...args: RedisArg[]): Promise<unknown> {
        if (failing) {
          failures++;
          throw new Error("ECONNRESET");
        }
        return super.xread(...args);
      }
      override duplicate(): FlakyRedis {
        return new FlakyRedis(this.store);
      }
    }
    const flaky = new FlakyRedis(base.store);
    const t = await boot({ redis: flaky });
    const sock = await connect(t);
    sock.sub(sessionChannel(SESSION_A));
    await waitFor(() => t.server.hub.readerCount === 1, 2_000, "reader");
    await publishSessionEvent(flaky, SESSION_A, note("first"));
    await waitFor(() => sock.events.length === 1, 2_000, "first event");

    failing = true;
    await waitFor(() => failures >= 3, 2_000, "reader retried");
    expect(t.server.hub.healthy).toBe(false);
    const health = await t.server.health();
    expect(health.ok).toBe(false);
    // Published while the reader is down: must arrive once it recovers (resume from the last id, not "$").
    await publishSessionEvent(flaky, SESSION_A, note("during outage"));
    failing = false;
    await waitFor(() => sock.events.length === 2, 3_000, "event from the outage window");
    expect((sock.events[1]!.e as { text: string }).text).toBe("during outage");
    await waitFor(() => t.server.hub.healthy, 2_000, "recovered");
    expect(t.metrics.get("reader_reconnects_total")).toBeGreaterThanOrEqual(3);
    await publishSessionEvent(flaky, SESSION_A, note("after"));
    await waitFor(() => sock.events.length === 3, 2_000, "after");
  });
});
