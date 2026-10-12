/**
 * events + outbox — the platform event store (BUILD §8.1; ARCHITECTURE §5).
 *
 * `@foundmill/events`' `writeEvent(tx, …)` is the write path services use: it validates the payload
 * against the catalogue and inserts into both tables in the caller's transaction. This repo is the read
 * side (the Composer's "highest-priority un-narrated event", the Inbox's source events, the Match Day's
 * payment event) plus `write` for callers inside packages/db (seeds, tests) that already hold a validated
 * payload: it checks the type against the shared vocabulary and the ids, but not the payload shape.
 */
import { Actor, EVENT_TYPES, uuid, type EventType } from "@foundmill/shared";
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { events, outbox, type Event, type OutboxRow } from "../schema";
import { DateRange, Id, IsoDateInput, JsonObject, one, PageInput, parseInput, timeKeyset, timeRange, toPage, type Executor, type Page } from "./_shared";

export const WriteEventInput = z.object({
  id: Id.optional(),
  type: z.enum(EVENT_TYPES),
  actor: Actor,
  entityIds: z.array(Id).default([]),
  payload: JsonObject.default({}),
  occurredAt: IsoDateInput.optional(),
  /** Idempotency key (e.g. webhook delivery id); a repeat returns the existing event instead of a second row. */
  idempotencyKey: z.string().max(200).nullable().optional(),
});
export type WriteEventInput = z.input<typeof WriteEventInput>;

export const EventListFilter = PageInput.extend(DateRange.shape).extend({
  type: z.union([z.enum(EVENT_TYPES), z.array(z.enum(EVENT_TYPES))]).optional(),
  narrated: z.boolean().optional(),
  entityId: Id.optional(),
  actorKind: z.string().max(20).optional(),
});
export type EventListFilter = z.input<typeof EventListFilter>;

/** Composer priority order for un-narrated events (BUILD §11.3 Refresh rule 1). Lower = first. */
export const EVENT_PRIORITY: Partial<Record<EventType, number>> = {
  "runway.threshold_crossed": 0,
  "approval.requested": 1,
  "payment.received": 2,
  "customer.converted": 2,
  "credential.expiring": 3,
  "agent.health_changed": 3,
  "task.blocked": 4,
  "filing.due": 4,
  "contract.signed": 5,
  "channel.threshold_breached": 5,
  "pr.merged": 6,
  "deploy.succeeded": 6,
  "activation.reached": 6,
  "signup.created": 7,
  "lead.replied": 7,
  "lead.created": 8,
  "training.completed": 8,
  "campaign.launched": 8,
  "task.completed": 9,
  "spec.proposal_created": 9,
};
const DEFAULT_PRIORITY = 10;
const toArray = <T>(v: T | T[] | undefined): T[] | undefined => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);

export const eventsRepo = {
  /** Inserts into events + outbox in one transaction (or returns the existing row for a known idempotency key). */
  async write(db: Executor, businessId: string, input: WriteEventInput): Promise<Event> {
    const v = parseInput(WriteEventInput, input, "event");
    return db.transaction(async (tx) => {
      if (v.idempotencyKey) {
        const existing = await tx.select().from(events).where(and(eq(events.businessId, businessId), eq(events.idempotencyKey, v.idempotencyKey))).limit(1);
        if (existing[0]) return existing[0];
      }
      const row = one(
        await tx
          .insert(events)
          .values({ id: v.id ?? uuid(), businessId, type: v.type, occurredAt: v.occurredAt ?? new Date(), actor: v.actor, entityIds: [...new Set(v.entityIds)], payload: v.payload, narrated: false, idempotencyKey: v.idempotencyKey ?? null })
          .returning(),
        "event",
      );
      await tx.insert(outbox).values({ businessId, eventId: row.id });
      return row;
    });
  },

  async get(db: Executor, businessId: string, eventId: string): Promise<Event> {
    return one(await db.select().from(events).where(and(eq(events.businessId, businessId), eq(events.id, eventId))).limit(1), "event", eventId);
  },

  /** The event written with this idempotency key (a webhook delivery, a narration of one event set), or null. */
  async byIdempotencyKey(db: Executor, businessId: string, idempotencyKey: string): Promise<Event | null> {
    const rows = await db.select().from(events).where(and(eq(events.businessId, businessId), eq(events.idempotencyKey, idempotencyKey))).limit(1);
    return rows[0] ?? null;
  },

  async byIds(db: Executor, businessId: string, ids: readonly string[]): Promise<Event[]> {
    if (ids.length === 0) return [];
    return db.select().from(events).where(and(eq(events.businessId, businessId), inArray(events.id, [...ids]))).orderBy(asc(events.occurredAt));
  },

  async list(db: Executor, businessId: string, filter: EventListFilter = {}): Promise<Page<Event>> {
    const f = parseInput(EventListFilter, filter, "event filter");
    const ks = timeKeyset<Event>(events.occurredAt, events.id, (r) => ({ at: r.occurredAt, id: r.id }));
    const types = toArray(f.type);
    const rows = await db
      .select()
      .from(events)
      .where(
        and(
          eq(events.businessId, businessId),
          types?.length ? inArray(events.type, types) : undefined,
          f.narrated === undefined ? undefined : eq(events.narrated, f.narrated),
          f.entityId ? sql`${events.entityIds} @> array[${f.entityId}::uuid]` : undefined,
          f.actorKind ? sql`${events.actor} ->> 'kind' = ${f.actorKind}` : undefined,
          timeRange(events.occurredAt, f),
          ks.after(f.cursor),
        ),
      )
      .orderBy(...ks.orderBy)
      .limit(f.limit + 1);
    return toPage(rows, f, ks);
  },

  /**
   * Un-narrated events, highest priority first then oldest first (what the Composer refresh picks from). `types` limits
   * the window to the events the caller can narrate, so rows it would skip (task.progressed, cycle.started, …) never
   * fill the `limit` ahead of a win or an alert.
   */
  async unnarrated(db: Executor, businessId: string, limit = 20, options: { types?: readonly EventType[] } = {}): Promise<Event[]> {
    if (options.types && options.types.length === 0) return [];
    // The priorities are bound as integers: an untyped parameter makes Postgres resolve the CASE as text and sort
    // "10" before "2", which put every routine event ahead of payments, wins and alerts (audit EXTRA-PRIO).
    const cases = Object.entries(EVENT_PRIORITY).map(([type, p]) => sql`when ${type} then ${p}::int`);
    const priority = sql`case ${events.type} ${sql.join(cases, sql` `)} else ${DEFAULT_PRIORITY}::int end`;
    return db
      .select()
      .from(events)
      .where(and(eq(events.businessId, businessId), eq(events.narrated, false), options.types ? inArray(events.type, [...options.types]) : undefined))
      .orderBy(priority, asc(events.occurredAt), asc(events.id))
      .limit(limit);
  },

  /**
   * Marks a business's un-narrated events whose type is not in `narratable` as narrated: they never become notes, and
   * left un-narrated they pile up behind the Composer's lookahead (audit EXTRA-STARVE). Returns how many were marked.
   */
  async markUnnarratable(db: Executor, businessId: string, narratable: readonly EventType[]): Promise<number> {
    const rows = await db
      .update(events)
      .set({ narrated: true })
      .where(and(eq(events.businessId, businessId), eq(events.narrated, false), narratable.length ? notInArray(events.type, [...narratable]) : undefined))
      .returning({ id: events.id });
    return rows.length;
  },

  async markNarrated(db: Executor, businessId: string, eventIds: readonly string[]): Promise<number> {
    if (eventIds.length === 0) return 0;
    const rows = await db
      .update(events)
      .set({ narrated: true })
      .where(and(eq(events.businessId, businessId), inArray(events.id, [...eventIds]), eq(events.narrated, false)))
      .returning({ id: events.id });
    return rows.length;
  },

  async countByType(db: Executor, businessId: string, range: DateRange = {}): Promise<Record<string, number>> {
    const r = parseInput(DateRange, range, "date range");
    const rows = await db
      .select({ type: events.type, n: sql<number>`count(*)::int` })
      .from(events)
      .where(and(eq(events.businessId, businessId), timeRange(events.occurredAt, r)))
      .groupBy(events.type);
    return Object.fromEntries(rows.map((x) => [x.type, Number(x.n)]));
  },

  /** The latest event of a type (e.g. the last `bank.balance_updated` for the status strip). */
  async latestOfType(db: Executor, businessId: string, type: EventType): Promise<Event | null> {
    const t = parseInput(z.enum(EVENT_TYPES), type, "event type");
    const rows = await db.select().from(events).where(and(eq(events.businessId, businessId), eq(events.type, t))).orderBy(desc(events.occurredAt), desc(events.id)).limit(1);
    return rows[0] ?? null;
  },

  // outbox (the relay in @foundmill/events owns publishing; these are for observability and tests) -------------
  async outboxPending(db: Executor, businessId: string, limit = 100): Promise<(OutboxRow & { event: Event })[]> {
    const rows = await db
      .select({ row: outbox, event: events })
      .from(outbox)
      .innerJoin(events, eq(events.id, outbox.eventId))
      .where(and(eq(outbox.businessId, businessId), isNull(outbox.publishedAt)))
      .orderBy(asc(outbox.createdAt))
      .limit(limit);
    return rows.map((r) => ({ ...r.row, event: r.event }));
  },

  async outboxCountPending(db: Executor, businessId: string): Promise<number> {
    const rows = await db.select({ n: sql<number>`count(*)::int` }).from(outbox).where(and(eq(outbox.businessId, businessId), isNull(outbox.publishedAt)));
    return Number(rows[0]?.n ?? 0);
  },
};
