/**
 * What Foundmill's own email to a person reads (docs/THESIS_REVIEW.md packages 1.5 and 5.1; apps/api `services/notify`,
 * apps/gateway `notify-email.ts`). No table of its own: the people and their walls are `memberships`, "opened on any
 * device" is the person's receipt in `inbox_item_reads` (0048), and what was already sent is the `notify.email_sent`
 * events (one per email, keyed `notify.email:<kind>:<user id>:<UTC day>` within the business, so a business's events can
 * hold at most one a day per person).
 *
 * `waitingAnswers` reads across businesses and runs on the service connection only (the api's notify pass); the rest
 * are scoped to one business like every other repo.
 */
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { LIMITED_EMAIL_KINDS, type EmailNotificationKind } from "@foundmill/shared";
import { approvals, businesses, events, inboxItems, memberships, productSignoffs, type Membership } from "../schema";
import { RESPOND_TYPES } from "./inbox";
import type { Executor } from "./_shared";
import { membershipNotEnded } from "./memberships";

/** A note that asks the person for something: it holds Continue, is a decision, or is a warning with a choice to make. */
const needsAnswer = and(
  inArray(inboxItems.state, ["unread", "read"]),
  isNull(inboxItems.archivedAt),
  or(eq(inboxItems.blocksContinue, true), inArray(inboxItems.type, [...RESPOND_TYPES]), and(eq(inboxItems.type, "warning"), isNotNull(inboxItems.decision))),
);

/** One person who has not opened one waiting note. */
export interface WaitingAnswer {
  businessId: string;
  inboxItemId: string;
  createdAt: Date;
  userId: string;
  membership: Pick<Membership, "role" | "sectionPermissions">;
}

/** The idempotency key of a `notify.email_sent`: one a day per person and kind within a business. */
export const notifyEmailDayKey = (kind: EmailNotificationKind, userId: string, at: Date): string => `notify.email:${kind}:${userId.toLowerCase()}:${at.toISOString().slice(0, 10)}`;

/** Midnight UTC of the day `at` falls in. */
export const utcDayStart = (at: Date): Date => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

export const notifyEmailRepo = {
  /**
   * Every (note, person) pair where the note needs an answer, was written between `since` and `olderThan`, belongs to a
   * live business that is not a sample (`is_demo`), and the person is a member of it, not through an example
   * membership, who has no receipt for it. Oldest first, at most `limit`. Section walls are the caller's
   * (`hasSectionAccess` on `membership`). Service connection only: it reads across businesses.
   */
  async waitingAnswers(db: Executor, input: { olderThan: Date; since: Date; limit?: number }): Promise<WaitingAnswer[]> {
    const rows = await db
      .select({ businessId: inboxItems.businessId, inboxItemId: inboxItems.id, createdAt: inboxItems.createdAt, userId: memberships.userId, role: memberships.role, sectionPermissions: memberships.sectionPermissions })
      .from(inboxItems)
      .innerJoin(businesses, and(eq(businesses.id, inboxItems.businessId), eq(businesses.isDemo, false), isNull(businesses.archivedAt)))
      // A membership that has ended (0092: a collaborator's date passed) is told nothing.
      .innerJoin(memberships, and(eq(memberships.businessId, inboxItems.businessId), ne(memberships.source, "example"), membershipNotEnded))
      .where(
        and(
          needsAnswer,
          lte(inboxItems.createdAt, input.olderThan),
          gte(inboxItems.createdAt, input.since),
          // 0103: a note for one person (a founder's showcase ask) is that person's only.
          or(isNull(inboxItems.forUserId), eq(inboxItems.forUserId, memberships.userId)),
          // Qualified by hand (inbox.ts `stateFor`): the receipt is the person's own, for this note.
          sql`not exists (select 1 from "inbox_item_reads" "r" where "r"."inbox_item_id" = "inbox_items"."id" and "r"."user_id" = "memberships"."user_id")`,
        ),
      )
      .orderBy(asc(inboxItems.createdAt), asc(inboxItems.id))
      .limit(Math.min(Math.max(input.limit ?? 2_000, 1), 10_000));
    return rows.map((r) => ({ businessId: r.businessId, inboxItemId: r.inboxItemId, createdAt: r.createdAt, userId: r.userId, membership: { role: r.role, sectionPermissions: r.sectionPermissions } }));
  },

  /** The note, when it still needs an answer and the person has not opened it; null otherwise. */
  async stillWaiting(db: Executor, businessId: string, inboxItemId: string, userId: string): Promise<{ id: string; subject: string; fromAgentId: string | null; blocksContinue: boolean; createdAt: Date } | null> {
    const rows = await db
      .select({ id: inboxItems.id, subject: inboxItems.subject, fromAgentId: inboxItems.fromAgentId, blocksContinue: inboxItems.blocksContinue, createdAt: inboxItems.createdAt })
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.businessId, businessId),
          eq(inboxItems.id, inboxItemId),
          needsAnswer,
          or(isNull(inboxItems.forUserId), eq(inboxItems.forUserId, userId)),
          sql`not exists (select 1 from "inbox_item_reads" "r" where "r"."business_id" = ${businessId}::uuid and "r"."inbox_item_id" = ${inboxItemId}::uuid and "r"."user_id" = ${userId}::uuid)`,
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  },

  /**
   * Of `itemIds`, the notes that hold up the team's work (founder, 2026-11-12): one that holds Continue, an agent's gated
   * call still waiting for its answer (its task waits too), or a sign-off of the specification or the roadmap still open
   * (the team only does groundwork before it). These are emailed 30 minutes after the person left; the rest after a day.
   */
  async holdingUpWork(db: Executor, businessId: string, itemIds: readonly string[]): Promise<Set<string>> {
    if (itemIds.length === 0) return new Set();
    const ids = [...itemIds];
    const [blocking, gated, signoffs] = await Promise.all([
      db.select({ id: inboxItems.id }).from(inboxItems).where(and(eq(inboxItems.businessId, businessId), inArray(inboxItems.id, ids), eq(inboxItems.blocksContinue, true))),
      db.select({ id: approvals.inboxItemId }).from(approvals).where(and(eq(approvals.businessId, businessId), inArray(approvals.inboxItemId, ids), isNull(approvals.resolvedAt))),
      db.select({ id: productSignoffs.inboxItemId }).from(productSignoffs).where(and(eq(productSignoffs.businessId, businessId), inArray(productSignoffs.inboxItemId, ids), eq(productSignoffs.status, "pending"), inArray(productSignoffs.kind, ["spec", "roadmap"]))),
    ]);
    return new Set([...blocking, ...gated, ...signoffs].map((r) => r.id).filter((id): id is string => typeof id === "string"));
  },

  /** The notes of `itemIds` this business already emailed the person about (any day), as a set of ids. */
  async emailedItems(db: Executor, businessId: string, userId: string, itemIds: readonly string[]): Promise<Set<string>> {
    if (itemIds.length === 0) return new Set();
    const rows = await db
      .select({ itemId: sql<string>`${events.payload} ->> 'inboxItemId'` })
      .from(events)
      .where(and(eq(events.businessId, businessId), eq(events.type, "notify.email_sent"), sql`${events.payload} ->> 'userId' = ${userId}`, sql`${events.payload} ->> 'inboxItemId' in (${sql.join(itemIds.map((id) => sql`${id}`), sql`, `)})`));
    return new Set(rows.map((r) => r.itemId));
  },

  /** How many limited emails (`LIMITED_EMAIL_KINDS`: every kind but the briefs) went to the person since `since`, per business, among `businessIds` (the businesses they belong to). */
  async sentSince(db: Executor, userId: string, businessIds: readonly string[], since: Date): Promise<Map<string, number>> {
    if (businessIds.length === 0) return new Map();
    const rows = await db
      .select({ businessId: events.businessId, n: sql<number>`count(*)::int` })
      .from(events)
      .where(
        and(
          inArray(events.businessId, [...businessIds]),
          eq(events.type, "notify.email_sent"),
          gte(events.occurredAt, since),
          sql`${events.payload} ->> 'userId' = ${userId}`,
          // The morning brief and the weekly review count toward no limit (founder, 2026-11-12).
          sql`${events.payload} ->> 'kind' in (${sql.join(LIMITED_EMAIL_KINDS.map((k) => sql`${k}`), sql`, `)})`,
        ),
      )
      .groupBy(events.businessId);
    return new Map(rows.map((r) => [r.businessId, Number(r.n)]));
  },
};
