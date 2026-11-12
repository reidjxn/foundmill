/**
 * Account outbox relay (docs/ARCHITECTURE.md §5 "Account events"): moves committed account events from
 * `account_outbox` onto the Redis stream `ae:{userId}` and marks them published. The sibling of ./relay, with a loop of
 * its own (./relay-loop): the two relays share nothing but the Redis connection, so an account outbox that is stuck
 * never holds up a project's events, and the reverse.
 *
 * Semantics are at-least-once, as for business events: a crash between XADD and the update re-publishes the batch on
 * the next tick, so consumers de-duplicate on the event `id`. Rows are locked with `for update skip locked` when the
 * database can open a transaction.
 *
 * Failure handling, recorded on the row (`attempts`, `last_error`, `next_attempt_at`):
 * - a row whose XADD fails stays unpublished: `attempts` goes up, `last_error` says why and `next_attempt_at` moves out
 *   (2 s, 4 s, 8 s … capped at 5 minutes), so it is retried without being read on every tick. The other rows of the
 *   batch are still published: one person's stream that cannot be written never holds up anyone else's events;
 * - a row that cannot be read as a valid account event would never succeed: it is marked published with its
 *   `last_error` and noted on `dlq:account-outbox-relay` by id, type and reason. The payload is not copied there: the
 *   row stays in Postgres, where it is the person's own and goes with their account;
 * - when nothing in a batch could be published (Redis is away), the tick fails after recording that, and the loop backs
 *   off (1 s doubling to 30 s) like the business relay.
 * Error text is the error's name and message, cut to 300 characters: never the payload.
 */
import { sql, type SQL } from "drizzle-orm";
import { safeParseAccountEvent, serializeAccountEvent, type AccountEvent } from "../account-event";
import { ACCOUNT_RELAY_DEAD_LETTER_KEY, ACCOUNT_STREAM_RETENTION_MS, accountStreamKey, DEFAULT_STREAM_MAXLEN, minIdFor } from "../keys";
import type { StreamRedis } from "../redis";
import { ACCOUNT_EVENTS_TABLE, ACCOUNT_OUTBOX_TABLE } from "./account-writer";
import { rowsOf, type RelayDb } from "./relay";
import { createRelayLoop, type OutboxRelay } from "./relay-loop";
import type { Queryable, TransactionalQueryable } from "./writer";

export interface AccountOutboxRelayOptions {
  /** Rows per tick (default 100). */
  batch?: number;
  /** Idle wait between ticks when nothing waits (default 250 ms). A full batch triggers an immediate next tick, and so does `wake()`. */
  intervalMs?: number;
  /** XADD MAXLEN ~ (default 100 000). */
  maxLen?: number;
  /**
   * Time retention per account stream (default 7 days, keys.ts): after each batch the relay trims the streams it wrote
   * to and sets the same TTL. 0 turns it off. Events stay in Postgres either way.
   */
  retentionMs?: number;
  /** Backoff after a tick that published nothing and failed (default 1 000 ms, doubling up to 30 s). */
  errorBackoffMs?: number;
  /** Override the stream key per person (tests). */
  streamKey?: (userId: string) => string;
  onError?: (err: unknown) => void;
  onPublished?: (events: readonly AccountEvent[]) => void;
  /** Use a transaction + row locks when the db supports it (default true). */
  lockRows?: boolean;
}

/** The longest `last_error` the relay writes. */
export const ACCOUNT_RELAY_ERROR_MAX = 300;

/** A row waits when it is unpublished and, after a failed attempt, once its own backoff has passed. */
const waiting = sql`o.published_at is null and (o.next_attempt_at is null or o.next_attempt_at <= now())`;

/** `select` run per tick. Exposed so tests can look at it. */
export function selectUnpublishedAccountSql(limit: number, lock: boolean): SQL {
  return sql`select o.event_id as "id", e.user_id as "userId", e.type as "type", e.occurred_at as "occurredAt", e.actor as "actor", e.payload as "payload"
from ${sql.identifier(ACCOUNT_OUTBOX_TABLE)} o
join ${sql.identifier(ACCOUNT_EVENTS_TABLE)} e on e.id = o.event_id
where ${waiting}
order by e.occurred_at asc, o.event_id asc
limit ${limit}${lock ? sql` for update of o skip locked` : sql``}`;
}

/** Whether any row waits, without locking anything: what an idle tick sends before it opens a transaction. */
export function hasUnpublishedAccountSql(): SQL {
  return sql`select exists (select 1 from ${sql.identifier(ACCOUNT_OUTBOX_TABLE)} o where ${waiting}) as "pending"`;
}

const idList = (ids: readonly string[]): SQL =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

export function markAccountPublishedSql(ids: readonly string[]): SQL {
  return sql`update ${sql.identifier(ACCOUNT_OUTBOX_TABLE)} set published_at = now(), last_error = null, next_attempt_at = null where event_id in (${idList(ids)}) and published_at is null`;
}

/** A row that can never be published: closed with the reason, so it does not stall the relay. */
export function markAccountParkedSql(ids: readonly string[], error: string): SQL {
  return sql`update ${sql.identifier(ACCOUNT_OUTBOX_TABLE)} set published_at = now(), attempts = attempts + 1, last_error = ${error}, next_attempt_at = null where event_id in (${idList(ids)}) and published_at is null`;
}

/** A failed attempt: counted, explained and retried after its own backoff (2 s doubling to 5 minutes). */
export function markAccountFailedSql(ids: readonly string[], error: string): SQL {
  return sql`update ${sql.identifier(ACCOUNT_OUTBOX_TABLE)} set attempts = attempts + 1, last_error = ${error}, next_attempt_at = now() + interval '1 second' * least(300, power(2, least(attempts + 1, 9))) where event_id in (${idList(ids)}) and published_at is null`;
}

/** The error's name and message, cut short. Never a payload: the relay's errors come from Redis and from validation paths. */
export function relayErrorText(err: unknown): string {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return text.length > ACCOUNT_RELAY_ERROR_MAX ? `${text.slice(0, ACCOUNT_RELAY_ERROR_MAX - 1)}…` : text;
}

/** Drivers return jsonb as objects, but a text column or a test fake may hand back a string. */
function asJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Convert a raw row into the shape `safeParseAccountEvent` accepts. */
export function rowToAccountEventInput(row: Record<string, unknown>): Record<string, unknown> {
  const occurredAt = row.occurredAt;
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    occurredAt: occurredAt instanceof Date ? occurredAt : new Date(String(occurredAt)),
    actor: asJson(row.actor),
    payload: asJson(row.payload),
  };
}

function hasTransaction(db: RelayDb): db is TransactionalQueryable {
  return typeof (db as TransactionalQueryable).transaction === "function";
}

interface BatchResult {
  /** Rows marked published (valid + parked). */
  closed: number;
  /** The first publish failure of the batch, when a row was left for a retry. */
  failure: unknown;
}

/** Build an account relay without starting it (tests call `tick()` directly). */
export function createAccountOutboxRelay(db: RelayDb, redis: StreamRedis, opts: AccountOutboxRelayOptions = {}): OutboxRelay {
  const batch = Math.max(1, opts.batch ?? 100);
  const intervalMs = Math.max(0, opts.intervalMs ?? 250);
  const maxLen = Math.max(1, opts.maxLen ?? DEFAULT_STREAM_MAXLEN);
  const retentionMs = Math.max(0, opts.retentionMs ?? ACCOUNT_STREAM_RETENTION_MS);
  const errorBackoffMs = Math.max(1, opts.errorBackoffMs ?? 1000);
  const streamKey = opts.streamKey ?? accountStreamKey;
  const onError = opts.onError ?? ((err: unknown) => console.error("[events] account outbox relay error", relayErrorText(err)));
  const lock = (opts.lockRows ?? true) && hasTransaction(db);

  async function publishRows(q: Queryable, rows: Record<string, unknown>[]): Promise<BatchResult> {
    if (rows.length === 0) return { closed: 0, failure: undefined };
    const published: AccountEvent[] = [];
    const publishedIds: string[] = [];
    /** Reason → the rows closed, or left for a retry, for it. */
    const parked = new Map<string, string[]>();
    const failed = new Map<string, string[]>();
    let failure: unknown;
    /** Stream key → the id Redis gave its newest entry in this batch. */
    const newest = new Map<string, string>();
    const note = (into: Map<string, string[]>, reason: string, id: string) => into.set(reason, [...(into.get(reason) ?? []), id]);

    for (const row of rows) {
      const id = String(row.id);
      const parsed = safeParseAccountEvent(rowToAccountEventInput(row));
      if (!parsed.ok) {
        // It would never succeed: say so on the row and on the dead-letter stream (id, type, reason; not the payload).
        const reason = relayErrorText(parsed.error);
        try {
          await redis.xadd(ACCOUNT_RELAY_DEAD_LETTER_KEY, "MAXLEN", "~", maxLen, "*", "id", id, "type", String(row.type ?? ""), "error", reason);
          note(parked, reason, id);
          onError(parsed.error);
        } catch (err) {
          failure ??= err;
          note(failed, relayErrorText(err), id);
        }
        continue;
      }
      const event = parsed.value;
      const key = streamKey(event.userId);
      try {
        const entryId = await redis.xadd(key, "MAXLEN", "~", maxLen, "*", "id", event.id, "type", event.type, "json", serializeAccountEvent(event));
        if (entryId) newest.set(key, entryId);
        published.push(event);
        publishedIds.push(id);
      } catch (err) {
        failure ??= err;
        note(failed, relayErrorText(err), id);
      }
    }

    if (publishedIds.length > 0) await q.execute(markAccountPublishedSql(publishedIds));
    for (const [reason, ids] of parked) await q.execute(markAccountParkedSql(ids, reason));
    for (const [reason, ids] of failed) await q.execute(markAccountFailedSql(ids, reason));
    if (published.length > 0) opts.onPublished?.(published);
    await applyRetention(newest);
    const closed = publishedIds.length + [...parked.values()].reduce((n, ids) => n + ids.length, 0);
    return { closed, failure };
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

  async function runBatch(): Promise<BatchResult> {
    if (lock && hasTransaction(db)) {
      // One statement that locks nothing first, as in the business relay: an idle tick costs one round trip.
      const [probe] = rowsOf(await db.execute(hasUnpublishedAccountSql()));
      if (!probe || (probe.pending !== true && probe.pending !== "t")) return { closed: 0, failure: undefined };
      return db.transaction(async (tx) => publishRows(tx, rowsOf(await tx.execute(selectUnpublishedAccountSql(batch, true)))));
    }
    return publishRows(db, rowsOf(await db.execute(selectUnpublishedAccountSql(batch, false))));
  }

  async function tickOnce(): Promise<number> {
    const result = await runBatch();
    if (result.failure !== undefined) {
      // The attempts are recorded and committed. Nothing got through: fail the tick so the loop backs off. Something
      // did: report it and carry on, the rows left behind are retried after their own backoff.
      if (result.closed === 0) throw result.failure;
      onError(result.failure);
    }
    return result.closed;
  }

  return createRelayLoop({ tickOnce, batch, intervalMs, errorBackoffMs, onError });
}

/** Create and start the account relay loop. `await relay.stop()` for a graceful shutdown. */
export function runAccountOutboxRelay(db: RelayDb, redis: StreamRedis, opts: AccountOutboxRelayOptions = {}): OutboxRelay {
  const relay = createAccountOutboxRelay(db, redis, opts);
  relay.start();
  return relay;
}

/**
 * Removes a person's account stream at once (for the flow that deletes an account: the rows cascade in Postgres, and
 * this removes the copy in Redis without waiting for its retention). Returns whether a stream was there.
 */
export async function deleteAccountStream(redis: StreamRedis, userId: string, streamKey: (userId: string) => string = accountStreamKey): Promise<boolean> {
  return (await redis.del(streamKey(userId))) > 0;
}
