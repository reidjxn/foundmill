/**
 * What the founder notifier reads (retention plan, 2026-11-11), service role, one business at a time: open decisions,
 * recent notes of a kind, recent events of a kind, the milestones reached and who started each Continue run. Nothing
 * here writes; the notifier decides from these facts with pure rules (apps/orchestrator/src/notify/rules.ts).
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { events, inboxItems, milestones } from "../schema";
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
      .where(and(eq(inboxItems.businessId, businessId), eq(inboxItems.type, "decision"), inArray(inboxItems.state, ["unread", "read"]), isNull(inboxItems.archivedAt), isNotNull(inboxItems.decision)))
      .orderBy(asc(inboxItems.createdAt))
      .limit(limit);
  },

  /** Notes of these types written since `since`, oldest first. */
  async itemsSince(db: Executor, businessId: string, types: readonly string[], since: Date, limit = 50): Promise<NotifyItem[]> {
    return db
      .select(itemColumns)
      .from(inboxItems)
      .where(and(eq(inboxItems.businessId, businessId), inArray(inboxItems.type, [...types] as never[]), gte(inboxItems.createdAt, since), isNull(inboxItems.archivedAt)))
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

  /** Milestones reached since `since`, newest first. */
  async milestonesSince(db: Executor, businessId: string, since: Date): Promise<{ id: string; label: string; achievedAt: Date }[]> {
    return db
      .select({ id: milestones.id, label: milestones.label, achievedAt: milestones.achievedAt })
      .from(milestones)
      .where(and(eq(milestones.businessId, businessId), gte(milestones.achievedAt, since), isNull(milestones.archivedAt)))
      .orderBy(desc(milestones.achievedAt))
      .limit(20);
  },
};
