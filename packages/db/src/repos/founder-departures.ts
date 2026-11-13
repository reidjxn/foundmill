/**
 * 0094 — founder departures (security review P2-3): one row each time a membership lost a founder's standing, written by
 * the trigger on `memberships`. The api and the gateway read them to tell a founder who was demoted or removed about a
 * deletion, and to let them cancel it for `FORMER_FOUNDER_CANCEL_WINDOW_MS`.
 *
 * - `latest` is safe on a signed-in person's RLS connection (it never selects the token's hash).
 * - `forUser` names the business, which a person who is out of it can no longer read: the service connection's, for
 *   the signed-in person's own id only.
 * - Everything about the one-click cancel (`setCancelToken`, `byCancelTokenHash`, `useCancelToken`) and the lists across a
 *   business (`formerFounders`) are the service connection's.
 */
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { FORMER_FOUNDER_CANCEL_WINDOW_MS, OWNER_ROLES } from "@foundmill/shared";
import { businesses, memberships } from "../schema";
import { founderDepartures, type FounderDeparture } from "../schema/people";
import { Id, maybeOne, parseInput, type Executor } from "./_shared";
import { membershipNotEnded } from "./memberships";

const Hex64 = z.string().regex(/^[0-9a-f]{64}$/);

/** What a client role may read of a row (never the token's hash). */
const visible = {
  id: founderDepartures.id,
  businessId: founderDepartures.businessId,
  userId: founderDepartures.userId,
  priorRole: founderDepartures.priorRole,
  how: founderDepartures.how,
  newRole: founderDepartures.newRole,
  byUserId: founderDepartures.byUserId,
  departedAt: founderDepartures.departedAt,
  cancelRequestId: founderDepartures.cancelRequestId,
  cancelExpiresAt: founderDepartures.cancelExpiresAt,
  cancelUsedAt: founderDepartures.cancelUsedAt,
};
export type FounderDepartureView = Omit<FounderDeparture, "cancelTokenHash" | "createdAt" | "updatedAt">;

/** Departures someone else caused: the ones that carry the right to cancel a deletion (never a founder's own leaving). */
const BY_SOMEONE_ELSE = inArray(founderDepartures.how, ["demoted", "removed"]);

/** The last moment a departure's cancel right holds. */
export const cancelWindowEnd = (departedAt: Date): Date => new Date(departedAt.getTime() + FORMER_FOUNDER_CANCEL_WINDOW_MS);

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
   * Service role, for the signed-in person's own id: their departures someone else caused since `since`, the latest per
   * business, with the business's name (archived ones too: a deletion can wait on an archived business). The card on
   * their home reads it.
   */
  async forUser(db: Executor, userId: string, since: Date): Promise<(FounderDepartureView & { businessName: string })[]> {
    const rows = await db
      .selectDistinctOn([founderDepartures.businessId], { ...visible, businessName: businesses.name })
      .from(founderDepartures)
      .innerJoin(businesses, eq(businesses.id, founderDepartures.businessId))
      .where(and(eq(founderDepartures.userId, parseInput(Id, userId, "user id")), gt(founderDepartures.departedAt, since)))
      .orderBy(founderDepartures.businessId, desc(founderDepartures.departedAt), desc(founderDepartures.id));
    return rows.filter((r) => r.how === "demoted" || r.how === "removed");
  },

  /**
   * Service role: the people of this business whose founder's standing someone else took away in the window before `at`
   * and who do not have it back now (a person who rejoined as a founder cancels like any founder). The latest departure
   * per person.
   */
  async formerFounders(db: Executor, businessId: string, at: Date = new Date()): Promise<FounderDepartureView[]> {
    const bid = parseInput(Id, businessId, "business id");
    const since = new Date(at.getTime() - FORMER_FOUNDER_CANCEL_WINDOW_MS);
    const rows = await db
      .selectDistinctOn([founderDepartures.userId], visible)
      .from(founderDepartures)
      .where(and(eq(founderDepartures.businessId, bid), gt(founderDepartures.departedAt, since), sql`${founderDepartures.departedAt} <= ${at}`))
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

  /** Service role: whether this person may cancel a pending deletion of this business as a former founder, now. */
  async formerFounder(db: Executor, businessId: string, userId: string, at: Date = new Date()): Promise<FounderDepartureView | null> {
    const uid = parseInput(Id, userId, "user id");
    return (await founderDeparturesRepo.formerFounders(db, businessId, at)).find((r) => r.userId === uid) ?? null;
  },

  /**
   * Service role: the one-click cancel for this departure, for one deletion request. Replaces a token minted earlier
   * (the newer email's link is the one that works). `expiresAt` is cut to the departure's window.
   */
  async setCancelToken(db: Executor, departureId: string, input: { tokenHash: string; requestId: string; expiresAt: Date }): Promise<boolean> {
    const v = parseInput(z.object({ tokenHash: Hex64, requestId: Id, expiresAt: z.date() }), input, "cancel link");
    const rows = await db
      .update(founderDepartures)
      .set({ cancelTokenHash: v.tokenHash, cancelRequestId: v.requestId, cancelExpiresAt: sql`least(${v.expiresAt}::timestamptz, ${founderDepartures.departedAt} + interval '7 days')`, cancelUsedAt: null })
      .where(and(eq(founderDepartures.id, parseInput(Id, departureId, "departure id")), BY_SOMEONE_ELSE))
      .returning({ id: founderDepartures.id });
    return rows.length > 0;
  },

  /** Service role: the departure a cancel token belongs to (the person who opens the link may not be signed in). */
  async byCancelTokenHash(db: Executor, tokenHash: string): Promise<FounderDeparture | null> {
    const hash = Hex64.safeParse(tokenHash);
    if (!hash.success) return null;
    return maybeOne(await db.select().from(founderDepartures).where(eq(founderDepartures.cancelTokenHash, hash.data)).limit(1));
  },

  /** Service role: spends the one-click cancel; true only for the first caller. */
  async useCancelToken(db: Executor, departureId: string, at: Date = new Date()): Promise<boolean> {
    const rows = await db
      .update(founderDepartures)
      .set({ cancelUsedAt: at })
      .where(and(eq(founderDepartures.id, parseInput(Id, departureId, "departure id")), isNull(founderDepartures.cancelUsedAt), sql`${founderDepartures.cancelTokenHash} is not null`))
      .returning({ id: founderDepartures.id });
    return rows.length > 0;
  },
};
