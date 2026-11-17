/**
 * project_updates and project_update_deliveries (0134; WP-08 T3): the founders' updates to their followers.
 *
 * Members (inside `withRls`): `list`, `get`, `saveDraft` (a draft's subject and body only; the column grants and the
 * policy refuse anything else). Services: `draftByAgent` (the `draft_follower_update` tool, through the gateway),
 * `cancel`, and the send's record (`startSend`, `claim`, `settle`, `finishBatch`, `pendingRecipients`), which the
 * gateway alone runs. A delivery row is claimed before its message goes out, so two presses never send to one person
 * twice, and it holds no address.
 */
import { FOLLOW_CONSENT_PURPOSE, FOLLOW_SOURCE, ValidationError, updateProblems, type ProjectUpdateSkip } from "@foundmill/shared";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { contactConsents, entities, projectUpdateDeliveries, projectUpdates, type ProjectUpdate } from "../schema";
import { maybeOne, one, type Executor } from "./_shared";

/** A confirmed, unwithdrawn follower on a live contact who has no delivery row for this update yet. */
export interface UpdateRecipient {
  entityId: string;
  email: string;
  /** The address's suppression hash (what the delivery row keeps). */
  recipientHash: string;
}

/** sha256 hex of the contact's address, trimmed and lowercased: the suppression list's form (`suppressionHash`). */
const contactHash = sql<string>`encode(sha256(convert_to(lower(trim(${entities.identifiers} ->> 'email')), 'UTF8')), 'hex')`;

const check = (subject: string, body: string) => {
  const problem = updateProblems(subject, body);
  if (problem) throw new ValidationError(problem, { field: "update" });
};

/** Confirmed followers of the page, not withdrawn, on a contact the founders still work with (followers.count's rule). */
const followerJoin = (businessId: string) =>
  and(
    eq(contactConsents.businessId, businessId),
    eq(contactConsents.purpose, FOLLOW_CONSENT_PURPOSE),
    eq(contactConsents.source, FOLLOW_SOURCE),
    isNotNull(contactConsents.confirmedAt),
    isNull(contactConsents.withdrawnAt),
    isNull(entities.archivedAt),
    isNull(entities.mergedIntoId),
    isNull(entities.deletionRequestedAt),
    // The contact still has the address that agreed: an edited address never carries the consent with it.
    sql`${contactConsents.emailHash} = ${contactHash}`,
  );

/** No delivery row of this update for this contact, nor for this address on another contact. */
const notReached = (updateId: string) =>
  sql`not exists (select 1 from ${projectUpdateDeliveries} d where d.update_id = ${updateId}::uuid and (d.entity_id = ${contactConsents.entityId} or d.recipient_hash = ${contactHash}))`;

export const updatesRepo = {
  async list(db: Executor, businessId: string, limit = 20): Promise<ProjectUpdate[]> {
    return db.select().from(projectUpdates).where(eq(projectUpdates.businessId, businessId)).orderBy(desc(projectUpdates.createdAt), desc(projectUpdates.id)).limit(Math.min(Math.max(limit, 1), 50));
  },

  async get(db: Executor, businessId: string, id: string): Promise<ProjectUpdate | null> {
    return maybeOne(await db.select().from(projectUpdates).where(and(eq(projectUpdates.businessId, businessId), eq(projectUpdates.id, id))).limit(1));
  },

  /** A member's draft: a new one, or the subject and body of an existing draft. */
  async saveDraft(db: Executor, businessId: string, input: { id?: string; subject: string; body: string }): Promise<ProjectUpdate> {
    check(input.subject, input.body);
    const subject = input.subject.trim();
    const body = input.body.trim();
    if (!input.id) return one(await db.insert(projectUpdates).values({ businessId, subject, body }).returning(), "project update");
    return one(
      await db
        .update(projectUpdates)
        .set({ subject, body, updatedAt: new Date() })
        .where(and(eq(projectUpdates.businessId, businessId), eq(projectUpdates.id, input.id), eq(projectUpdates.status, "draft")))
        .returning(),
      "project update",
      input.id,
    );
  },

  /** The team's draft (service role): the agent is named, and nothing is sent. */
  async draftByAgent(db: Executor, businessId: string, input: { subject: string; body: string; agentId: string }): Promise<ProjectUpdate> {
    check(input.subject, input.body);
    // One open draft from the team at a time: a new one replaces the words of the one that waits.
    const [open] = await db.select({ id: projectUpdates.id }).from(projectUpdates).where(and(eq(projectUpdates.businessId, businessId), eq(projectUpdates.status, "draft"), isNotNull(projectUpdates.draftedByAgentId))).limit(1);
    if (open) return one(await db.update(projectUpdates).set({ subject: input.subject.trim(), body: input.body.trim(), draftedByAgentId: input.agentId, updatedAt: new Date() }).where(and(eq(projectUpdates.businessId, businessId), eq(projectUpdates.id, open.id))).returning(), "project update", open.id);
    return one(await db.insert(projectUpdates).values({ businessId, subject: input.subject.trim(), body: input.body.trim(), draftedByAgentId: input.agentId }).returning(), "project update");
  },

  /** A draft deleted from the screen (service role, after the member's check): kept as canceled. */
  async cancel(db: Executor, businessId: string, id: string): Promise<boolean> {
    const rows = await db.update(projectUpdates).set({ status: "canceled", updatedAt: new Date() }).where(and(eq(projectUpdates.businessId, businessId), eq(projectUpdates.id, id), eq(projectUpdates.status, "draft"))).returning({ id: projectUpdates.id });
    return rows.length > 0;
  },

  /** How many people follow the project now and have not yet been reached (or skipped) by this update. */
  async pendingCount(db: Executor, businessId: string, updateId: string): Promise<number> {
    const [row] = await db
      .select({ n: sql<number>`count(distinct ${contactHash})::int` })
      .from(contactConsents)
      .innerJoin(entities, and(eq(entities.id, contactConsents.entityId), eq(entities.businessId, businessId)))
      .where(and(followerJoin(businessId), notReached(updateId)));
    return Number(row?.n ?? 0);
  },

  /** The next followers to send to (the gateway's read; the addresses never leave it). */
  async pendingRecipients(db: Executor, businessId: string, updateId: string, limit: number): Promise<UpdateRecipient[]> {
    const rows = await db
      .selectDistinct({ entityId: contactConsents.entityId, email: sql<string | null>`lower(trim(${entities.identifiers} ->> 'email'))`, recipientHash: contactHash })
      .from(contactConsents)
      .innerJoin(entities, and(eq(entities.id, contactConsents.entityId), eq(entities.businessId, businessId)))
      .where(and(followerJoin(businessId), notReached(updateId)))
      .orderBy(contactConsents.entityId)
      .limit(limit * 2);
    // One person once: two records with the same address count as one.
    const seen = new Set<string>();
    const out: UpdateRecipient[] = [];
    for (const r of rows) {
      if (!r.email || seen.has(r.recipientHash)) continue;
      seen.add(r.recipientHash);
      out.push({ entityId: r.entityId, email: r.email, recipientHash: r.recipientHash });
      if (out.length >= limit) break;
    }
    return out;
  },

  /** A draft becomes a send (or a send continues): the founder who pressed it is recorded once. False when it is neither. */
  /**
   * A draft becomes a send (or a send continues): the founder who pressed it is recorded once. A draft moves only when
   * its words are the version the founder previewed (`seenUpdatedAt`), so an edit after the preview is never sent
   * unseen. Null when it is neither a draft nor a send, or the words changed since.
   */
  async startSend(db: Executor, businessId: string, id: string, input: { userId: string; at: Date; seenUpdatedAt?: Date | null }): Promise<ProjectUpdate | null> {
    const row = await updatesRepo.get(db, businessId, id);
    if (!row || (row.status !== "draft" && row.status !== "sending")) return null;
    if (row.status === "sending") return row;
    if (input.seenUpdatedAt && row.updatedAt.getTime() !== input.seenUpdatedAt.getTime()) return null;
    return maybeOne(
      await db
        .update(projectUpdates)
        .set({ status: "sending", approvedBy: input.userId, approvedAt: input.at, updatedAt: input.at })
        // Postgres keeps microseconds and a JavaScript Date milliseconds: compare at the precision the read gave.
        .where(and(eq(projectUpdates.businessId, businessId), eq(projectUpdates.id, id), eq(projectUpdates.status, "draft"), sql`date_trunc('milliseconds', ${projectUpdates.updatedAt}) = ${row.updatedAt}`))
        .returning(),
    );
  },

  /** Takes one follower for this update before the message goes out; false when another press already has them. */
  async claim(db: Executor, businessId: string, input: { updateId: string; entityId: string; recipientHash: string; at: Date }): Promise<boolean> {
    // Either unique (the record, or the address on another record) means someone already has this person.
    const rows = await db.insert(projectUpdateDeliveries).values({ updateId: input.updateId, businessId, entityId: input.entityId, recipientHash: input.recipientHash, state: "sending", at: input.at }).onConflictDoNothing().returning({ entityId: projectUpdateDeliveries.entityId });
    return rows.length > 0;
  },

  /** What happened to a claimed follower: sent, skipped with a reason, or `release` to give them back for a later press. */
  async settle(db: Executor, businessId: string, input: { updateId: string; entityId: string; outcome: { state: "sent"; messageRef: string } | { state: "skipped"; reason: ProjectUpdateSkip } | { state: "release" }; at: Date }): Promise<void> {
    const where = and(eq(projectUpdateDeliveries.businessId, businessId), eq(projectUpdateDeliveries.updateId, input.updateId), eq(projectUpdateDeliveries.entityId, input.entityId));
    if (input.outcome.state === "release") {
      await db.delete(projectUpdateDeliveries).where(where);
      return;
    }
    await db
      .update(projectUpdateDeliveries)
      .set(input.outcome.state === "sent" ? { state: "sent", messageRef: input.outcome.messageRef, at: input.at, updatedAt: input.at } : { state: "skipped", reason: input.outcome.reason, at: input.at, updatedAt: input.at })
      .where(where);
  },

  /** After a press: the counts from the delivery rows, and `sent` once nobody is left. */
  async finishBatch(db: Executor, businessId: string, id: string, at: Date): Promise<ProjectUpdate | null> {
    const [counts] = await db
      .select({ sent: sql<number>`count(*) filter (where ${projectUpdateDeliveries.state} = 'sent')::int`, skipped: sql<number>`count(*) filter (where ${projectUpdateDeliveries.state} = 'skipped')::int` })
      .from(projectUpdateDeliveries)
      .where(and(eq(projectUpdateDeliveries.businessId, businessId), eq(projectUpdateDeliveries.updateId, id)));
    const remaining = await updatesRepo.pendingCount(db, businessId, id);
    // Recomputed from the rows on every press, so whichever press ends last leaves the true counts; a canceled update
    // keeps its status.
    return maybeOne(
      await db
        .update(projectUpdates)
        .set({ sentCount: Number(counts?.sent ?? 0), skippedCount: Number(counts?.skipped ?? 0), remainingCount: remaining, status: remaining === 0 ? "sent" : "sending", updatedAt: at })
        .where(and(eq(projectUpdates.businessId, businessId), eq(projectUpdates.id, id), inArray(projectUpdates.status, ["draft", "sending"])))
        .returning(),
    );
  },
};
