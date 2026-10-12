/**
 * Shared test harness: a stream server on an ephemeral port (127.0.0.1:0) over the in-memory Redis fake, the dev
 * token bypass (`dev:<uuid>` tokens) and an in-memory authorizer. Every test stops what it starts.
 */
import { MemoryRedis, type StreamRedis } from "@foundmill/events";
import { fixtureId } from "@foundmill/events/testing/fixtures";
import WebSocket from "ws";
import { createTokenVerifier, type TokenVerifier } from "../auth";
import { createMemoryAuthorizer, type Authorizer } from "../authorize";
import { Metrics } from "../metrics";
import { createStreamServer, type StreamServer, type StreamServerOptions } from "../server";

export const USER_A = fixtureId("user-a");
export const USER_B = fixtureId("user-b");
export const BUSINESS_A = fixtureId("business-a");
export const BUSINESS_B = fixtureId("business-b");
export const SESSION_A = fixtureId("session-a");
/** A second session of business A (two tiles in one tab). */
export const SESSION_A2 = fixtureId("session-a2");
export const SESSION_B = fixtureId("session-b");

export const memberships = {
  members: { [USER_A]: [BUSINESS_A], [USER_B]: [BUSINESS_B] },
  sessions: { [SESSION_A]: BUSINESS_A, [SESSION_A2]: BUSINESS_A, [SESSION_B]: BUSINESS_B },
};

export interface TestServer {
  server: StreamServer;
  redis: MemoryRedis;
  metrics: Metrics;
  port: number;
  /** ws://127.0.0.1:<port> */
  url: string;
  close(): Promise<void>;
}

export interface TestServerOptions {
  redis?: StreamRedis;
  authorizer?: Authorizer;
  auth?: TokenVerifier;
  options?: StreamServerOptions;
  port?: number;
}

export async function startTestServer(opts: TestServerOptions = {}): Promise<TestServer> {
  const redis = (opts.redis as MemoryRedis | undefined) ?? new MemoryRedis();
  const metrics = new Metrics();
  const server = createStreamServer({
    redis,
    metrics,
    auth: opts.auth ?? createTokenVerifier({ appEnv: "test", devUserId: USER_A }),
    authorizer: opts.authorizer ?? createMemoryAuthorizer(memberships),
    options: {
      heartbeatMs: 5_000,
      closeGraceMs: 200,
      ...(opts.options ?? {}),
      hub: { blockMs: 50, reconnectMinMs: 10, reconnectMaxMs: 50, ...(opts.options?.hub ?? {}) },
    },
  });
  const addr = await server.listen(opts.port ?? 0, "127.0.0.1");
  return {
    server,
    redis,
    metrics,
    port: addr.port,
    url: `ws://127.0.0.1:${addr.port}`,
    close: () => server.close(),
  };
}

export const devToken = (userId: string) => `dev:${userId}`;

export interface TestSocket {
  ws: WebSocket;
  /** Every parsed server frame in arrival order (array frames are kept as arrays). */
  frames: unknown[];
  /** Flattened event frames `{ ch, e }`. */
  events: { ch: string; e: unknown }[];
  errors: { t: "err"; ch?: string; code: string; message: string }[];
  /** Channels the server acknowledged as live (`{ t: "subscribed", ch }`), in arrival order. */
  subscribed: string[];
  send(frame: unknown): void;
  sub(ch: string, focus?: boolean): void;
  unsub(ch: string): void;
  closed: Promise<{ code: number; reason: string }>;
  close(): Promise<void>;
}

/** Open a raw `ws` client and resolve once the handshake completes. Rejects with the HTTP status on a refused upgrade. */
export function openSocket(url: string, token: string | null): Promise<TestSocket> {
  const target = token === null ? url : `${url}/?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(target);
  const frames: unknown[] = [];
  const events: { ch: string; e: unknown }[] = [];
  const errors: TestSocket["errors"] = [];
  const subscribed: string[] = [];
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  });
  ws.on("message", (data) => {
    const frame = JSON.parse(data.toString()) as unknown;
    frames.push(frame);
    const list = Array.isArray(frame) ? frame : [frame];
    for (const f of list as Record<string, unknown>[]) {
      if (typeof f.ch === "string" && "e" in f) events.push({ ch: f.ch, e: f.e });
      else if (f.t === "err") errors.push(f as TestSocket["errors"][number]);
      else if (f.t === "subscribed" && typeof f.ch === "string") subscribed.push(f.ch);
    }
  });
  const sock: TestSocket = {
    ws,
    frames,
    events,
    errors,
    subscribed,
    send: (frame) => ws.send(JSON.stringify(frame)),
    sub: (ch, focus) => ws.send(JSON.stringify(focus === undefined ? { t: "sub", ch } : { t: "sub", ch, focus })),
    unsub: (ch) => ws.send(JSON.stringify({ t: "unsub", ch })),
    closed,
    close: async () => {
      if (ws.readyState === WebSocket.CLOSED) return;
      ws.close(1000);
      await closed;
    },
  };
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(sock));
    ws.once("unexpected-response", (_req, res) => {
      reject(new Error(`upgrade refused: ${res.statusCode}`));
      res.resume();
    });
    ws.once("error", (err) => reject(err));
  });
}

export async function waitFor(cond: () => boolean, timeoutMs = 3_000, label = "condition"): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor(${label}): timed out after ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 2));
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
}
