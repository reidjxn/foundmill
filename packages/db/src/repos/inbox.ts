/**
 * inbox_items, decisions, composer_buffer — the Inbox (BUILD §11.3; routers inbox.list/get/refresh/decide/markRead/archive).
 *
 * `createItem` accepts the Composer output shape verbatim (snake_case, BUILD §11.3 "Composer output schema"),
 * validates it with Zod and checks that every referenced agent, event and entity belongs to the business,
 * so a note can never carry an id from another club.
 */
import { EXHIBIT_KINDS, INBOX_ITEM_TYPES, INBOX_STATES, ValidationError, type InboxItemType, type InboxState } from "@foundmill/shared";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { agents, composerBuffer, DECIDED_BY_KINDS, decisions, entities, events, inboxItems, type ComposerBufferRow, type Decision, type InboxItem } from "../schema";
import { Currency, Id, MinorAmount, one, PageInput, parseInput, timeKeyset, toPage, type Executor, type Page } from "./_shared";

// --- Composer output schema (BUILD §11.3) ------------------------------------------------------------------------------

export const ComposerOption = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
  recommended: z.boolean(),
  consequence: z.string(),
  cost_minor: z.number().int().nonnegative(),
  reversible: z.boolean(),
});

export const ComposerStatusMetric = z.object({ metric: z.string().min(1), source: z.string().min(1) });

export const ComposerDecision = z
  .object({
    options: z.array(ComposerOption).min(2).max(4),
    free_text: z.boolean(),
    expires_at: z.string().nullable(),
  })
  .refine((d) => d.options.filter((o) => o.recommended).length === 1, { message: "exactly one option must be recommended", path: ["options"] })
  .refine((d) => new Set(d.options.map((o) => o.id)).size === d.options.length, { message: "option ids must be unique", path: ["options"] });

export const ComposerItem = z
  .object({
    type: z.enum(INBOX_ITEM_TYPES),
    from_agent_id: Id.nullable(),
    subject: z.string().min(1).max(80),
    body_md: z.string().min(1),
    status_strip: z.array(ComposerStatusMetric).max(4).default([]),
    exhibit: z.object({ kind: z.enum(EXHIBIT_KINDS), spec_ref: z.string().nullable() }).default({ kind: "none", spec_ref: null }),
    decision: ComposerDecision.nullable().default(null),
    blocks_continue: z.boolean().default(false),
    source_event_ids: z.array(Id).default([]),
    entity_ids: z.array(Id).default([]),
  })
  .refine((v) => v.exhibit.kind === "none" || v.exhibit.spec_ref !== null, { message: "an exhibit other than 'none' must reference a named query", path: ["exhibit", "spec_ref"] })
  .refine((v) => v.type !== "decision" || v.decision !== null, { message: "a decision item carries a decision block", path: ["decision"] })
  .refine((v) => v.type === "human_message" || v.from_agent_id !== null, { message: "agent-authored items name the agent", path: ["from_agent_id"] });
export type ComposerItem = z.input<typeof ComposerItem>;

export const CreateItemOptions = z.object({
  fromUserId: Id.nullable().optional(),
  costMinor: MinorAmount.default(0),
  currency: Currency.optional(),
  state: z.enum(INBOX_STATES).default("unread"),
});
export type CreateItemOptions = z.input<typeof CreateItemOptions>;

/** Tabs of the Inbox list (BUILD §11.3 layout). */
export const INBOX_TABS = ["all", "respond", "customers", "updates", "messages", "archive"] as const;
export type InboxTab = (typeof INBOX_TABS)[number];

/** Types that ask the founder for something; they sit in Respond until answered. */
export const RESPOND_TYPES: readonly InboxItemType[] = ["decision", "customer_won", "warning"];

function tabCondition(tab: InboxTab) {
  switch (tab) {
    case "all":
      return sql`${inboxItems.state} <> 'archived'`;
    case "respond":
      return and(inArray(inboxItems.state, ["unread", "read"]), or(eq(inboxItems.blocksContinue, true), inArray(inboxItems.type, [...RESPOND_TYPES])));
    case "customers":
      return and(sql`${inboxItems.state} <> 'archived'`, eq(inboxItems.type, "customer_won"));
    case "updates":
      return and(sql`${inboxItems.state} <> 'archived'`, inArray(inboxItems.type, ["update", "milestone", "report"]));
    case "messages":
      return and(sql`${inboxItems.state} <> 'archived'`, eq(inboxItems.type, "human_message"));
    case "archive":
      return eq(inboxItems.state, "archived");
  }
}

export const InboxListFilter = PageInput.extend({
  tab: z.enum(INBOX_TABS).default("all"),
  state: z.union([z.enum(INBOX_STATES), z.array(z.enum(INBOX_STATES))]).optional(),
  type: z.union([z.enum(INBOX_ITEM_TYPES), z.array(z.enum(INBOX_ITEM_TYPES))]).optional(),
  fromAgentId: Id.optional(),
  blocking: z.boolean().optional(),
});
export type InboxListFilter = z.input<typeof InboxListFilter>;

export const DecideInput = z
  .object({
    chosenOption: z.string().max(40).nullable().optional(),
    freeText: z.string().max(4000).nullable().optional(),
    decidedByKind: z.enum(DECIDED_BY_KINDS).default("user"),
    decidedBy: Id.nullable().optional(),
    planId: Id.nullable().optional(),
  })
  .refine((v) => Boolean(v.chosenOption) || Boolean(v.freeText), { message: "a decision chooses an option or gives free text" });
export type DecideInput = z.input<typeof DecideInput>;

export const BufferCandidateInput = z.object({
  candidate: ComposerItem,
  sourceHash: z.string().min(1).max(200),
  priority: z.number().int().default(0),
});
export type BufferCandidateInput = z.input<typeof BufferCandidateInput>;

const scoped = (businessId: string, itemId: string) => and(eq(inboxItems.businessId, businessId), eq(inboxItems.id, itemId));
const toArray = <T>(v: T | T[] | undefined): T[] | undefined => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);

async function assertOwnedIds(db: Executor, businessId: string, v: z.output<typeof ComposerItem>): Promise<void> {
  if (v.from_agent_id) {
    const a = await db.select({ id: agents.id }).from(agents).where(and(eq(agents.businessId, businessId), eq(agents.id, v.from_agent_id))).limit(1);
    if (a.length === 0) throw new ValidationError("from_agent_id is not an agent of this business", { from_agent_id: v.from_agent_id });
  }
  if (v.source_event_ids.length) {
    const found = await db.select({ id: events.id }).from(events).where(and(eq(events.businessId, businessId), inArray(events.id, v.source_event_ids)));
    if (found.length !== new Set(v.source_event_ids).size) throw new ValidationError("source_event_ids must be events of this business", { source_event_ids: v.source_event_ids });
  }
  if (v.entity_ids.length) {
    const found = await db.select({ id: entities.id }).from(entities).where(and(eq(entities.businessId, businessId), inArray(entities.id, v.entity_ids)));
    if (found.length !== new Set(v.entity_ids).size) throw new ValidationError("entity_ids must be entities of this business", { entity_ids: v.entity_ids });
  }
}

export const inboxRepo = {
  async list(db: Executor, businessId: string, filter: InboxListFilter = {}): Promise<Page<InboxItem>> {
    const f = parseInput(InboxListFilter, filter, "inbox filter");
    const ks = timeKeyset<InboxItem>(inboxItems.createdAt, inboxItems.id, (r) => ({ at: r.createdAt, id: r.id }));
    const states = toArray(f.state);
    const types = toArray(f.type);
    const rows = await db
      .select()
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.businessId, businessId),
          isNull(inboxItems.archivedAt),
          tabCondition(f.tab),
          states?.length ? inArray(inboxItems.state, states) : undefined,
          types?.length ? inArray(inboxItems.type, types) : undefined,
          f.fromAgentId ? eq(inboxItems.fromAgentId, f.fromAgentId) : undefined,
          f.blocking === undefined ? undefined : eq(inboxItems.blocksContinue, f.blocking),
          ks.after(f.cursor),
        ),
      )
      .orderBy(...ks.orderBy)
      .limit(f.limit + 1);
    return toPage(rows, f, ks);
  },

  async get(db: Executor, businessId: string, itemId: string): Promise<InboxItem> {
    return one(await db.select().from(inboxItems).where(scoped(businessId, itemId)).limit(1), "inbox item", itemId);
  },

  /** Items that block Continue and are still unanswered (AC-11.3.3: the button reads "Respond · N"). */
  async countBlocking(db: Executor, businessId: string): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(inboxItems)
      .where(and(eq(inboxItems.businessId, businessId), eq(inboxItems.blocksContinue, true), inArray(inboxItems.state, ["unread", "read"]), isNull(inboxItems.archivedAt)));
    return Number(rows[0]?.n ?? 0);
  },

  async countByTab(db: Executor, businessId: string): Promise<Record<InboxTab, number>> {
    const out = {} as Record<InboxTab, number>;
    for (const tab of INBOX_TABS) {
      const rows = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(inboxItems)
        .where(and(eq(inboxItems.businessId, businessId), isNull(inboxItems.archivedAt), tabCondition(tab)));
      out[tab] = Number(rows[0]?.n ?? 0);
    }
    return out;
  },

  /** Persists one Composer note. Validates the §11.3 shape and that every referenced id belongs to the business. */
  async createItem(db: Executor, businessId: string, item: ComposerItem, options: CreateItemOptions = {}): Promise<InboxItem> {
    const v = parseInput(ComposerItem, item, "composer item");
    const o = parseInput(CreateItemOptions, options, "inbox item options");
    await assertOwnedIds(db, businessId, v);
    return one(
      await db
        .insert(inboxItems)
        .values({
          businessId,
          type: v.type,
          fromAgentId: v.from_agent_id,
          fromUserId: o.fromUserId ?? null,
          subject: v.subject,
          bodyMd: v.body_md,
          statusStrip: v.status_strip,
          exhibit: v.exhibit,
          decision: v.decision,
          blocksContinue: v.blocks_continue,
          sourceEventIds: v.source_event_ids,
          entityIds: v.entity_ids,
          state: o.state,
          costMinor: o.costMinor,
          ...(o.currency ? { currency: o.currency } : {}),
        })
        .returning(),
      "inbox item",
    );
  },

  /** A human-to-human (or human-to-agent) message in the Messages tab. */
  async createHumanMessage(db: Executor, businessId: string, input: { fromUserId: string; subject: string; bodyMd: string; entityIds?: string[] }): Promise<InboxItem> {
    const v = parseInput(z.object({ fromUserId: Id, subject: z.string().min(1).max(80), bodyMd: z.string().min(1), entityIds: z.array(Id).default([]) }), input, "human message");
    return inboxRepo.createItem(db, businessId, { type: "human_message", from_agent_id: null, subject: v.subject, body_md: v.bodyMd, entity_ids: v.entityIds }, { fromUserId: v.fromUserId });
  },

  async markRead(db: Executor, businessId: string, itemId: string): Promise<InboxItem> {
    return one(await db.update(inboxItems).set({ state: "read" }).where(and(scoped(businessId, itemId), eq(inboxItems.state, "unread"))).returning().then((rows) => (rows.length ? rows : db.select().from(inboxItems).where(scoped(businessId, itemId)))), "inbox item", itemId);
  },

  async archive(db: Executor, businessId: string, itemId: string): Promise<InboxItem> {
    return one(await db.update(inboxItems).set({ state: "archived" }).where(scoped(businessId, itemId)).returning(), "inbox item", itemId);
  },

  /**
   * Records the founder's (or the Chief of Staff's, on holiday) answer: inserts the decision row, marks the item
   * answered and, when the item blocked Continue, releases it — all in one transaction. A chosen option must be
   * one of the item's options.
   */
  async decide(db: Executor, businessId: string, itemId: string, input: DecideInput): Promise<{ item: InboxItem; decision: Decision }> {
    const v = parseInput(DecideInput, input, "decision");
    return db.transaction(async (tx) => {
      const item = await inboxRepo.get(tx, businessId, itemId);
      if (item.state === "answered" || item.state === "archived") throw new ValidationError(`Inbox item is already ${item.state}`, { itemId });
      if (v.chosenOption) {
        const options = ((item.decision as { options?: { id: string }[] } | null)?.options ?? []).map((o) => o.id);
        if (!options.includes(v.chosenOption)) throw new ValidationError("chosenOption is not one of the item's options", { chosenOption: v.chosenOption, options });
      }
      const decision = one(
        await tx
          .insert(decisions)
          .values({ businessId, inboxItemId: itemId, chosenOption: v.chosenOption ?? null, freeText: v.freeText ?? null, decidedByKind: v.decidedByKind, decidedBy: v.decidedBy ?? null, planId: v.planId ?? null })
          .returning(),
        "decision",
      );
      const updated = one(await tx.update(inboxItems).set({ state: "answered", blocksContinue: false }).where(scoped(businessId, itemId)).returning(), "inbox item", itemId);
      return { item: updated, decision };
    });
  },

  async decisionsFor(db: Executor, businessId: string, itemId: string): Promise<Decision[]> {
    return db.select().from(decisions).where(and(eq(decisions.businessId, businessId), eq(decisions.inboxItemId, itemId))).orderBy(desc(decisions.decidedAt));
  },

  async linkDecisionPlan(db: Executor, businessId: string, decisionId: string, planId: string): Promise<Decision> {
    return one(await db.update(decisions).set({ planId }).where(and(eq(decisions.businessId, businessId), eq(decisions.id, decisionId))).returning(), "decision", decisionId);
  },

  // composer buffer (BUILD §11.3 Refresh: 3 pre-written candidates, invalidated on source change) -----------------
  async bufferList(db: Executor, businessId: string): Promise<ComposerBufferRow[]> {
    return db
      .select()
      .from(composerBuffer)
      .where(and(eq(composerBuffer.businessId, businessId), eq(composerBuffer.valid, true), isNull(composerBuffer.consumedAt)))
      .orderBy(desc(composerBuffer.priority), asc(composerBuffer.createdAt));
  },

  /** Adds a candidate (validated as a Composer item); the same source hash replaces the earlier candidate. */
  async bufferPush(db: Executor, businessId: string, input: BufferCandidateInput): Promise<ComposerBufferRow> {
    const v = parseInput(BufferCandidateInput, input, "buffer candidate");
    return one(
      await db
        .insert(composerBuffer)
        .values({ businessId, candidate: v.candidate as Record<string, unknown>, sourceHash: v.sourceHash, priority: v.priority, valid: true })
        .onConflictDoUpdate({
          target: [composerBuffer.businessId, composerBuffer.sourceHash],
          set: { candidate: v.candidate as Record<string, unknown>, priority: v.priority, valid: true, consumedAt: null },
        })
        .returning(),
      "buffer candidate",
    );
  },

  /** Pops the highest-priority valid candidate (marks it consumed); null when the buffer is empty. */
  async bufferConsume(db: Executor, businessId: string): Promise<ComposerBufferRow | null> {
    return db.transaction(async (tx) => {
      const [next] = await inboxRepo.bufferList(tx, businessId);
      if (!next) return null;
      const rows = await tx
        .update(composerBuffer)
        .set({ consumedAt: new Date() })
        .where(and(eq(composerBuffer.businessId, businessId), eq(composerBuffer.id, next.id), isNull(composerBuffer.consumedAt)))
        .returning();
      return rows[0] ?? null;
    });
  },

  /** Invalidates every unconsumed candidate (a source changed). Returns the number invalidated. */
  async bufferInvalidate(db: Executor, businessId: string): Promise<number> {
    const rows = await db
      .update(composerBuffer)
      .set({ valid: false })
      .where(and(eq(composerBuffer.businessId, businessId), eq(composerBuffer.valid, true), isNull(composerBuffer.consumedAt)))
      .returning({ id: composerBuffer.id });
    return rows.length;
  },
};

export type { InboxState };
