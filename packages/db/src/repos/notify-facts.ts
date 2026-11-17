/**
 * What the founder notifier reads (retention plan, 2026-11-11), service role, one business at a time: open decisions,
 * recent notes of a kind, recent events of a kind, the milestones reached and who started each Continue run. Nothing
 * here writes; the notifier decides from these facts with pure rules (apps/orchestrator/src/notify/rules.ts).
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { accountAdmissions, campaigns, complianceEvents, events, filings, founderNotifications, founderPresence, founderProfiles, ideas, inboxItems, memberships, milestones } from "../schema";
import { membershipNotEnded } from "./memberships";
import type { Executor } from "./_shared";

export interface NotifyItem {
  id: string;
  type: string;
  subject: string;
  createdAt: Date;
  state: string;
  decision: Record<string, unknown> | null;
  blocksContinue: boolean;
}

export interface NotifyEvent {
  id: string;
  type: string;
  occurredAt: Date;
  actor: { kind: string; id: string };
  payload: Record<string, unknown>;
}

const itemColumns = { id: inboxItems.id, type: inboxItems.type, subject: inboxItems.subject, createdAt: inboxItems.createdAt, state: inboxItems.state, decision: inboxItems.decision, blocksContinue: inboxItems.blocksContinue };

export const notifyFactsRepo = {
  /** Decisions waiting for an answer (not answered, not archived), oldest first; at most `limit`. */
  async openDecisions(db: Executor, businessId: string, limit = 20): Promise<NotifyItem[]> {
    return db
      .select(itemColumns)
      .from(inboxItems)
      .where(and(eq(inboxItems.businessId, businessId), eq(inboxItems.type, "decision"), inArray(inboxItems.state, ["unread", "read"]), isNull(inboxItems.archivedAt), isNotNull(inboxItems.decision), isNull(inboxItems.forUserId)))
      .orderBy(asc(inboxItems.createdAt))
      .limit(limit);
  },

  /** Notes of these types written since `since`, oldest first. */
  async itemsSince(db: Executor, businessId: string, types: readonly string[], since: Date, limit = 50): Promise<NotifyItem[]> {
    return db
      .select(itemColumns)
      .from(inboxItems)
      .where(and(eq(inboxItems.businessId, businessId), inArray(inboxItems.type, [...types] as never[]), gte(inboxItems.createdAt, since), isNull(inboxItems.archivedAt), isNull(inboxItems.forUserId)))
      .orderBy(asc(inboxItems.createdAt))
      .limit(limit);
  },

  /** One note (the one-click answer re-checks it at answer time). */
  async item(db: Executor, businessId: string, id: string): Promise<NotifyItem | null> {
    const [row] = await db.select(itemColumns).from(inboxItems).where(and(eq(inboxItems.businessId, businessId), eq(inboxItems.id, id))).limit(1);
    return row ?? null;
  },

  /** Events of these types since `since`, oldest first. */
  async eventsSince(db: Executor, businessId: string, types: readonly string[], since: Date, limit = 500): Promise<NotifyEvent[]> {
    return db
      .select({ id: events.id, type: events.type, occurredAt: events.occurredAt, actor: events.actor, payload: events.payload })
      .from(events)
      .where(and(eq(events.businessId, businessId), inArray(events.type, [...types]), gte(events.occurredAt, since)))
      .orderBy(asc(events.occurredAt))
      .limit(limit);
  },

  /** Who pressed Continue for each run (the `cycle.run_started` actor) and when it started. */
  async runStarts(db: Executor, businessId: string, runIds: readonly string[]): Promise<Map<string, { actor: { kind: string; id: string }; at: Date }>> {
    if (runIds.length === 0) return new Map();
    const rows = await db
      .select({ runId: sql<string>`${events.payload}->>'runId'`, actor: events.actor, at: events.occurredAt })
      .from(events)
      .where(and(eq(events.businessId, businessId), eq(events.type, "cycle.run_started"), inArray(sql<string>`${events.payload}->>'runId'`, [...runIds])));
    return new Map(rows.map((r) => [r.runId, { actor: r.actor, at: r.at }]));
  },

  /**
   * The morning brief's calendar (item 10): campaigns scheduled to start in [now, until], and filings and compliance
   * dates not yet done that fall in [from, until], soonest first.
   */
  async briefCalendar(db: Executor, businessId: string, window: { now: Date; from: Date; until: Date }): Promise<{ campaigns: { name: string; startsAt: Date | null }[]; filings: { kind: string; title: string; dueAt: Date | null }[]; compliance: { kind: string; title: string; dueAt: Date }[] }> {
    const [scheduled, due, compliance] = await Promise.all([
      db
        .select({ name: campaigns.name, startsAt: campaigns.startsAt })
        .from(campaigns)
        .where(and(eq(campaigns.businessId, businessId), eq(campaigns.status, "scheduled"), isNull(campaigns.archivedAt), gte(campaigns.startsAt, window.now), lte(campaigns.startsAt, window.until)))
        .orderBy(asc(campaigns.startsAt))
        .limit(10),
      db
        .select({ kind: filings.kind, title: filings.title, dueAt: filings.dueAt })
        .from(filings)
        .where(and(eq(filings.businessId, businessId), inArray(filings.status, ["upcoming", "due"]), isNull(filings.archivedAt), gte(filings.dueAt, window.from), lte(filings.dueAt, window.until)))
        .orderBy(asc(filings.dueAt))
        .limit(10),
      db
        .select({ kind: complianceEvents.kind, title: complianceEvents.title, dueAt: complianceEvents.dueAt })
        .from(complianceEvents)
        .where(and(eq(complianceEvents.businessId, businessId), isNull(complianceEvents.completedAt), isNull(complianceEvents.archivedAt), gte(complianceEvents.dueAt, window.from), lte(complianceEvents.dueAt, window.until)))
        .orderBy(asc(complianceEvents.dueAt))
        .limit(10),
    ]);
    return { campaigns: scheduled, filings: due, compliance };
  },

  /** When this person's last morning brief or weekly review from this business went out; null for a first one. */
  async lastBriefSentAt(db: Executor, businessId: string, userId: string): Promise<Date | null> {
    const [row] = await db
      .select({ sentAt: founderNotifications.sentAt })
      .from(founderNotifications)
      .where(and(eq(founderNotifications.businessId, businessId), eq(founderNotifications.userId, userId), inArray(founderNotifications.kind, ["daily_brief", "weekly_review"]), eq(founderNotifications.status, "sent"), isNotNull(founderNotifications.sentAt)))
      .orderBy(desc(founderNotifications.sentAt))
      .limit(1);
    return row?.sentAt ?? null;
  },

  /** Milestones reached since `since`, newest first. */
  async milestonesSince(db: Executor, businessId: string, since: Date): Promise<{ id: string; label: string; achievedAt: Date }[]> {
    return db
      .select({ id: milestones.id, label: milestones.label, achievedAt: milestones.achievedAt })
      .from(milestones)
      .where(and(eq(milestones.businessId, businessId), gte(milestones.achievedAt, since), isNull(milestones.archivedAt)))
      .orderBy(desc(milestones.achievedAt))
      .limit(20);
  },

  /** The latest visit of anyone in the project (`founder_presence`), or null. */
  async projectLastSeen(db: Executor, businessId: string): Promise<Date | null> {
    const [row] = await db.select({ at: sql<Date | null>`max(${founderPresence.lastSeenAt})` }).from(founderPresence).where(eq(founderPresence.businessId, businessId));
    return row?.at ? new Date(row.at) : null;
  },

  /**
   * People with a kept card and no project yet (WP-04 T12), across accounts, service role only: an admitted account
   * with a profile, no membership that counts (not an example visit, not ended) and a card kept since `since` that is
   * neither archived nor started. The newest card per person; at most `limit` people (5,000). `only` reads one person's
   * newest card and answers it only when it is the card named (the gateway's check).
   */
  async cardHolders(db: Executor, since: Date, opts: { only?: { userId: string; ideaId: string }; limit?: number } = {}): Promise<{ userId: string; ideaId: string; title: string; keptAt: Date }[]> {
    const rows = await db
      .selectDistinctOn([ideas.ownerUserId], { userId: ideas.ownerUserId, ideaId: ideas.id, title: ideas.title, keptAt: ideas.createdAt })
      .from(ideas)
      .innerJoin(founderProfiles, and(eq(founderProfiles.userId, ideas.ownerUserId), isNull(founderProfiles.archivedAt)))
      .innerJoin(accountAdmissions, eq(accountAdmissions.userId, ideas.ownerUserId))
      .where(
        and(
          isNull(ideas.businessId),
          isNull(ideas.committedAt),
          isNull(ideas.archivedAt),
          gte(ideas.createdAt, since),
          opts.only ? eq(ideas.ownerUserId, opts.only.userId) : undefined,
          sql`not exists (select 1 from ${memberships} where ${memberships.userId} = ${ideas.ownerUserId} and ${memberships.source} <> 'example' and ${membershipNotEnded})`,
        ),
      )
      .orderBy(ideas.ownerUserId, desc(ideas.createdAt))
      .limit(opts.limit ?? 5_000);
    // The newest card per person; with `only`, that card must be the one asked about.
    return opts.only ? rows.filter((r) => r.ideaId === opts.only!.ideaId) : rows;
  },
};
