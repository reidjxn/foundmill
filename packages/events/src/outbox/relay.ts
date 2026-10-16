/**
 * Outbox relay (docs/ARCHITECTURE.md §5): moves committed events from the `outbox` table onto the Redis
 * stream `ev:{businessId}` and marks them published. One instance runs inside apps/api for staging.
 *
 * Semantics are at-least-once: a crash between XADD and the `update outbox` re-publishes the batch on
 * the next tick, so consumers de-duplicate on the event `id`. Rows are locked with
 * `for update skip locked` when the database can open a transaction, which lets a second relay instance
 * run safely (it simply skips rows the first one is publishing).
 *
 * Latency (audit realtime-bg F7): an idle tick sends one statement that locks nothing (`hasUnpublishedSql`) and opens
 * the locking transaction only when rows wait, and `wake()` runs a tick at once, so a process that has just committed
 * events (the api, after a mutation) does not wait for the poll. The poll stays as the net for every other writer.
 */
import { sql } from "drizzle-orm";
import { safeParseEvent, serializeEvent, type PlatformEvent } from "../catalogue";
import { BUSINESS_STREAM_RETENTION_MS, businessStreamKey, DEFAULT_STREAM_MAXLEN, minIdFor, RELAY_DEAD_LETTER_KEY } from "../keys";
import type { StreamRedis } from "../redis";
import { EVENTS_TABLE, OUTBOX_TABLE, type Queryable, type TransactionalQueryable } from "./writer";

export type RelayDb = Queryable | TransactionalQueryable;

export interface OutboxRelayOptions {
  /** Rows per tick (default 100). */
  batch?: number;
  /**
   * Idle wait between ticks when the outbox is empty (default 250 ms). A full batch triggers an immediate next tick, and
   * so does `wake()`.
   */
  intervalMs?: number;
  /** XADD MAXLEN ~ (default 100 000). */
  maxLen?: number;
  /**
   * Time retention per business stream (default 30 days, keys.ts): after each batch the relay trims the streams it
   * wrote to entries newer than this (XTRIM MINID ~, measured from the id Redis just gave the newest entry, so the
   * window follows Redis's clock) and sets the same TTL, so a business that stops producing events loses its stream
   * too. 0 turns it off. Events stay in Postgres either way.
   */
  retentionMs?: number;
  /** Backoff after a failed tick (default 1 000 ms, doubling up to 30 s). */
  errorBackoffMs?: number;
  /** Override the stream key per business (tests). */
  streamKey?: (businessId: string) => string;
  onError?: (err: unknown) => void;
  onPublished?: (events: readonly PlatformEvent[]) => void;
  /** Use a transaction + row locks when the db supports it (default true). */
  lockRows?: boolean;
}

export interface OutboxRelay {
  /** Publish one batch now. Resolves to the number of rows marked published (valid + dead-lettered). */
  tick(): Promise<number>;
  /** Start the polling loop (no-op if already running). */
  start(): void;
  /**
   * Run the next tick now instead of after the idle wait (call it after committing outbox rows). A wake during a tick
   * runs one more right after it, so rows committed while it read are not left to the poll. Ignored while the loop is
   * not running or is backing off after a failure.
   */
  wake(): void;
  /** Stop after the in-flight tick finishes. Resolves when the loop has exited. */
  stop(): Promise<void>;
  readonly running: boolean;
  /** Resolves when the loop exits (after `stop()`). Resolved immediately if never started. */
  readonly done: Promise<void>;
}

/** Shape of one joined outbox row as the relay reads it (column aliases match the select below). */
export interface OutboxRow {
  id: string;
  businessId: string;
  type: string;
  occurredAt: Date | string;
  actor: unknown;
  entityIds: unknown;
  payload: unknown;
  narrated: boolean;
}

/** `select` run per tick. Exposed so test fakes can recognise it. */
export function selectUnpublishedSql(limit: number, lock: boolean) {
  return sql`select o.event_id as "id", e.business_id as "businessId", e.type as "type", e.occurred_at as "occurredAt", e.actor as "actor", e.entity_ids as "entityIds", e.payload as "payload", e.narrated as "narrated"
from ${sql.identifier(OUTBOX_TABLE)} o
join ${sql.identifier(EVENTS_TABLE)} e on e.id = o.event_id
where o.published_at is null
order by e.occurred_at asc, o.event_id asc
limit ${limit}${lock ? sql` for update of o skip locked` : sql``}`;
}

/** Whether any row waits, without locking anything: what an idle tick sends before it opens a transaction. */
export function hasUnpublishedSql() {
  return sql`select exists (select 1 from ${sql.identifier(OUTBOX_TABLE)} where published_at is null) as "pending"`;
}

export function markPublishedSql(ids: readonly string[]) {
  return sql`update ${sql.identifier(OUTBOX_TABLE)} set published_at = now() where event_id in (${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}) and published_at is null`;
}

/** Normalise driver result shapes: postgres.js returns an array, PGlite / node-postgres return `{ rows }`. */
export function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: Record<string, unknown>[] }).rows;
  }
  return [];
}

/** Drivers return jsonb as objects, but a text column or a test fake may hand back a string. */
function asJson(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

/** `uuid[]` arrives as a JS array from postgres.js/PGlite, or as `{a,b}` text from a lesser driver. */
function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    const inner = value.replace(/^\{|\}$/g, "").trim();
    return inner.length === 0 ? [] : inner.split(",").map((s) => s.replace(/^"|"$/g, ""));
  }
  return [];
}

/** Convert a raw row into the wire shape `safeParseEvent` accepts. */
export function rowToEventInput(row: Record<string, unknown>): Record<string, unknown> {
  const occurredAt = row.occurredAt;
  return {
    id: row.id,
    businessId: row.businessId,
    type: row.type,
    occurredAt: occurredAt instanceof Date ? occurredAt : new Date(String(occurredAt)),
    actor: asJson(row.actor),
    entityIds: asStringArray(row.entityIds),
    payload: asJson(row.payload),
    narrated: Boolean(row.narrated),
  };
}

function hasTransaction(db: RelayDb): db is TransactionalQueryable {
  return typeof (db as TransactionalQueryable).transaction === "function";
}

interface LoopSignal {
  cancelled: boolean;
  /** Ends the current sleep early (set while sleeping). */
  wake?: () => void;
  /** A `wake()` arrived while no idle sleep was running: the next idle sleep returns at once. */
  woken: boolean;
}

/** An idle wait (`wakeable`) ends early on `wake()` or `stop()`; a backoff after a failure ends early only on `stop()`. */
const sleep = (ms: number, signal: LoopSignal, wakeable: boolean) =>
  new Promise<void>((resolve) => {
    if (signal.cancelled) return resolve();
    if (wakeable && signal.woken) {
      signal.woken = false;
      return resolve();
    }
    const t = setTimeout(() => {
      signal.wake = undefined;
      resolve();
    }, ms);
    const end = () => {
      clearTimeout(t);
      signal.wake = undefined;
      resolve();
    };
    signal.wake = wakeable ? end : () => (signal.cancelled ? end() : undefined);
  });

/** Build a relay without starting it (tests call `tick()` directly). */
export function createOutboxRelay(
  db: RelayDb,
  redis: StreamRedis,
  opts: OutboxRelayOptions = {},
): OutboxRelay {
  const batch = Math.max(1, opts.batch ?? 100);
  const intervalMs = Math.max(0, opts.intervalMs ?? 250);
  const maxLen = Math.max(1, opts.maxLen ?? DEFAULT_STREAM_MAXLEN);
  const retentionMs = Math.max(0, opts.retentionMs ?? BUSINESS_STREAM_RETENTION_MS);
  const errorBackoffMs = Math.max(1, opts.errorBackoffMs ?? 1000);
  const streamKey = opts.streamKey ?? businessStreamKey;
  const onError =
    opts.onError ?? ((err: unknown) => console.error("[events] outbox relay error", err));
  const lock = (opts.lockRows ?? true) && hasTransaction(db);

  const state: LoopSignal & { running: boolean } = { running: false, cancelled: false, wake: undefined, woken: false };
  let loopPromise: Promise<void> = Promise.resolve();
  let inFlight: Promise<number> | null = null;

  async function publishRows(q: Queryable, rows: Record<string, unknown>[]): Promise<number> {
    if (rows.length === 0) return 0;
    const published: PlatformEvent[] = [];
    const ids: string[] = [];
    /** Stream key → the id Redis gave its newest entry in this batch. */
    const newest = new Map<string, string>();
    for (const row of rows) {
      const parsed = safeParseEvent(rowToEventInput(row));
      if (parsed.ok) {
        const event = parsed.value;
        const key = streamKey(event.businessId);
        const entryId = await redis.xadd(
          key,
          "MAXLEN",
          "~",
          maxLen,
          "*",
          "id",
          event.id,
          "type",
          event.type,
          "json",
          serializeEvent(event),
        );
        if (entryId) newest.set(key, entryId);
        published.push(event);
      } else {
        // A row that cannot be parsed would otherwise stall the relay forever: park it and move on.
        await redis.xadd(
          RELAY_DEAD_LETTER_KEY,
          "MAXLEN",
          "~",
          maxLen,
          "*",
          "id",
          String(row.id ?? ""),
          "type",
          String(row.type ?? ""),
          "error",
          parsed.error.message,
          "json",
          JSON.stringify(row),
        );
        onError(parsed.error);
      }
      ids.push(String(row.id));
    }
    await q.execute(markPublishedSql(ids));
    if (published.length > 0) opts.onPublished?.(published);
    await applyRetention(newest);
    return ids.length;
  }

  /** After the batch is marked published: a failure here only delays trimming, it never re-publishes the batch. */
  async function applyRetention(newest: Map<string, string>): Promise<void> {
    if (retentionMs === 0 || newest.size === 0) return;
    const ttl = Math.ceil(retentionMs / 1000);
    for (const [key, entryId] of newest) {
      try {
        await redis.xtrim?.(key, "MINID", "~", minIdFor(Number(entryId.split("-")[0]), retentionMs));
        await redis.expire?.(key, ttl);
      } catch (err) {
        onError(err);
      }
    }
  }

  async function tickOnce(): Promise<number> {
    if (lock && hasTransaction(db)) {
      // One statement that locks nothing first: an empty outbox costs one round trip instead of the transaction's three
      // (BEGIN, the locking select, COMMIT), and holds a pooled connection for that long only.
      const [probe] = rowsOf(await db.execute(hasUnpublishedSql()));
      if (!probe || (probe.pending !== true && probe.pending !== "t")) return 0;
      return db.transaction(async (tx) => {
        const rows = rowsOf(await tx.execute(selectUnpublishedSql(batch, true)));
        return publishRows(tx, rows);
      });
    }
    const rows = rowsOf(await db.execute(selectUnpublishedSql(batch, false)));
    return publishRows(db, rows);
  }

  function tick(): Promise<number> {
    if (inFlight) return inFlight;
    inFlight = tickOnce().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  async function loop(): Promise<void> {
    let backoff = errorBackoffMs;
    while (!state.cancelled) {
      let n: number;
      try {
        n = await tick();
        backoff = errorBackoffMs;
      } catch (err) {
        onError(err);
        await sleep(backoff, state, false);
        backoff = Math.min(backoff * 2, 30_000);
        continue;
      }
      if (state.cancelled) break;
      if (n >= batch) continue; // more waiting: drain without pausing
      await sleep(intervalMs, state, true);
    }
    state.running = false;
  }

  return {
    tick,
    start() {
      if (state.running) return;
      state.running = true;
      state.cancelled = false;
      state.woken = false;
      loopPromise = loop();
    },
    wake() {
      if (!state.running || state.cancelled) return;
      if (state.wake) state.wake();
      else state.woken = true;
    },
    async stop() {
      if (!state.running) return;
      state.cancelled = true;
      state.wake?.();
      await loopPromise;
    },
    get running() {
      return state.running;
    },
    get done() {
      return loopPromise;
    },
  };
}

/** Create and start the relay loop. `await relay.stop()` for a graceful shutdown. */
export function runOutboxRelay(
  db: RelayDb,
  redis: StreamRedis,
  opts: OutboxRelayOptions = {},
): OutboxRelay {
  const relay = createOutboxRelay(db, redis, opts);
  relay.start();
  return relay;
}
