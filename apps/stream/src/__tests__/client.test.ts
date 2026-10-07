/**
 * StreamClient against a real server: subscription multiplexing, focus-aware throttling, server errors, reconnect
 * with resubscribe after the server goes away, and token refresh on reconnect.
 */
import { publishSessionEvent, type SessionEvent } from "@foundmill/events";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { StreamClient, type StreamStatus, type WebSocketLike } from "../client";
import { businessChannel, sessionChannel } from "../protocol";
import { BUSINESS_A, devToken, SESSION_A, SESSION_A2, sleep, startTestServer, USER_A, waitFor, type TestServer } from "./helpers";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const WS = WebSocket as unknown as new (url: string) => WebSocketLike;
const note = (text: string): SessionEvent => ({ kind: "note", at: new Date().toISOString(), level: "info", source: "agent", text });

function makeClient(t: TestServer, extra: Partial<ConstructorParameters<typeof StreamClient>[0]> = {}): StreamClient & { statuses: StreamStatus[] } {
  const statuses: StreamStatus[] = [];
  const client = new StreamClient({
    url: t.url,
    getToken: () => devToken(USER_A),
    webSocket: WS,
    minBackoffMs: 20,
    maxBackoffMs: 100,
    pingMs: 500,
    onStatus: (s) => statuses.push(s),
    ...extra,
  }) as StreamClient & { statuses: StreamStatus[] };
  client.statuses = statuses;
  cleanups.push(() => client.close());
  return client;
}

describe("StreamClient", () => {
  it("connects lazily, multiplexes handlers per channel and unsubscribes when the last handler leaves", async () => {
    const t = await startTestServer();
    cleanups.push(() => t.close());
    const client = makeClient(t);
    expect(client.state).toBe("idle");
    const got1: unknown[] = [];
    const got2: unknown[] = [];
    const off1 = client.subscribe(sessionChannel(SESSION_A), (e) => got1.push(e));
    const off2 = client.subscribe(sessionChannel(SESSION_A), (e) => got2.push(e));
    await waitFor(() => client.state === "open", 2_000, "open");
    await waitFor(() => t.server.subscriptions()[0]?.channels.length === 1, 2_000, "one server subscription");
    expect(t.metrics.get("subscriptions_total")).toBe(1);
    await publishSessionEvent(t.redis, SESSION_A, note("hello"));
    await waitFor(() => got1.length === 1 && got2.length === 1, 2_000, "both handlers");
    expect(got1[0]).toMatchObject({ kind: "note", text: "hello" });
    off1();
    await sleep(20);
    expect(t.server.subscriptions()[0]?.channels).toEqual([sessionChannel(SESSION_A)]);
    off2();
    await waitFor(() => t.server.subscriptions()[0]?.channels.length === 0, 2_000, "server unsubscribed");
    expect(client.subscribedChannels()).toEqual([]);
    off2(); // idempotent
  });

  it("throttles unfocused channels to 4 bursts per second without losing events and restores full rate on focus", async () => {
    const t = await startTestServer();
    cleanups.push(() => t.close());
    const client = makeClient(t);
    const focusedTimes: number[] = [];
    const idleTimes: number[] = [];
    const idleEvents: string[] = [];
    client.subscribe(sessionChannel(SESSION_A), () => focusedTimes.push(performance.now()));
    client.subscribe(sessionChannel(SESSION_A2), (e) => {
      idleTimes.push(performance.now());
      idleEvents.push((e as { text: string }).text);
    }, { focused: false });
    await waitFor(() => t.server.subscriptions()[0]?.channels.length === 2, 2_000, "subscribed");
    const N = 60;
    const start = performance.now();
    for (let i = 0; i < N; i++) {
      await publishSessionEvent(t.redis, SESSION_A, note(`f${i}`));
      await publishSessionEvent(t.redis, SESSION_A2, note(`u${i}`));
      await sleep(10);
    }
    await waitFor(() => focusedTimes.length === N && idleTimes.length === N, 5_000, "all delivered");
    const elapsedS = (performance.now() - start) / 1000;
    expect(idleEvents).toEqual(Array.from({ length: N }, (_, i) => `u${i}`));
    // Count bursts: handler calls more than 5 ms apart start a new burst.
    const bursts = (times: number[]) => times.reduce((n, tm, i) => (i === 0 || tm - times[i - 1]! > 5 ? n + 1 : n), 0);
    expect(bursts(idleTimes)).toBeLessThanOrEqual(Math.ceil(elapsedS * 4) + 1);
    expect(bursts(focusedTimes)).toBeGreaterThan(bursts(idleTimes) * 2);

    client.setFocus(sessionChannel(SESSION_A2), true);
    const before = idleTimes.length;
    const t0 = performance.now();
    await publishSessionEvent(t.redis, SESSION_A2, note("now focused"));
    await waitFor(() => idleTimes.length === before + 1, 2_000, "focused delivery");
    expect(performance.now() - t0).toBeLessThan(100);
  });

  it("surfaces server-side denials through onError", async () => {
    const t = await startTestServer();
    cleanups.push(() => t.close());
    const errors: { ch?: string; code: string }[] = [];
    const client = makeClient(t, { onError: (e) => errors.push({ ch: e.ch, code: e.code }) });
    client.subscribe(businessChannel(BUSINESS_A), () => {});
    client.subscribe(sessionChannel("00000000-0000-4000-8000-00000000dead"), () => {});
    await waitFor(() => errors.length === 1, 2_000, "denial");
    expect(errors[0]).toEqual({ ch: "as:00000000-0000-4000-8000-00000000dead", code: "forbidden" });
    expect(client.stats.errors).toBe(1);
  });

  it("reconnects with backoff after the server goes away, refreshes the token and re-subscribes", async () => {
    const t1 = await startTestServer();
    let tokens = 0;
    const client = makeClient(t1, {
      getToken: () => {
        tokens++;
        return devToken(USER_A);
      },
    });
    const got: string[] = [];
    client.subscribe(sessionChannel(SESSION_A), (e) => got.push((e as { text: string }).text));
    await waitFor(() => t1.server.subscriptions()[0]?.channels.length === 1, 2_000, "subscribed on server 1");
    await publishSessionEvent(t1.redis, SESSION_A, note("before"));
    await waitFor(() => got.length === 1, 2_000, "before");

    await t1.close(); // 1001 to every socket
    await waitFor(() => client.state === "reconnecting", 2_000, "reconnecting");
    // Re-listen on the same port (freed by close) so the client's fixed url points at the new server.
    const t2 = await startTestServer({ port: t1.port, redis: t1.redis });
    cleanups.push(() => t2.close());
    await waitFor(() => client.state === "open", 5_000, "re-opened");
    await waitFor(() => t2.server.subscriptions()[0]?.channels.length === 1, 2_000, "re-subscribed");
    expect(tokens).toBeGreaterThanOrEqual(2);
    expect(client.stats.reconnects).toBe(1);
    await publishSessionEvent(t2.redis, SESSION_A, note("after"));
    await waitFor(() => got.length === 2, 2_000, "after");
    expect(got).toEqual(["before", "after"]);
    expect(client.statuses).toEqual(expect.arrayContaining(["connecting", "open", "reconnecting"]));
  });

  it("stops reconnecting once closed by the user and reopens on the next subscribe", async () => {
    const t = await startTestServer();
    cleanups.push(() => t.close());
    const client = makeClient(t);
    client.subscribe(sessionChannel(SESSION_A), () => {});
    await waitFor(() => client.state === "open", 2_000, "open");
    client.close();
    expect(client.state).toBe("closed");
    await waitFor(() => t.server.connections === 0, 2_000, "server saw the close");
    await sleep(150);
    expect(t.server.connections).toBe(0);
    client.connect();
    await waitFor(() => client.state === "open" && t.server.subscriptions()[0]?.channels.length === 1, 2_000, "reopened with the subscription");
  });

  it("does not block the page when the server is unreachable: keeps backing off and reports status", async () => {
    const statuses: StreamStatus[] = [];
    const client = new StreamClient({ url: "ws://127.0.0.1:1", getToken: () => "", webSocket: WS, minBackoffMs: 10, maxBackoffMs: 40, onStatus: (s) => statuses.push(s) });
    cleanups.push(() => client.close());
    client.subscribe(sessionChannel(SESSION_A), () => {});
    await waitFor(() => statuses.filter((s) => s === "reconnecting").length >= 3, 3_000, "retried at least three times");
    expect(client.state).toBe("reconnecting");
  });
});
