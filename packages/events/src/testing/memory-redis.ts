/**
 * In-memory Redis Streams fake implementing the subset `StreamRedis` declares, with real Redis semantics
 * for ids, MAXLEN/MINID trimming (exact, also for `~`), key TTLs (EXPIRE; an expired key disappears on the next
 * command), consumer groups, pending entries (idle time, delivery counts), XCLAIM and blocking XREADGROUP/XREAD. Tests in this package and in consumers (composer, stream, journey...) run
 * against it without a Redis server. `duplicate()` returns a client sharing the same store.
 *
 * Time is injectable (`new MemoryRedis({ now })`) so idle-based behaviour is deterministic.
 */
import type { RawStreamEntry, RedisArg, StreamRedis } from "../redis";
import { compareStreamIds, splitStreamId } from "../redis";

interface Entry {
  id: string;
  fields: string[];
}

interface Pending {
  id: string;
  consumer: string;
  deliveredAt: number;
  deliveries: number;
}

interface Group {
  name: string;
  lastDeliveredId: string;
  pending: Map<string, Pending>;
  consumers: Set<string>;
}

interface Stream {
  entries: Entry[];
  groups: Map<string, Group>;
  lastId: string;
}

interface Waiter {
  keys: Set<string>;
  wake: () => void;
}

export class MemoryStore {
  readonly streams = new Map<string, Stream>();
  readonly waiters = new Set<Waiter>();
  /** Key → epoch ms at which it expires (EXPIRE). */
  readonly expiresAt = new Map<string, number>();
  now: () => number;
  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }
  notify(key: string): void {
    for (const w of this.waiters) if (w.keys.has(key)) w.wake();
  }
  /** Drops every key whose TTL has run out (Redis expires keys lazily too, on access). */
  sweep(): void {
    const now = this.now();
    for (const [key, at] of this.expiresAt) {
      if (at > now) continue;
      this.expiresAt.delete(key);
      this.streams.delete(key);
    }
  }
}

export class RedisReplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplyError";
  }
}

const MIN_ID = "0-0";
const MAX_ID = `${"18446744073709551615"}-${"18446744073709551615"}`;

function parseRangeBound(bound: string, side: "start" | "end"): { id: string; exclusive: boolean } {
  if (bound === "-") return { id: MIN_ID, exclusive: false };
  if (bound === "+") return { id: MAX_ID, exclusive: false };
  let exclusive = false;
  let b = bound;
  if (b.startsWith("(")) {
    exclusive = true;
    b = b.slice(1);
  }
  if (!b.includes("-")) b = side === "start" ? `${b}-0` : `${b}-18446744073709551615`;
  return { id: b, exclusive };
}

function inRange(
  id: string,
  start: { id: string; exclusive: boolean },
  end: { id: string; exclusive: boolean },
): boolean {
  const cs = compareStreamIds(id, start.id);
  const ce = compareStreamIds(id, end.id);
  return (start.exclusive ? cs > 0 : cs >= 0) && (end.exclusive ? ce < 0 : ce <= 0);
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

const str = (v: RedisArg): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : v.toString();

export interface MemoryRedisOptions {
  /** Clock used for entry ids (when `*`) and pending idle times. */
  now?: () => number;
}

export class MemoryRedis implements StreamRedis {
  readonly store: MemoryStore;
  private closed = false;

  constructor(storeOrOpts?: MemoryStore | MemoryRedisOptions) {
    this.store =
      storeOrOpts instanceof MemoryStore ? storeOrOpts : new MemoryStore(storeOrOpts?.now);
  }

  duplicate(): MemoryRedis {
    return new MemoryRedis(this.store);
  }

  // ------------------------------------------------------------------ helpers

  private stream(key: string, create: boolean): Stream | undefined {
    let s = this.store.streams.get(key);
    if (!s && create) {
      s = { entries: [], groups: new Map(), lastId: MIN_ID };
      this.store.streams.set(key, s);
    }
    return s;
  }

  private group(key: string, group: string): { s: Stream; g: Group } {
    const s = this.store.streams.get(key);
    const g = s?.groups.get(group);
    if (!s || !g)
      throw new RedisReplyError(
        `NOGROUP No such key '${key}' or consumer group '${group}' in XREADGROUP with GROUP option`,
      );
    return { s, g };
  }

  private nextId(s: Stream, requested: string): string {
    const [lastMs, lastSeq] = splitStreamId(s.lastId);
    if (requested === "*") {
      const nowMs = BigInt(Math.max(0, Math.floor(this.store.now())));
      if (nowMs > lastMs) return `${nowMs}-0`;
      return `${lastMs}-${lastSeq + 1n}`;
    }
    if (requested.endsWith("-*")) {
      const ms = BigInt(requested.slice(0, -2));
      if (ms < lastMs)
        throw new RedisReplyError(
          "ERR The ID specified in XADD is equal or smaller than the target stream top item",
        );
      return ms === lastMs ? `${ms}-${lastSeq + 1n}` : `${ms}-0`;
    }
    const id = requested.includes("-") ? requested : `${requested}-0`;
    if (compareStreamIds(id, s.lastId) <= 0 && !(s.entries.length === 0 && id !== MIN_ID)) {
      throw new RedisReplyError(
        "ERR The ID specified in XADD is equal or smaller than the target stream top item",
      );
    }
    if (id === MIN_ID)
      throw new RedisReplyError("ERR The ID specified in XADD must be greater than 0-0");
    return id;
  }

  private entryById(s: Stream, id: string): Entry | undefined {
    return s.entries.find((e) => e.id === id);
  }

  private checkOpen(): void {
    if (this.closed) throw new RedisReplyError("Connection is closed.");
    this.store.sweep();
  }

  /** Removes entries with an id below `minId`; returns how many. */
  private trimMinId(s: Stream, minId: string): number {
    const keep = s.entries.findIndex((e) => compareStreamIds(e.id, minId) >= 0);
    const n = keep === -1 ? s.entries.length : keep;
    if (n > 0) s.entries.splice(0, n);
    return n;
  }

  // ------------------------------------------------------------------ XADD / XRANGE / XLEN / XDEL

  async xadd(key: string, ...rawArgs: RedisArg[]): Promise<string | null> {
    this.checkOpen();
    const args = rawArgs.map(str);
    let i = 0;
    let maxLen: number | null = null;
    let minId: string | null = null;
    let noMkStream = false;
    for (; i < args.length;) {
      const tok = args[i]!.toUpperCase();
      if (tok === "NOMKSTREAM") {
        noMkStream = true;
        i += 1;
      } else if (tok === "MAXLEN" || tok === "MINID") {
        let j = i + 1;
        if (args[j] === "~" || args[j] === "=") j += 1;
        const threshold = args[j]!;
        j += 1;
        if (args[j]?.toUpperCase() === "LIMIT") j += 2;
        if (tok === "MAXLEN") maxLen = Number(threshold);
        else minId = threshold.includes("-") ? threshold : `${threshold}-0`;
        i = j;
      } else break;
    }
    const requestedId = args[i];
    if (requestedId === undefined)
      throw new RedisReplyError("ERR wrong number of arguments for 'xadd' command");
    const fields = args.slice(i + 1);
    if (fields.length === 0 || fields.length % 2 !== 0)
      throw new RedisReplyError("ERR wrong number of arguments for 'xadd' command");
    const existing = this.store.streams.get(key);
    if (!existing && noMkStream) return null;
    const s = this.stream(key, true)!;
    const id = this.nextId(s, requestedId);
    s.entries.push({ id, fields });
    s.lastId = id;
    if (maxLen !== null && maxLen >= 0 && s.entries.length > maxLen)
      s.entries.splice(0, s.entries.length - maxLen);
    if (minId !== null) this.trimMinId(s, minId);
    this.store.notify(key);
    return id;
  }

  /** XTRIM key MAXLEN|MINID [=|~] threshold (trimming is exact here). */
  async xtrim(key: string, ...rawArgs: RedisArg[]): Promise<number> {
    this.checkOpen();
    const args = rawArgs.map(str);
    const strategy = args[0]?.toUpperCase();
    const threshold = args[1] === "~" || args[1] === "=" ? args[2] : args[1];
    if ((strategy !== "MAXLEN" && strategy !== "MINID") || threshold === undefined)
      throw new RedisReplyError("ERR syntax error");
    const s = this.store.streams.get(key);
    if (!s) return 0;
    if (strategy === "MINID") return this.trimMinId(s, threshold.includes("-") ? threshold : `${threshold}-0`);
    const maxLen = Number(threshold);
    if (s.entries.length <= maxLen) return 0;
    const n = s.entries.length - maxLen;
    s.entries.splice(0, n);
    return n;
  }

  async xrange(
    key: string,
    start: string,
    end: string,
    ...rest: RedisArg[]
  ): Promise<RawStreamEntry[]> {
    this.checkOpen();
    const s = this.store.streams.get(key);
    if (!s) return [];
    const count =
      rest.length >= 2 && str(rest[0]!).toUpperCase() === "COUNT" ? Number(rest[1]) : Infinity;
    const a = parseRangeBound(start, "start");
    const b = parseRangeBound(end, "end");
    const out: RawStreamEntry[] = [];
    for (const e of s.entries) {
      if (out.length >= count) break;
      if (inRange(e.id, a, b)) out.push([e.id, [...e.fields]]);
    }
    return out;
  }

  async xrevrange(
    key: string,
    end: string,
    start: string,
    ...rest: RedisArg[]
  ): Promise<RawStreamEntry[]> {
    this.checkOpen();
    const s = this.store.streams.get(key);
    if (!s) return [];
    const count =
      rest.length >= 2 && str(rest[0]!).toUpperCase() === "COUNT" ? Number(rest[1]) : Infinity;
    const a = parseRangeBound(start, "start");
    const b = parseRangeBound(end, "end");
    const out: RawStreamEntry[] = [];
    for (let i = s.entries.length - 1; i >= 0 && out.length < count; i--) {
      const e = s.entries[i]!;
      if (inRange(e.id, a, b)) out.push([e.id, [...e.fields]]);
    }
    return out;
  }

  async xlen(key: string): Promise<number> {
    this.checkOpen();
    return this.store.streams.get(key)?.entries.length ?? 0;
  }

  async xdel(key: string, ...ids: RedisArg[]): Promise<number> {
    this.checkOpen();
    const s = this.store.streams.get(key);
    if (!s) return 0;
    let n = 0;
    for (const raw of ids) {
      const id = str(raw);
      const idx = s.entries.findIndex((e) => e.id === id);
      if (idx !== -1) {
        s.entries.splice(idx, 1);
        n++;
      }
    }
    return n;
  }

  // ------------------------------------------------------------------ XGROUP

  async xgroup(
    subcommand: string,
    key: string,
    group: string,
    ...rest: RedisArg[]
  ): Promise<unknown> {
    this.checkOpen();
    const sub = subcommand.toUpperCase();
    if (sub === "CREATE") {
      const args = rest.map(str);
      const id = args[0];
      if (id === undefined)
        throw new RedisReplyError("ERR wrong number of arguments for 'xgroup|create' command");
      const mkstream = args.slice(1).some((a) => a.toUpperCase() === "MKSTREAM");
      let s = this.store.streams.get(key);
      if (!s) {
        if (!mkstream)
          throw new RedisReplyError(
            "ERR The XGROUP subcommand requires the key to exist. Note that for CREATE you may want to use the MKSTREAM option to create an empty stream automatically.",
          );
        s = this.stream(key, true)!;
      }
      if (s.groups.has(group))
        throw new RedisReplyError("BUSYGROUP Consumer Group name already exists");
      const lastDeliveredId = id === "$" ? s.lastId : id.includes("-") ? id : `${id}-0`;
      s.groups.set(group, {
        name: group,
        lastDeliveredId,
        pending: new Map(),
        consumers: new Set(),
      });
      return "OK";
    }
    if (sub === "DESTROY") {
      const s = this.store.streams.get(key);
      if (!s) return 0;
      return s.groups.delete(group) ? 1 : 0;
    }
    if (sub === "DELCONSUMER") {
      const { g } = this.group(key, group);
      const consumer = str(rest[0]!);
      let n = 0;
      for (const [id, p] of g.pending) {
        if (p.consumer === consumer) {
          g.pending.delete(id);
          n++;
        }
      }
      g.consumers.delete(consumer);
      return n;
    }
    if (sub === "CREATECONSUMER") {
      const { g } = this.group(key, group);
      const consumer = str(rest[0]!);
      const added = !g.consumers.has(consumer);
      g.consumers.add(consumer);
      return added ? 1 : 0;
    }
    if (sub === "SETID") {
      const { s, g } = this.group(key, group);
      const id = str(rest[0]!);
      g.lastDeliveredId = id === "$" ? s.lastId : id;
      return "OK";
    }
    throw new RedisReplyError(`ERR unknown subcommand '${subcommand}'`);
  }

  // ------------------------------------------------------------------ XREADGROUP / XREAD

  async xreadgroup(...rawArgs: RedisArg[]): Promise<unknown> {
    this.checkOpen();
    const args = rawArgs.map(str);
    let i = 0;
    if (args[i]?.toUpperCase() !== "GROUP") throw new RedisReplyError("ERR syntax error");
    const group = args[i + 1]!;
    const consumer = args[i + 2]!;
    i += 3;
    let count = Infinity;
    let block: number | null = null;
    let noack = false;
    while (i < args.length && args[i]!.toUpperCase() !== "STREAMS") {
      const tok = args[i]!.toUpperCase();
      if (tok === "COUNT") {
        count = Number(args[i + 1]);
        i += 2;
      } else if (tok === "BLOCK") {
        block = Number(args[i + 1]);
        i += 2;
      } else if (tok === "NOACK") {
        noack = true;
        i += 1;
      } else throw new RedisReplyError("ERR syntax error");
    }
    i += 1; // STREAMS
    const remaining = args.slice(i);
    if (remaining.length === 0 || remaining.length % 2 !== 0)
      throw new RedisReplyError(
        "ERR Unbalanced 'xreadgroup' list of streams: for each stream key an ID or '>' must be specified.",
      );
    const half = remaining.length / 2;
    const keys = remaining.slice(0, half);
    const ids = remaining.slice(half);
    // Groups must exist for every key (Redis checks before blocking).
    for (const k of keys) this.group(k, group);

    const attempt = (): [string, [string, string[]][]][] | null => {
      const reply: [string, [string, string[]][]][] = [];
      keys.forEach((key, idx) => {
        const id = ids[idx]!;
        const { s, g } = this.group(key, group);
        g.consumers.add(consumer);
        const now = this.store.now();
        const items: [string, string[]][] = [];
        if (id === ">") {
          for (const e of s.entries) {
            if (items.length >= count) break;
            if (compareStreamIds(e.id, g.lastDeliveredId) <= 0) continue;
            items.push([e.id, [...e.fields]]);
            g.lastDeliveredId = e.id;
            if (!noack)
              g.pending.set(e.id, { id: e.id, consumer, deliveredAt: now, deliveries: 1 });
          }
        } else {
          // Re-read this consumer's pending entries with id > given id (idle/deliveries updated as Redis does).
          const bound = id.includes("-") ? id : `${id}-0`;
          const mine = [...g.pending.values()]
            .filter((p) => p.consumer === consumer && compareStreamIds(p.id, bound) > 0)
            .sort((a, b) => compareStreamIds(a.id, b.id));
          for (const p of mine) {
            if (items.length >= count) break;
            const e = this.entryById(s, p.id);
            p.deliveredAt = now;
            p.deliveries += 1;
            items.push([p.id, e ? [...e.fields] : (null as unknown as string[])]);
          }
        }
        if (items.length > 0) reply.push([key, items]);
      });
      return reply.length > 0 ? reply : null;
    };

    const first = attempt();
    if (first !== null || block === null || !ids.every((id) => id === ">")) return first;
    return this.blockUntil(new Set(keys), block, attempt);
  }

  async xread(...rawArgs: RedisArg[]): Promise<unknown> {
    this.checkOpen();
    const args = rawArgs.map(str);
    let i = 0;
    let count = Infinity;
    let block: number | null = null;
    while (i < args.length && args[i]!.toUpperCase() !== "STREAMS") {
      const tok = args[i]!.toUpperCase();
      if (tok === "COUNT") {
        count = Number(args[i + 1]);
        i += 2;
      } else if (tok === "BLOCK") {
        block = Number(args[i + 1]);
        i += 2;
      } else throw new RedisReplyError("ERR syntax error");
    }
    i += 1;
    const remaining = args.slice(i);
    if (remaining.length === 0 || remaining.length % 2 !== 0)
      throw new RedisReplyError(
        "ERR Unbalanced 'xread' list of streams: for each stream key an ID or '$' must be specified.",
      );
    const half = remaining.length / 2;
    const keys = remaining.slice(0, half);
    const ids = remaining
      .slice(half)
      .map((id, idx) =>
        id === "$"
          ? (this.store.streams.get(keys[idx]!)?.lastId ?? MIN_ID)
          : id.includes("-")
            ? id
            : `${id}-0`,
      );

    const attempt = (): [string, [string, string[]][]][] | null => {
      const reply: [string, [string, string[]][]][] = [];
      keys.forEach((key, idx) => {
        const s = this.store.streams.get(key);
        if (!s) return;
        const items: [string, string[]][] = [];
        for (const e of s.entries) {
          if (items.length >= count) break;
          if (compareStreamIds(e.id, ids[idx]!) > 0) items.push([e.id, [...e.fields]]);
        }
        if (items.length > 0) reply.push([key, items]);
      });
      return reply.length > 0 ? reply : null;
    };
    const first = attempt();
    if (first !== null || block === null) return first;
    return this.blockUntil(new Set(keys), block, attempt);
  }

  private blockUntil<T>(
    keys: Set<string>,
    blockMs: number,
    attempt: () => T | null,
  ): Promise<T | null> {
    return new Promise<T | null>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const waiter: Waiter = {
        keys,
        wake: () => {
          const r = attempt();
          if (r === null) return; // another consumer took it; keep waiting
          finish(r);
        },
      };
      const finish = (value: T | null) => {
        this.store.waiters.delete(waiter);
        if (timer) clearTimeout(timer);
        resolve(value);
      };
      this.store.waiters.add(waiter);
      // BLOCK 0 means forever in Redis; we cap it so a forgotten test cannot hang.
      timer = setTimeout(() => finish(null), blockMs === 0 ? 60_000 : blockMs);
    });
  }

  // ------------------------------------------------------------------ XACK / XPENDING / XCLAIM

  async xack(key: string, group: string, ...ids: RedisArg[]): Promise<number> {
    this.checkOpen();
    const s = this.store.streams.get(key);
    const g = s?.groups.get(group);
    if (!g) return 0;
    let n = 0;
    for (const raw of ids) if (g.pending.delete(str(raw))) n++;
    return n;
  }

  async xpending(key: string, group: string, ...rest: RedisArg[]): Promise<unknown[]> {
    this.checkOpen();
    const { g } = this.group(key, group);
    const now = this.store.now();
    const all = [...g.pending.values()].sort((a, b) => compareStreamIds(a.id, b.id));
    if (rest.length === 0) {
      if (all.length === 0) return [0, null, null, null];
      const perConsumer = new Map<string, number>();
      for (const p of all) perConsumer.set(p.consumer, (perConsumer.get(p.consumer) ?? 0) + 1);
      return [
        all.length,
        all[0]!.id,
        all[all.length - 1]!.id,
        [...perConsumer.entries()].map(([c, n]) => [c, String(n)]),
      ];
    }
    const args = rest.map(str);
    let i = 0;
    let minIdle = 0;
    if (args[i]?.toUpperCase() === "IDLE") {
      minIdle = Number(args[i + 1]);
      i += 2;
    }
    const start = parseRangeBound(args[i]!, "start");
    const end = parseRangeBound(args[i + 1]!, "end");
    const count = Number(args[i + 2]);
    const consumer = args[i + 3];
    const out: unknown[] = [];
    for (const p of all) {
      if (out.length >= count) break;
      if (!inRange(p.id, start, end)) continue;
      const idle = Math.max(0, now - p.deliveredAt);
      if (idle < minIdle) continue;
      if (consumer !== undefined && p.consumer !== consumer) continue;
      out.push([p.id, p.consumer, idle, p.deliveries]);
    }
    return out;
  }

  async xclaim(
    key: string,
    group: string,
    consumer: string,
    minIdleMs: RedisArg,
    ...rest: RedisArg[]
  ): Promise<unknown[]> {
    this.checkOpen();
    const { s, g } = this.group(key, group);
    const args = rest.map(str);
    const ids: string[] = [];
    let i = 0;
    const OPTS = new Set(["IDLE", "TIME", "RETRYCOUNT", "FORCE", "JUSTID", "LASTID"]);
    for (; i < args.length && !OPTS.has(args[i]!.toUpperCase()); i++) ids.push(args[i]!);
    let idle: number | null = null;
    let time: number | null = null;
    let retryCount: number | null = null;
    let force = false;
    let justId = false;
    for (; i < args.length;) {
      const tok = args[i]!.toUpperCase();
      if (tok === "IDLE") {
        idle = Number(args[i + 1]);
        i += 2;
      } else if (tok === "TIME") {
        time = Number(args[i + 1]);
        i += 2;
      } else if (tok === "RETRYCOUNT") {
        retryCount = Number(args[i + 1]);
        i += 2;
      } else if (tok === "FORCE") {
        force = true;
        i += 1;
      } else if (tok === "JUSTID") {
        justId = true;
        i += 1;
      } else if (tok === "LASTID") {
        i += 2;
      } else throw new RedisReplyError("ERR syntax error");
    }
    const now = this.store.now();
    const minIdle = Number(str(minIdleMs));
    const out: unknown[] = [];
    g.consumers.add(consumer);
    for (const id of ids) {
      let p = g.pending.get(id);
      const entry = this.entryById(s, id);
      if (!entry) {
        // Redis 7: claiming an id no longer in the stream removes it from the PEL and skips it.
        if (p) g.pending.delete(id);
        continue;
      }
      if (!p) {
        if (!force) continue;
        p = { id, consumer, deliveredAt: now, deliveries: 0 };
        g.pending.set(id, p);
      } else if (now - p.deliveredAt < minIdle) continue;
      p.consumer = consumer;
      p.deliveredAt = time !== null ? time : idle !== null ? now - idle : now;
      if (retryCount !== null) p.deliveries = retryCount;
      else if (!justId) p.deliveries += 1;
      out.push(justId ? id : [id, [...entry.fields]]);
    }
    return out;
  }

  // ------------------------------------------------------------------ keys

  async scan(
    cursor: number | string,
    ...rest: RedisArg[]
  ): Promise<[cursor: string, keys: string[]]> {
    this.checkOpen();
    const args = rest.map(str);
    let pattern = "*";
    let type: string | null = null;
    for (let i = 0; i < args.length;) {
      const tok = args[i]!.toUpperCase();
      if (tok === "MATCH") {
        pattern = args[i + 1]!;
        i += 2;
      } else if (tok === "COUNT") i += 2;
      else if (tok === "TYPE") {
        type = args[i + 1]!.toLowerCase();
        i += 2;
      } else throw new RedisReplyError("ERR syntax error");
    }
    if (String(cursor) !== "0") return ["0", []];
    if (type !== null && type !== "stream") return ["0", []];
    const re = globToRegExp(pattern);
    return ["0", [...this.store.streams.keys()].filter((k) => re.test(k)).sort()];
  }

  async keys(pattern: string): Promise<string[]> {
    this.checkOpen();
    const re = globToRegExp(pattern);
    return [...this.store.streams.keys()].filter((k) => re.test(k)).sort();
  }

  async del(...keys: string[]): Promise<number> {
    this.checkOpen();
    let n = 0;
    for (const k of keys) {
      this.store.expiresAt.delete(k);
      if (this.store.streams.delete(k)) n++;
    }
    return n;
  }

  /** EXPIRE key seconds: 1 when the key exists (a TTL of 0 or less deletes it at once), else 0. */
  async expire(key: string, seconds: number | string): Promise<number> {
    this.checkOpen();
    if (!this.store.streams.has(key)) return 0;
    const ms = Number(seconds) * 1000;
    if (ms <= 0) {
      this.store.expiresAt.delete(key);
      this.store.streams.delete(key);
    } else this.store.expiresAt.set(key, this.store.now() + ms);
    return 1;
  }

  /** TTL key: seconds left, -1 without a TTL, -2 when the key does not exist. */
  async ttl(key: string): Promise<number> {
    this.checkOpen();
    if (!this.store.streams.has(key)) return -2;
    const at = this.store.expiresAt.get(key);
    return at === undefined ? -1 : Math.ceil((at - this.store.now()) / 1000);
  }

  async exists(...keys: string[]): Promise<number> {
    this.checkOpen();
    return keys.filter((k) => this.store.streams.has(k)).length;
  }

  async quit(): Promise<"OK"> {
    this.closed = true;
    return "OK";
  }

  disconnect(): void {
    this.closed = true;
  }

  // ------------------------------------------------------------------ test helpers

  /** Every entry of a stream as `{ id, fields }` objects (for assertions). */
  dump(key: string): { id: string; fields: Record<string, string> }[] {
    const s = this.store.streams.get(key);
    if (!s) return [];
    return s.entries.map((e) => {
      const fields: Record<string, string> = {};
      for (let i = 0; i + 1 < e.fields.length; i += 2) fields[e.fields[i]!] = e.fields[i + 1]!;
      return { id: e.id, fields };
    });
  }

  /** Pending entries for a group (for assertions). */
  pendingOf(key: string, group: string): { id: string; consumer: string; deliveries: number }[] {
    const g = this.store.streams.get(key)?.groups.get(group);
    if (!g) return [];
    return [...g.pending.values()]
      .sort((a, b) => compareStreamIds(a.id, b.id))
      .map(({ id, consumer, deliveries }) => ({ id, consumer, deliveries }));
  }

  /** Remove every stream (between tests). */
  flushall(): void {
    this.store.streams.clear();
    this.store.expiresAt.clear();
  }
}

/** A `MemoryRedis` with a manually advanced clock. `clock.advance(ms)` makes pending entries idle. */
export function createMemoryRedisWithClock(startMs = 1_700_000_000_000): {
  redis: MemoryRedis;
  clock: { now(): number; advance(ms: number): void; set(ms: number): void };
} {
  let t = startMs;
  const clock = {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
    set(ms: number) {
      t = ms;
    },
  };
  return { redis: new MemoryRedis({ now: () => t }), clock };
}
