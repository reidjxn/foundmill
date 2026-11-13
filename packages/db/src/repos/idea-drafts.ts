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
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { ideaDrafts, waitlistEntries, type IdeaDraftRow, type WaitlistEntryRow } from "../schema";
import { ideasRepo, type CreateIdeaInput } from "./ideas";
import { maybeOne, type Executor } from "./_shared";

/** How long an unclaimed card is kept (founder, 2026-11-13). */
export const IDEA_DRAFT_TTL_MS = 7 * 24 * 60 * 60_000;
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
      by: "token" | "claim";
      toIdea: (row: IdeaDraftRow) => CreateIdeaInput;
      now?: Date;
    },
  ): Promise<ClaimIdeaDraftResult> {
    if (!isHash(input.hash)) return { status: "none" };
    const now = input.now ?? new Date();
    return db.transaction(async (tx) => {
      const column = input.by === "token" ? ideaDrafts.tokenHash : ideaDrafts.claimHash;
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

  /** Deletes every draft past its expiry and any hold, claimed or not. Returns how many. */
  async sweep(db: Executor, now = new Date()): Promise<number> {
    const rows = await db
      .delete(ideaDrafts)
      .where(
        and(
          lt(ideaDrafts.expiresAt, now),
          or(isNull(ideaDrafts.heldUntil), lt(ideaDrafts.heldUntil, now)),
        ),
      )
      .returning({ id: ideaDrafts.id });
    return rows.length;
  },
};

export const waitlistRepo = {
  /** Adds the signed-in person (once; joining again updates the draft they keep). One row per address. */
  async join(
    db: Executor,
    input: { userId: string; email: string; ideaDraftId: string | null; now?: Date },
  ): Promise<WaitlistEntryRow> {
    const now = input.now ?? new Date();
    const [row] = await db
      .insert(waitlistEntries)
      .values({
        userId: input.userId,
        email: input.email.trim().toLowerCase().slice(0, 320),
        ideaDraftId: input.ideaDraftId,
        createdAt: now,
        updatedAt: now,
      })
      // One row per address: a row added before the person had an account takes their account when they join.
      .onConflictDoUpdate({
        target: waitlistEntries.email,
        set: {
          userId: input.userId,
          ideaDraftId: sql`coalesce(excluded.idea_draft_id, ${waitlistEntries.ideaDraftId})`,
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
};
