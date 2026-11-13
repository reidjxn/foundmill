/**
 * 0094 — founder departures and the one-click cancel links (security review P2-3, reworked after the second review).
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
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
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
   * caused it, with the business's name (archived ones too: a deletion can wait on an archived business). The card on
   * their home reads it.
   */
  async forUser(db: Executor, userId: string, since: Date): Promise<(FounderDepartureView & { businessName: string })[]> {
    const rows = await db
      .selectDistinctOn([founderDepartures.businessId], { ...visible, businessName: businesses.name })
      .from(founderDepartures)
      .innerJoin(businesses, eq(businesses.id, founderDepartures.businessId))
      .where(and(eq(founderDepartures.userId, parseInput(Id, userId, "user id")), gte(founderDepartures.departedAt, since)))
      .orderBy(founderDepartures.businessId, desc(founderDepartures.departedAt), desc(founderDepartures.id));
    return rows.filter((r) => r.how === "demoted" || r.how === "removed");
  },

  /**
   * Service role: the former founders for a deletion request made at `requestedAt`: the latest departure per person since
   * 30 days before it (or after it), when someone else caused it and the person does not have a founder's standing now.
   */
  async formerFoundersFor(db: Executor, businessId: string, requestedAt: Date): Promise<FounderDepartureView[]> {
    const bid = parseInput(Id, businessId, "business id");
    const rows = await db
      .selectDistinctOn([founderDepartures.userId], visible)
      .from(founderDepartures)
      .where(and(eq(founderDepartures.businessId, bid), gte(founderDepartures.departedAt, formerFounderSince(requestedAt))))
      .orderBy(founderDepartures.userId, desc(founderDepartures.departedAt), desc(founderDepartures.id));
    const others = rows.filter((r) => r.how === "demoted" || r.how === "removed");
    if (others.length === 0) return [];
    const founders = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.businessId, bid), inArray(memberships.role, [...OWNER_ROLES]), membershipNotEnded, inArray(memberships.userId, others.map((r) => r.userId))));
    const still = new Set(founders.map((f) => f.userId));
    return others.filter((r) => !still.has(r.userId));
  },

  /** Service role: this person's departure if they are a former founder for a request made at `requestedAt`, else null. */
  async formerFounderFor(db: Executor, businessId: string, userId: string, requestedAt: Date): Promise<FounderDepartureView | null> {
    const uid = parseInput(Id, userId, "user id");
    return (await founderDeparturesRepo.formerFoundersFor(db, businessId, requestedAt)).find((r) => r.userId === uid) ?? null;
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
