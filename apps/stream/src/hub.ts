/**
 * Redis stream readers shared across sockets (docs/ARCHITECTURE.md §12, BUILD §8.2).
 *
 * One reader per subscribed stream key, regardless of how many sockets want it. A reader runs a blocking
 * `XREAD BLOCK … STREAMS <key> <lastId>` loop on its own connection (`redis.duplicate()`; blocking commands must
 * never share the connection other commands use), starting at the tail (`$`) and continuing from the last seen id,
 * so a lost connection resumes without a gap once it reconnects. Errors back off exponentially (100 ms → 5 s) and
 * the reader keeps retrying until the last listener leaves, when it stops and releases its connection.
 *
 * Listeners get the raw entry (`{ stream, id, fields }`); the server forwards `fields.json` verbatim so an event
 * written by the relay or `publishSessionEvent` reaches the tab without being parsed and re-serialised here.
 */
import { parseReadReply, type StreamEntry, type StreamRedis } from "@foundmill/events";
import type { Metrics } from "./metrics";

export type HubListener = (entry: StreamEntry) => void;

export interface StreamLog {
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export const silentLog: StreamLog = { debug() {}, info() {}, warn() {}, error() {} };

export interface StreamHubOptions {
  /** XREAD BLOCK timeout per loop iteration (default 5 000 ms; tests use less so stop() returns quickly). */
  blockMs?: number;
  /** COUNT per XREAD (default 256). */
  count?: number;
  /** First retry delay after a read error (default 100 ms), doubling up to `reconnectMaxMs` (default 5 000 ms). */
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
  log?: StreamLog;
  metrics?: Metrics;
}

interface Reader {
  key: string;
  listeners: Set<HubListener>;
  stopped: boolean;
  lastId: string;
  /** True while the reader is backing off after an error (surfaces in /health). */
  degraded: boolean;
  reconnects: number;
  done: Promise<void>;
  conn: StreamRedis;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function closeConnection(conn: StreamRedis, base: StreamRedis): void {
  if (conn === base) return;
  const c = conn as StreamRedis & { disconnect?: () => void };
  try {
    if (typeof c.disconnect === "function") c.disconnect();
    else void conn.quit().catch(() => {});
  } catch {
    /* already closed */
  }
}

export class StreamHub {
  private readonly readers = new Map<string, Reader>();
  private readonly blockMs: number;
  private readonly count: number;
  private readonly reconnectMinMs: number;
  private readonly reconnectMaxMs: number;
  private readonly log: StreamLog;
  private readonly metrics: Metrics | undefined;
  private closed = false;

  constructor(
    private readonly redis: StreamRedis,
    opts: StreamHubOptions = {},
  ) {
    this.blockMs = Math.max(1, opts.blockMs ?? 5_000);
    this.count = Math.max(1, opts.count ?? 256);
    this.reconnectMinMs = Math.max(1, opts.reconnectMinMs ?? 100);
    this.reconnectMaxMs = Math.max(this.reconnectMinMs, opts.reconnectMaxMs ?? 5_000);
    this.log = opts.log ?? silentLog;
    this.metrics = opts.metrics;
  }

  /** Number of live readers (one per stream key with at least one listener). */
  get readerCount(): number {
    return this.readers.size;
  }

  /** Stream keys currently being read. */
  keys(): string[] {
    return [...this.readers.keys()];
  }

  /** False when any reader is retrying after a Redis error. */
  get healthy(): boolean {
    for (const r of this.readers.values()) if (r.degraded) return false;
    return true;
  }

  /** Total reconnects across readers (also counted in metrics). */
  get reconnects(): number {
    let n = 0;
    for (const r of this.readers.values()) n += r.reconnects;
    return n;
  }

  /** Attach a listener to a stream; starts the reader on the first listener. Returns the detach function. */
  subscribe(streamKey: string, listener: HubListener): () => void {
    if (this.closed) throw new Error("StreamHub is closed");
    let reader = this.readers.get(streamKey);
    if (!reader) {
      reader = this.start(streamKey);
      this.readers.set(streamKey, reader);
      this.metrics?.set("readers_open", this.readers.size);
    }
    reader.listeners.add(listener);
    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      reader!.listeners.delete(listener);
      if (reader!.listeners.size === 0) this.stop(streamKey);
    };
  }

  /** Stop every reader. Resolves once all loops have exited. */
  async close(): Promise<void> {
    this.closed = true;
    const pending = [...this.readers.keys()].map((k) => this.stop(k));
    await Promise.all(pending);
  }

  private stop(streamKey: string): Promise<void> {
    const reader = this.readers.get(streamKey);
    if (!reader) return Promise.resolve();
    this.readers.delete(streamKey);
    this.metrics?.set("readers_open", this.readers.size);
    reader.stopped = true;
    closeConnection(reader.conn, this.redis);
    return reader.done;
  }

  private start(key: string): Reader {
    const reader: Reader = {
      key,
      listeners: new Set(),
      stopped: false,
      lastId: "$",
      degraded: false,
      reconnects: 0,
      done: Promise.resolve(),
      conn: this.redis.duplicate?.() ?? this.redis,
    };
    reader.done = this.loop(reader);
    return reader;
  }

  private async loop(reader: Reader): Promise<void> {
    let backoff = this.reconnectMinMs;
    while (!reader.stopped) {
      try {
        const reply = await reader.conn.xread("COUNT", this.count, "BLOCK", this.blockMs, "STREAMS", reader.key, reader.lastId);
        if (reader.stopped) break;
        if (reader.degraded) {
          reader.degraded = false;
          this.log.info({ stream: reader.key, lastId: reader.lastId }, "stream reader recovered");
        }
        backoff = this.reconnectMinMs;
        const entries = parseReadReply(reply);
        if (entries.length === 0) continue;
        this.metrics?.inc("events_in_total", entries.length);
        for (const entry of entries) {
          reader.lastId = entry.id;
          for (const listener of reader.listeners) {
            try {
              listener(entry);
            } catch (err) {
              this.log.error({ err, stream: reader.key }, "stream listener threw");
            }
          }
        }
      } catch (err) {
        if (reader.stopped) break;
        reader.reconnects += 1;
        this.metrics?.inc("reader_errors_total");
        this.metrics?.inc("reader_reconnects_total");
        if (!reader.degraded) this.log.warn({ err, stream: reader.key, backoffMs: backoff }, "stream reader error; retrying");
        reader.degraded = true;
        await sleep(backoff);
        backoff = Math.min(backoff * 2, this.reconnectMaxMs);
        if (reader.stopped) break;
        // A dead duplicated connection is replaced; ioredis reconnects the base connection by itself.
        if (reader.conn !== this.redis && isClosed(reader.conn)) {
          closeConnection(reader.conn, this.redis);
          reader.conn = this.redis.duplicate?.() ?? this.redis;
        }
      }
    }
    closeConnection(reader.conn, this.redis);
  }
}

function isClosed(conn: StreamRedis): boolean {
  const status = (conn as StreamRedis & { status?: string }).status;
  if (typeof status === "string") return status === "end" || status === "close";
  const closed = (conn as StreamRedis & { closed?: boolean }).closed;
  return closed === true;
}
