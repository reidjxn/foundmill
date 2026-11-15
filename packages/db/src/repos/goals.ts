/**
 * goals — the business's goal (founder, 2026-11-07; migration 0072). One row per proposal, tied to the Chief of Staff's
 * Inbox decision note that asks for it. `propose` writes the note and the row together (idempotent: while a proposal is
 * open nothing is written); `approve` makes a proposal the active goal and replaces the previous one in the caller's
 * transaction; `requestChange` closes a proposal with the founder's words; `achieve` marks the active goal reached.
 * Every transition is conditional on the row's status, so a second tab or a second member changes nothing.
 *
 * Who writes: the api proposes and decides as the user (RLS: owner, admin, member); ingest marks a goal achieved with
 * the service role; the demo seeds write an active goal.
 */
import { GOAL_METRIC_KINDS, GOAL_PROPOSAL_REASONS, GOAL_SENTENCE_MAX, ValidationError } from "@foundmill/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { goals, type Goal, type InboxItem } from "../schema";
import { Currency, Id, maybeOne, parseInput, type Executor } from "./_shared";
import { inboxRepo, type ComposerItem } from "./inbox";

export interface CurrentGoals {
  /** The goal the team aims at now (null before the founder approved one). */
  active: Goal | null;
  /** The proposal waiting for the founder (null when none is open). */
  proposed: Goal | null;
}

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a day is YYYY-MM-DD");
const Value = z.number().int().safe();

const GoalFields = z.object({
  sentence: z.string().trim().min(1).max(GOAL_SENTENCE_MAX),
  kind: z.enum(GOAL_METRIC_KINDS),
  target: Value.positive().nullable(),
  currency: Currency.nullable().optional(),
  dueOn: Day,
  startValue: Value.nullable().optional(),
});

const ProposeInput = GoalFields.extend({
  reason: z.enum(GOAL_PROPOSAL_REASONS),
  agentId: Id.nullable(),
  replacesGoalId: Id.nullable().optional(),
});
export type ProposeGoalInput = z.input<typeof ProposeInput> & { item: ComposerItem };

const SeedActiveInput = GoalFields.extend({ approvedAt: z.coerce.date(), approvedBy: Id.nullable().optional(), agentId: Id.nullable().optional() });

function checkShape(v: z.output<typeof GoalFields>): void {
  if ((v.kind === "custom") !== (v.target === null)) throw new ValidationError(v.kind === "custom" ? "a custom goal has no number to track" : "a measured goal needs a target", { kind: v.kind });
  if (v.kind === "revenue_month" && !v.currency) throw new ValidationError("a revenue goal names its currency", { kind: v.kind });
}

const scoped = (businessId: string, id: string) => and(eq(goals.businessId, businessId), eq(goals.id, id));

export const goalsRepo = {
  /** One goal decision per business at a time (transaction-scoped advisory lock): take it before `current` when deciding. */
  async lock(db: Executor, businessId: string): Promise<void> {
    await db.execute(sql`select pg_advisory_xact_lock(hashtext('goals'), hashtext(${businessId}::text))`);
  },

  /** The active goal and the open proposal. */
  async current(db: Executor, businessId: string): Promise<CurrentGoals> {
    const rows = await db
      .select()
      .from(goals)
      .where(and(eq(goals.businessId, businessId), sql`${goals.status} in ('active', 'proposed')`))
      .orderBy(desc(goals.revision))
      .limit(4);
    return { active: rows.find((r) => r.status === "active") ?? null, proposed: rows.find((r) => r.status === "proposed") ?? null };
  },

  /** The latest goals, newest first (the history a screen lists; at most `limit`). */
  async recent(db: Executor, businessId: string, limit = 10): Promise<Goal[]> {
    return db.select().from(goals).where(eq(goals.businessId, businessId)).orderBy(desc(goals.revision)).limit(Math.min(Math.max(1, limit), 100));
  },

  async get(db: Executor, businessId: string, id: string): Promise<Goal | null> {
    return maybeOne(await db.select().from(goals).where(scoped(businessId, id)).limit(1));
  },

  /** The goal an Inbox decision note asks about, or null for any other note. */
  async forInboxItem(db: Executor, businessId: string, inboxItemId: string): Promise<Goal | null> {
    return maybeOne(await db.select().from(goals).where(and(eq(goals.businessId, businessId), eq(goals.inboxItemId, inboxItemId))).orderBy(desc(goals.revision)).limit(1));
  },

  /**
   * Open a proposal: the Chief of Staff's decision note (`item`) and the row, together, at the next revision. While a
   * proposal is open nothing is written and it comes back (`created: false`), so a second visit never asks twice.
   */
  async propose(db: Executor, businessId: string, input: ProposeGoalInput): Promise<{ goal: Goal; item: InboxItem | null; created: boolean }> {
    const v = parseInput(ProposeInput, input, "goal proposal");
    checkShape(v);
    const open = (await goalsRepo.current(db, businessId)).proposed;
    if (open) {
      const item = open.inboxItemId ? await inboxRepo.get(db, businessId, open.inboxItemId).catch(() => null) : null;
      return { goal: open, item, created: false };
    }
    const last = maybeOne(await db.select({ revision: goals.revision }).from(goals).where(eq(goals.businessId, businessId)).orderBy(desc(goals.revision)).limit(1));
    const item = await inboxRepo.createItem(db, businessId, { ...input.item, blocks_continue: false });
    const [goal] = await db
      .insert(goals)
      .values({
        businessId,
        revision: (last?.revision ?? 0) + 1,
        sentence: v.sentence,
        metricKind: v.kind,
        targetValue: v.target,
        currency: v.kind === "revenue_month" ? (v.currency ?? null) : null,
        startValue: v.startValue ?? null,
        dueOn: v.dueOn,
        status: "proposed",
        reason: v.reason,
        proposedByAgentId: v.agentId,
        replacesGoalId: v.replacesGoalId ?? null,
        inboxItemId: item.id,
      })
      .returning();
    return { goal: goal!, item, created: true };
  },

  /**
   * Approve a proposal: it becomes the active goal (with where the number stands now) and the previous active goal is
   * replaced, in the caller's transaction. Null when the proposal is no longer open (decided a moment ago).
   */
  async approve(db: Executor, businessId: string, id: string, input: { approvedBy: string | null; startValue?: number | null; at?: Date }): Promise<{ goal: Goal; replaced: Goal | null } | null> {
    const at = input.at ?? new Date();
    const open = maybeOne(await db.select().from(goals).where(and(scoped(businessId, id), eq(goals.status, "proposed"))).limit(1).for("update"));
    if (!open) return null;
    const [replaced] = await db
      .update(goals)
      .set({ status: "replaced", replacedAt: at })
      .where(and(eq(goals.businessId, businessId), eq(goals.status, "active")))
      .returning();
    const [goal] = await db
      .update(goals)
      .set({ status: "active", approvedBy: input.approvedBy, approvedAt: at, ...(input.startValue !== undefined ? { startValue: input.startValue } : {}) })
      .where(and(scoped(businessId, id), eq(goals.status, "proposed")))
      .returning();
    return goal ? { goal, replaced: replaced ?? null } : null;
  },

  /** Close an open proposal with the founder's words ("Change it"). Null when it is no longer open. */
  async requestChange(db: Executor, businessId: string, id: string, input: { words: string; at?: Date }): Promise<Goal | null> {
    const words = input.words.trim().slice(0, 2000);
    if (!words) throw new ValidationError("say what should change", { goalId: id });
    const rows = await db
      .update(goals)
      .set({ status: "replaced", changeRequest: words, replacedAt: input.at ?? new Date() })
      .where(and(scoped(businessId, id), eq(goals.status, "proposed")))
      .returning();
    return rows[0] ?? null;
  },

  /** Mark the active goal reached with the value it reached. Null when it is not active (reached a moment ago, or replaced). */
  async achieve(db: Executor, businessId: string, id: string, input: { value: number | null; at?: Date }): Promise<Goal | null> {
    const rows = await db
      .update(goals)
      .set({ status: "achieved", achievedAt: input.at ?? new Date(), achievedValue: input.value })
      .where(and(scoped(businessId, id), eq(goals.status, "active")))
      .returning();
    return rows[0] ?? null;
  },

  /** The demo seeds: an active goal the founder approved (a business seeded twice keeps the one it has). */
  async seedActive(db: Executor, businessId: string, input: z.input<typeof SeedActiveInput>): Promise<Goal | null> {
    const v = parseInput(SeedActiveInput, input, "seeded goal");
    checkShape(v);
    if ((await goalsRepo.current(db, businessId)).active) return null;
    const last = maybeOne(await db.select({ revision: goals.revision }).from(goals).where(eq(goals.businessId, businessId)).orderBy(desc(goals.revision)).limit(1));
    const [goal] = await db
      .insert(goals)
      .values({
        businessId,
        revision: (last?.revision ?? 0) + 1,
        sentence: v.sentence,
        metricKind: v.kind,
        targetValue: v.target,
        currency: v.kind === "revenue_month" ? (v.currency ?? null) : null,
        startValue: v.startValue ?? null,
        dueOn: v.dueOn,
        status: "active",
        reason: "first",
        proposedByAgentId: v.agentId ?? null,
        approvedBy: v.approvedBy ?? null,
        approvedAt: v.approvedAt,
        createdAt: v.approvedAt,
      })
      .onConflictDoNothing()
      .returning();
    return goal ?? null;
  },
};
