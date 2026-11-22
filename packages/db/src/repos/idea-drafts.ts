/**
 * The landing page's idea box (0086; docs/IDEA_BOX.md): a signed-out visitor's one card and the waitlist that keeps it.
 * Service connection only (no client role can read either table). Every lookup takes a token's SHA-256 (lowercase hex),
 * never the token: the api hashes what the cookie or the email link carries (`ideaTokenHash`, apps/api).
 *
 * A draft is live while nobody has claimed it and `greatest(expires_at, held_until)` is in the future. Claiming moves
 * the card into the person's deck in the caller's transaction and records who claimed it; the same person claiming
 * again gets the same idea back, anyone else gets nothing. The sweep deletes every draft past its time, claimed or not
 * (a claimed card lives on as the idea).
 */
import { and, asc, count, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { accountAdmissions, ideaDrafts, waitlistBatches, waitlistEntries, type IdeaDraftRow, type WaitlistEntryRow } from "../schema";
import { ideasRepo, type CreateIdeaInput } from "./ideas";
import { admissionsRepo } from "./people";
import { newPostCode } from "./post-attributions";
import { isPostCode } from "@foundmill/shared/via";
import { addressKey } from "@foundmill/shared";
import { Id, maybeOne, parseInput, type Executor } from "./_shared";

/** How long an unclaimed card is kept (founder, 2026-11-13). */
export const IDEA_DRAFT_TTL_MS = 7 * 24 * 60 * 60_000;
/** Drafts one sweep statement deletes at most. */
export const IDEA_DRAFT_SWEEP_BATCH = 200;
/** How long the waitlist keeps it (founder, 2026-11-13: people on the waitlist keep their card). */
export const IDEA_DRAFT_HOLD_MS = 90 * 24 * 60 * 60_000;

const HASH = /^[0-9a-f]{64}$/;
const isHash = (h: string | null | undefined): h is string => typeof h === "string" && HASH.test(h);

export interface CreateIdeaDraftInput {
  tokenHash: string;
  claimHash: string;
  prompt: string;
  interest: string | null;
  card: unknown;
  modelMode: "live" | "mock";
  costMicro: number;
  now?: Date;
}

export type ClaimIdeaDraftResult =
  { status: "claimed"; ideaId: string; draftId: string; again: boolean } | { status: "none" };

/** Live: unclaimed, and not past both its expiry and any hold. */
const live = (now: Date) =>
  and(
    isNull(ideaDrafts.claimedAt),
    or(gt(ideaDrafts.expiresAt, now), gt(ideaDrafts.heldUntil, now)),
  );

export const ideaDraftsRepo = {
  async create(db: Executor, input: CreateIdeaDraftInput): Promise<IdeaDraftRow> {
    if (!isHash(input.tokenHash) || !isHash(input.claimHash))
      throw new Error("idea draft tokens must be SHA-256 hex");
    const now = input.now ?? new Date();
    const [row] = await db
      .insert(ideaDrafts)
      .values({
        tokenHash: input.tokenHash,
        claimHash: input.claimHash,
        prompt: input.prompt.slice(0, 500),
        interest: input.interest?.slice(0, 60) ?? null,
        card: input.card,
        modelMode: input.modelMode,
        costMicro: Math.max(0, Math.round(input.costMicro)),
        expiresAt: new Date(now.getTime() + IDEA_DRAFT_TTL_MS),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return row!;
  },

  /**
   * "Try another idea" (WP-03 T7): puts a new card in the browser's live draft, under the same token. The claim token
   * is replaced (the old link stops working), the card gets a fresh 7 days, and its cost is added to what the draft
   * already cost, dated now, so the day's ceiling counts every card made (a redraw of yesterday's card counts it again
   * today: more cautious, never less). Null when the draft is claimed, past its time or unknown.
   */
  async replace(
    db: Executor,
    tokenHash: string,
    input: Omit<CreateIdeaDraftInput, "tokenHash">,
  ): Promise<IdeaDraftRow | null> {
    if (!isHash(tokenHash) || !isHash(input.claimHash))
      throw new Error("idea draft tokens must be SHA-256 hex");
    const now = input.now ?? new Date();
    const [row] = await db
      .update(ideaDrafts)
      .set({
        claimHash: input.claimHash,
        prompt: input.prompt.slice(0, 500),
        interest: input.interest?.slice(0, 60) ?? null,
        card: input.card,
        modelMode: input.modelMode,
        costMicro: sql`${ideaDrafts.costMicro} + ${Math.max(0, Math.round(input.costMicro))}`,
        expiresAt: new Date(now.getTime() + IDEA_DRAFT_TTL_MS),
        createdAt: now,
        updatedAt: now,
      })
      .where(and(eq(ideaDrafts.tokenHash, tokenHash), live(now)))
      .returning();
    return row ?? null;
  },

  /** The live draft an email link's claim token points at, or null. */
  async liveByClaim(db: Executor, claimHash: string, now = new Date()): Promise<IdeaDraftRow | null> {
    if (!isHash(claimHash)) return null;
    return maybeOne(await db.select().from(ideaDrafts).where(and(eq(ideaDrafts.claimHash, claimHash), live(now))).limit(1));
  },

  /** A live draft by id (the one a waitlist entry holds), or null. */
  async liveById(db: Executor, id: string, now = new Date()): Promise<IdeaDraftRow | null> {
    return maybeOne(await db.select().from(ideaDrafts).where(and(eq(ideaDrafts.id, id), live(now))).limit(1));
  },

  /** The browser's live draft, or null (unknown, claimed, or past its time). */
  async liveByToken(
    db: Executor,
    tokenHash: string,
    now = new Date(),
  ): Promise<IdeaDraftRow | null> {
    if (!isHash(tokenHash)) return null;
    return maybeOne(
      await db
        .select()
        .from(ideaDrafts)
        .where(and(eq(ideaDrafts.tokenHash, tokenHash), live(now)))
        .limit(1),
    );
  },

  /**
   * Claims the draft the browser token (`by: "token"`) or the email's claim token (`by: "claim"`) points at for `userId`:
   * the card becomes an idea in their deck (`toIdea`), in one transaction. The claim token works once.
   */
  async claim(
    db: Executor,
    input: {
      userId: string;
      hash: string;
      by: "token" | "claim" | "id";
      toIdea: (row: IdeaDraftRow) => CreateIdeaInput;
      now?: Date;
    },
  ): Promise<ClaimIdeaDraftResult> {
    if (input.by !== "id" && !isHash(input.hash)) return { status: "none" };
    const now = input.now ?? new Date();
    return db.transaction(async (tx) => {
      const column = input.by === "token" ? ideaDrafts.tokenHash : input.by === "claim" ? ideaDrafts.claimHash : ideaDrafts.id;
      const row = maybeOne(
        await tx.select().from(ideaDrafts).where(eq(column, input.hash)).for("update").limit(1),
      );
      if (!row) return { status: "none" } as const;
      if (row.claimedAt) {
        // The same person again (a second tab, a reload, the link after the cookie): the same idea. Anyone else: nothing.
        return row.claimedBy === input.userId && row.ideaId
          ? ({ status: "claimed", ideaId: row.ideaId, draftId: row.id, again: true } as const)
          : ({ status: "none" } as const);
      }
      const until = Math.max(row.expiresAt.getTime(), row.heldUntil?.getTime() ?? 0);
      if (until <= now.getTime()) return { status: "none" } as const;
      const idea = await ideasRepo.create(tx, input.userId, input.toIdea(row));
      await tx
        .update(ideaDrafts)
        .set({
          claimedBy: input.userId,
          claimedAt: now,
          ideaId: idea.id,
          claimHash: null,
          updatedAt: now,
        })
        .where(eq(ideaDrafts.id, row.id));
      return { status: "claimed", ideaId: idea.id, draftId: row.id, again: false } as const;
    });
  },

  /** A new claim token for a live draft (the visitor came back: the old one is not stored, so it is replaced). */
  async rotateClaim(
    db: Executor,
    tokenHash: string,
    claimHash: string,
    now = new Date(),
  ): Promise<boolean> {
    if (!isHash(tokenHash) || !isHash(claimHash)) return false;
    const rows = await db
      .update(ideaDrafts)
      .set({ claimHash, updatedAt: now })
      .where(and(eq(ideaDrafts.tokenHash, tokenHash), live(now)))
      .returning({ id: ideaDrafts.id });
    return rows.length > 0;
  },

  /** Keeps a live draft until `until` (the waitlist). Returns whether a live draft was held. */
  async hold(
    db: Executor,
    tokenHash: string,
    until: Date,
    now = new Date(),
  ): Promise<IdeaDraftRow | null> {
    if (!isHash(tokenHash)) return null;
    const [row] = await db
      .update(ideaDrafts)
      .set({ heldUntil: until, updatedAt: now })
      .where(and(eq(ideaDrafts.tokenHash, tokenHash), live(now)))
      .returning();
    return row ?? null;
  },

  /** Ends a hold (the person left the waitlist): the draft keeps only its own expiry. */
  async releaseHold(db: Executor, tokenHash: string, now = new Date()): Promise<boolean> {
    if (!isHash(tokenHash)) return false;
    const rows = await db
      .update(ideaDrafts)
      .set({ heldUntil: null, updatedAt: now })
      .where(eq(ideaDrafts.tokenHash, tokenHash))
      .returning({ id: ideaDrafts.id });
    return rows.length > 0;
  },

  /** What the drafts written since `since` cost, in millionths of a US cent (Estimate): the idea box's daily ceiling. */
  async spentSince(db: Executor, since: Date): Promise<number> {
    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${ideaDrafts.costMicro}), 0)` })
      .from(ideaDrafts)
      .where(gt(ideaDrafts.createdAt, since));
    return Number(row?.total ?? 0);
  },

  /** Deletes up to `limit` drafts past their expiry and any hold, claimed or not, in one statement. Returns how many. */
  async sweep(db: Executor, now = new Date(), limit = IDEA_DRAFT_SWEEP_BATCH): Promise<number> {
    // One small batch per statement (no transaction held across a wait): the caller loops.
    const batch = db
      .select({ id: ideaDrafts.id })
      .from(ideaDrafts)
      .where(and(lt(ideaDrafts.expiresAt, now), or(isNull(ideaDrafts.heldUntil), lt(ideaDrafts.heldUntil, now))))
      .limit(Math.max(1, Math.min(limit, 1_000)));
    const rows = await db.delete(ideaDrafts).where(inArray(ideaDrafts.id, batch)).returning({ id: ideaDrafts.id });
    return rows.length;
  },
};

export const waitlistRepo = {
  /**
   * Adds the signed-in person (once; joining again updates the draft they keep). One row per address. The entry gets
   * its share code here (0113; an entry made before 0113 gets one on its next join). `referrerCode` is the code of the
   * link the person came through (`?via=w.<code>`, WP-03 T10): it is recorded only when the entry is first made, only
   * when it names another person's entry, and never changes after; anything else is ignored without an error. Another
   * person means another mailbox (`addressKey`: `maya+1@` and `maya@` are one), and someone already let in brings no one.
   */
  async join(
    db: Executor,
    input: { userId: string; email: string; ideaDraftId: string | null; referrerCode?: string | null; cardThen?: "studio" | null; now?: Date },
  ): Promise<WaitlistEntryRow> {
    const now = input.now ?? new Date();
    const email = input.email.trim().toLowerCase().slice(0, 320);
    const referrer = isPostCode(input.referrerCode) && !(await admissionsRepo.has(db, input.userId))
      ? maybeOne(
          await db
            .select({ id: waitlistEntries.id, userId: waitlistEntries.userId, email: waitlistEntries.email })
            .from(waitlistEntries)
            .where(eq(waitlistEntries.code, input.referrerCode))
            .limit(1),
        )
      : null;
    const ownKey = addressKey(email);
    const sameMailbox = (other: string) => !ownKey || addressKey(other) === ownKey;
    const referredByEntryId = referrer && referrer.userId !== input.userId && !sameMailbox(referrer.email) ? referrer.id : null;
    const [row] = await db
      .insert(waitlistEntries)
      .values({ userId: input.userId, email, ideaDraftId: input.ideaDraftId, cardThen: input.ideaDraftId ? (input.cardThen ?? null) : null, code: newPostCode(), referredByEntryId, createdAt: now, updatedAt: now })
      // One row per address: a row added before the person had an account takes their account when they join. Who
      // brought them is left as the entry was made.
      .onConflictDoUpdate({
        target: waitlistEntries.email,
        set: {
          userId: input.userId,
          ideaDraftId: sql`coalesce(excluded.idea_draft_id, ${waitlistEntries.ideaDraftId})`,
          // The choice goes with the card: a join that holds a card sets it (or clears it); one without a card keeps it.
          cardThen: sql`case when excluded.idea_draft_id is not null then excluded.card_then else ${waitlistEntries.cardThen} end`,
          code: sql`coalesce(${waitlistEntries.code}, excluded.code)`,
          updatedAt: now,
        },
      })
      .returning();
    return row!;
  },

  async get(db: Executor, userId: string): Promise<WaitlistEntryRow | null> {
    return maybeOne(
      await db.select().from(waitlistEntries).where(eq(waitlistEntries.userId, userId)).limit(1),
    );
  },

  /**
   * Admits the next `limit` people who wait (WP-03 T2), in `WAITLIST_ORDER`: entries with an account and no
   * `admitted_at`, each row locked (`for update skip locked`, so two sweeps never take the same person). For each, the
   * admission is recorded as `waitlist` (`repos.admissions.record`) and `admitted_at` is set. An account that already
   * had an admission keeps it (`newAdmission` false): its entry is closed as told (`notified_at` set), so it gets no
   * "Your place is open" email and takes none of the day's number (`admittedSince` counts new admissions only). Run it
   * inside the transaction that holds `lockOpenCount`. `batchId` (0153): the batch these places belong to; it is written
   * on new admissions only, so an account that was already in takes none of a batch's places either.
   */
  async admitNext(tx: Executor, input: { limit: number; now?: Date; batchId?: string | null }): Promise<WaitlistAdmitted[]> {
    const limit = Math.max(0, Math.min(Math.floor(input.limit), 1_000));
    if (limit === 0) return [];
    const now = input.now ?? new Date();
    const next = await tx
      .select({ id: waitlistEntries.id, userId: waitlistEntries.userId })
      .from(waitlistEntries)
      .where(and(isNotNull(waitlistEntries.userId), isNull(waitlistEntries.admittedAt)))
      .orderBy(WAITLIST_ORDER)
      .limit(limit)
      .for("update", { skipLocked: true });
    const out: WaitlistAdmitted[] = [];
    for (const entry of next) {
      const recorded = await admissionsRepo.record(tx, { userId: entry.userId!, how: "waitlist", at: now });
      const [row] = await tx
        .update(waitlistEntries)
        .set({ admittedAt: now, updatedAt: now, ...(recorded === null ? { notifiedAt: now } : input.batchId ? { batchId: input.batchId } : {}) })
        .where(and(eq(waitlistEntries.id, entry.id), isNull(waitlistEntries.admittedAt)))
        .returning();
      if (row) out.push({ ...row, newAdmission: recorded !== null });
    }
    const took = out.filter((row) => row.newAdmission).length;
    // The database refuses `taken` above `places`, so a batch can never admit more than it published.
    if (input.batchId && took > 0) await tx.update(waitlistBatches).set({ taken: sql`${waitlistBatches.taken} + ${took}`, updatedAt: now }).where(eq(waitlistBatches.id, input.batchId));
    return out;
  },

  /**
   * The batches that still have places (0153; WP-14 T15), lowest number first, each with the places it has left: its
   * `places` less `taken`, the new accounts it admitted (a count that only goes up, so a closed account gives no place back). `openOnly`: only those whose day has come (`opens_on <= day`, a UTC day
   * as `YYYY-MM-DD`), which is what the sweep admits from; without it, the next ones to open too, which is what the
   * public page shows. A real count, never an estimate.
   */
  async batchesWithPlaces(db: Executor, input: { day: string; openOnly?: boolean; limit?: number }): Promise<WaitlistBatchWithPlaces[]> {
    const rows = await db
      .select({ id: waitlistBatches.id, number: waitlistBatches.number, opensOn: waitlistBatches.opensOn, places: waitlistBatches.places, taken: waitlistBatches.taken })
      .from(waitlistBatches)
      .where(and(gt(waitlistBatches.places, waitlistBatches.taken), input.openOnly ? lte(waitlistBatches.opensOn, input.day) : undefined))
      .orderBy(asc(waitlistBatches.number))
      .limit(Math.max(1, Math.min(input.limit ?? 20, 100)));
    return rows.map((r) => ({ id: r.id, number: r.number, opensOn: r.opensOn, places: r.places, placesLeft: r.places - r.taken, open: r.opensOn <= input.day }));
  },

  /**
   * New accounts the waitlist let in since `since` (the start of the UTC day): `waitlist` admissions, the sweep's and the
   * operator's alike. An entry whose account was already in is not one.
   */
  async admittedSince(db: Executor, since: Date): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(accountAdmissions)
      .where(and(eq(accountAdmissions.how, "waitlist"), gte(accountAdmissions.createdAt, since)));
    return Number(row?.n ?? 0);
  },

  /** Admitted since `since` and not yet emailed, oldest admission first. */
  async toNotify(db: Executor, input: { since: Date; limit: number }): Promise<{ id: string; userId: string }[]> {
    const rows = await db
      .select({ id: waitlistEntries.id, userId: waitlistEntries.userId })
      .from(waitlistEntries)
      .where(and(gte(waitlistEntries.admittedAt, input.since), isNull(waitlistEntries.notifiedAt), isNotNull(waitlistEntries.userId)))
      .orderBy(waitlistEntries.admittedAt, waitlistEntries.id)
      .limit(Math.max(1, Math.min(input.limit, 500)));
    return rows.map((r) => ({ id: r.id, userId: r.userId! }));
  },

  /**
   * One entry as the gateway reads it before the email (never the address: that comes from `auth.users`), with the name
   * of the card it keeps while that card is still kept (live, or claimed by the same person), else null.
   */
  async forEmail(db: Executor, id: string, now = new Date()): Promise<WaitlistEntryForEmail | null> {
    const entryId = parseInput(Id, id, "waitlist entry id");
    const row = maybeOne(
      await db
        .select({
          id: waitlistEntries.id,
          userId: waitlistEntries.userId,
          admittedAt: waitlistEntries.admittedAt,
          notifiedAt: waitlistEntries.notifiedAt,
          cardName: sql<string | null>`${ideaDrafts.card}->>'name'`,
        })
        .from(waitlistEntries)
        .leftJoin(
          ideaDrafts,
          and(eq(ideaDrafts.id, waitlistEntries.ideaDraftId), or(live(now), eq(ideaDrafts.claimedBy, waitlistEntries.userId))),
        )
        .where(eq(waitlistEntries.id, entryId))
        .limit(1),
    );
    if (!row) return null;
    const cardName = typeof row.cardName === "string" && row.cardName.trim() ? row.cardName : null;
    return { ...row, cardName };
  },

  /** Records that the email went (or will never go); true the first time only. */
  async markNotified(db: Executor, id: string, now = new Date()): Promise<boolean> {
    const rows = await db
      .update(waitlistEntries)
      .set({ notifiedAt: now, updatedAt: now })
      .where(and(eq(waitlistEntries.id, parseInput(Id, id, "waitlist entry id")), isNull(waitlistEntries.notifiedAt)))
      .returning({ id: waitlistEntries.id });
    return rows.length > 0;
  },
};

/**
 * The waitlist's order (DECISIONS 2026-11-12: plain and ordered by referral; WP-03 T10, 0113): first the entries that
 * brought someone who joined (at least one entry with an account names them in `referred_by_entry_id`), then every
 * other entry; within each group, sign-up time, oldest first, then id. How many someone brought never orders anyone.
 * Being brought changes nothing for the person brought (no head start, no penalty), and coming on your own costs
 * nothing beyond this: you wait in sign-up order, behind only those who brought someone.
 */
export const WAITLIST_ORDER = sql`exists (select 1 from waitlist_entries brought where brought.referred_by_entry_id = ${waitlistEntries.id} and brought.user_id is not null) desc, ${waitlistEntries.createdAt} asc, ${waitlistEntries.id} asc`;

/** An entry `admitNext` admitted; `newAdmission` is false when the account already had an admission row. */
/** A batch that still has places: `placesLeft` is real, `open` says whether its day has come. */
export interface WaitlistBatchWithPlaces {
  id: string;
  number: number;
  opensOn: string;
  places: number;
  placesLeft: number;
  open: boolean;
}

export type WaitlistAdmitted = WaitlistEntryRow & { newAdmission: boolean };

export interface WaitlistEntryForEmail {
  id: string;
  userId: string | null;
  admittedAt: Date | null;
  notifiedAt: Date | null;
  cardName: string | null;
}
