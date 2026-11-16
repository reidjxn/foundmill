/**
 * founder_presence / founder_visit_days (0083; retention plan, founder 2026-11-11). Business-scoped and per person
 * (businessId first, then userId). The api's presence ping (`founder.presence.ping`) calls `ping` as the signed-in person,
 * so RLS holds it to their own rows in a business they belong to; the notifier and the retention report read with the
 * service role. Definitions of a session, activation and a habit live in @foundmill/shared (founder-return.ts).
 */
import { ACTIVATION, addDaysToKey, dayKeyIn, founderActivation, founderHabit, startsNewSession, type ActivationResult, type FounderReturnVia, type HabitResult } from "@foundmill/shared";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, min, sql } from "drizzle-orm";
import { businesses, events, founderPresence, founderVisitDays, memberships, productSignoffs, realBusinesses } from "../schema";
import { maybeOne, rowsOf, type Executor } from "./_shared";

export interface PresenceView {
  lastSeenAt: string;
  sessionStartedAt: string;
  /** The end of the session before this one; null on the first session. */
  previousSeenAt: string | null;
  sessions: number;
  lastVia: FounderReturnVia;
}

export interface PingResult extends PresenceView {
  /** This ping started a new session (the first ever, or after a gap longer than PRESENCE.sessionGapMs). */
  newSession: boolean;
  /** The business-calendar day the ping was counted on. */
  day: string;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function view(row: typeof founderPresence.$inferSelect): PresenceView {
  return { lastSeenAt: row.lastSeenAt.toISOString(), sessionStartedAt: row.sessionStartedAt.toISOString(), previousSeenAt: iso(row.previousSeenAt), sessions: row.sessions, lastVia: row.lastVia };
}

export interface RetentionRow {
  businessId: string;
  businessName: string;
  ownerUserId: string;
  committedAt: string;
  activation: ActivationResult;
  habit: HabitResult;
  /** Sessions the owner started from a founder email or a browser notification. */
  returnsFromNotifications: number;
}

export interface RetentionReport {
  from: string;
  to: string;
  businesses: number;
  activated: number;
  habit: number;
  rows: RetentionRow[];
}

export const presenceRepo = {
  /**
   * One ping from an open tab: moves `last_seen_at`, starts a new session after a long gap (keeping the end of the one
   * before as `previous_seen_at`), and counts the day in the business's time zone. Concurrent pings from two tabs are
   * safe: the row is created once and locked for the update.
   */
  async ping(db: Executor, businessId: string, userId: string, opts: { now?: Date; timeZone?: string | null; via?: FounderReturnVia } = {}): Promise<PingResult> {
    const now = opts.now ?? new Date();
    const via = opts.via ?? "direct";
    const day = dayKeyIn(now, opts.timeZone ?? null);
    const created = await db
      .insert(founderPresence)
      .values({ businessId, userId, lastSeenAt: now, sessionStartedAt: now, previousSeenAt: null, sessions: 1, lastVia: via })
      .onConflictDoNothing({ target: [founderPresence.userId, founderPresence.businessId] })
      .returning();
    let result: PingResult;
    if (created[0]) {
      result = { ...view(created[0]), newSession: true, day };
    } else {
      const row = maybeOne(await db.select().from(founderPresence).where(and(eq(founderPresence.businessId, businessId), eq(founderPresence.userId, userId))).for("update").limit(1));
      if (!row) throw new Error("founder_presence row vanished during a ping");
      const fresh = startsNewSession(row.lastSeenAt.getTime(), now.getTime());
      // A ping that arrives late (a clock behind the last one) never moves the last ping back.
      const lastSeenAt = row.lastSeenAt.getTime() > now.getTime() ? row.lastSeenAt : now;
      const [updated] = await db
        .update(founderPresence)
        .set(fresh ? { lastSeenAt, sessionStartedAt: now, previousSeenAt: row.lastSeenAt, sessions: row.sessions + 1, lastVia: via } : { lastSeenAt })
        .where(eq(founderPresence.id, row.id))
        .returning();
      result = { ...view(updated!), newSession: fresh, day };
    }
    await db
      .insert(founderVisitDays)
      .values({ businessId, userId, day, firstAt: now, lastAt: now, pings: 1 })
      .onConflictDoUpdate({ target: [founderVisitDays.userId, founderVisitDays.businessId, founderVisitDays.day], set: { lastAt: sql`greatest(${founderVisitDays.lastAt}, excluded.last_at)`, pings: sql`${founderVisitDays.pings} + 1` } });
    return result;
  },

  /** The person's presence in the business, or null before their first ping. */
  async get(db: Executor, businessId: string, userId: string): Promise<PresenceView | null> {
    const row = maybeOne(await db.select().from(founderPresence).where(and(eq(founderPresence.businessId, businessId), eq(founderPresence.userId, userId))).limit(1));
    return row ? view(row) : null;
  },

  /** Last ping per person, for the notifier's "are they in the app" check. People never seen are absent from the map. */
  async lastSeenByUser(db: Executor, businessId: string, userIds: readonly string[]): Promise<Map<string, Date>> {
    if (userIds.length === 0) return new Map();
    const rows = await db.select({ userId: founderPresence.userId, lastSeenAt: founderPresence.lastSeenAt }).from(founderPresence).where(and(eq(founderPresence.businessId, businessId), inArray(founderPresence.userId, [...userIds])));
    return new Map(rows.map((r) => [r.userId, r.lastSeenAt]));
  },

  /** The days the person came, oldest first, between two day keys (inclusive). */
  async visitDays(db: Executor, businessId: string, userId: string, range: { from: string; to: string }): Promise<string[]> {
    const rows = await db
      .select({ day: founderVisitDays.day })
      .from(founderVisitDays)
      .where(and(eq(founderVisitDays.businessId, businessId), eq(founderVisitDays.userId, userId), gte(founderVisitDays.day, range.from), lte(founderVisitDays.day, range.to)))
      .orderBy(asc(founderVisitDays.day));
    return rows.map((r) => r.day);
  },

  /**
   * The retention report (service role): for every real business committed in `[from, to)` (no demo, no example), its
   * owner's activation (both foundations signed off and a first Continue within 24 hours) and habit (three return days
   * in the week after commit), with how many sessions started from a notification.
   */
  async retentionReport(db: Executor, range: { from: Date; to: Date }): Promise<RetentionReport> {
    const committed = await db
      .select({ id: businesses.id, name: businesses.name, committedAt: businesses.committedAt, timeZone: businesses.timeZone, ownerUserId: memberships.userId })
      .from(businesses)
      // Across projects, so through real_businesses (0121): no sample ever counts. The house stays in.
      .innerJoin(realBusinesses, eq(realBusinesses.id, businesses.id))
      .innerJoin(memberships, and(eq(memberships.businessId, businesses.id), eq(memberships.role, "owner")))
      .where(and(isNotNull(businesses.committedAt), gte(businesses.committedAt, range.from), sql`${businesses.committedAt} < ${range.to}`, isNull(businesses.archivedAt)))
      .orderBy(asc(businesses.committedAt));
    const rows: RetentionRow[] = [];
    for (const b of committed) {
      const committedAt = b.committedAt!;
      const signoffs = await db
        .select({ kind: productSignoffs.kind, at: min(productSignoffs.decidedAt) })
        .from(productSignoffs)
        .where(and(eq(productSignoffs.businessId, b.id), eq(productSignoffs.status, "approved"), inArray(productSignoffs.kind, ["spec", "roadmap"])))
        .groupBy(productSignoffs.kind);
      const signedAt = (kind: string) => signoffs.find((s) => s.kind === kind)?.at ?? null;
      const [firstRun] = await db
        .select({ at: min(events.occurredAt) })
        .from(events)
        .where(and(eq(events.businessId, b.id), eq(events.type, "cycle.run_started"), sql`${events.actor}->>'kind' = 'user'`));
      const [firstPage] = await db
        .select({ at: min(events.occurredAt) })
        .from(events)
        .where(and(eq(events.businessId, b.id), eq(events.type, "page.published"), sql`${events.actor}->>'kind' = 'user'`));
      const activation = founderActivation({ committedAt, specificationSignedOffAt: signedAt("spec"), roadmapSignedOffAt: signedAt("roadmap"), firstFounderContinueAt: firstRun?.at ?? null, firstPagePublishedAt: firstPage?.at ?? null });
      const committedDay = dayKeyIn(committedAt, b.timeZone);
      const days = await presenceRepo.visitDays(db, b.id, b.ownerUserId, { from: committedDay, to: addDaysToKey(committedDay, 7) });
      const returns = rowsOf<{ n: number | string }>(
        await db.execute(sql`select count(*) as n from events where business_id = ${b.id} and type = 'founder.session_started' and actor->>'id' = ${b.ownerUserId} and payload->>'via' <> 'direct'`),
      );
      rows.push({ businessId: b.id, businessName: b.name, ownerUserId: b.ownerUserId, committedAt: committedAt.toISOString(), activation, habit: founderHabit(committedDay, days), returnsFromNotifications: Number(returns[0]?.n ?? 0) });
    }
    return { from: range.from.toISOString(), to: range.to.toISOString(), businesses: rows.length, activated: rows.filter((r) => r.activation.activated).length, habit: rows.filter((r) => r.habit.habit).length, rows };
  },
};

/** For tests and the report's caption: the activation window in hours. */
export const ACTIVATION_WINDOW_HOURS = ACTIVATION.windowMs / 3_600_000;
