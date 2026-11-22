/**
 * Founder-executed requests (0162 `founder_actions`; founder, 2026-11-22). Service connection only for writes; a member
 * reads through RLS.
 *
 * - `prepare` records the exact payload and its hash for the founder to press. Preparing the same payload while one is
 *   still open returns the open one, so there is one note per request.
 * - `claim` is the one atomic step that lets a press run: `prepared` to `executing` in a single update, so a replayed
 *   token, or two presses at once, reach the vendor exactly once.
 * - `finish` records what became of it; `voidOpen` ends an open request whose subject changed.
 */
import { founderActionPayloadHash } from "@foundmill/shared";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { founderActions, type FounderAction, type FounderActionSummary } from "../schema";
import { Id, JsonObject, maybeOne, one, parseInput, type Executor } from "./_shared";

export const PrepareFounderActionInput = z.object({
  connectorKey: z.string().trim().min(1).max(60),
  tool: z.string().trim().min(1).max(120),
  payload: JsonObject,
  summary: z.object({ title: z.string().min(1).max(200), lines: z.array(z.string().max(600)).max(20), facts: z.record(z.string(), z.string().nullable()) }),
  preparedByAgentId: Id.nullable().default(null),
});
export type PrepareFounderActionInput = z.input<typeof PrepareFounderActionInput>;

export const founderActionsRepo = {
  async get(db: Executor, businessId: string, id: string): Promise<FounderAction | null> {
    return maybeOne(await db.select().from(founderActions).where(and(eq(founderActions.businessId, businessId), eq(founderActions.id, id))).limit(1));
  },

  async forInboxItem(db: Executor, businessId: string, inboxItemId: string): Promise<FounderAction | null> {
    return maybeOne(await db.select().from(founderActions).where(and(eq(founderActions.businessId, businessId), eq(founderActions.inboxItemId, inboxItemId))).limit(1));
  },

  /** Records a request to press; `created: false` returns the open one for the same payload. The hash is computed here, never taken from a caller. */
  async prepare(db: Executor, businessId: string, input: PrepareFounderActionInput): Promise<{ action: FounderAction; created: boolean }> {
    const v = parseInput(PrepareFounderActionInput, input, "founder action");
    const payloadHash = founderActionPayloadHash(v.payload);
    const open = and(eq(founderActions.businessId, businessId), eq(founderActions.connectorKey, v.connectorKey), eq(founderActions.tool, v.tool), eq(founderActions.payloadHash, payloadHash), eq(founderActions.status, "prepared"));
    const existing = maybeOne(await db.select().from(founderActions).where(open).limit(1));
    if (existing) return { action: existing, created: false };
    const rows = await db
      .insert(founderActions)
      .values({ businessId, connectorKey: v.connectorKey, tool: v.tool, payload: v.payload, payloadHash, summary: v.summary as FounderActionSummary, preparedByAgentId: v.preparedByAgentId })
      .onConflictDoNothing()
      .returning();
    if (rows[0]) return { action: rows[0], created: true };
    // Lost a race with another preparer: theirs is the open one.
    return { action: one(await db.select().from(founderActions).where(open).limit(1), "founder action"), created: false };
  },

  /** Whether an earlier request with this payload ended `unknown`: a new request for it says so in its note. */
  async hadUnknown(db: Executor, businessId: string, connectorKey: string, tool: string, payloadHash: string): Promise<boolean> {
    const rows = await db.select({ id: founderActions.id }).from(founderActions).where(and(eq(founderActions.businessId, businessId), eq(founderActions.connectorKey, connectorKey), eq(founderActions.tool, tool), eq(founderActions.payloadHash, payloadHash), eq(founderActions.status, "unknown"))).limit(1);
    return rows.length > 0;
  },

  async attachNote(db: Executor, businessId: string, id: string, inboxItemId: string): Promise<void> {
    await db.update(founderActions).set({ inboxItemId, updatedAt: sql`now()` }).where(and(eq(founderActions.businessId, businessId), eq(founderActions.id, id)));
  },

  /** `prepared` to `executing`, once: null when the row is anything else (already pressed, run, voided). */
  async claim(db: Executor, businessId: string, id: string, input: { tokenHash: string; expiresAt: Date; pressedBy: string; now: Date }): Promise<FounderAction | null> {
    const rows = await db
      .update(founderActions)
      .set({ status: "executing", tokenHash: input.tokenHash, tokenExpiresAt: input.expiresAt, pressedBy: input.pressedBy, pressedAt: input.now, updatedAt: sql`now()` })
      .where(and(eq(founderActions.businessId, businessId), eq(founderActions.id, id), eq(founderActions.status, "prepared")))
      .returning();
    return rows[0] ?? null;
  },

  /** What became of a claimed press. Only an `executing` row is finished, so a row is never finished twice. */
  async finish(db: Executor, businessId: string, id: string, input: { status: "executed" | "failed" | "unknown"; result?: Record<string, unknown>; error?: string; now: Date }): Promise<FounderAction | null> {
    const rows = await db
      .update(founderActions)
      .set({ status: input.status, result: input.result ?? null, error: input.error ? input.error.slice(0, 1000) : null, executedAt: input.status === "executed" ? input.now : null, updatedAt: sql`now()` })
      .where(and(eq(founderActions.businessId, businessId), eq(founderActions.id, id), eq(founderActions.status, "executing")))
      .returning();
    return rows[0] ?? null;
  },

  /** Ends an open request: what its note showed changed, or the founder said not now. Nothing else is touched. */
  async voidOpen(db: Executor, businessId: string, id: string, reason: string): Promise<FounderAction | null> {
    const rows = await db
      .update(founderActions)
      .set({ status: "voided", error: reason.slice(0, 1000), updatedAt: sql`now()` })
      .where(and(eq(founderActions.businessId, businessId), eq(founderActions.id, id), eq(founderActions.status, "prepared")))
      .returning();
    return rows[0] ?? null;
  },
};
