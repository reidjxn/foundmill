/**
 * Per-socket outbound queue: coalescing and backpressure (docs/ARCHITECTURE.md §12).
 *
 * - At most `framesPerSecond` (20) frames per second per socket. The first event after an idle gap is sent at once
 *   (low latency); events arriving within the same 50 ms tick are coalesced into one array frame
 *   `[{ ch, e }, …]`, so a burst of 500 terminal chunks costs one write, not 500.
 * - Backpressure: while the socket's `bufferedAmount` is above `highWaterBytes` nothing more is written; the queue
 *   grows up to `maxQueue` entries, beyond which the oldest entries are dropped, preferring session channels the
 *   client has not marked focused, then any session channel, then anything. Business events (`ev:`) are dropped only
 *   as a last resort because the Inbox cannot replay them. A socket that stays above the high-water mark for
 *   `slowCloseMs` is closed with 1013 (the tab reconnects and re-subscribes from the live tail).
 * - Event JSON is spliced into the frame as text; nothing is parsed or re-serialised on the hot path.
 */
import { CLOSE_CODES, SERVER_FRAMES_PER_SECOND, SESSION_CHANNEL_PREFIX } from "./protocol";
import type { Metrics } from "./metrics";

export interface SocketLike {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string, cb?: (err?: Error) => void): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
}

export const WS_OPEN = 1;

export interface OutboundQueueOptions {
  framesPerSecond?: number;
  maxQueue?: number;
  highWaterBytes?: number;
  slowCloseMs?: number;
  now?: () => number;
  metrics?: Metrics;
  onDrop?: (channel: string, count: number) => void;
}

interface Queued {
  ch: string;
  json: string;
}

export function eventFrame(ch: string, json: string): string {
  return `{"ch":${JSON.stringify(ch)},"e":${json}}`;
}

export class OutboundQueue {
  readonly focused = new Set<string>();
  private readonly queue: Queued[] = [];
  private readonly intervalMs: number;
  private readonly maxQueue: number;
  private readonly highWaterBytes: number;
  private readonly slowCloseMs: number;
  private readonly now: () => number;
  private readonly metrics: Metrics | undefined;
  private readonly onDrop: ((channel: string, count: number) => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSendAt = -Infinity;
  private slowSince: number | null = null;
  private closed = false;
  /** Counters for tests and /health. */
  sent = 0;
  batches = 0;
  dropped = 0;

  constructor(
    private readonly socket: SocketLike,
    opts: OutboundQueueOptions = {},
  ) {
    this.intervalMs = Math.max(1, Math.round(1000 / (opts.framesPerSecond ?? SERVER_FRAMES_PER_SECOND)));
    this.maxQueue = Math.max(1, opts.maxQueue ?? 2_000);
    this.highWaterBytes = Math.max(1, opts.highWaterBytes ?? 1024 * 1024);
    this.slowCloseMs = Math.max(1, opts.slowCloseMs ?? 30_000);
    this.now = opts.now ?? (() => Date.now());
    this.metrics = opts.metrics;
    this.onDrop = opts.onDrop;
  }

  get size(): number {
    return this.queue.length;
  }

  /** Queue one event for `ch`. `json` is the already-serialised event. */
  push(ch: string, json: string): void {
    if (this.closed || this.socket.readyState !== WS_OPEN) return;
    this.queue.push({ ch, json });
    this.metrics?.add("queued_frames", 1);
    if (this.queue.length > this.maxQueue) this.shed();
    const now = this.now();
    if (this.timer === null && now - this.lastSendAt >= this.intervalMs && this.socket.bufferedAmount < this.highWaterBytes) {
      this.flush(now);
      return;
    }
    this.schedule(now);
  }

  /** Drop everything queued for a channel (after an unsubscribe). */
  purge(ch: string): void {
    let removed = 0;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i]!.ch === ch) {
        this.queue.splice(i, 1);
        removed++;
      }
    }
    if (removed > 0) this.metrics?.add("queued_frames", -removed);
  }

  close(): void {
    this.closed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.queue.length > 0) this.metrics?.add("queued_frames", -this.queue.length);
    this.queue.length = 0;
  }

  private schedule(now: number): void {
    if (this.timer !== null) return;
    const wait = Math.max(0, this.lastSendAt + this.intervalMs - now);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.tick();
    }, wait);
  }

  private tick(): void {
    if (this.closed) return;
    if (this.socket.readyState !== WS_OPEN) return this.close();
    const now = this.now();
    if (this.socket.bufferedAmount >= this.highWaterBytes) {
      this.slowSince ??= now;
      if (now - this.slowSince >= this.slowCloseMs) {
        this.metrics?.inc("slow_consumers_closed_total");
        this.socket.close(CLOSE_CODES.tooSlow, "client too slow");
        return this.close();
      }
      this.schedule(now);
      return;
    }
    this.slowSince = null;
    if (this.queue.length === 0) return;
    this.flush(now);
  }

  private flush(now: number): void {
    const items = this.queue.splice(0, this.queue.length);
    if (items.length === 0) return;
    this.metrics?.add("queued_frames", -items.length);
    const frame = items.length === 1 ? eventFrame(items[0]!.ch, items[0]!.json) : `[${items.map((q) => eventFrame(q.ch, q.json)).join(",")}]`;
    this.lastSendAt = now;
    this.sent += 1;
    this.metrics?.inc("frames_out_total");
    if (items.length > 1) {
      this.batches += 1;
      this.metrics?.inc("batches_out_total");
    }
    this.socket.send(frame, (err) => {
      if (err && !this.closed) this.close();
    });
  }

  /** Over capacity: drop the oldest entry of the least valuable channel. */
  private shed(): void {
    const overflow = this.queue.length - this.maxQueue;
    for (let n = 0; n < overflow; n++) {
      let idx = this.queue.findIndex((q) => q.ch.startsWith(SESSION_CHANNEL_PREFIX) && !this.focused.has(q.ch));
      if (idx === -1) idx = this.queue.findIndex((q) => q.ch.startsWith(SESSION_CHANNEL_PREFIX));
      if (idx === -1) idx = 0;
      const [victim] = this.queue.splice(idx, 1);
      this.dropped += 1;
      this.metrics?.inc("events_dropped_total");
      this.metrics?.add("queued_frames", -1);
      if (victim) this.onDrop?.(victim.ch, 1);
    }
  }
}
