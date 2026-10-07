/**
 * Consumer-group reader for platform event streams (docs/ARCHITECTURE.md §5, BUILD §8.2).
 *
 * `consume(redis, { stream | pattern | businessId, group, consumer, handler })`:
 * - creates the group with `XGROUP CREATE ... MKSTREAM` (idempotent),
 * - reads with `XREADGROUP ... BLOCK` on a dedicated connection (`redis.duplicate()` when available),
 * - acks after the handler resolves (at-least-once; handlers de-duplicate on `event.id`),
 * - leaves failed entries pending and redelivers them after `retryDelayMs` via XPENDING/XCLAIM,
 * - claims entries left pending by a crashed consumer after `claimIdleMs` (pending-claim on restart),
 * - dead-letters an entry to `dlq:{group}` after `maxRetries` failed deliveries (default 5), and
 *   immediately when it cannot be decoded (a poison message never succeeds on retry).
 *
 * With `pattern` (e.g. `ev:*`) the consumer discovers streams with SCAN every `discoverIntervalMs`,
 * so a business created after start-up is picked up without a restart.
 */
import { ValidationError } from "@foundmill/shared";
import { parseEvent, type PlatformEvent } from "./catalogue";
import {
  ALL_BUSINESS_STREAMS_PATTERN,
  businessStreamKey,
  deadLetterKey,
  DEFAULT_STREAM_MAXLEN,
} from "./keys";
import {
  isBusyGroupError,
  isNoGroupError,
  parseEntryList,
  parsePendingReply,
  parseReadReply,
  type StreamEntry,
  type StreamRedis,
} from "./redis";

export interface EntryMeta {
  stream: string;
  /** Stream entry id (`ms-seq`), distinct from the event's own uuid. */
  id: string;
  group: string;
  consumer: string;
  /** How many times this entry has been delivered to the group, including this time. */
  deliveries: number;
  fields: Record<string, string>;
}

export type EventHandler<T> = (event: T, meta: EntryMeta) => Promise<void> | void;

export interface ConsumeOptions<T = PlatformEvent> {
  /** Exact stream key, e.g. `ev:<businessId>`. */
  stream?: string;
  /** Glob pattern of streams, e.g. `ev:*`. Discovered with SCAN. */
  pattern?: string;
  /** Sugar: a business id → `ev:{businessId}`; `"*"` → every business stream. */
  businessId?: string | "*";
  group: string;
  consumer: string;
  handler: EventHandler<T>;
  /** Turn a raw entry into the handler's argument. Default: parse the `json` field as a PlatformEvent. Throwing = poison → dead letter. */
  decode?: (entry: StreamEntry) => T;
  /** Failed deliveries before dead-lettering (default 5). */
  maxRetries?: number;
  /** Entries per XREADGROUP (default 10). */
  batch?: number;
  /** XREADGROUP BLOCK (default 5 000 ms). `stop()` can take up to this long. */
  blockMs?: number;
  /** Idle time before one of this consumer's own failed entries is redelivered (default 1 000 ms). */
  retryDelayMs?: number;
  /** Idle time before another consumer's pending entry is claimed (default 30 000 ms). */
  claimIdleMs?: number;
  /** How often to rescan for new streams when using `pattern` (default 5 000 ms). */
  discoverIntervalMs?: number;
  /** Where a brand-new group starts: "0" = from the oldest retained entry (default), "$" = only new entries. */
  startFrom?: "0" | "$";
  /** Dead-letter stream (default `dlq:{group}`). */
  deadLetterKey?: string;
  /** MAXLEN ~ for the dead-letter stream (default 100 000). */
  deadLetterMaxLen?: number;
  onError?: (
    err: unknown,
    ctx: { stage: "read" | "handle" | "ack" | "claim" | "discover" | "group"; entry?: StreamEntry },
  ) => void;
  onDeadLetter?: (entry: StreamEntry, err: unknown, deliveries: number) => void;
  /** Maximum pending entries examined per sweep (default 100). */
  claimBatch?: number;
}

export interface Consumer {
  /** Stop after the current block/handler finishes. Resolves when the loop has exited. */
  stop(): Promise<void>;
  readonly running: boolean;
  /** Resolves when the loop exits. */
  readonly done: Promise<void>;
  /** Streams currently subscribed. */
  streams(): string[];
  /** Run one iteration (claim stale → read new → handle) without the loop. For tests and cron-style consumers. */
  runOnce(): Promise<number>;
}

/** Default decoder: the relay writes `id`, `type`, `json`; `json` is the serialised PlatformEvent. */
export function decodePlatformEntry(entry: StreamEntry): PlatformEvent {
  const json = entry.fields.json;
  if (json === undefined)
    throw new ValidationError(
      `Stream entry ${entry.stream}/${entry.id} has no "json" field`,
      entry.fields,
    );
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new ValidationError(`Stream entry ${entry.stream}/${entry.id} has invalid JSON`, {
      cause: String(e),
    });
  }
  return parseEvent(raw);
}

export class DeadLetterError extends Error {
  constructor(
    message: string,
    public readonly entry: StreamEntry,
    public readonly deliveries: number,
    public readonly reason: unknown,
  ) {
    super(message, reason === undefined ? undefined : { cause: reason });
    this.name = "DeadLetterError";
  }
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

async function scanKeys(redis: StreamRedis, pattern: string): Promise<string[]> {
  const found = new Set<string>();
  let cursor = "0";
  const re = globToRegExp(pattern);
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200, "TYPE", "stream");
    for (const k of keys) if (re.test(k)) found.add(k);
    cursor = String(next);
  } while (cursor !== "0");
  return [...found].sort();
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

export function consume<T = PlatformEvent>(redis: StreamRedis, opts: ConsumeOptions<T>): Consumer {
  const { group, consumer, handler } = opts;
  if (!group || !consumer) throw new Error("consume: group and consumer are required");
  const decode = (opts.decode ?? (decodePlatformEntry as unknown as (entry: StreamEntry) => T)) as (
    entry: StreamEntry,
  ) => T;
  const maxRetries = Math.max(1, opts.maxRetries ?? 5);
  const batch = Math.max(1, opts.batch ?? 10);
  const blockMs = Math.max(1, opts.blockMs ?? 5000);
  const retryDelayMs = Math.max(0, opts.retryDelayMs ?? 1000);
  const claimIdleMs = Math.max(0, opts.claimIdleMs ?? 30_000);
  const discoverIntervalMs = Math.max(1, opts.discoverIntervalMs ?? 5000);
  const claimBatch = Math.max(1, opts.claimBatch ?? 100);
  const startFrom = opts.startFrom ?? "0";
  const dlqKey = opts.deadLetterKey ?? deadLetterKey(group);
  const dlqMaxLen = Math.max(1, opts.deadLetterMaxLen ?? DEFAULT_STREAM_MAXLEN);
  const onError =
    opts.onError ??
    ((err: unknown, ctx: { stage: string }) =>
      console.error(`[events] consumer ${group}/${consumer} ${ctx.stage} error`, err));

  let pattern: string | undefined = opts.pattern;
  let fixedStream: string | undefined = opts.stream;
  if (opts.businessId !== undefined) {
    if (opts.businessId === "*") pattern = ALL_BUSINESS_STREAMS_PATTERN;
    else fixedStream = businessStreamKey(opts.businessId);
  }
  if (!fixedStream && !pattern)
    throw new Error("consume: one of stream, pattern or businessId is required");
  if (fixedStream && pattern) throw new Error("consume: pass either stream or pattern, not both");

  // Blocking reads get their own connection so XADD/XACK on the shared one are never stalled.
  const blocking: StreamRedis = typeof redis.duplicate === "function" ? redis.duplicate() : redis;
  const ownsBlocking = blocking !== redis;

  const subscribed = new Set<string>();
  const state = { running: false, cancelled: false };
  let loopPromise: Promise<void> = Promise.resolve();
  let lastDiscover = 0;

  async function ensureGroup(stream: string): Promise<void> {
    try {
      await redis.xgroup("CREATE", stream, group, startFrom, "MKSTREAM");
    } catch (err) {
      if (!isBusyGroupError(err)) throw err;
    }
  }

  async function discover(force = false): Promise<void> {
    const now = Date.now();
    if (fixedStream) {
      if (!subscribed.has(fixedStream)) {
        await ensureGroup(fixedStream);
        subscribed.add(fixedStream);
      }
      return;
    }
    if (!force && now - lastDiscover < discoverIntervalMs) return;
    lastDiscover = now;
    const keys = await scanKeys(redis, pattern!);
    for (const key of keys) {
      if (subscribed.has(key)) continue;
      try {
        await ensureGroup(key);
        subscribed.add(key);
      } catch (err) {
        onError(err, { stage: "group" });
      }
    }
  }

  async function deadLetter(entry: StreamEntry, err: unknown, deliveries: number): Promise<void> {
    const fields: string[] = [];
    for (const [k, v] of Object.entries(entry.fields)) fields.push(k, v);
    fields.push(
      "source_stream",
      entry.stream,
      "source_id",
      entry.id,
      "group",
      group,
      "consumer",
      consumer,
      "deliveries",
      String(deliveries),
      "error",
      errorMessage(err),
      "failed_at",
      new Date().toISOString(),
    );
    await redis.xadd(dlqKey, "MAXLEN", "~", dlqMaxLen, "*", ...fields);
    await redis.xack(entry.stream, group, entry.id);
    opts.onDeadLetter?.(entry, err, deliveries);
  }

  /** Handle one delivered entry. Returns true when it was acked (success or dead-lettered). */
  async function handleEntry(entry: StreamEntry, deliveries: number): Promise<boolean> {
    if (deliveries > maxRetries) {
      // Already failed maxRetries times (e.g. the previous consumer crashed mid-handler every time).
      await deadLetter(
        entry,
        new DeadLetterError(`exceeded ${maxRetries} deliveries`, entry, deliveries, undefined),
        deliveries,
      );
      return true;
    }
    let decoded: T;
    try {
      decoded = decode(entry);
    } catch (err) {
      onError(err, { stage: "handle", entry });
      await deadLetter(entry, err, deliveries);
      return true;
    }
    try {
      await handler(decoded, {
        stream: entry.stream,
        id: entry.id,
        group,
        consumer,
        deliveries,
        fields: entry.fields,
      });
    } catch (err) {
      onError(err, { stage: "handle", entry });
      if (deliveries >= maxRetries) {
        await deadLetter(entry, err, deliveries);
        return true;
      }
      return false; // stays pending; redelivered after retryDelayMs
    }
    try {
      await redis.xack(entry.stream, group, entry.id);
    } catch (err) {
      onError(err, { stage: "ack", entry });
      return false;
    }
    return true;
  }

  /** Re-deliver this consumer's failed entries and claim entries abandoned by other consumers. */
  async function claimStale(): Promise<number> {
    let handled = 0;
    for (const stream of subscribed) {
      let pending;
      try {
        pending = parsePendingReply(
          await redis.xpending(stream, group, "IDLE", retryDelayMs, "-", "+", claimBatch),
        );
      } catch (err) {
        if (isNoGroupError(err)) {
          subscribed.delete(stream);
          continue;
        }
        onError(err, { stage: "claim" });
        continue;
      }
      const eligible = pending.filter((p) => p.consumer === consumer || p.idleMs >= claimIdleMs);
      if (eligible.length === 0) continue;
      let claimed: StreamEntry[];
      try {
        claimed = parseEntryList(
          stream,
          await redis.xclaim(stream, group, consumer, retryDelayMs, ...eligible.map((p) => p.id)),
        );
      } catch (err) {
        onError(err, { stage: "claim" });
        continue;
      }
      const deliveriesById = new Map(eligible.map((p) => [p.id, p.deliveries + 1] as const)); // XCLAIM increments the counter
      for (const entry of claimed) {
        if (state.cancelled) return handled;
        await handleEntry(entry, deliveriesById.get(entry.id) ?? 1);
        handled++;
      }
    }
    return handled;
  }

  async function readNew(block: boolean): Promise<number> {
    const streams = [...subscribed];
    if (streams.length === 0) return 0;
    const args: (string | number)[] = ["GROUP", group, consumer, "COUNT", batch];
    if (block) args.push("BLOCK", blockMs);
    args.push("STREAMS", ...streams, ...streams.map(() => ">"));
    let entries: StreamEntry[];
    try {
      entries = parseReadReply(await blocking.xreadgroup(...args));
    } catch (err) {
      if (isNoGroupError(err)) {
        // A stream was deleted or its group destroyed: re-create on the next discover.
        for (const s of streams) subscribed.delete(s);
        lastDiscover = 0;
        return 0;
      }
      throw err;
    }
    let handled = 0;
    for (const entry of entries) {
      if (state.cancelled) break;
      await handleEntry(entry, 1);
      handled++;
    }
    return handled;
  }

  async function runOnce(): Promise<number> {
    await discover(true);
    const a = await claimStale();
    const b = await readNew(false);
    return a + b;
  }

  async function loop(): Promise<void> {
    try {
      while (!state.cancelled) {
        try {
          await discover();
        } catch (err) {
          onError(err, { stage: "discover" });
        }
        try {
          await claimStale();
        } catch (err) {
          onError(err, { stage: "claim" });
        }
        if (state.cancelled) break;
        if (subscribed.size === 0) {
          await new Promise((r) => setTimeout(r, Math.min(blockMs, discoverIntervalMs)));
          continue;
        }
        try {
          await readNew(true);
        } catch (err) {
          onError(err, { stage: "read" });
          await new Promise((r) => setTimeout(r, Math.min(blockMs, 1000)));
        }
      }
    } finally {
      state.running = false;
      if (ownsBlocking) {
        try {
          await blocking.quit();
        } catch {
          // connection may already be gone
        }
      }
    }
  }

  state.running = true;
  loopPromise = loop();

  return {
    async stop() {
      state.cancelled = true;
      await loopPromise;
    },
    get running() {
      return state.running;
    },
    get done() {
      return loopPromise;
    },
    streams: () => [...subscribed],
    runOnce,
  };
}
