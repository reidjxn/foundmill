/**
 * postgres.js over PGlite's wire protocol, in process, counting round trips (docs/DECISIONS.md "Round trips per
 * procedure"). Production talks to Supabase through Drizzle over postgres.js (`createDb`); Drizzle sends every statement
 * through `sql.unsafe`, which postgres.js never prepares, whatever the client's `prepare` option says. Every round trip
 * costs the network's latency (about 28 ms from Railway's Amsterdam region to the eu-north-1 pooler), so the number of
 * round trips a procedure makes is what decides how fast it answers. PGlite alone
 * cannot show that: Drizzle's PGlite driver never goes through postgres.js. Here postgres.js gets a socket whose other
 * end is PGlite's own protocol handler (`execProtocolRaw`), so the very messages production sends are answered by a
 * real Postgres, and the socket counts how often the client had to wait for an answer before sending again.
 *
 * One connection (`max: 1`): PGlite is a single session, so two connections would interleave their transactions.
 * Use it for one caller at a time, and do not query the PGlite instance directly while a wire transaction is open.
 */
import { EventEmitter } from "node:events";
import type { Socket } from "node:net";
import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { withDateParams, type Db } from "../client";
import * as schema from "../schema";

export interface WireDb {
  /** Drizzle over postgres.js, as `createDb` builds it (unprepared statements, as Drizzle always sends them). */
  db: Db;
  /** Round trips since the last `reset`: each time the client sent something after the server had answered. */
  roundTrips(): number;
  /** The SQL of every statement sent since the last `reset`, in order (extended-protocol Parse and simple Query). */
  statements(): string[];
  reset(): void;
  close(): Promise<void>;
}

/** What a server says right after a startup message: authenticated, a few parameters, ready for queries. */
function startupReply(): Buffer {
  const parts: Buffer[] = [];
  const message = (type: string, body: Buffer) => {
    const head = Buffer.alloc(5);
    head.write(type, 0, "latin1");
    head.writeInt32BE(4 + body.length, 1);
    parts.push(head, body);
  };
  const int32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeInt32BE(n);
    return b;
  };
  message("R", int32(0)); // AuthenticationOk
  for (const [key, value] of [
    ["server_version", "17.0"],
    ["client_encoding", "UTF8"],
    ["DateStyle", "ISO, MDY"],
    ["integer_datetimes", "on"],
    ["standard_conforming_strings", "on"],
  ]) {
    message("S", Buffer.from(`${key}\0${value}\0`));
  }
  message("K", Buffer.concat([int32(1), int32(1)])); // BackendKeyData
  message("Z", Buffer.from("I")); // ReadyForQuery, idle
  return Buffer.concat(parts);
}

/** The SQL text of each Parse ('P') and simple Query ('Q') message in a chunk the client sent. */
function statementsIn(chunk: Buffer): string[] {
  const out: string[] = [];
  for (let i = 0; i + 5 <= chunk.length; ) {
    const type = String.fromCharCode(chunk[i]!);
    const length = chunk.readInt32BE(i + 1);
    const body = chunk.subarray(i + 5, i + 1 + length);
    if (type === "Q") out.push(body.toString("utf8", 0, body.indexOf(0)));
    if (type === "P") {
      const nameEnd = body.indexOf(0);
      out.push(body.toString("utf8", nameEnd + 1, body.indexOf(0, nameEnd + 1)));
    }
    i += 1 + length;
  }
  return out;
}

class PgliteSocket extends EventEmitter {
  readyState = "open";
  private started = false;
  private answered = true;
  private queue: Promise<void> = Promise.resolve();
  trips = 0;
  sent: string[] = [];

  constructor(private readonly pg: PGlite) {
    super();
  }

  write(chunk: Uint8Array, callback?: () => void): boolean {
    const data = Buffer.from(chunk);
    if (this.started) {
      if (this.answered) this.trips++;
      this.answered = false;
      this.sent.push(...statementsIn(data));
    }
    this.queue = this.queue.then(async () => {
      let reply: Buffer;
      if (!this.started) {
        this.started = true;
        reply = startupReply();
      } else {
        if (data[0] === 0x58) return; // Terminate
        reply = Buffer.from(await this.pg.execProtocolRaw(new Uint8Array(data)));
      }
      if (reply.length === 0) return;
      setImmediate(() => {
        this.answered = true;
        this.emit("data", reply);
      });
    });
    callback?.();
    return true;
  }

  end(chunk?: Uint8Array): void {
    if (chunk) this.write(chunk);
    this.close();
  }

  destroy(): void {
    this.close();
  }

  setKeepAlive(): void {}
  pause(): void {}
  resume(): void {}

  private close(): void {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    void this.queue.then(() => setImmediate(() => this.emit("close")));
  }
}

/**
 * A postgres.js client on `pg` through the wire protocol; the first query (and postgres.js's type lookup) is done.
 *
 * `describe: true` is the reference for "the same answer": every statement Drizzle sends outside a transaction asks
 * for a prepared statement, so postgres.js has the server describe it first and serializes each value for the type the
 * server names, as it did for every statement with values before patches/postgres@3.4.9.patch. (Asking the client
 * for `prepare: true` alone changes nothing: Drizzle's `unsafe` calls opt out of it.) A transaction's statements go
 * through the transaction's own handle and are not affected.
 */
export async function createWireDb(pg: PGlite, options: { describe?: boolean } = {}): Promise<WireDb> {
  let socket: PgliteSocket | null = null;
  // `socket` (a factory for the connection's socket) is a postgres.js option its type definitions leave out.
  const client = postgres({
    max: 1,
    prepare: options.describe ?? false,
    onnotice: () => {},
    socket: () => {
      socket = new PgliteSocket(pg);
      return socket as unknown as Socket;
    },
  } as postgres.Options<Record<string, postgres.PostgresType>>);
  if (options.describe) {
    const unsafe = client.unsafe;
    Object.assign(client, { unsafe: (query: string, args?: unknown[], queryOptions?: postgres.UnsafeQueryOptions) => unsafe(query, args as postgres.ParameterOrJSON<never>[], { ...queryOptions, prepare: true }) });
  }
  const db = withDateParams(client, drizzle({ client, schema })) as unknown as Db;
  await client`select 1`;
  const current = () => {
    if (!socket) throw new Error("createWireDb: not connected");
    return socket;
  };
  return {
    db,
    roundTrips: () => current().trips,
    statements: () => [...current().sent],
    reset: () => {
      current().trips = 0;
      current().sent = [];
    },
    close: () => client.end({ timeout: 1 }),
  };
}
