/**
 * The stream server (docs/ARCHITECTURE.md §12): one HTTP server that answers `GET /health` and upgrades
 * everything else to WebSocket. Tokens are verified before the upgrade (a bad token gets a 401, never a socket),
 * every subscription is authorised against memberships, Redis streams are read once per key through `StreamHub`
 * and fanned out through a per-socket `OutboundQueue` (20 frames/s coalescing, backpressure shedding).
 *
 * Heartbeat: the server pings every `heartbeatMs`; a socket that has neither answered a ping nor sent a frame by
 * the next tick is terminated (4000). Clients may also send `{ "t": "ping" }` and get `{ "t": "pong" }`.
 * Shutdown: `close()` stops accepting upgrades, closes every socket with 1001, stops the readers and the HTTP server.
 */
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { APP_NAME } from "@foundmill/config";
import type { StreamRedis } from "@foundmill/events";
import type { AuthUser, TokenVerifier } from "./auth";
import type { Authorizer } from "./authorize";
import { OutboundQueue, type OutboundQueueOptions } from "./connection";
import { MAX_INBOUND_BYTES, parseClientFrame } from "./frames";
import { silentLog, StreamHub, type StreamHubOptions, type StreamLog } from "./hub";
import { Metrics, type MetricsSnapshot } from "./metrics";
import { CLOSE_CODES, parseChannel, type ClientFrame, type ErrorFrame, type StreamErrorCode, type SubscribedFrame } from "./protocol";

export interface StreamServerOptions {
  /** Ping interval; a socket silent for two intervals is terminated (default 30 000 ms). */
  heartbeatMs?: number;
  maxSubscriptionsPerSocket?: number;
  /** Malformed frames tolerated before the socket is closed with 1008 (default 5). */
  maxBadFrames?: number;
  /** How long close() waits for sockets to finish their close handshake before terminating them (default 1 000 ms). */
  closeGraceMs?: number;
  queue?: Omit<OutboundQueueOptions, "metrics" | "now">;
  hub?: Omit<StreamHubOptions, "log" | "metrics">;
  /** Optional Redis liveness probe for /health (e.g. ioredis `ping`). Defaults to the hub's reader state. */
  checkRedis?: () => Promise<boolean>;
  now?: () => number;
}

export interface StreamServerDeps {
  redis: StreamRedis;
  auth: TokenVerifier;
  authorizer: Authorizer;
  log?: StreamLog;
  metrics?: Metrics;
  options?: StreamServerOptions;
}

export interface HealthReport {
  ok: boolean;
  app: string;
  service: "stream";
  uptimeMs: number;
  redis: boolean;
  closing: boolean;
  metrics: MetricsSnapshot;
}

export interface StreamServer {
  listen(port: number, host?: string): Promise<AddressInfo>;
  close(): Promise<void>;
  address(): AddressInfo | null;
  health(): Promise<HealthReport>;
  readonly metrics: Metrics;
  readonly hub: StreamHub;
  readonly http: HttpServer;
  readonly connections: number;
  /** Channels subscribed per open socket (tests). */
  subscriptions(): { userId: string; channels: string[]; focused: string[] }[];
}

interface Client {
  ws: WebSocket;
  user: AuthUser;
  queue: OutboundQueue;
  subs: Map<string, () => void>;
  pending: Set<string>;
  alive: boolean;
  badFrames: number;
}

const HOST_FALLBACKS = ["::", "0.0.0.0"] as const;

export function createStreamServer(deps: StreamServerDeps): StreamServer {
  const log = deps.log ?? silentLog;
  const metrics = deps.metrics ?? new Metrics();
  const opts = deps.options ?? {};
  const now = opts.now ?? (() => Date.now());
  const heartbeatMs = Math.max(10, opts.heartbeatMs ?? 30_000);
  const maxSubs = Math.max(1, opts.maxSubscriptionsPerSocket ?? 128);
  const maxBadFrames = Math.max(1, opts.maxBadFrames ?? 5);
  const closeGraceMs = Math.max(0, opts.closeGraceMs ?? 1_000);
  const startedAt = now();

  const hub = new StreamHub(deps.redis, { ...(opts.hub ?? {}), log, metrics });
  const clients = new Set<Client>();
  let closing = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const http = createServer((req, res) => handleHttp(req, res));
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_INBOUND_BYTES, clientTracking: false, perMessageDeflate: false });

  async function health(): Promise<HealthReport> {
    let redis = hub.healthy;
    if (opts.checkRedis) {
      try {
        redis = (await opts.checkRedis()) && hub.healthy;
      } catch {
        redis = false;
      }
    }
    return { ok: redis && !closing, app: APP_NAME, service: "stream", uptimeMs: now() - startedAt, redis, closing, metrics: metrics.snapshot() };
  }

  function handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/health" && (req.method === "GET" || req.method === "HEAD")) {
      void health().then((report) => {
        res.writeHead(report.ok ? 200 : 503, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(req.method === "HEAD" ? undefined : JSON.stringify(report));
      });
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found", hint: "WebSocket at /?token=…; health at /health" }));
  }

  function rejectUpgrade(socket: Duplex, status: number, text: string): void {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  }

  http.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (closing) return rejectUpgrade(socket, 503, "Service Unavailable");
    const url = new URL(req.url ?? "/", "http://localhost");
    const token = url.searchParams.get("token");
    socket.on("error", () => {});
    deps.auth
      .resolve(token)
      .then((user) => {
        if (!user) {
          metrics.inc("auth_failures_total");
          return rejectUpgrade(socket, 401, "Unauthorized");
        }
        if (closing) return rejectUpgrade(socket, 503, "Service Unavailable");
        wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, user));
      })
      .catch((err) => {
        log.error({ err }, "upgrade failed");
        rejectUpgrade(socket, 500, "Internal Server Error");
      });
  });

  function sendControl(client: Client, frame: ErrorFrame | SubscribedFrame | { t: "pong" }): void {
    if (client.ws.readyState !== client.ws.OPEN) return;
    client.ws.send(JSON.stringify(frame));
  }

  function sendError(client: Client, code: StreamErrorCode, message: string, ch?: string): void {
    sendControl(client, ch ? { t: "err", ch, code, message } : { t: "err", code, message });
  }

  function onConnection(ws: WebSocket, user: AuthUser): void {
    const client: Client = {
      ws,
      user,
      queue: new OutboundQueue(ws, { ...(opts.queue ?? {}), metrics, now }),
      subs: new Map(),
      pending: new Set(),
      alive: true,
      badFrames: 0,
    };
    clients.add(client);
    metrics.inc("connections_total");
    metrics.set("connections_open", clients.size);
    log.debug({ userId: user.userId }, "socket opened");

    ws.on("pong", () => {
      client.alive = true;
    });
    ws.on("message", (data, isBinary) => {
      client.alive = true;
      metrics.inc("frames_in_total");
      const parsed = parseClientFrame(isBinary ? new Uint8Array(data as Buffer) : (data as Buffer).toString("utf8"));
      if (!parsed.ok) {
        metrics.inc("bad_frames_total");
        client.badFrames += 1;
        sendError(client, "bad_frame", parsed.reason);
        if (client.badFrames >= maxBadFrames) ws.close(CLOSE_CODES.policyViolation, "too many malformed frames");
        return;
      }
      void handleFrame(client, parsed.frame);
    });
    ws.on("error", (err) => log.warn({ err, userId: user.userId }, "socket error"));
    ws.on("close", () => {
      for (const detach of client.subs.values()) detach();
      client.subs.clear();
      client.pending.clear();
      client.queue.close();
      clients.delete(client);
      metrics.set("connections_open", clients.size);
      updateSubscriptionGauge();
      log.debug({ userId: user.userId }, "socket closed");
    });
  }

  function updateSubscriptionGauge(): void {
    let n = 0;
    for (const c of clients) n += c.subs.size;
    metrics.set("subscriptions_open", n);
  }

  async function handleFrame(client: Client, frame: ClientFrame): Promise<void> {
    switch (frame.t) {
      case "ping":
        sendControl(client, { t: "pong" });
        return;
      case "unsub": {
        client.pending.delete(frame.ch);
        const detach = client.subs.get(frame.ch);
        if (detach) {
          detach();
          client.subs.delete(frame.ch);
          client.queue.purge(frame.ch);
          updateSubscriptionGauge();
        }
        client.queue.focused.delete(frame.ch);
        return;
      }
      case "focus":
        if (frame.focused) client.queue.focused.add(frame.ch);
        else client.queue.focused.delete(frame.ch);
        return;
      case "sub":
        // A channel is focused unless the client says otherwise: both clients (apps/web, ./client.ts) send `focus:false`
        // for an unfocused tile and leave the field out for a focused one (RES-12).
        return subscribe(client, frame.ch, frame.focus !== false);
    }
  }

  async function subscribe(client: Client, ch: string, focus: boolean): Promise<void> {
    // The latest frame decides: a repeated sub (a retry after an error) carries the channel's current focus.
    if (focus) client.queue.focused.add(ch);
    else client.queue.focused.delete(ch);
    // Idempotent: a repeated sub of a live channel is acknowledged again; a pending one is acknowledged when it lands.
    if (client.subs.has(ch)) return sendControl(client, { t: "subscribed", ch });
    if (client.pending.has(ch)) return;
    const parsed = parseChannel(ch);
    if (!parsed) return sendError(client, "invalid_channel", `unknown channel "${ch}"`, ch);
    if (client.subs.size + client.pending.size >= maxSubs) return sendError(client, "too_many_subscriptions", `at most ${maxSubs} channels per socket`, ch);
    if (closing) return sendError(client, "shutting_down", "server is shutting down", ch);
    client.pending.add(ch);
    metrics.inc("subscriptions_total");
    let decision;
    try {
      decision = await deps.authorizer.canSubscribe(client.user.userId, ch);
    } catch (err) {
      log.error({ err, ch }, "authorizer threw");
      decision = { ok: false as const, code: "unavailable" as const, message: "membership check unavailable" };
    }
    if (!client.pending.has(ch)) return; // unsubscribed (or closed) while we were checking
    client.pending.delete(ch);
    if (!decision.ok) {
      metrics.inc("subscriptions_denied_total");
      log.info({ userId: client.user.userId, ch, code: decision.code }, "subscription denied");
      return sendError(client, decision.code, decision.message, ch);
    }
    if (client.ws.readyState !== client.ws.OPEN) return;
    const detach = hub.subscribe(parsed.streamKey, (entry) => {
      const json = entry.fields.json ?? JSON.stringify(entry.fields);
      client.queue.push(ch, json);
    });
    client.subs.set(ch, detach);
    updateSubscriptionGauge();
    sendControl(client, { t: "subscribed", ch });
  }

  function startHeartbeat(): void {
    heartbeat = setInterval(() => {
      for (const client of clients) {
        if (!client.alive) {
          metrics.inc("heartbeat_timeouts_total");
          log.info({ userId: client.user.userId }, "heartbeat timeout; terminating socket");
          client.ws.terminate();
          continue;
        }
        client.alive = false;
        if (client.ws.readyState === client.ws.OPEN) client.ws.ping();
      }
    }, heartbeatMs);
    heartbeat.unref?.();
  }

  function listenOn(port: number, hosts: readonly string[]): Promise<AddressInfo> {
    const [host, ...rest] = hosts;
    if (!host) return Promise.reject(new Error("no address family available to listen on"));
    return new Promise((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        http.off("listening", onListening);
        if ((err.code === "EAFNOSUPPORT" || err.code === "EADDRNOTAVAIL") && rest.length > 0) {
          log.warn({ host, code: err.code }, "address family unavailable; falling back");
          listenOn(port, rest).then(resolve, reject);
        } else reject(err);
      };
      const onListening = () => {
        http.off("error", onError);
        const addr = http.address() as AddressInfo;
        log.info({ port: addr.port, host }, "stream listening");
        resolve(addr);
      };
      http.once("error", onError);
      http.once("listening", onListening);
      http.listen(port, host);
    });
  }

  return {
    metrics,
    hub,
    http,
    get connections() {
      return clients.size;
    },
    subscriptions() {
      return [...clients].map((c) => ({ userId: c.user.userId, channels: [...c.subs.keys()], focused: [...c.queue.focused] }));
    },
    address() {
      const a = http.address();
      return a && typeof a === "object" ? a : null;
    },
    health,
    async listen(port, host) {
      const addr = await listenOn(port, host ? [host] : HOST_FALLBACKS);
      startHeartbeat();
      return addr;
    },
    async close() {
      if (closing) return;
      closing = true;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      for (const client of clients) {
        client.queue.close();
        try {
          client.ws.close(CLOSE_CODES.goingAway, "server shutting down");
        } catch {
          client.ws.terminate();
        }
      }
      if (clients.size > 0 && closeGraceMs > 0) {
        await new Promise<void>((resolve) => {
          const deadline = setTimeout(resolve, closeGraceMs);
          const poll = setInterval(() => {
            if (clients.size === 0) {
              clearTimeout(deadline);
              clearInterval(poll);
              resolve();
            }
          }, 10);
          deadline.unref?.();
          poll.unref?.();
        });
      }
      for (const client of clients) client.ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await hub.close();
      if (http.listening) await new Promise<void>((resolve) => http.close(() => resolve()));
      log.info({}, "stream stopped");
    },
  };
}
