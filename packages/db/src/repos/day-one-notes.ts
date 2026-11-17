/**
 * The unanswered day-one notes of quiet projects (WP-04 T16 step 2; founder, Nov 17, 2026: "clear them"). A project
 * that went quiet keeps the pile of notes its first day wrote; a person who comes back should see one screen, not that
 * pile. Read across businesses, service role only (the script in ../clear-day-one-notes.ts); `archive` moves the notes
 * to the Archive (never deletes them) and leaves one audit row per project.
 *
 * A project is quiet when nobody in it has been here for `quietFor`; a day-one note is one written in the 24 hours after
 * commit, older than `olderThan`, still unread or read (never answered), not a person's message and not a used-up
 * credits warning (that one stays while it is true).
 */
import { CREDITS_SUBJECTS } from "@foundmill/shared";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, notInArray, sql } from "drizzle-orm";
import { businesses, founderPresence, inboxItems } from "../schema";
import type { Executor } from "./_shared";
import { auditRepo } from "./audit";

export interface DayOneNotesToClear {
  businessId: string;
  name: string;
  ids: string[];
  oldest: Date;
}

const OPEN = ["unread", "read"] as const;

export const dayOneNotesRepo = {
  /** Each quiet project with unanswered day-one notes older than `olderThan`, oldest project first. */
  async toClear(db: Executor, input: { now: Date; quietFor: number; olderThan: number }): Promise<DayOneNotesToClear[]> {
    const quietSince = new Date(input.now.getTime() - input.quietFor);
    const before = new Date(input.now.getTime() - input.olderThan);
    const rows = await db
      .select({ businessId: businesses.id, name: businesses.name, id: inboxItems.id, createdAt: inboxItems.createdAt })
      .from(inboxItems)
      .innerJoin(businesses, eq(businesses.id, inboxItems.businessId))
      .where(
        and(
          eq(businesses.isDemo, false),
          isNotNull(businesses.committedAt),
          isNull(businesses.archivedAt),
          sql`not exists (select 1 from ${founderPresence} where ${founderPresence.businessId} = ${businesses.id} and ${founderPresence.lastSeenAt} >= ${quietSince})`,
          gte(inboxItems.createdAt, sql`${businesses.committedAt}`),
          lt(inboxItems.createdAt, sql`${businesses.committedAt} + interval '24 hours'`),
          lt(inboxItems.createdAt, before),
          inArray(inboxItems.state, [...OPEN]),
          isNull(inboxItems.archivedAt),
          sql`${inboxItems.type} <> 'human_message'`,
          sql`not (${inboxItems.type} = 'warning' and ${inboxItems.subject} in (${sql.join(CREDITS_SUBJECTS.map((s) => sql`${s}`), sql`, `)}))`,
        ),
      )
      .orderBy(asc(businesses.committedAt), asc(inboxItems.createdAt));
    const out = new Map<string, DayOneNotesToClear>();
    for (const r of rows) {
      const entry = out.get(r.businessId) ?? { businessId: r.businessId, name: r.name, ids: [], oldest: r.createdAt };
      entry.ids.push(r.id);
      out.set(r.businessId, entry);
    }
    return [...out.values()];
  },

  /** Archives these notes of one project if they are still open; one audit row. Returns how many moved. */
  async archive(db: Executor, businessId: string, ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const moved = await db
      .update(inboxItems)
      .set({ state: "archived", updatedAt: new Date() })
      .where(and(eq(inboxItems.businessId, businessId), inArray(inboxItems.id, [...ids]), inArray(inboxItems.state, [...OPEN]), isNull(inboxItems.archivedAt), notInArray(inboxItems.type, ["human_message"])))
      .returning({ id: inboxItems.id });
    if (moved.length > 0) await auditRepo.append(db, businessId, { actorKind: "system", action: "inbox.day_one_notes_archived", target: { kind: "business", id: businessId }, details: { count: moved.length, reason: "quiet project, WP-04 T16" } });
    return moved.length;
  },
};
