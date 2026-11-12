/**
 * account_events + account_outbox (0085) — the person-level event store (docs/ARCHITECTURE.md §5 "Account events"):
 * facts about one person, keyed by their account (`userId` first, like the other account-scoped repos) and never by a
 * business.
 *
 * This repo is the read side. There is no `write` here on purpose: the one writer is `@foundmill/events`
 * `writeAccountEvent(tx, …)`, which validates the payload against the catalog, holds it to the two-person rule (a
 * payload names another person only by something public about them, never by account id or email address) and inserts
 * the event and its outbox row in the caller's transaction.
 *
 * `list` and `get` select only the columns a person may read (`ACCOUNT_EVENT_CLIENT_COLUMNS`), so they run under RLS as
 * that person as well as on the service connection, and what they return is safe to hand to that person. Everything
 * else (`byIdempotencyKey`, the outbox reads) is for services: under RLS it is refused or reads nothing.
 */
import { ACCOUNT_EVENT_TYPES, type AccountEventType } from "@foundmill/shared";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { accountEvents, accountOutbox } from "../schema";
import { DateRange, Id, maybeOne, PageInput, parseInput, timeKeyset, timeRange, toPage, type Executor, type Page } from "./_shared";

/** One account event as its own person may read it: no actor, no idempotency key. */
export interface AccountEventView {
  id: string;
  userId: string;
  type: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
  createdAt: Date;
}

/** One queue row for observability: which event, how often it failed and why. Never the payload. */
export interface AccountOutboxView {
  eventId: string;
  userId: string;
  type: string;
  publishedAt: Date | null;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: Date | null;
  createdAt: Date;
}

export const AccountEventListFilter = PageInput.extend(DateRange.shape).extend({
  type: z.union([z.enum(ACCOUNT_EVENT_TYPES), z.array(z.enum(ACCOUNT_EVENT_TYPES))]).optional(),
});
export type AccountEventListFilter = z.input<typeof AccountEventListFilter>;

/** Exactly `ACCOUNT_EVENT_CLIENT_COLUMNS` (schema/governance.ts): the grant of 0085, by Drizzle column. */
const clientColumns = {
  id: accountEvents.id,
  userId: accountEvents.userId,
  type: accountEvents.type,
  occurredAt: accountEvents.occurredAt,
  payload: accountEvents.payload,
  createdAt: accountEvents.createdAt,
} as const;

const outboxColumns = {
  eventId: accountOutbox.eventId,
  userId: accountOutbox.userId,
  type: accountEvents.type,
  publishedAt: accountOutbox.publishedAt,
  attempts: accountOutbox.attempts,
  lastError: accountOutbox.lastError,
  nextAttemptAt: accountOutbox.nextAttemptAt,
  createdAt: accountOutbox.createdAt,
} as const;

const toArray = <T>(v: T | T[] | undefined): T[] | undefined => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);

export const accountEventsRepo = {
  /** The person's own events, newest first, page by page. */
  async list(db: Executor, userId: string, filter: AccountEventListFilter = {}): Promise<Page<AccountEventView>> {
    const uid = parseInput(Id, userId, "user id");
    const f = parseInput(AccountEventListFilter, filter, "account event filter");
    const ks = timeKeyset<AccountEventView>(accountEvents.occurredAt, accountEvents.id, (r) => ({ at: r.occurredAt, id: r.id }));
    const types = toArray(f.type);
    const rows = await db
      .select(clientColumns)
      .from(accountEvents)
      .where(and(eq(accountEvents.userId, uid), types?.length ? inArray(accountEvents.type, types) : undefined, timeRange(accountEvents.occurredAt, f), ks.after(f.cursor)))
      .orderBy(...ks.orderBy)
      .limit(f.limit + 1);
    return toPage(rows, f, ks);
  },

  /** One of the person's own events, or null (an unknown id and another person's event read the same). */
  async get(db: Executor, userId: string, eventId: string): Promise<AccountEventView | null> {
    const uid = parseInput(Id, userId, "user id");
    const id = parseInput(Id, eventId, "event id");
    return maybeOne(await db.select(clientColumns).from(accountEvents).where(and(eq(accountEvents.userId, uid), eq(accountEvents.id, id))).limit(1));
  },

  /** Service connection only: the person's event written with this idempotency key, or null. */
  async byIdempotencyKey(db: Executor, userId: string, idempotencyKey: string): Promise<AccountEventView | null> {
    const uid = parseInput(Id, userId, "user id");
    return maybeOne(await db.select(clientColumns).from(accountEvents).where(and(eq(accountEvents.userId, uid), eq(accountEvents.idempotencyKey, idempotencyKey))).limit(1));
  },

  /** How many events of each type the person has. */
  async countByType(db: Executor, userId: string, range: DateRange = {}): Promise<Partial<Record<AccountEventType, number>>> {
    const uid = parseInput(Id, userId, "user id");
    const r = parseInput(DateRange, range, "date range");
    const rows = await db
      .select({ type: accountEvents.type, n: sql<number>`count(*)::int` })
      .from(accountEvents)
      .where(and(eq(accountEvents.userId, uid), timeRange(accountEvents.occurredAt, r)))
      .groupBy(accountEvents.type);
    return Object.fromEntries(rows.map((x) => [x.type, Number(x.n)]));
  },

  // account_outbox (the relay in @foundmill/events owns publishing; these are for observability and tests) -----
  /** Service connection only: the person's events not yet published to their stream, oldest first. */
  async outboxPending(db: Executor, userId: string, limit = 100): Promise<AccountOutboxView[]> {
    const uid = parseInput(Id, userId, "user id");
    return db
      .select(outboxColumns)
      .from(accountOutbox)
      .innerJoin(accountEvents, eq(accountEvents.id, accountOutbox.eventId))
      .where(and(eq(accountOutbox.userId, uid), isNull(accountOutbox.publishedAt)))
      .orderBy(asc(accountOutbox.createdAt))
      .limit(limit);
  },

  /** Service connection only: how many account events wait for the relay, for one person or for everyone. */
  async outboxCountPending(db: Executor, userId?: string): Promise<number> {
    const uid = userId === undefined ? undefined : parseInput(Id, userId, "user id");
    const rows = await db.select({ n: sql<number>`count(*)::int` }).from(accountOutbox).where(and(uid ? eq(accountOutbox.userId, uid) : undefined, isNull(accountOutbox.publishedAt)));
    return Number(rows[0]?.n ?? 0);
  },

  /**
   * Service connection only: the rows the relay could not publish, most attempts first: still waiting for a retry
   * (`publishedAt` null) or closed because they can never be published (`publishedAt` set with a `lastError`).
   */
  async outboxFailing(db: Executor, limit = 100): Promise<AccountOutboxView[]> {
    return db
      .select(outboxColumns)
      .from(accountOutbox)
      .innerJoin(accountEvents, eq(accountEvents.id, accountOutbox.eventId))
      .where(isNotNull(accountOutbox.lastError))
      .orderBy(sql`${accountOutbox.attempts} desc`, asc(accountOutbox.createdAt))
      .limit(limit);
  },
};
