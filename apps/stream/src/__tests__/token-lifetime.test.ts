/**
 * Where the token travels and how long a socket lives (security review SEC-12, audit SIEC-4 / SECX-6 / SECX-12): the
 * access token rides in the `foundmill.bearer.*` subprotocol and never in the URL, the upgrade answer is `no-store`
 * and never echoes it, and a socket is closed when its token expires unless the client sent a fresh one for the same
 * account first.
 */
import { SignJWT } from "jose";
import { publishSessionEvent, type SessionEvent } from "@foundmill/events";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createTokenVerifier } from "../auth";
import { StreamClient, type WebSocketLike } from "../client";
import { CLOSE_CODES, sessionChannel, STREAM_SUBPROTOCOL, streamProtocols } from "../protocol";
import { openSocket, SESSION_A, sleep, startTestServer, USER_A, USER_B, waitFor, type TestServer, type TestSocket } from "./helpers";

const SECRET = new TextEncoder().encode("a-very-long-test-only-project-secret-0123456789");
const auth = createTokenVerifier({ appEnv: "production", hsKey: SECRET });

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

/** An access token for `userId` that expires `seconds` from now (JWT `exp` has one-second resolution). */
function token(userId: string, seconds: number): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("authenticated")
    .setExpirationTime(Math.floor(Date.now() / 1000) + seconds)
    .sign(SECRET);
}

async function boot(opts: Parameters<typeof startTestServer>[0] = {}): Promise<TestServer> {
  const t = await startTestServer({ auth, ...opts });
  cleanups.push(() => t.close());
  return t;
}

async function open(t: TestServer, tok: string): Promise<TestSocket> {
  const s = await openSocket(t.url, tok);
  cleanups.push(() => s.close());
  return s;
}

const note = (text: string): SessionEvent => ({ kind: "note", at: new Date().toISOString(), level: "info", source: "agent", text });

describe("the token travels in a subprotocol, never in the URL (SEC-12)", () => {
  it("accepts the bearer subprotocol, selects only the stream's own and answers no-store", async () => {
    const t = await boot();
    const tok = await token(USER_A, 3600);
    const ws = new WebSocket(t.url, streamProtocols(tok));
    const headers = await new Promise<Record<string, string | string[] | undefined>>((resolve, reject) => {
      ws.once("upgrade", (res) => resolve(res.headers));
      ws.once("error", reject);
    });
    await new Promise<void>((resolve) => (ws.readyState === WebSocket.OPEN ? resolve() : ws.once("open", () => resolve())));
    cleanups.push(() => ws.close());
    expect(ws.protocol).toBe(STREAM_SUBPROTOCOL);
    expect(headers["sec-websocket-protocol"]).toBe(STREAM_SUBPROTOCOL);
    expect(JSON.stringify(headers)).not.toContain(tok);
    expect(headers["cache-control"]).toBe("no-store");
    expect(t.server.subscriptions()).toEqual([{ userId: USER_A, channels: [], focused: [] }]);
  });

  it("refuses a token in the URL with 400, even a valid one, and counts no socket", async () => {
    const t = await boot();
    const tok = await token(USER_A, 3600);
    const ws = new WebSocket(`${t.url}/?token=${encodeURIComponent(tok)}`, streamProtocols(tok));
    const status = await new Promise<number>((resolve, reject) => {
      ws.once("unexpected-response", (_req, res) => {
        resolve(res.statusCode ?? 0);
        res.resume();
      });
      ws.once("open", () => reject(new Error("upgraded")));
      ws.once("error", () => undefined);
    });
    expect(status).toBe(400);
    expect(t.server.connections).toBe(0);
    expect(t.metrics.get("auth_failures_total")).toBe(1);
  });

  it("still refuses a missing or invalid bearer with 401 outside development", async () => {
    const t = await boot();
    await expect(openSocket(t.url, null)).rejects.toThrow(/401/);
    await expect(openSocket(t.url, "not-a-token")).rejects.toThrow(/401/);
    await expect(openSocket(t.url, await token(USER_A, -60))).rejects.toThrow(/401/);
  });
});

describe("a socket lives no longer than its token (audit SIEC-4)", () => {
  it("closes the socket with 4001 when the token expires, and nothing reaches it afterwards", async () => {
    const t = await boot();
    const s = await open(t, await token(USER_A, 2));
    s.sub(sessionChannel(SESSION_A));
    await waitFor(() => s.subscribed.length === 1, 2_000, "subscribed");
    const closed = await Promise.race([s.closed, sleep(4_000).then(() => null)]);
    expect(closed).toEqual({ code: CLOSE_CODES.unauthorized, reason: "token expired" });
    expect(t.metrics.get("tokens_expired_total")).toBe(1);
    await publishSessionEvent(t.redis, SESSION_A, note("after expiry"));
    await sleep(100);
    expect(s.events).toEqual([]);
    expect(t.server.connections).toBe(0);
  });

  it("keeps the socket past the old expiry when the client sends a fresh token for the same account", async () => {
    const t = await boot();
    const s = await open(t, await token(USER_A, 2));
    s.sub(sessionChannel(SESSION_A));
    await waitFor(() => s.subscribed.length === 1, 2_000, "subscribed");
    const fresh = await token(USER_A, 3600);
    s.send({ t: "auth", token: fresh });
    await waitFor(() => s.authed.length === 1, 2_000, "authed");
    expect(s.authed[0]).toBeGreaterThan(Date.now() + 3_000_000);
    await sleep(2_600); // past the first token's expiry
    expect(s.ws.readyState).toBe(WebSocket.OPEN);
    await publishSessionEvent(t.redis, SESSION_A, note("still here"));
    await waitFor(() => s.events.length === 1, 2_000, "event after renewal");
    expect(t.metrics.get("tokens_expired_total")).toBe(0);
  });

  it("closes the socket when a refreshed token names another account or does not verify", async () => {
    const t = await boot();
    const s = await open(t, await token(USER_A, 3600));
    s.send({ t: "auth", token: await token(USER_B, 3600) });
    expect(await s.closed).toEqual({ code: CLOSE_CODES.unauthorized, reason: "unauthorized" });

    const s2 = await open(t, await token(USER_A, 3600));
    s2.send({ t: "auth", token: "garbage" });
    expect(await s2.closed).toEqual({ code: CLOSE_CODES.unauthorized, reason: "unauthorized" });
    expect(t.metrics.get("auth_failures_total")).toBe(2);
  });

  it("closes the socket with 4003 when a refreshed token's account is no longer on the invite list", async () => {
    let admitted = true;
    const t = await boot({ admit: () => admitted });
    const s = await open(t, await token(USER_A, 3600));
    admitted = false;
    s.send({ t: "auth", token: await token(USER_A, 3600) });
    expect(await s.closed).toEqual({ code: CLOSE_CODES.forbidden, reason: "forbidden" });
  });

  it("the client sends a fresh token before the old one expires, so its subscriptions survive", async () => {
    const t = await boot();
    let issued = 0;
    const client = new StreamClient({
      url: t.url,
      getToken: async () => {
        issued += 1;
        return token(USER_A, issued === 1 ? 2 : 3600);
      },
      webSocket: WebSocket as unknown as new (url: string, protocols?: string[]) => WebSocketLike,
      renewBeforeMs: 1_500,
      minBackoffMs: 20,
      maxBackoffMs: 100,
    });
    cleanups.push(() => client.close());
    const seen: unknown[] = [];
    client.subscribe(sessionChannel(SESSION_A), (e) => seen.push(e));
    await waitFor(() => t.server.subscriptions().some((s) => s.channels.length === 1), 2_000, "subscribed");
    await sleep(2_600); // past the first token's expiry
    expect(issued).toBeGreaterThanOrEqual(2);
    expect(client.stats.connects).toBe(1); // never closed: renewed in place
    await publishSessionEvent(t.redis, SESSION_A, note("renewed"));
    await waitFor(() => seen.length === 1, 2_000, "event after renewal");
    expect(t.metrics.get("tokens_expired_total")).toBe(0);
  });
});
