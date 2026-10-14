/**
 * Browser client for apps/stream (docs/ARCHITECTURE.md §12 and §14 `lib/stream.ts`; docs/DECISIONS.md
 * "apps/stream: protocol extensions"). apps/stream is not a dependency of apps/web, so the protocol is
 * implemented here, frame-compatible with apps/stream/src/client.ts:
 *
 *   client → server  { t:"sub", ch, focus? } · { t:"unsub", ch } · { t:"ping" } · { t:"focus", ch, focused }
 *                    · { t:"auth", token }
 *   server → client  { ch, e } · [ { ch, e }, … ] (coalesced burst) · { t:"pong" } · { t:"err", ch?, code, message }
 *                    · { t:"subscribed", ch } · { t:"authed", exp }
 *
 * The access token never goes in the URL, where proxies and CDNs log it (security review SEC-12): it travels in the
 * `foundmill.bearer.<base64url>` subprotocol next to `foundmill.stream.v1`. The server closes a socket when its token
 * expires (4001), so before then the client fetches a fresh token and sends it on the open socket (`auth`).
 *
 * One WebSocket per tab multiplexes every subscription; `sub` is sent once per channel (first handler) and `unsub`
 * when the last handler leaves. Reconnects with exponential backoff + jitter, re-subscribing every channel and
 * fetching a fresh token each time. Unfocused channels deliver in at most 4 bursts per second (every event is still
 * delivered); the focused tile gets every event as it arrives. A per-channel buffer cap drops the oldest events of
 * an unfocused channel when a tab is far behind (reported through `onDrop`).
 *
 * Liveness is per channel, not per socket: a channel is live once the server acknowledges its `sub` and stops being
 * live when the socket closes or goes silent, when the server refuses it (`err` with its `ch`; refusals that can heal
 * are asked again with backoff on the same socket) or when it is unsubscribed. `onChannel` reports each change. The
 * server does not replay what it sent while a channel was not live, so a channel that comes back after a gap (a
 * reconnect, a retried refusal, a return to a channel this tab had before) is reported with `resync: true` and the app
 * refetches what that channel keeps current. A tab that becomes visible again calls `checkConnection()`, which probes
 * a socket that may have slept (half-open) with a short deadline instead of a whole heartbeat.
 */

export type StreamHandler = (event: unknown) => void;
export type StreamStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export type StreamErrorCode = "bad_frame" | "invalid_channel" | "forbidden" | "unavailable" | "too_many_subscriptions" | "shutting_down";
export interface StreamErrorFrame {
  t: "err";
  ch?: string;
  code: StreamErrorCode;
  message: string;
}
export interface StreamEventFrame {
  ch: string;
  e: unknown;
}
/** The server's acknowledgement that a subscription is live: every event from here on is delivered. */
export interface StreamSubscribedFrame {
  t: "subscribed";
  ch: string;
}
export type StreamClientFrame = { t: "sub"; ch: string; focus?: boolean } | { t: "unsub"; ch: string } | { t: "ping" } | { t: "focus"; ch: string; focused: boolean } | { t: "auth"; token: string };

export const CLOSE_CODES = { goingAway: 1001, policyViolation: 1008, tooSlow: 1013, heartbeatTimeout: 4000, unauthorized: 4001, forbidden: 4003 } as const;
/** The subprotocol every socket offers (and the server selects); the token rides in a second one (`bearerProtocol`). */
export const STREAM_SUBPROTOCOL = "foundmill.stream.v1";
export const BEARER_PROTOCOL_PREFIX = "foundmill.bearer.";

function base64Url(text: string): string {
  let binary = "";
  for (const b of new TextEncoder().encode(text)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The subprotocols a socket offers: the stream's own, plus the token when there is one. */
export function streamProtocols(token: string | null | undefined): string[] {
  return token ? [STREAM_SUBPROTOCOL, `${BEARER_PROTOCOL_PREFIX}${base64Url(token)}`] : [STREAM_SUBPROTOCOL];
}

/** When a JWT expires (epoch ms), read without verifying it; null for a dev token or anything that is not a JWT. */
export function tokenExpiry(token: string | null | undefined): number | null {
  const payload = token?.split(".")[1];
  if (!payload || !/^[A-Za-z0-9_-]+$/.test(payload)) return null;
  try {
    const exp = (JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: unknown }).exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}
export const UNFOCUSED_BURSTS_PER_SECOND = 4;
/**
 * Refusals asked again on the same socket, with backoff: a membership check that failed (`unavailable`), a membership
 * the server has not seen yet (`forbidden`, cached for seconds), a full socket, a server on its way out. A malformed
 * channel is never retried.
 */
export const RESUBSCRIBE_CODES: readonly StreamErrorCode[] = ["unavailable", "forbidden", "too_many_subscriptions", "shutting_down"];

export const businessChannel = (businessId: string): string => `ev:${businessId}`;
export const sessionChannel = (sessionId: string): string => `as:${sessionId}`;
/** The business of an `ev:<businessId>` channel; null for any other channel. */
export const businessIdOfChannel = (channel: string): string | null => (channel.startsWith("ev:") && channel.length > 3 ? channel.slice(3) : null);

export function isEventFrame(v: unknown): v is StreamEventFrame {
  return typeof v === "object" && v !== null && typeof (v as StreamEventFrame).ch === "string" && "e" in (v as object);
}
export function isPongFrame(v: unknown): v is { t: "pong" } {
  return typeof v === "object" && v !== null && (v as { t?: string }).t === "pong";
}
export function isErrorFrame(v: unknown): v is StreamErrorFrame {
  return typeof v === "object" && v !== null && (v as { t?: string }).t === "err" && typeof (v as StreamErrorFrame).code === "string";
}
export function isSubscribedFrame(v: unknown): v is StreamSubscribedFrame {
  return typeof v === "object" && v !== null && (v as { t?: string }).t === "subscribed" && typeof (v as StreamSubscribedFrame).ch === "string";
}

/** Minimal WebSocket surface (the browser's WebSocket, or a fake in tests). */
export interface WebSocketLike {
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number; reason?: string | unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type TimerHandle = unknown;

export interface StreamClientOptions {
  /** WebSocket endpoint (NEXT_PUBLIC_STREAM_URL); the token is never put in it. */
  url: string;
  /** Current access token; "" connects anonymously (dev bypass). */
  getToken: () => string | Promise<string>;
  webSocket?: new (url: string, protocols?: string[]) => WebSocketLike;
  /** How long before the token expires a fresh one is sent on the open socket (default 60 000 ms). */
  renewBeforeMs?: number;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  pingMs?: number;
  /** How long a probe (`checkConnection`) waits for any frame before it replaces the socket. */
  probeMs?: number;
  /** Ceiling of the backoff between asks for a refused subscription. */
  maxResubscribeMs?: number;
  unfocusedBurstsPerSecond?: number;
  maxBufferedPerChannel?: number;
  onStatus?: (status: StreamStatus, detail?: { code?: number; reason?: string; attempt?: number }) => void;
  onError?: (err: StreamErrorFrame) => void;
  /**
   * A channel became live (the server acknowledged it) or stopped being live. `resync` is true when it comes back after
   * a gap in which events may have been missed (it was live before in this tab, or a socket dropped or the server
   * refused it since it was asked for).
   */
  onChannel?: (channel: string, live: boolean, detail: { resync: boolean }) => void;
  onDrop?: (channel: string, count: number) => void;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => TimerHandle;
  clearTimeout?: (handle: TimerHandle) => void;
}

interface ChannelState {
  handlers: Set<StreamHandler>;
  focused: boolean;
  buffer: unknown[];
  flushTimer: TimerHandle | null;
  lastFlushAt: number;
  sent: boolean;
  /** The server acknowledged the subscription on the current socket. */
  live: boolean;
  /** Events may have been missed since this channel was asked for (a dropped socket, a refusal). */
  missed: boolean;
  retryTimer: TimerHandle | null;
  retries: number;
}

const WS_OPEN = 1;

export class StreamClient {
  private readonly channels = new Map<string, ChannelState>();
  private ws: WebSocketLike | null = null;
  private status: StreamStatus = "idle";
  private attempt = 0;
  private reconnectTimer: TimerHandle | null = null;
  private pingTimer: TimerHandle | null = null;
  private renewTimer: TimerHandle | null = null;
  private lastFrameAt = 0;
  /** When the outstanding heartbeat ping was sent; any frame after it proves the link alive. */
  private pingSentAt: number | null = null;
  /** Channels that were live at some point in this tab (coming back to one is a gap). */
  private readonly everLive = new Set<string>();
  private closedByUser = false;
  private connectSeq = 0;
  private readonly minBackoff: number;
  private readonly maxBackoff: number;
  private readonly pingMs: number;
  private readonly renewBefore: number;
  private readonly probeMs: number;
  private readonly maxResubscribe: number;
  private readonly burstIntervalMs: number;
  private readonly maxBuffered: number;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => TimerHandle;
  private readonly clearTimer: (handle: TimerHandle) => void;
  readonly stats = { connects: 0, reconnects: 0, framesIn: 0, eventsIn: 0, dropped: 0, errors: 0 };

  constructor(private readonly opts: StreamClientOptions) {
    this.minBackoff = Math.max(1, opts.minBackoffMs ?? 250);
    this.maxBackoff = Math.max(this.minBackoff, opts.maxBackoffMs ?? 10_000);
    this.pingMs = Math.max(10, opts.pingMs ?? 20_000);
    this.renewBefore = Math.max(0, opts.renewBeforeMs ?? 60_000);
    this.probeMs = Math.max(10, Math.min(this.pingMs, opts.probeMs ?? 5_000));
    this.maxResubscribe = Math.max(this.minBackoff, opts.maxResubscribeMs ?? 30_000);
    this.burstIntervalMs = Math.max(1, Math.round(1000 / (opts.unfocusedBurstsPerSecond ?? UNFOCUSED_BURSTS_PER_SECOND)));
    this.maxBuffered = Math.max(1, opts.maxBufferedPerChannel ?? 2_000);
    this.now = opts.now ?? (() => Date.now());
    this.setTimer = opts.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
    this.clearTimer = opts.clearTimeout ?? ((t) => globalThis.clearTimeout(t as ReturnType<typeof globalThis.setTimeout>));
  }

  get state(): StreamStatus {
    return this.status;
  }
  get isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WS_OPEN;
  }
  subscribedChannels(): string[] {
    return [...this.channels.keys()];
  }
  /** True while the server has acknowledged `channel` on the open socket. */
  isLive(channel: string): boolean {
    return this.channels.get(channel)?.live ?? false;
  }

  /** Subscribe to `ev:<businessId>` or `as:<sessionId>`; connects lazily on the first subscription. */
  subscribe(channel: string, handler: StreamHandler, options: { focused?: boolean } = {}): () => void {
    let state = this.channels.get(channel);
    const first = !state;
    if (!state) {
      state = { handlers: new Set(), focused: options.focused ?? true, buffer: [], flushTimer: null, lastFlushAt: -Infinity, sent: false, live: false, missed: false, retryTimer: null, retries: 0 };
      this.channels.set(channel, state);
    } else if (options.focused !== undefined) {
      this.setFocus(channel, options.focused);
    }
    state.handlers.add(handler);
    if (first) {
      this.closedByUser = false;
      if (this.isOpen) this.sendSub(channel, state);
      else this.connect();
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const s = this.channels.get(channel);
      if (!s) return;
      s.handlers.delete(handler);
      if (s.handlers.size > 0) return;
      this.channels.delete(channel);
      if (s.flushTimer !== null) this.clearTimer(s.flushTimer);
      if (s.retryTimer !== null) this.clearTimer(s.retryTimer);
      if (this.isOpen && s.sent) this.send({ t: "unsub", ch: channel });
      this.setDown(channel, s);
    };
  }

  /** Focused channels get every event; unfocused ones are delivered in ≤ 4 bursts/s and shed first under backpressure. */
  setFocus(channel: string, focused: boolean): void {
    const s = this.channels.get(channel);
    if (!s || s.focused === focused) return;
    s.focused = focused;
    if (focused) this.flushChannel(channel, s);
    if (this.isOpen && s.sent) this.send({ t: "focus", ch: channel, focused });
  }

  ping(): void {
    if (this.isOpen) this.send({ t: "ping" });
  }

  /**
   * The tab became visible or the browser came back online: retry a pending reconnect now, and probe an open socket
   * (a laptop that slept leaves one half-open, which only a missing answer reveals) with `probeMs` to answer.
   */
  checkConnection(): void {
    if (this.closedByUser || this.channels.size === 0) return;
    if (this.reconnectTimer !== null) {
      this.clearTimer(this.reconnectTimer);
      this.reconnectTimer = null;
      void this.open();
      return;
    }
    if (!this.isOpen) return;
    if (this.pingTimer !== null) this.clearTimer(this.pingTimer);
    this.pingSentAt = this.now();
    this.ping();
    this.pingTimer = this.setTimer(() => this.heartbeat(), this.probeMs);
  }

  /** Close and stop reconnecting; subscriptions are kept and the next subscribe/connect reopens. */
  close(): void {
    this.closedByUser = true;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    this.channelsDown();
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close(1000, "client closed");
      } catch {
        /* already closed */
      }
    }
    this.setStatus("closed");
  }

  connect(): void {
    if (this.ws || this.reconnectTimer !== null) return;
    this.closedByUser = false;
    void this.open();
  }

  private setStatus(status: StreamStatus, detail?: { code?: number; reason?: string; attempt?: number }): void {
    this.status = status;
    this.opts.onStatus?.(status, detail);
  }

  private send(frame: StreamClientFrame): void {
    if (!this.ws || this.ws.readyState !== WS_OPEN) return;
    try {
      this.ws.send(JSON.stringify(frame));
    } catch {
      /* the close handler reconnects */
    }
  }

  private sendSub(channel: string, state: ChannelState): void {
    this.send(state.focused ? { t: "sub", ch: channel } : { t: "sub", ch: channel, focus: false });
    state.sent = true;
  }

  /** The socket is gone (closed, silent or closed by the app): no channel is live, and each may miss events until it is again. */
  private channelsDown(): void {
    for (const [channel, s] of this.channels) {
      s.sent = false;
      s.missed = true;
      s.retries = 0;
      if (s.retryTimer !== null) this.clearTimer(s.retryTimer);
      s.retryTimer = null;
      this.setDown(channel, s);
    }
  }

  private setDown(channel: string, s: ChannelState): void {
    if (!s.live) return;
    s.live = false;
    this.opts.onChannel?.(channel, false, { resync: false });
  }

  private onSubscribed(channel: string): void {
    const s = this.channels.get(channel);
    if (!s || s.live) return; // unsubscribed meanwhile, or a repeated acknowledgement
    s.sent = true;
    s.live = true;
    s.retries = 0;
    if (s.retryTimer !== null) this.clearTimer(s.retryTimer);
    s.retryTimer = null;
    const resync = s.missed || this.everLive.has(channel);
    s.missed = false;
    this.everLive.add(channel);
    this.opts.onChannel?.(channel, true, { resync });
  }

  /** The server refused a channel: it is not live, and a refusal that can heal is asked again with backoff. */
  private onRefused(frame: StreamErrorFrame): void {
    const channel = frame.ch;
    const s = channel ? this.channels.get(channel) : undefined;
    if (!channel || !s) return;
    s.sent = false;
    s.missed = true;
    this.setDown(channel, s);
    if (!RESUBSCRIBE_CODES.includes(frame.code) || s.retryTimer !== null) return;
    const base = Math.min(this.maxResubscribe, this.minBackoff * 2 ** (s.retries + 2));
    const delay = Math.round(base / 2 + Math.random() * (base / 2));
    s.retries += 1;
    s.retryTimer = this.setTimer(() => {
      s.retryTimer = null;
      // Still wanted and not asked meanwhile; a closed socket re-sends every channel when it reopens.
      if (this.channels.get(channel) === s && !s.sent && this.isOpen) this.sendSub(channel, s);
    }, delay);
  }

  private async open(): Promise<void> {
    const seq = ++this.connectSeq;
    this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting", { attempt: this.attempt });
    const token = await Promise.resolve()
      .then(() => this.opts.getToken())
      .catch(() => "");
    if (seq !== this.connectSeq || this.closedByUser) return;
    const Ctor = this.opts.webSocket ?? (globalThis as unknown as { WebSocket?: new (url: string, protocols?: string[]) => WebSocketLike }).WebSocket;
    if (!Ctor) {
      this.setStatus("closed", { reason: "no WebSocket implementation" });
      return;
    }
    const url = new URL(this.opts.url);
    url.searchParams.delete("token"); // the server refuses a token in the URL
    let ws: WebSocketLike;
    try {
      ws = new Ctor(url.toString(), streamProtocols(token));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.stats.connects += 1;
      if (this.attempt > 0) this.stats.reconnects += 1;
      this.attempt = 0;
      this.lastFrameAt = this.now();
      this.setStatus("open");
      for (const [channel, state] of this.channels) this.sendSub(channel, state);
      this.startPing();
      this.scheduleRenewal(token);
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.lastFrameAt = this.now();
      this.stats.framesIn += 1;
      this.handleMessage(ev.data);
    };
    ws.onerror = () => {
      /* onclose follows */
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clearTimers();
      this.channelsDown();
      const code = typeof ev?.code === "number" ? ev.code : undefined;
      const reason = typeof ev?.reason === "string" ? ev.reason : undefined;
      if (this.closedByUser) return this.setStatus("closed", { code, reason });
      if (code === CLOSE_CODES.unauthorized || code === CLOSE_CODES.forbidden) this.attempt = Math.max(this.attempt, 3);
      this.scheduleReconnect({ code, reason });
    };
  }

  private scheduleReconnect(detail: { code?: number; reason?: string } = {}): void {
    for (const s of this.channels.values()) s.missed = true;
    if (this.closedByUser || this.channels.size === 0 || this.reconnectTimer !== null) {
      if (this.channels.size === 0) this.setStatus("idle", detail);
      return;
    }
    const base = Math.min(this.maxBackoff, this.minBackoff * 2 ** this.attempt);
    const delay = Math.round(base / 2 + Math.random() * (base / 2));
    this.attempt += 1;
    this.setStatus("reconnecting", { ...detail, attempt: this.attempt });
    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = null;
      void this.open();
    }, delay);
  }

  private startPing(): void {
    if (this.pingTimer !== null) this.clearTimer(this.pingTimer);
    this.pingSentAt = null;
    this.pingTimer = this.setTimer(() => this.heartbeat(), this.pingMs);
  }

  /**
   * One heartbeat: a ping still unanswered (no frame of any kind since it was sent) means the link is dead, even when
   * the socket says it is open (a stalled or half-open link); otherwise ping again.
   */
  private heartbeat(): void {
    this.pingTimer = null;
    if (!this.isOpen) return;
    if (this.pingSentAt !== null && this.lastFrameAt < this.pingSentAt) return this.dropSilentSocket();
    this.pingSentAt = this.now();
    this.ping();
    this.pingTimer = this.setTimer(() => this.heartbeat(), this.pingMs);
  }

  private dropSilentSocket(): void {
    const ws = this.ws!;
    this.ws = null;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try {
      ws.close(CLOSE_CODES.heartbeatTimeout, "no frames");
    } catch {
      /* ignore */
    }
    this.clearTimers();
    this.channelsDown();
    this.scheduleReconnect({ code: CLOSE_CODES.heartbeatTimeout, reason: "no frames" });
  }

  /**
   * Before the token in use expires, fetch a fresh one and send it on the open socket, so the server (which closes a
   * socket at its token's expiry) keeps it. A dev token has no expiry. A token the server refuses closes the socket,
   * and the reconnect fetches a token again.
   */
  private scheduleRenewal(token: string, retryInMs?: number): void {
    if (this.renewTimer !== null) this.clearTimer(this.renewTimer);
    this.renewTimer = null;
    const exp = tokenExpiry(token);
    if (exp === null) return;
    const ws = this.ws;
    this.renewTimer = this.setTimer(
      () => {
        this.renewTimer = null;
        void Promise.resolve()
          .then(() => this.opts.getToken())
          .catch(() => "")
          .then((fresh) => {
            if (this.ws !== ws || !this.isOpen) return;
            // Not refreshed yet (or signed out): ask again shortly, until the server closes the socket at expiry.
            if (!fresh || fresh === token) return this.now() < exp ? this.scheduleRenewal(token, Math.max(1_000, Math.min(15_000, this.renewBefore / 4))) : undefined;
            this.send({ t: "auth", token: fresh });
            this.scheduleRenewal(fresh);
          });
      },
      retryInMs ?? Math.max(0, exp - this.now() - this.renewBefore),
    );
  }

  private clearTimers(): void {
    if (this.reconnectTimer !== null) this.clearTimer(this.reconnectTimer);
    if (this.pingTimer !== null) this.clearTimer(this.pingTimer);
    if (this.renewTimer !== null) this.clearTimer(this.renewTimer);
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.renewTimer = null;
    this.pingSentAt = null;
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") return;
    let frame: unknown;
    try {
      frame = JSON.parse(data);
    } catch {
      return;
    }
    if (Array.isArray(frame)) {
      for (const f of frame) if (isEventFrame(f)) this.deliver(f);
      return;
    }
    if (isEventFrame(frame)) return this.deliver(frame);
    if (isPongFrame(frame)) return;
    if (isSubscribedFrame(frame)) return this.onSubscribed(frame.ch);
    if (isErrorFrame(frame)) {
      this.stats.errors += 1;
      this.onRefused(frame);
      this.opts.onError?.(frame);
    }
  }

  private deliver(frame: StreamEventFrame): void {
    const s = this.channels.get(frame.ch);
    if (!s) return;
    this.stats.eventsIn += 1;
    if (s.focused) {
      for (const h of s.handlers) this.call(h, frame.e);
      return;
    }
    s.buffer.push(frame.e);
    if (s.buffer.length > this.maxBuffered) {
      const over = s.buffer.length - this.maxBuffered;
      s.buffer.splice(0, over);
      this.stats.dropped += over;
      this.opts.onDrop?.(frame.ch, over);
    }
    const now = this.now();
    if (s.flushTimer !== null) return;
    const wait = Math.max(0, s.lastFlushAt + this.burstIntervalMs - now);
    if (wait === 0) return this.flushChannel(frame.ch, s);
    s.flushTimer = this.setTimer(() => {
      s.flushTimer = null;
      this.flushChannel(frame.ch, s);
    }, wait);
  }

  private flushChannel(channel: string, s: ChannelState): void {
    if (s.flushTimer !== null) {
      this.clearTimer(s.flushTimer);
      s.flushTimer = null;
    }
    if (s.buffer.length === 0) return;
    const events = s.buffer.splice(0, s.buffer.length);
    s.lastFlushAt = this.now();
    for (const e of events) for (const h of s.handlers) this.call(h, e);
  }

  private call(handler: StreamHandler, event: unknown): void {
    try {
      handler(event);
    } catch (err) {
      console.error("[stream] handler threw", err);
    }
  }
}

export function createStreamClient(opts: StreamClientOptions): StreamClient {
  return new StreamClient(opts);
}
