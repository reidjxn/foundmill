/**
 * The subset of the Redis Streams API this package uses, as a structural interface.
 *
 * ioredis's `Redis` satisfies it (asserted at compile time in `testing/type-assertions.ts`), and so does
 * `MemoryRedis` from `./testing/memory-redis`, which lets every test run without a Redis server.
 * Signatures mirror ioredis's own overloads (minus the trailing callback) so the real client type-checks.
 */
import type { Buffer } from "node:buffer";

export type RedisArg = string | number | Buffer;

/** One stream entry as returned by XRANGE / XREADGROUP / XCLAIM: `[id, [field, value, field, value, ...]]`. */
export type RawStreamEntry = [id: string, fields: string[]];

/** XREADGROUP / XREAD reply (RESP2 shape): `[[streamKey, entries], ...]` or `null` on timeout. */
export type RawReadReply = [key: string, entries: [id: string, fields: string[] | null][]][] | null;

export interface StreamRedis {
  xadd(key: string, ...args: RedisArg[]): Promise<string | null>;

  xrange(key: string, start: string, end: string): Promise<RawStreamEntry[]>;
  xrange(
    key: string,
    start: string,
    end: string,
    countToken: "COUNT",
    count: number | string,
  ): Promise<RawStreamEntry[]>;

  xrevrange(key: string, end: string, start: string): Promise<RawStreamEntry[]>;
  xrevrange(
    key: string,
    end: string,
    start: string,
    countToken: "COUNT",
    count: number | string,
  ): Promise<RawStreamEntry[]>;

  xlen(key: string): Promise<number>;
  xdel(key: string, ...ids: RedisArg[]): Promise<number>;

  xgroup(
    subcommand: "CREATE",
    key: string,
    group: string,
    id: string,
    mkstream: "MKSTREAM",
  ): Promise<unknown>;
  xgroup(subcommand: "CREATE", key: string, group: string, id: string): Promise<unknown>;
  xgroup(subcommand: "DESTROY", key: string, group: string): Promise<unknown>;
  xgroup(subcommand: "DELCONSUMER", key: string, group: string, consumer: string): Promise<unknown>;

  xreadgroup(...args: RedisArg[]): Promise<unknown>;
  xread(...args: RedisArg[]): Promise<unknown>;

  xack(key: string, group: string, ...ids: RedisArg[]): Promise<number>;

  /** Summary form: `[count, smallestId, greatestId, [[consumer, count], ...]]`. */
  xpending(key: string, group: string): Promise<unknown[]>;
  /** Extended form: `[[id, consumer, idleMs, deliveries], ...]`. */
  xpending(
    key: string,
    group: string,
    start: string,
    end: string,
    count: number | string,
  ): Promise<unknown[]>;
  xpending(
    key: string,
    group: string,
    start: string,
    end: string,
    count: number | string,
    consumer: string,
  ): Promise<unknown[]>;
  xpending(
    key: string,
    group: string,
    idleToken: "IDLE",
    minIdleMs: number | string,
    start: string,
    end: string,
    count: number | string,
  ): Promise<unknown[]>;
  xpending(
    key: string,
    group: string,
    idleToken: "IDLE",
    minIdleMs: number | string,
    start: string,
    end: string,
    count: number | string,
    consumer: string,
  ): Promise<unknown[]>;

  xclaim(
    key: string,
    group: string,
    consumer: string,
    minIdleMs: RedisArg,
    ...args: RedisArg[]
  ): Promise<unknown[]>;

  scan(
    cursor: number | string,
    matchToken: "MATCH",
    pattern: string,
    countToken: "COUNT",
    count: number | string,
  ): Promise<[cursor: string, keys: string[]]>;
  scan(
    cursor: number | string,
    matchToken: "MATCH",
    pattern: string,
    countToken: "COUNT",
    count: number | string,
    typeToken: "TYPE",
    type: string,
  ): Promise<[cursor: string, keys: string[]]>;

  del(...keys: string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  quit(): Promise<unknown>;

  /** Blocking reads must not share a connection with other commands; consumers call this when present. */
  duplicate?(): StreamRedis;
}

/** Turn a flat `[k, v, k, v]` field list into an object. Later duplicates win (as in Redis replies). */
export function fieldsToObject(
  fields: readonly string[] | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fields) return out;
  for (let i = 0; i + 1 < fields.length; i += 2) {
    out[String(fields[i])] = String(fields[i + 1]);
  }
  return out;
}

/** Flatten an object into the `[k, v, k, v]` argument list XADD expects. */
export function objectToFields(obj: Record<string, string | number>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) out.push(k, String(v));
  return out;
}

export interface StreamEntry {
  stream: string;
  id: string;
  fields: Record<string, string>;
}

/** Normalise an XREADGROUP/XREAD reply into a flat list of entries (null/empty → []). */
export function parseReadReply(reply: unknown): StreamEntry[] {
  if (!Array.isArray(reply)) return [];
  const out: StreamEntry[] = [];
  for (const streamRow of reply as unknown[]) {
    if (!Array.isArray(streamRow) || streamRow.length < 2) continue;
    const stream = String(streamRow[0]);
    const entries = streamRow[1];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries as unknown[]) {
      if (!Array.isArray(entry) || entry.length < 1) continue;
      const id = String(entry[0]);
      const rawFields = entry[1];
      out.push({
        stream,
        id,
        fields: fieldsToObject(Array.isArray(rawFields) ? (rawFields as string[]) : null),
      });
    }
  }
  return out;
}

/** Normalise an XRANGE/XCLAIM reply for one stream into entries. Entries whose fields are null (deleted) are skipped. */
export function parseEntryList(stream: string, reply: unknown): StreamEntry[] {
  if (!Array.isArray(reply)) return [];
  const out: StreamEntry[] = [];
  for (const entry of reply as unknown[]) {
    if (!Array.isArray(entry) || entry.length < 2 || entry[1] === null) continue;
    out.push({ stream, id: String(entry[0]), fields: fieldsToObject(entry[1] as string[]) });
  }
  return out;
}

export interface PendingEntry {
  id: string;
  consumer: string;
  idleMs: number;
  deliveries: number;
}

/** Normalise an extended XPENDING reply: `[[id, consumer, idle, deliveries], ...]`. */
export function parsePendingReply(reply: unknown): PendingEntry[] {
  if (!Array.isArray(reply)) return [];
  const out: PendingEntry[] = [];
  for (const row of reply as unknown[]) {
    if (!Array.isArray(row) || row.length < 4) continue;
    out.push({
      id: String(row[0]),
      consumer: String(row[1]),
      idleMs: Number(row[2]),
      deliveries: Number(row[3]),
    });
  }
  return out;
}

/** Compare two stream ids (`ms-seq`). Negative when a < b. */
export function compareStreamIds(a: string, b: string): number {
  const [am, as] = splitStreamId(a);
  const [bm, bs] = splitStreamId(b);
  if (am !== bm) return am < bm ? -1 : 1;
  if (as !== bs) return as < bs ? -1 : 1;
  return 0;
}

export function splitStreamId(id: string): [ms: bigint, seq: bigint] {
  const dash = id.indexOf("-");
  if (dash === -1) return [BigInt(id), 0n];
  return [BigInt(id.slice(0, dash)), BigInt(id.slice(dash + 1))];
}

/** Error thrown by Redis when a consumer group already exists; safe to ignore on XGROUP CREATE. */
export function isBusyGroupError(err: unknown): boolean {
  return err instanceof Error && /BUSYGROUP/.test(err.message);
}

/** Error thrown by Redis when the group (or stream) does not exist for XREADGROUP/XACK/XPENDING. */
export function isNoGroupError(err: unknown): boolean {
  return err instanceof Error && /NOGROUP/.test(err.message);
}
