/**
 * A fake `Queryable` for tests: renders every statement to SQL text + params through drizzle's Postgres
 * dialect (so assertions can look at the exact SQL `writeEvent` emits) and keeps in-memory `events` and
 * `outbox` tables so the relay can run end to end without Postgres.
 *
 * It understands only the statements this package issues (insert into events / outbox, select unpublished,
 * update outbox set published_at) and throws on anything else, which keeps the fake honest.
 */
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Queryable, TransactionalQueryable } from "../outbox/writer";

export interface CapturedStatement {
  sql: string;
  params: unknown[];
}

export interface FakeEventRow {
  id: string;
  business_id: string;
  type: string;
  occurred_at: Date;
  actor: unknown;
  entity_ids: string[];
  payload: unknown;
  narrated: boolean;
}

export interface FakeOutboxRow {
  event_id: string;
  published_at: Date | null;
  created_at: Date;
}

const dialect = new PgDialect();

export function renderSql(query: SQL): CapturedStatement {
  const q = dialect.sqlToQuery(query);
  return { sql: q.sql, params: q.params };
}

export interface FakeDbOptions {
  /** Result shape of `execute`: postgres.js returns the row array, PGlite returns `{ rows }`. Default "array". */
  resultShape?: "array" | "rows";
  /** Fail the nth statement (1-based) with this error — for at-least-once tests. */
  failOn?: (stmt: CapturedStatement, index: number) => Error | undefined;
  now?: () => Date;
}

export class FakeDb implements TransactionalQueryable {
  readonly statements: CapturedStatement[] = [];
  readonly events = new Map<string, FakeEventRow>();
  readonly outbox: FakeOutboxRow[] = [];
  transactions = 0;
  private readonly opts: FakeDbOptions;

  constructor(opts: FakeDbOptions = {}) {
    this.opts = opts;
  }

  async execute(query: SQL): Promise<unknown> {
    const stmt = renderSql(query);
    this.statements.push(stmt);
    const err = this.opts.failOn?.(stmt, this.statements.length);
    if (err) throw err;
    return this.apply(stmt);
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    this.transactions++;
    // Snapshot so a thrown error rolls back the fake tables like a real transaction would.
    const eventsSnapshot = new Map([...this.events.entries()].map(([k, v]) => [k, { ...v }]));
    const outboxSnapshot = this.outbox.map((r) => ({ ...r }));
    try {
      return await fn({ execute: (q) => this.execute(q) });
    } catch (e) {
      this.events.clear();
      for (const [k, v] of eventsSnapshot) this.events.set(k, v);
      this.outbox.splice(0, this.outbox.length, ...outboxSnapshot);
      throw e;
    }
  }

  private wrap(rows: Record<string, unknown>[]): unknown {
    return this.opts.resultShape === "rows" ? { rows, affectedRows: rows.length } : rows;
  }

  private apply(stmt: CapturedStatement): unknown {
    const s = stmt.sql.replace(/\s+/g, " ").trim().toLowerCase();
    const now = this.opts.now ?? (() => new Date());

    if (s.startsWith('insert into "events"')) {
      const [id, business_id, type, occurred_at, actor, ...rest] = stmt.params as [
        string,
        string,
        string,
        string,
        string,
        ...unknown[],
      ];
      // entity ids are the params between actor and payload; payload and narrated are the last two.
      const narrated = rest[rest.length - 1] as boolean;
      const payload = rest[rest.length - 2] as string;
      const entity_ids = rest.slice(0, rest.length - 2).map(String);
      if (this.events.has(id))
        throw new Error(`duplicate key value violates unique constraint "events_pkey" (${id})`);
      this.events.set(id, {
        id,
        business_id,
        type,
        occurred_at: new Date(occurred_at),
        actor: JSON.parse(actor),
        entity_ids,
        payload: JSON.parse(payload),
        narrated,
      });
      return this.wrap([]);
    }

    if (s.startsWith('insert into "outbox"')) {
      const [event_id] = stmt.params as [string];
      if (!this.events.has(event_id))
        throw new Error(
          `insert or update on table "outbox" violates foreign key constraint (${event_id})`,
        );
      this.outbox.push({ event_id, published_at: null, created_at: now() });
      return this.wrap([]);
    }

    if (s.startsWith("select o.event_id") && s.includes('from "outbox" o join "events" e')) {
      const limit = Number(stmt.params[0]);
      const rows = this.outbox
        .filter((o) => o.published_at === null)
        .map((o) => ({ o, e: this.events.get(o.event_id)! }))
        .filter((x) => x.e)
        .sort(
          (a, b) =>
            a.e.occurred_at.getTime() - b.e.occurred_at.getTime() ||
            a.o.event_id.localeCompare(b.o.event_id),
        )
        .slice(0, limit)
        .map(({ e }) => ({
          id: e.id,
          businessId: e.business_id,
          type: e.type,
          occurredAt: e.occurred_at,
          actor: e.actor,
          entityIds: e.entity_ids,
          payload: e.payload,
          narrated: e.narrated,
        }));
      return this.wrap(rows);
    }

    if (s.startsWith('update "outbox" set published_at = now()')) {
      const ids = new Set(stmt.params.map(String));
      const at = now();
      for (const o of this.outbox)
        if (ids.has(o.event_id) && o.published_at === null) o.published_at = at;
      return this.wrap([]);
    }

    throw new Error(`FakeDb: unsupported statement: ${stmt.sql}`);
  }

  unpublished(): FakeOutboxRow[] {
    return this.outbox.filter((o) => o.published_at === null);
  }
}

/** A `Queryable` that only records statements (no tables), for pure SQL-shape assertions. */
export class CapturingQueryable implements Queryable {
  readonly statements: CapturedStatement[] = [];
  constructor(private readonly result: unknown = []) {}
  async execute(query: SQL): Promise<unknown> {
    this.statements.push(renderSql(query));
    return this.result;
  }
}
