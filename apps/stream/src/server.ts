/**
 * The stream server (docs/ARCHITECTURE.md §12): one HTTP server that answers `GET /health` and upgrades
 * everything else to WebSocket. Tokens are verified before the upgrade (a bad token gets a 401, never a socket),
 * every subscription is authorised against memberships, Redis streams are read once per key through `StreamHub`
 * and fanned out through a per-socket `OutboundQueue` (20 frames/s coalescing, backpressure shedding).
 *
 * Tokens (security review SEC-12, audit SIEC-4): the token comes in the `foundmill.bearer.*` subprotocol, never the
 * URL (a `?token=` upgrade is refused with 400), and the upgrade answer is `no-store`. A socket lives no longer than
 * its token: at `exp` it is closed with 4001 (the client reconnects with a fresh token) unless the client has sent a
 * fresh token for the same account first (`{ t: "auth" }`, answered by `{ t: "authed", exp }`).
 *
 * Heartbeat: the server pings every `heartbeatMs`; a socket that has neither answered a ping nor sent a frame by
 * the next tick is terminated (4000). Clients may also send `{ "t": "ping" }` and get `{ "t": "pong" }`.
 * Shutdown: `close()` stops accepting upgrades, closes every socket with 1001, stops the readers and the HTTP server.
 *
 * Section walls (security review S1): a business event reaches a reader only through their membership's walls
 * (walls.ts: dropped, redacted or as is). Access is not fixed at subscribe time: a `membership.changed` event read on
 * a business stream holds that person's subscriptions to the business, re-checks them with fresh decisions and then
 * either releases what was held under the new walls or closes the subscription (`{ t: "err", ch, code }`); every
 * `reauthorizeMs` all live subscriptions are re-checked as well, for changes that publish no event (an archived
 * business, a deleted account, a direct database change).
 */
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { APP_NAME } from "@foundmill/config";
import type { StreamEntry, StreamRedis } from "@foundmill/events";
import type { AuthUser, TokenVerifier } from "./auth";
import type { AuthorizationResult, Authorizer } from "./authorize";
import { OutboundQueue, type OutboundQueueOptions } from "./connection";
import { MAX_INBOUND_BYTES, parseClientFrame } from "./frames";
import { silentLog, StreamHub, type StreamHubOptions, type StreamLog } from "./hub";
import { Metrics, type MetricsSnapshot } from "./metrics";
import { CLOSE_CODES, parseChannel, STREAM_SUBPROTOCOL, tokenFromProtocols, type AuthedFrame, type ClientFrame, type ErrorFrame, type StreamErrorCode, type SubscribedFrame } from "./protocol";
import { eventView, membershipChangeOf, viewAccountEvent, viewEvent, type EventView } from "./walls";

export interface StreamServerOptions {
  /** Ping interval; a socket silent for two intervals is terminated (default 30 000 ms). */
  heartbeatMs?: number;
  /** How often every live subscription is re-checked against memberships (default 30 000 ms). */
  reauthorizeMs?: number;
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
  /**
   * Whether a signed-in account may use the app at all (`SIGNUP_ALLOWLIST`, the same list apps/api checks on every
   * request); an account it refuses gets a 403 instead of a socket. Absent: everyone who signs in.
   */
  admit?: (user: AuthUser) => boolean;
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

interface Subscription {
  detach: () => void;
  /** The business the channel belongs to (null when the decision named none). */
  businessId: string | null;
  /** Business channels: what the reader may see of each event (their section walls). Null for session channels. */
  view: EventView | null;
  /** Account channels (`ae:<userId>`): the account the channel belongs to; every entry is held to it. Null otherwise. */
  accountUserId: string | null;
  /** Entries held back while the subscription is re-checked after a membership change; null when not held. */
  held: StreamEntry[] | null;
  /** Bumped by every re-check: only the latest one's answer counts (an older one may carry the old access). */
  checks: number;
}

interface Client {
  ws: WebSocket;
  user: AuthUser;
  queue: OutboundQueue;
  subs: Map<string, Subscription>;
  pending: Set<string>;
  alive: boolean;
  badFrames: number;
  /** Closes the socket when the token expires; re-armed by a fresh token. */
  expiry: ReturnType<typeof setTimeout> | null;
  /** Bumped by every `auth` frame: only the latest one's answer counts. */
  auths: number;
}

/** Entries a subscription holds at most while it is re-checked; past that it is closed as unavailable. */
const MAX_HELD = 1_000;
/** Longest delay a Node timer takes (about 24.8 days); a later expiry is re-armed when it fires. */
const MAX_TIMER_MS = 2 ** 31 - 1;
const sameUser = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const HOST_FALLBACKS = ["::", "0.0.0.0"] as const;

export function createStreamServer(deps: StreamServerDeps): StreamServer {
  const log = deps.log ?? silentLog;
  const metrics = deps.metrics ?? new Metrics();
  const opts = deps.options ?? {};
  const now = opts.now ?? (() => Date.now());
  const heartbeatMs = Math.max(10, opts.heartbeatMs ?? 30_000);
  const reauthorizeMs = Math.max(10, opts.reauthorizeMs ?? 30_000);
  const maxSubs = Math.max(1, opts.maxSubscriptionsPerSocket ?? 128);
  const maxBadFrames = Math.max(1, opts.maxBadFrames ?? 5);
  const closeGraceMs = Math.max(0, opts.closeGraceMs ?? 1_000);
  const startedAt = now();

  const hub = new StreamHub(deps.redis, { ...(opts.hub ?? {}), log, metrics, tap: onEntry });
  const clients = new Set<Client>();
  /** Membership changes seen per person (lowercase id): a decision that raced one is checked again when it lands. */
  const membershipChanges = new Map<string, number>();
  const changesOf = (userId: string) => membershipChanges.get(userId.toLowerCase()) ?? 0;
  let closing = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let reauthorizer: ReturnType<typeof setInterval> | null = null;

  const http = createServer((req, res) => handleHttp(req, res));
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_INBOUND_BYTES,
    clientTracking: false,
    perMessageDeflate: false,
    // Only the stream's own subprotocol is ever selected: the bearer one carries the token, which is never echoed.
    handleProtocols: (protocols) => (protocols.has(STREAM_SUBPROTOCOL) ? STREAM_SUBPROTOCOL : false),
  });
  wss.on("headers", (headers) => headers.push("Cache-Control: no-store"));

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
    res.end(JSON.stringify({ error: "not_found", hint: `WebSocket at / (subprotocols ${STREAM_SUBPROTOCOL} and foundmill.bearer.<token>); health at /health` }));
  }

  function rejectUpgrade(socket: Duplex, status: number, text: string): void {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  }

  http.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (closing) return rejectUpgrade(socket, 503, "Service Unavailable");
    socket.on("error", () => {});
    // A token in the URL lands in every proxy's and CDN's access log: refuse it rather than let a client rely on it.
    if (new URL(req.url ?? "/", "http://localhost").searchParams.has("token")) {
      metrics.inc("auth_failures_total");
      log.warn({}, "upgrade with a token in the URL refused; send it in the foundmill.bearer subprotocol");
      return rejectUpgrade(socket, 400, "Bad Request");
    }
    const token = tokenFromProtocols(req.headers["sec-websocket-protocol"]);
    deps.auth
      .resolve(token)
      .then((user) => {
        if (!user) {
          metrics.inc("auth_failures_total");
          return rejectUpgrade(socket, 401, "Unauthorized");
        }
        if (deps.admit && !deps.admit(user)) {
          metrics.inc("auth_failures_total");
          log.info({ userId: user.userId }, "account is not on the invite list; upgrade refused");
          return rejectUpgrade(socket, 403, "Forbidden");
        }
        if (closing) return rejectUpgrade(socket, 503, "Service Unavailable");
        wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, user));
      })
      .catch((err) => {
        log.error({ err }, "upgrade failed");
        rejectUpgrade(socket, 500, "Internal Server Error");
      });
  });

  function sendControl(client: Client, frame: ErrorFrame | SubscribedFrame | AuthedFrame | { t: "pong" }): void {
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
      expiry: null,
      auths: 0,
    };
    clients.add(client);
    metrics.inc("connections_total");
    metrics.set("connections_open", clients.size);
    log.debug({ userId: user.userId }, "socket opened");
    armExpiry(client);

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
      if (client.expiry) clearTimeout(client.expiry);
      client.expiry = null;
      for (const sub of client.subs.values()) sub.detach();
      client.subs.clear();
      client.pending.clear();
      client.queue.close();
      clients.delete(client);
      metrics.set("connections_open", clients.size);
      updateSubscriptionGauge();
      log.debug({ userId: user.userId }, "socket closed");
    });
  }

  /** Arms (or re-arms) the close at the token's expiry; a token without one (development) never expires. */
  function armExpiry(client: Client): void {
    if (client.expiry) clearTimeout(client.expiry);
    client.expiry = null;
    const at = client.user.expiresAt;
    if (at === null) return;
    client.expiry = setTimeout(() => expire(client), Math.min(MAX_TIMER_MS, Math.max(0, at - now())));
    client.expiry.unref?.();
  }

  function expire(client: Client): void {
    client.expiry = null;
    const at = client.user.expiresAt;
    if (at !== null && at > now()) return armExpiry(client); // a timer capped at MAX_TIMER_MS, or a clock that differs
    if (client.ws.readyState !== client.ws.OPEN) return;
    metrics.inc("tokens_expired_total");
    log.info({ userId: client.user.userId }, "token expired; closing socket");
    client.ws.close(CLOSE_CODES.unauthorized, "token expired");
  }

  /**
   * A fresh token on an open socket (the client refreshes before `exp`): it must verify, name the same account and still
   * be admitted; then the socket lives until the new expiry. Anything else closes the socket (4001, or 4003 when the
   * invite list no longer names the account), and the client reconnects through the normal checks.
   */
  async function reauthenticate(client: Client, token: string): Promise<void> {
    const attempt = ++client.auths;
    let user: AuthUser | null;
    try {
      user = await deps.auth.resolve(token);
    } catch (err) {
      log.error({ err }, "token refresh failed");
      user = null;
    }
    if (attempt !== client.auths || client.ws.readyState !== client.ws.OPEN) return;
    if (!user || !sameUser(user.userId, client.user.userId)) {
      metrics.inc("auth_failures_total");
      log.info({ userId: client.user.userId }, user ? "refreshed token names another account; closing socket" : "refreshed token does not verify; closing socket");
      return client.ws.close(CLOSE_CODES.unauthorized, "unauthorized");
    }
    if (deps.admit && !deps.admit(user)) {
      metrics.inc("auth_failures_total");
      log.info({ userId: user.userId }, "account is not on the invite list; closing socket");
      return client.ws.close(CLOSE_CODES.forbidden, "forbidden");
    }
    client.user = { ...user, userId: client.user.userId };
    armExpiry(client);
    sendControl(client, { t: "authed", exp: user.expiresAt });
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
        const sub = client.subs.get(frame.ch);
        if (sub) {
          sub.detach();
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
      case "auth":
        return reauthenticate(client, frame.token);
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
    const changesBefore = changesOf(client.user.userId);
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
    const business = parsed.kind === "business";
    const sub: Subscription = { detach: () => {}, businessId: decision.businessId ?? (business ? parsed.id : null), view: business ? eventView(decision.membership) : null, accountUserId: parsed.kind === "account" ? parsed.id : null, held: null, checks: 0 };
    sub.detach = hub.subscribe(parsed.streamKey, (entry) => {
      if (sub.held) {
        if (sub.held.length < MAX_HELD) sub.held.push(entry);
        else revoke(client, ch, sub, { ok: false, code: "unavailable", message: "access check took too long" });
        return;
      }
      deliver(client, ch, sub, entry);
    });
    client.subs.set(ch, sub);
    updateSubscriptionGauge();
    sendControl(client, { t: "subscribed", ch });
    // The person's membership changed while this decision was being made: it may be the old access. Hold and ask again.
    if (changesOf(client.user.userId) !== changesBefore) {
      sub.held = [];
      void recheck(client, ch, sub);
    }
  }

  /**
   * One entry to one subscriber: business events through the reader's walls, account events only to the account they
   * belong to (and only when that is still the account on this socket), session events and signals as they are.
   */
  function deliver(client: Client, ch: string, sub: Subscription, entry: StreamEntry): void {
    const json =
      sub.accountUserId !== null
        ? sameUser(client.user.userId, sub.accountUserId)
          ? viewAccountEvent(entry, sub.accountUserId)
          : null
        : sub.view
          ? viewEvent(entry, sub.view)
          : (entry.fields.json ?? JSON.stringify(entry.fields));
    if (json === null) {
      metrics.inc("events_walled_total");
      return;
    }
    client.queue.push(ch, json);
  }

  /** Closes a live subscription the reader may no longer have, and says why on the channel. */
  function revoke(client: Client, ch: string, sub: Subscription, decision: Extract<AuthorizationResult, { ok: false }>): void {
    if (client.subs.get(ch) !== sub) return;
    sub.detach();
    sub.held = null;
    client.subs.delete(ch);
    client.queue.purge(ch);
    client.queue.focused.delete(ch);
    updateSubscriptionGauge();
    metrics.inc("subscriptions_revoked_total");
    log.info({ userId: client.user.userId, ch, code: decision.code }, "subscription revoked");
    sendError(client, decision.code, decision.message, ch);
  }

  /**
   * Asks the authorizer again for one live subscription. Allowed: the walls are updated and anything held is released
   * through them. Refused: the subscription is closed. Unavailable (the database did not answer): a subscription held
   * because the person's access changed is closed (the tab asks again), a routine re-check keeps its last decision.
   */
  async function recheck(client: Client, ch: string, sub: Subscription): Promise<void> {
    const check = ++sub.checks;
    let decision: AuthorizationResult;
    try {
      decision = await deps.authorizer.canSubscribe(client.user.userId, ch);
    } catch (err) {
      log.error({ err, ch }, "authorizer threw");
      decision = { ok: false, code: "unavailable", message: "membership check unavailable" };
    }
    if (client.subs.get(ch) !== sub) return; // unsubscribed, revoked or closed meanwhile
    if (check !== sub.checks) return; // a later check (after a membership change) decides
    if (!decision.ok) {
      if (decision.code === "unavailable" && !sub.held) return;
      return revoke(client, ch, sub, decision);
    }
    if (sub.view) sub.view = eventView(decision.membership);
    sub.businessId = decision.businessId ?? sub.businessId;
    const held = sub.held;
    sub.held = null;
    for (const entry of held ?? []) deliver(client, ch, sub, entry);
  }

  /**
   * Every entry read, once, before its listeners: a `membership.changed` on a business stream holds that person's
   * subscriptions to the business (its events and its sessions'), drops their cached decisions and re-checks them.
   */
  function onEntry(streamKey: string, entry: StreamEntry): void {
    const userId = membershipChangeOf(entry);
    if (!userId) return;
    const parsed = parseChannel(streamKey);
    if (!parsed || parsed.kind !== "business") return;
    deps.authorizer.invalidate?.(userId);
    const key = userId.toLowerCase();
    // Counts only matter while a decision is in flight; keep the map small.
    if (membershipChanges.size >= 10_000 && !membershipChanges.has(key)) membershipChanges.clear();
    membershipChanges.set(key, (membershipChanges.get(key) ?? 0) + 1);
    for (const client of clients) {
      if (!sameUser(client.user.userId, userId)) continue;
      for (const [ch, sub] of client.subs) {
        if (sub.businessId !== parsed.id) continue;
        sub.held ??= [];
        void recheck(client, ch, sub);
      }
    }
  }

  /** The periodic re-check of every live subscription (not those already being re-checked). */
  function reauthorizeAll(): void {
    for (const client of clients) {
      for (const [ch, sub] of client.subs) if (!sub.held) void recheck(client, ch, sub);
    }
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
    reauthorizer = setInterval(reauthorizeAll, reauthorizeMs);
    reauthorizer.unref?.();
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
      if (reauthorizer) clearInterval(reauthorizer);
      reauthorizer = null;
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
