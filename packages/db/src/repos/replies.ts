/**
 * Email replies kept on `interactions.body_untrusted` (0125; WP-08 T2, audit a5 GTM-04, founder D3 Nov 16, 2026).
 *
 * `storeInbound` is ingest's: one row per verified reply to the project's Foundmill address, with the id the
 * `lead.replied` event names (`interactionId`), so the event points at it. The sender's record is found by address, or
 * created (a person named with the address masked, source `reply`, no lawful basis: writing to the project is not
 * consent to marketing); an archived record with the address is reused. A record whose deletion was requested gets
 * nothing, and neither does an address whose record was erased (its deletion suppression stays: never imported again).
 * At most `dailyCap` rows a project in a UTC day, counted under a per-project lock. Idempotent on the id.
 *
 * `list` and `answer` are the api's (inside `withRls`, behind `sectionRead/Write("crm")`); `forAnswer` is the gateway's,
 * the one place an address is read to send the founder's answer. The text is a stranger's: callers show it as plain
 * text and never hand it to an agent.
 */
import { REPLY_BODY_MAX, REPLY_CONTACT_LABEL, REPLY_SOURCE, followerDisplayName } from "@foundmill/shared";
import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { entities, interactions, suppressionList, type Interaction } from "../schema";
import { suppressionHash } from "./channels";
import { ENTITY_DELETION_REASON, entitiesRepo } from "./entities";
import { maybeOne, type Executor } from "./_shared";

export type StoreInboundStatus = "stored" | "duplicate" | "over_cap" | "deleted";

export interface StoreInboundInput {
  /** The id `lead.replied` names (`uuidFromSeed("interaction", "sendgrid", "inbound", key)`). */
  interactionId: string;
  /** The verified sender, lowercased. */
  email: string;
  subject: string;
  /** The reply's own words (`replyOwnText`); cut at `REPLY_BODY_MAX`. */
  body: string;
  occurredAt: Date;
  dailyCap: number;
  /** Runs in the same transaction once a new row is written (ingest raises the founders' note there). */
  onStored?: (tx: Executor, stored: { interactionId: string; entityId: string; displayName: string }) => Promise<void>;
}

export interface ReplyMessage {
  id: string;
  entityId: string;
  /** The record's name (a masked address unless the founders named the person). */
  from: string;
  direction: "inbound" | "outbound";
  at: Date;
  subject: string;
  text: string;
  /** An inbound message the founders answered after it arrived. */
  answered: boolean;
}

/** An archived record with this address (`findByIdentifier` reads live records only): reused rather than duplicated. */
async function archivedByEmail(db: Executor, businessId: string, email: string) {
  const [row] = await db.select().from(entities).where(and(eq(entities.businessId, businessId), sql`lower(${entities.identifiers}->>'email') = ${email}`, isNotNull(entities.archivedAt), sql`${entities.mergedIntoId} is null`)).limit(1);
  return row ?? null;
}

const startOfUtcDay = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const kept = and(eq(interactions.kind, "email"), isNotNull(interactions.bodyUntrusted));

export const repliesRepo = {
  async storeInbound(db: Executor, businessId: string, input: StoreInboundInput): Promise<{ status: StoreInboundStatus; entityId: string | null }> {
    const conflict = new Error("interaction id taken");
    try {
      return await db.transaction(async (tx) => {
      // One reply at a time per project: the day's count and the find-or-create of the sender hold under concurrency.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('crm.reply'), hashtext(${businessId}))`);
      const [existing] = await tx.select({ entityIds: interactions.entityIds }).from(interactions).where(and(eq(interactions.businessId, businessId), eq(interactions.id, input.interactionId))).limit(1);
      if (existing) return { status: "duplicate" as const, entityId: existing.entityIds[0] ?? null };
      const day = startOfUtcDay(input.occurredAt);
      const [count] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(interactions)
        .where(and(eq(interactions.businessId, businessId), kept, eq(interactions.direction, "inbound"), gte(interactions.occurredAt, day), lt(interactions.occurredAt, new Date(day.getTime() + 86_400_000))));
      if (Number(count?.n ?? 0) >= input.dailyCap) return { status: "over_cap" as const, entityId: null };
      const email = input.email.trim().toLowerCase();
      const erased = await tx.select({ id: suppressionList.id }).from(suppressionList).where(and(eq(suppressionList.businessId, businessId), eq(suppressionList.emailHash, suppressionHash("email", email)), eq(suppressionList.reason, ENTITY_DELETION_REASON))).limit(1);
      if (erased.length) return { status: "deleted" as const, entityId: null };
      const found = (await entitiesRepo.findByIdentifier(tx, businessId, "email", email)) ?? (await archivedByEmail(tx, businessId, email));
      if (found?.deletionRequestedAt) return { status: "deleted" as const, entityId: null };
      const entity = found ?? (await entitiesRepo.create(tx, businessId, { kind: "person", displayName: followerDisplayName(email, REPLY_CONTACT_LABEL), identifiers: { email }, source: REPLY_SOURCE, lawfulBasis: null }));
      const subject = input.subject.replace(/[\r\n]+/g, " ").trim().slice(0, 200);
      const rows = await tx
        .insert(interactions)
        .values({ id: input.interactionId, businessId, kind: "email", direction: "inbound", occurredAt: input.occurredAt, entityIds: [entity.id], summary: subject, bodyUntrusted: input.body.slice(0, REPLY_BODY_MAX) })
        .onConflictDoNothing()
        .returning({ id: interactions.id });
      // The id is taken by another project's row (ids are unique across projects): roll back the person just made.
      if (rows.length === 0) throw conflict;
      await input.onStored?.(tx, { interactionId: input.interactionId, entityId: entity.id, displayName: entity.displayName });
      return { status: "stored" as const, entityId: entity.id };
      });
    } catch (e) {
      if (e === conflict) return { status: "duplicate", entityId: null };
      throw e;
    }
  },

  /** Kept email (replies and the founders' answers), newest first, for one record or the whole project. */
  async list(db: Executor, businessId: string, filter: { entityId?: string; limit: number }): Promise<ReplyMessage[]> {
    const rows = await db
      .select()
      .from(interactions)
      .where(and(eq(interactions.businessId, businessId), kept, inArray(interactions.direction, ["inbound", "outbound"]), filter.entityId ? sql`${interactions.entityIds} @> array[${filter.entityId}::uuid]` : undefined))
      .orderBy(desc(interactions.occurredAt), desc(interactions.id))
      .limit(Math.min(Math.max(filter.limit, 1), 50));
    const entityIds = [...new Set(rows.map((r) => r.entityIds[0]).filter((id): id is string => !!id))];
    const names = new Map((entityIds.length ? await db.select({ id: entities.id, displayName: entities.displayName }).from(entities).where(and(eq(entities.businessId, businessId), inArray(entities.id, entityIds))) : []).map((e) => [e.id, e.displayName]));
    const answeredAfter = (r: Interaction): boolean => rows.some((o) => o.direction === "outbound" && o.entityIds[0] === r.entityIds[0] && o.occurredAt.getTime() >= r.occurredAt.getTime());
    return rows.flatMap((r) => {
      const entityId = r.entityIds[0];
      if (!entityId) return [];
      return [{ id: r.id, entityId, from: names.get(entityId) ?? REPLY_CONTACT_LABEL, direction: r.direction === "outbound" ? ("outbound" as const) : ("inbound" as const), at: r.occurredAt, subject: r.summary, text: r.bodyUntrusted ?? "", answered: r.direction === "inbound" && answeredAfter(r) }];
    });
  },

  /** Whether this id is a kept reply of the business (read inside withRls before an answer is asked for). */
  async isInbound(db: Executor, businessId: string, interactionId: string): Promise<boolean> {
    const rows = await db.select({ id: interactions.id }).from(interactions).where(and(eq(interactions.businessId, businessId), eq(interactions.id, interactionId), kept, eq(interactions.direction, "inbound"))).limit(1);
    return rows.length > 0;
  },

  /** The kept reply the founders are answering, and the address it came from (the gateway's read; never returned to the api). */
  async forAnswer(db: Executor, businessId: string, interactionId: string): Promise<{ interactionId: string; entityId: string; email: string; subject: string } | null> {
    const row = maybeOne(await db.select().from(interactions).where(and(eq(interactions.businessId, businessId), eq(interactions.id, interactionId), kept, eq(interactions.direction, "inbound"), sql`${interactions.archivedAt} is null`)).limit(1));
    const entityId = row?.entityIds[0];
    if (!row || !entityId) return null;
    const entity = maybeOne(await db.select().from(entities).where(and(eq(entities.businessId, businessId), eq(entities.id, entityId))).limit(1));
    const email = typeof entity?.identifiers?.email === "string" ? entity.identifiers.email : null;
    if (!entity || !email || entity.deletionRequestedAt || entity.mergedIntoId) return null;
    return { interactionId: row.id, entityId, email, subject: row.summary };
  },

  /** The founders' answer, once it went out (not for a simulated send). */
  async recordAnswer(db: Executor, businessId: string, input: { entityId: string; subject: string; text: string; at: Date }): Promise<{ id: string }> {
    const [row] = await db
      .insert(interactions)
      .values({ businessId, kind: "email", direction: "outbound", occurredAt: input.at, entityIds: [input.entityId], summary: input.subject.slice(0, 200), bodyUntrusted: input.text.slice(0, REPLY_BODY_MAX) })
      .returning({ id: interactions.id });
    return { id: row!.id };
  },
};
