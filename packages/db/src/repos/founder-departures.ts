/**
 * 0097 — founder departures and the one-click cancel links (security review P2-3, reworked after the second review).
 *
 * A former founder, for a deletion request: someone whose founder's standing someone else took away (`demoted` or
 * `removed`) within `FORMER_FOUNDER_LOOKBACK_MS` (30 days) before the request, or at any time after it, and who does not
 * have the standing back. They hear about that request and may cancel it until its scheduled day. Counted from the
 * request, so waiting out a window does not wear the right away.
 *
 * - `latest` is safe on a signed-in person's RLS connection.
 * - `forUser` names the business, which a person who is out of it can no longer read: the service connection's, for the
 *   signed-in person's own id only.
 * - `formerFoundersFor` / `formerFounderFor` and everything about the links are the service connection's.
 */
import { and, desc, eq, gte, inArray, isNull, lt, notExists, sql } from "drizzle-orm";
import { z } from "zod";
import { FORMER_FOUNDER_LOOKBACK_MS, OWNER_ROLES } from "@foundmill/shared";
import { businesses, memberships } from "../schema";
import { founderCancelLinks, founderDepartures, type FounderCancelLink, type FounderDeparture } from "../schema/people";
import { Id, maybeOne, one, parseInput, type Executor } from "./_shared";
import { membershipNotEnded } from "./memberships";

const Hex64 = z.string().regex(/^[0-9a-f]{64}$/);

export type FounderDepartureView = Omit<FounderDeparture, "createdAt" | "updatedAt">;
const visible = {
  id: founderDepartures.id,
  businessId: founderDepartures.businessId,
  userId: founderDepartures.userId,
  priorRole: founderDepartures.priorRole,
  how: founderDepartures.how,
  newRole: founderDepartures.newRole,
  byUserId: founderDepartures.byUserId,
  departedAt: founderDepartures.departedAt,
};

/** The earliest departure that still counts for a request made at `requestedAt`. */
export const formerFounderSince = (requestedAt: Date): Date => new Date(requestedAt.getTime() - FORMER_FOUNDER_LOOKBACK_MS);

/** The latest departure per person since `since`, when someone else caused it and the person is not a founder now. */
async function formerSince(db: Executor, businessId: string, since: Date): Promise<FounderDepartureView[]> {
  const bid = parseInput(Id, businessId, "business id");
  const rows = await db
    .selectDistinctOn([founderDepartures.userId], visible)
    .from(founderDepartures)
    .where(and(eq(founderDepartures.businessId, bid), gte(founderDepartures.departedAt, since)))
    .orderBy(founderDepartures.userId, desc(founderDepartures.departedAt), desc(founderDepartures.id));
  const others = rows.filter((r) => r.how === "demoted" || r.how === "removed");
  if (others.length === 0) return [];
  const founders = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.businessId, bid), inArray(memberships.role, [...OWNER_ROLES]), membershipNotEnded, inArray(memberships.userId, others.map((r) => r.userId))));
  const still = new Set(founders.map((f) => f.userId));
  // Most recent first.
  return others.filter((r) => !still.has(r.userId)).sort((x, y) => y.departedAt.getTime() - x.departedAt.getTime() || (x.id < y.id ? 1 : -1));
}

/** No founder's standing in the business now (an owner or a cofounder, not ended) for the row's person. */
const notFounderNow = (bid: string, userIdColumn: unknown) =>
  notExists(
    sql`(select 1 from ${memberships} where ${memberships.businessId} = ${bid} and ${memberships.userId} = ${userIdColumn} and ${inArray(memberships.role, [...OWNER_ROLES])} and ${membershipNotEnded})`,
  );

/**
 * The people whose latest departure from the business is before `before`, when someone else caused it and they are not
 * founders now, most recent first, at most `limit`: ordered and limited in the database (final review, P3).
 */
async function formerBefore(db: Executor, businessId: string, before: Date | null, limit: number): Promise<FounderDepartureView[]> {
  const bid = parseInput(Id, businessId, "business id");
  const latest = db
    .selectDistinctOn([founderDepartures.userId], visible)
    .from(founderDepartures)
    .where(eq(founderDepartures.businessId, bid))
    .orderBy(founderDepartures.userId, desc(founderDepartures.departedAt), desc(founderDepartures.id))
    .as("latest");
  return db
    .select({ id: latest.id, businessId: latest.businessId, userId: latest.userId, priorRole: latest.priorRole, how: latest.how, newRole: latest.newRole, byUserId: latest.byUserId, departedAt: latest.departedAt })
    .from(latest)
    .where(and(inArray(latest.how, ["demoted", "removed"]), before ? lt(latest.departedAt, before) : undefined, notFounderNow(bid, latest.userId)))
    .orderBy(desc(latest.departedAt), desc(latest.id))
    .limit(Math.max(0, limit));
}

export const founderDeparturesRepo = {
  /** The person's latest departure from this business, or null (any kind). */
  async latest(db: Executor, businessId: string, userId: string): Promise<FounderDepartureView | null> {
    return maybeOne(
      await db
        .select(visible)
        .from(founderDepartures)
        .where(and(eq(founderDepartures.businessId, parseInput(Id, businessId, "business id")), eq(founderDepartures.userId, parseInput(Id, userId, "user id"))))
        .orderBy(desc(founderDepartures.departedAt), desc(founderDepartures.id))
        .limit(1),
    );
  },

  /**
   * Service role, for the signed-in person's own id: their latest departure per business since `since`, when someone else
   * caused it, with the business's name (archived ones too: a deletion can wait on an archived business), most recent
   * first (final review, P3). The card on their home and the gateway's folded email read it.
   */
  async forUser(db: Executor, userId: string, since: Date): Promise<(FounderDepartureView & { businessName: string })[]> {
    const rows = await db
      .selectDistinctOn([founderDepartures.businessId], { ...visible, businessName: businesses.name })
      .from(founderDepartures)
      .innerJoin(businesses, eq(businesses.id, founderDepartures.businessId))
      .where(and(eq(founderDepartures.userId, parseInput(Id, userId, "user id")), gte(founderDepartures.departedAt, since)))
      .orderBy(founderDepartures.businessId, desc(founderDepartures.departedAt), desc(founderDepartures.id));
    return rows.filter((r) => r.how === "demoted" || r.how === "removed").sort((x, y) => y.departedAt.getTime() - x.departedAt.getTime());
  },

  /**
   * Service role: the former founders for a deletion request made at `requestedAt`: the latest departure per person since
   * 30 days before it (or after it), when someone else caused it and the person does not have a founder's standing now.
   */
  async formerFoundersFor(db: Executor, businessId: string, requestedAt: Date): Promise<FounderDepartureView[]> {
    return formerSince(db, businessId, formerFounderSince(requestedAt));
  },

  /**
   * Service role: everyone whose founder's standing someone else ever took away in this project and who does not have it
   * back (the latest departure per person), most recent first. They hear about a deletion request and its cancel (third
   * review), at most `limit` of them (final review: `FOUNDER_NOTICE_LIMITS.formerPerRequest`, the most recent); the right
   * to cancel stays with the former founders for the request (`formerFoundersFor`).
   */
  async formerFoundersEver(db: Executor, businessId: string, opts: { limit?: number } = {}): Promise<FounderDepartureView[]> {
    if (opts.limit === undefined) return formerSince(db, businessId, new Date(0));
    return formerBefore(db, businessId, null, opts.limit);
  },

  /**
   * Service role: the former founders a deletion request made at `requestedAt` emails beyond its own window: the people
   * someone else took out more than 30 days before it (their latest departure), not founders now, most recent first and
   * at most `limit` (`FOUNDER_NOTICE_LIMITS.formerPerRequest`), ordered and limited in the database (final review). The
   * former founders for the request itself (`formerFoundersFor`) are never capped: they may cancel it.
   */
  async formerFoundersLongAgo(db: Executor, businessId: string, requestedAt: Date, opts: { limit: number }): Promise<FounderDepartureView[]> {
    return formerBefore(db, businessId, formerFounderSince(requestedAt), opts.limit);
  },

  /**
   * Service role: this person's departure if they were ever a founder someone else took out of this project (and, with
   * `limit`, one of the `limit` most recent such people), else null.
   */
  async formerFounderEver(db: Executor, businessId: string, userId: string, opts: { limit?: number } = {}): Promise<FounderDepartureView | null> {
    const uid = parseInput(Id, userId, "user id");
    return (await founderDeparturesRepo.formerFoundersEver(db, businessId, opts)).find((r) => r.userId === uid) ?? null;
  },
  /**
   * Service role: this person's departure if they are a former founder for a request made at `requestedAt`, else null:
   * one person's rows only (their latest departure since 30 days before the request, someone else's change, not a
   * founder now).
   */
  async formerFounderFor(db: Executor, businessId: string, userId: string, requestedAt: Date): Promise<FounderDepartureView | null> {
    const bid = parseInput(Id, businessId, "business id");
    const uid = parseInput(Id, userId, "user id");
    const latest = maybeOne(
      await db
        .select(visible)
        .from(founderDepartures)
        .where(and(eq(founderDepartures.businessId, bid), eq(founderDepartures.userId, uid), gte(founderDepartures.departedAt, formerFounderSince(requestedAt))))
        .orderBy(desc(founderDepartures.departedAt), desc(founderDepartures.id))
        .limit(1),
    );
    if (!latest || (latest.how !== "demoted" && latest.how !== "removed")) return null;
    const founder = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.businessId, bid), eq(memberships.userId, uid), inArray(memberships.role, [...OWNER_ROLES]), membershipNotEnded))
      .limit(1);
    return founder.length > 0 ? null : latest;
  },
};

export const founderCancelLinksRepo = {
  /** Service role: records one email's link (only the token's hash). */
  async create(db: Executor, input: { businessId: string; userId: string; requestId: string; tokenHash: string; expiresAt: Date }): Promise<FounderCancelLink> {
    const v = parseInput(z.object({ businessId: Id, userId: Id, requestId: Id, tokenHash: Hex64, expiresAt: z.date() }), input, "cancel link");
    return one(await db.insert(founderCancelLinks).values(v).returning(), "cancel link");
  },

  /** Service role: the link a token belongs to (the person who opens it may not be signed in). */
  async byTokenHash(db: Executor, tokenHash: string): Promise<FounderCancelLink | null> {
    const hash = Hex64.safeParse(tokenHash);
    if (!hash.success) return null;
    return maybeOne(await db.select().from(founderCancelLinks).where(eq(founderCancelLinks.tokenHash, hash.data)).limit(1));
  },

  /** Service role: spends the link; true only for the first caller. */
  async use(db: Executor, linkId: string, at: Date = new Date()): Promise<boolean> {
    const rows = await db
      .update(founderCancelLinks)
      .set({ usedAt: at })
      .where(and(eq(founderCancelLinks.id, parseInput(Id, linkId, "link id")), isNull(founderCancelLinks.usedAt), sql`${founderCancelLinks.expiresAt} > ${at}`))
      .returning({ id: founderCancelLinks.id });
    return rows.length > 0;
  },

  /** Service role: forgets a link whose email was not sent (nobody holds its token). */
  async remove(db: Executor, linkId: string): Promise<void> {
    await db.delete(founderCancelLinks).where(eq(founderCancelLinks.id, parseInput(Id, linkId, "link id")));
  },
};
