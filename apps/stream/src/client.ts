/**
 * Browser-safe stream client (docs/ARCHITECTURE.md §12, §14 `lib/stream.ts`; BUILD §8.2).
 *
 * One WebSocket per tab multiplexes every subscription. `subscribe(channel, handler)` returns an unsubscribe;
 * the server-side `sub` is sent once per channel (on the first handler) and `unsub` when the last handler leaves.
 * Reconnects automatically with exponential backoff and jitter, re-subscribing every channel, and fetches a fresh
 * token each time (Supabase access tokens expire). Focus-aware throttling: channels marked unfocused deliver in
 * bursts at most 4 times per second (every event is still delivered, so the tile re-renders ≤ 4×/s without losing
 * terminal output); the focused tile gets every event as it arrives. A per-channel buffer cap drops the oldest
 * events of an unfocused channel when a tab is far behind.
 *
 * No Node imports: this file is imported by apps/web. Only `./protocol` (dependency-free) is used.
 */
import {
  CLOSE_CODES,
  isErrorFrame,
  isEventFrame,
  isPongFrame,
  UNFOCUSED_BURSTS_PER_SECOND,
  type ClientFrame,
  type ErrorFrame,
  type EventFrame,
} from "./protocol";

export type StreamHandler = (event: unknown) => void;
export type StreamStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

/** Minimal WebSocket surface the client needs (the browser's `WebSocket`, Node 22's global, or `ws`). */
export interface WebSocketLike {
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number; reason?: string | unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface StreamClientOptions {
  /** WebSocket endpoint, e.g. `wss://stream.foundmill.com` (NEXT_PUBLIC_STREAM_URL). `?token=` is appended. */
  url: string;
  /** Supplies the current access token (async so it can refresh). Return `""` to connect anonymously (dev bypass). */
  getToken: () => string | Promise<string>;
  /** WebSocket constructor (defaults to the global `WebSocket`). */
  webSocket?: new (url: string) => WebSocketLike;
  /** First reconnect delay (default 250 ms), doubling with jitter up to `maxBackoffMs` (default 10 000 ms). */
  minBackoffMs?: number;
  maxBackoffMs?: number;
  /** Client ping interval (default 20 000 ms); no frame within two intervals closes and reconnects. */
  pingMs?: number;
  /** Bursts per second for unfocused channels (default 4). */
  unfocusedBurstsPerSecond?: number;
  /** Oldest events of an unfocused channel are dropped beyond this buffer (default 2 000). */
  maxBufferedPerChannel?: number;
  onStatus?: (status: StreamStatus, detail?: { code?: number; reason?: string; attempt?: number }) => void;
  /** Server-side errors (`forbidden`, `invalid_channel`, …). */
  onError?: (err: ErrorFrame) => void;
  /** Called when buffered events of an unfocused channel were dropped. */
  onDrop?: (channel: string, count: number) => void;
  now?: () => number;
  /** Timer injection for tests. */
  setTimeout?: TimerSet;
  clearTimeout?: TimerClear;
}

export type TimerHandle = unknown;
export type TimerSet = (fn: () => void, ms: number) => TimerHandle;
export type TimerClear = (handle: TimerHandle) => void;

interface ChannelState {
  handlers: Set<StreamHandler>;
  focused: boolean;
  buffer: unknown[];
  flushTimer: TimerHandle | null;
  lastFlushAt: number;
  /** True once the server has been sent `sub` on the current socket. */
  sent: boolean;
}

const WS_OPEN = 1;

export class StreamClient {
  private readonly channels = new Map<string, ChannelState>();
  private ws: WebSocketLike | null = null;
  private status: StreamStatus = "idle";
  private attempt = 0;
  private reconnectTimer: TimerHandle | null = null;
  private pingTimer: TimerHandle | null = null;
  private lastFrameAt = 0;
  private closedByUser = false;
  private connectSeq = 0;
  private readonly minBackoff: number;
  private readonly maxBackoff: number;
  private readonly pingMs: number;
  private readonly burstIntervalMs: number;
  private readonly maxBuffered: number;
  private readonly now: () => number;
  private readonly setTimer: TimerSet;
  private readonly clearTimer: TimerClear;
  /** Counters for tests and devtools. */
  readonly stats = { connects: 0, reconnects: 0, framesIn: 0, eventsIn: 0, dropped: 0, errors: 0 };

  constructor(private readonly opts: StreamClientOptions) {
    this.minBackoff = Math.max(1, opts.minBackoffMs ?? 250);
    this.maxBackoff = Math.max(this.minBackoff, opts.maxBackoffMs ?? 10_000);
    this.pingMs = Math.max(10, opts.pingMs ?? 20_000);
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

  /** Channels with at least one handler. */
  subscribedChannels(): string[] {
    return [...this.channels.keys()];
  }

  /**
   * Subscribe to `ev:<businessId>` or `as:<sessionId>`. Connects lazily on the first subscription.
   * `focused` (default true) controls throttling; change it later with `setFocus`.
   */
  subscribe(channel: string, handler: StreamHandler, options: { focused?: boolean } = {}): () => void {
    let state = this.channels.get(channel);
    const first = !state;
    if (!state) {
      state = { handlers: new Set(), focused: options.focused ?? true, buffer: [], flushTimer: null, lastFlushAt: -Infinity, sent: false };
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
      if (this.isOpen && s.sent) this.send({ t: "unsub", ch: channel });
    };
  }

  /** Mark a channel focused (full rate) or unfocused (≤ 4 bursts/s). Also tells the server which tiles matter under backpressure. */
  setFocus(channel: string, focused: boolean): void {
    const s = this.channels.get(channel);
    if (!s || s.focused === focused) return;
    s.focused = focused;
    if (focused) this.flushChannel(channel, s);
    if (this.isOpen && s.sent) this.send({ t: "focus", ch: channel, focused });
  }

  /** Send a protocol ping; the server answers with `{ t: "pong" }`. */
  ping(): void {
    if (this.isOpen) this.send({ t: "ping" });
  }

  /** Close the socket and stop reconnecting. Subscriptions are kept; the next `subscribe` or `connect()` reopens. */
  close(): void {
    this.closedByUser = true;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    for (const s of this.channels.values()) s.sent = false;
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

  /** Open the socket now (normally implicit). */
  connect(): void {
    if (this.ws || this.reconnectTimer !== null) return;
    this.closedByUser = false;
    void this.open();
  }

  // ---------------------------------------------------------------------------------------------- internals

  private setStatus(status: StreamStatus, detail?: { code?: number; reason?: string; attempt?: number }): void {
    this.status = status;
    this.opts.onStatus?.(status, detail);
  }

  private send(frame: ClientFrame): void {
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

  private async open(): Promise<void> {
    const seq = ++this.connectSeq;
    this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting", { attempt: this.attempt });
    const token = await Promise.resolve()
      .then(() => this.opts.getToken())
      .catch(() => "");
    if (seq !== this.connectSeq || this.closedByUser) return;
    const Ctor = this.opts.webSocket ?? (globalThis as unknown as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
    if (!Ctor) throw new Error("No WebSocket implementation available");
    const url = new URL(this.opts.url);
    if (token) url.searchParams.set("token", token);
    else url.searchParams.delete("token");
    let ws: WebSocketLike;
    try {
      ws = new Ctor(url.toString());
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
      for (const s of this.channels.values()) s.sent = false;
      const code = typeof ev?.code === "number" ? ev.code : undefined;
      const reason = typeof ev?.reason === "string" ? ev.reason : undefined;
      if (this.closedByUser) return this.setStatus("closed", { code, reason });
      if (code === CLOSE_CODES.unauthorized) this.attempt = Math.max(this.attempt, 3); // back off harder on auth failures
      this.scheduleReconnect({ code, reason });
    };
  }

  private scheduleReconnect(detail: { code?: number; reason?: string } = {}): void {
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
    const tick = () => {
      this.pingTimer = null;
      if (!this.isOpen) return;
      if (this.now() - this.lastFrameAt > this.pingMs * 2) {
        // Dead socket (laptop slept, proxy dropped us): close and let the reconnect path handle it.
        const ws = this.ws!;
        this.ws = null;
        ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
        try {
          ws.close(CLOSE_CODES.heartbeatTimeout, "no frames");
        } catch {
          /* ignore */
        }
        for (const s of this.channels.values()) s.sent = false;
        this.scheduleReconnect({ code: CLOSE_CODES.heartbeatTimeout, reason: "no frames" });
        return;
      }
      this.ping();
      this.pingTimer = this.setTimer(tick, this.pingMs);
    };
    this.pingTimer = this.setTimer(tick, this.pingMs);
  }

  private clearTimers(): void {
    if (this.reconnectTimer !== null) this.clearTimer(this.reconnectTimer);
    if (this.pingTimer !== null) this.clearTimer(this.pingTimer);
    this.reconnectTimer = null;
    this.pingTimer = null;
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
    if (isErrorFrame(frame)) {
      this.stats.errors += 1;
      this.opts.onError?.(frame);
    }
  }

  private deliver(frame: EventFrame): void {
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
