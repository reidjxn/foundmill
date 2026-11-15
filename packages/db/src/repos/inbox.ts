/**
 * inbox_items, decisions, composer_buffer — the Inbox (BUILD §11.3; routers inbox.list/get/refresh/decide/markRead/archive).
 *
 * `createItem` accepts the Composer output shape verbatim (snake_case, BUILD §11.3 "Composer output schema"),
 * validates it with Zod and checks that every referenced agent, event and entity belongs to the business,
 * so a note can never carry an id from another business. Every note an agent or the product writes is stored in the
 * business's own words (Settings › Glossary, AC-11.13.6): `applyGlossary` runs on its subject, body and decision
 * options here, the one place every composed and templated note passes through.
 */
import { ENTITY_MARKUP_RE, EXHIBIT_KINDS, INBOX_ITEM_TYPES, INBOX_STATES, OptionAction, ValidationError, applyGlossary, type InboxItemType, type InboxState } from "@foundmill/shared";
import { and, asc, desc, eq, getTableColumns, inArray, isNotNull, isNull, notInArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { agents, businesses, composerBuffer, DECIDED_BY_KINDS, decisions, entities, events, inboxItemReads, inboxItems, memberships, plans, tasks, type ComposerBufferRow, type Decision, type InboxItem } from "../schema";
import { Currency, Id, MinorAmount, one, PageInput, parseInput, timeKeyset, toPage, type Executor, type Page } from "./_shared";

// --- Composer output schema (BUILD §11.3) ------------------------------------------------------------------------------

export const ComposerOption = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
  recommended: z.boolean(),
  consequence: z.string(),
  cost_minor: z.number().int().nonnegative(),
  reversible: z.boolean(),
  /**
   * Why this option is recommended, or why it is on the list, in the agent's words ("Recommended because it is free and
   * reversible."; UX plan §7.19). One sentence; the DecisionBar shows it under the consequence.
   */
  because: z.string().max(400).optional(),
  /** What choosing it runs, written with the option (the Board's and the Import report's options; audit IAE-20). */
  actions: z.array(OptionAction).min(1).max(8).optional(),
});

export const ComposerStatusMetric = z.object({ metric: z.string().min(1), source: z.string().min(1) });

export const ComposerDecision = z
  .object({
    options: z.array(ComposerOption).min(2).max(4),
    free_text: z.boolean(),
    /** A deadline: an ISO timestamp in the future, or null (the composer validates what the model writes; audit CML-13). */
    expires_at: z.string().nullable(),
    /**
     * What a grounded next-best decision is about (its kind and facts, never the rotation), so Refresh does not write the
     * same open decision twice (audit CML-02). Set by the composer service; absent on every other note.
     */
    key: z.string().min(1).max(200).optional(),
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

type ParsedComposerItem = z.output<typeof ComposerItem>;

/** The business's glossary (empty when it has none). */
async function businessGlossary(db: Executor, businessId: string): Promise<Record<string, string>> {
  const rows = await db.select({ glossary: businesses.glossary }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  return rows[0]?.glossary ?? {};
}

/** A rename never breaks the shape's limits: a longer word trims the text at the limit with an ellipsis. */
const clampText = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** `[[ent:<uuid>|Name]]` → `Name`: an option's label and "because" are plain lines, never linked. */
const withoutEntityMarkup = (text: string) => text.replace(new RegExp(ENTITY_MARKUP_RE.source, "g"), "$2");

/**
 * The decision options' plain lines, before validation: entity markup reduced to its name and the label (120) and
 * "because" (400) clamped to the stored shape's limits. A model writes these, and neither composer path bounds them,
 * so a 450-character "because" would otherwise fail the whole note (review F36). An empty "because" is dropped. Anything
 * that is not an option of the expected shape is left for the schema to refuse.
 */
export function withPlainOptionLines(item: ComposerItem): ComposerItem {
  const decision = item.decision;
  if (!decision || !Array.isArray(decision.options)) return item;
  const options = decision.options.map((o) => {
    if (!o || typeof o !== "object") return o;
    const next = { ...o };
    if (typeof o.label === "string") next.label = clampText(withoutEntityMarkup(o.label), 120);
    if (typeof o.because === "string") {
      const because = withoutEntityMarkup(o.because).replace(/\s+/g, " ").trim();
      if (because) next.because = clampText(because, 400);
      else delete next.because;
    }
    return next;
  });
  return { ...item, decision: { ...decision, options } };
}

/** The note in the business's own words: subject, body and decision options (ids, costs and flags unchanged). */
export function inBusinessWords(v: ParsedComposerItem, glossary: Record<string, string>): ParsedComposerItem {
  const g = (text: string) => applyGlossary(text, glossary);
  return {
    ...v,
    subject: clampText(g(v.subject), 80),
    body_md: g(v.body_md),
    decision: v.decision
      ? {
          ...v.decision,
          options: v.decision.options.map((opt) => ({
            ...opt,
            label: clampText(g(opt.label), 120),
            consequence: g(opt.consequence),
            ...(opt.because !== undefined ? { because: clampText(g(opt.because), 400) } : {}),
          })),
        }
      : null,
  };
}

/** Tabs of the Inbox list (BUILD §11.3 layout). */
export const INBOX_TABS = ["all", "respond", "customers", "updates", "messages", "archive"] as const;
export type InboxTab = (typeof INBOX_TABS)[number];

/**
 * Types that ask the founder for something; they sit in Respond (shown as "Needs you") until answered. A warning sits
 * there only when it carries a decision or holds Continue (a hard stop): fifteen "no action needed" warnings in Respond
 * trained the founder to ignore the tab (Nov 1, 2026), so the rest read as updates. A customer win is good news, not a
 * question: it has its own Customers tab and left Respond on Nov 7, 2026.
 */
export const RESPOND_TYPES: readonly InboxItemType[] = ["decision"];

/**
 * Only a hard stop holds Continue (0071, founder, Nov 7, 2026): a warning the team cannot work past until the founder
 * acts (credits used up, a revoked key). A decision waits for its answer without stopping the team, since the work that
 * needs it is held on its own; a customer win never holds anything.
 */
export function holdsContinue(type: InboxItemType, requested: boolean): boolean {
  return requested && type === "warning";
}

/** The task ids an event names (`taskId`, `blockedByTaskId`, `taskIds`), for closing the notes it sourced. */
function noteTaskIds(payload: unknown): string[] {
  const p = (payload ?? {}) as { taskId?: unknown; blockedByTaskId?: unknown; taskIds?: unknown };
  const ids = [p.taskId, p.blockedByTaskId, ...(Array.isArray(p.taskIds) ? p.taskIds : [])];
  return ids.filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id));
}

/**
 * The item's plan waits for the founder's go-ahead ("Here is what will happen", `plan.confirm`): it was answered, so
 * Continue is free, but it still asks for something, so it stays in Respond until the plan is confirmed (audit OL-01).
 */
const awaitingConfirmation = sql`exists (select 1 from ${plans} where ${plans.businessId} = ${inboxItems.businessId} and ${plans.inboxItemId} = ${inboxItems.id} and ${plans.status} = 'pending_confirmation' and ${plans.archivedAt} is null)`;

/**
 * A note's state as this person sees it (0048): `unread` becomes `read` once they have a receipt for it; answered,
 * archived and a state the system wrote as `read` are the same for everyone. No viewer: the stored state.
 */
function stateFor(viewerId?: string | null): SQL<InboxState> {
  if (!viewerId) return sql<InboxState>`"inbox_items"."state"`;
  // Qualified by hand: a single-table select strips the table from the columns of its SQL fields, and the bare `id` would
  // then be the receipt's own.
  return sql<InboxState>`case when "inbox_items"."state" = 'unread' and exists (select 1 from "inbox_item_reads" "r" where "r"."inbox_item_id" = "inbox_items"."id" and "r"."user_id" = ${viewerId}::uuid) then 'read' else "inbox_items"."state" end`;
}

/**
 * Whose notes a read may see (0103 `for_user_id`): with a viewer, the notes for everyone and the viewer's own; without
 * one (the orchestrator, the composer, the push notifier on the privileged connection, which RLS does not narrow), the
 * notes for everyone only. A founder's own showcase ask is never read for, or shown to, anyone else.
 */
export function inboxAudience(viewerId?: string | null) {
  return viewerId ? or(isNull(inboxItems.forUserId), eq(inboxItems.forUserId, viewerId)) : isNull(inboxItems.forUserId);
}

function tabCondition(tab: InboxTab) {
  switch (tab) {
    case "all":
      return sql`${inboxItems.state} <> 'archived'`;
    case "respond":
      return or(
        and(inArray(inboxItems.state, ["unread", "read"]), or(eq(inboxItems.blocksContinue, true), inArray(inboxItems.type, [...RESPOND_TYPES]), and(eq(inboxItems.type, "warning"), isNotNull(inboxItems.decision)))),
        and(eq(inboxItems.state, "answered"), awaitingConfirmation),
      );
    case "customers":
      return and(sql`${inboxItems.state} <> 'archived'`, eq(inboxItems.type, "customer_won"));
    case "updates":
      // A warning with nothing to decide and nothing holding Continue is news, not a request.
      return and(sql`${inboxItems.state} <> 'archived'`, or(inArray(inboxItems.type, ["update", "milestone", "report"]), and(eq(inboxItems.type, "warning"), isNull(inboxItems.decision), eq(inboxItems.blocksContinue, false))));
    case "messages":
      return and(sql`${inboxItems.state} <> 'archived'`, eq(inboxItems.type, "human_message"));
    case "archive":
      return eq(inboxItems.state, "archived");
  }
}

export const InboxListFilter = PageInput.extend({
  tab: z.enum(INBOX_TABS).default("all"),
  state: z.union([z.enum(INBOX_STATES), z.array(z.enum(INBOX_STATES)).max(INBOX_STATES.length)]).optional(),
  type: z.union([z.enum(INBOX_ITEM_TYPES), z.array(z.enum(INBOX_ITEM_TYPES)).max(INBOX_ITEM_TYPES.length)]).optional(),
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
  /**
   * `viewerId` is who is looking: with it, `state` reads `read` for a note that person has opened (their receipt, 0048)
   * and `unread` for one they have not, whatever others did; the `state` filter follows. Without it (the composer, the
   * orchestrator) the stored state is used as it is.
   */
  async list(db: Executor, businessId: string, filter: InboxListFilter = {}, viewerId?: string | null): Promise<Page<InboxItem>> {
    const f = parseInput(InboxListFilter, filter, "inbox filter");
    const state = stateFor(viewerId);
    const ks = timeKeyset<InboxItem>(inboxItems.createdAt, inboxItems.id, (r) => ({ at: r.createdAt, id: r.id }));
    const states = toArray(f.state);
    const types = toArray(f.type);
    const rows = await db
      .select({ ...getTableColumns(inboxItems), state })
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.businessId, businessId),
          isNull(inboxItems.archivedAt),
          inboxAudience(viewerId),
          tabCondition(f.tab),
          states?.length ? inArray(state, states) : undefined,
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

  /** One note; with `viewerId` its `state` is that person's (see `list`). */
  async get(db: Executor, businessId: string, itemId: string, viewerId?: string | null): Promise<InboxItem> {
    return one(await db.select({ ...getTableColumns(inboxItems), state: stateFor(viewerId) }).from(inboxItems).where(scoped(businessId, itemId)).limit(1), "inbox item", itemId);
  },

  /** Several items in one query (ids of another business, or of nothing, are left out). */
  async byIds(db: Executor, businessId: string, itemIds: readonly string[]): Promise<InboxItem[]> {
    if (itemIds.length === 0) return [];
    return db.select().from(inboxItems).where(and(eq(inboxItems.businessId, businessId), inArray(inboxItems.id, [...itemIds])));
  },

  /** Items that block Continue and are still unanswered (AC-11.3.3: the button reads "Respond · N"). */
  async countBlocking(db: Executor, businessId: string): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(inboxItems)
      .where(and(eq(inboxItems.businessId, businessId), eq(inboxItems.blocksContinue, true), inArray(inboxItems.state, ["unread", "read"]), isNull(inboxItems.archivedAt), isNull(inboxItems.forUserId)));
    return Number(rows[0]?.n ?? 0);
  },

  /** Items per tab, in one statement (a `count(*) filter (where …)` per tab) rather than one query per tab. */
  async countByTab(db: Executor, businessId: string, viewerId?: string | null): Promise<Record<InboxTab, number>> {
    const counts = Object.fromEntries(INBOX_TABS.map((tab) => [tab, sql<number>`count(*) filter (where ${tabCondition(tab) ?? sql`true`})::int`]));
    const rows = await db.select(counts).from(inboxItems).where(and(eq(inboxItems.businessId, businessId), isNull(inboxItems.archivedAt), inboxAudience(viewerId)));
    const row: Record<string, unknown> = rows[0] ?? {};
    return Object.fromEntries(INBOX_TABS.map((tab) => [tab, Number(row[tab] ?? 0)])) as Record<InboxTab, number>;
  },

  /**
   * Persists one Composer note. Validates the §11.3 shape and that every referenced id belongs to the business, then
   * renames nouns with the business glossary (a person's own message is theirs and is stored as written).
   */
  async createItem(db: Executor, businessId: string, item: ComposerItem, options: CreateItemOptions = {}): Promise<InboxItem> {
    const parsed = parseInput(ComposerItem, withPlainOptionLines(item), "composer item");
    const o = parseInput(CreateItemOptions, options, "inbox item options");
    await assertOwnedIds(db, businessId, parsed);
    const v = parsed.type === "human_message" ? parsed : inBusinessWords(parsed, await businessGlossary(db, businessId));
    const created = one(
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
          blocksContinue: holdsContinue(v.type, v.blocks_continue),
          sourceEventIds: v.source_event_ids,
          entityIds: v.entity_ids,
          state: o.state,
          costMinor: o.costMinor,
          ...(o.currency ? { currency: o.currency } : {}),
        })
        .returning(),
      "inbox item",
    );
    // One current update per agent: the newer replaces the older open ones (Nov 7, 2026).
    if (created.type === "update" && created.fromAgentId && created.decision === null && created.state !== "archived") await inboxRepo.supersedeUpdates(db, businessId, { fromAgentId: created.fromAgentId, keepId: created.id });
    return created;
  },

  /** A human-to-human (or human-to-agent) message in the Messages tab. */
  async createHumanMessage(db: Executor, businessId: string, input: { fromUserId: string; subject: string; bodyMd: string; entityIds?: string[] }): Promise<InboxItem> {
    const v = parseInput(z.object({ fromUserId: Id, subject: z.string().min(1).max(80), bodyMd: z.string().min(1), entityIds: z.array(Id).default([]) }), input, "human message");
    return inboxRepo.createItem(db, businessId, { type: "human_message", from_agent_id: null, subject: v.subject, body_md: v.bodyMd, entity_ids: v.entityIds }, { fromUserId: v.fromUserId });
  },

  /**
   * `userId` opened the note: their receipt (0048), and nobody else's markers move. Any member keeps their own, the
   * viewers and advisors the Inbox policy keeps from writing notes included. Without a `userId` the system read it for
   * the whole business (the Chief of Staff deciding a win on vacation): the stored state becomes `read`.
   */
  /**
   * True once a founder opened a note an agent wrote: the first-week checklist's "read a note from an agent"
   * (docs/UX_AUDIT_AND_PLAN.md §6.2). Only a read receipt (0048) by an owner, a cofounder or an admin of the business counts, never an
   * example viewer's. A note's state does not: a sign-off approved from the Product tab answers its note unopened, and
   * the Chief of Staff reads and answers notes on vacation (review F38). One id at most is loaded.
   */
  async anyAgentNoteOpened(db: Executor, businessId: string): Promise<boolean> {
    const openedByFounder = sql`exists (select 1 from ${inboxItemReads} join ${memberships} on ${memberships.businessId} = ${inboxItemReads.businessId} and ${memberships.userId} = ${inboxItemReads.userId} where ${inboxItemReads.inboxItemId} = ${inboxItems.id} and ${memberships.role} in ('owner', 'cofounder', 'admin') and ${memberships.source} <> 'example')`;
    const rows = await db
      .select({ id: inboxItems.id })
      .from(inboxItems)
      .where(and(eq(inboxItems.businessId, businessId), isNotNull(inboxItems.fromAgentId), openedByFounder))
      .limit(1);
    return rows.length > 0;
  },

  /**
   * Revises a note in place (the Chief of Staff updating a warning about a problem it already told the founder about):
   * the replacement's subject, body, decision and flags (validated and in the business's words like a new note), its
   * source events and entities appended, and the note unread again so it surfaces once more as one item, never a second
   * copy. Only an open note (unread or read) is revised, and it keeps its type.
   */
  async revise(db: Executor, businessId: string, itemId: string, replacement: ComposerItem): Promise<InboxItem> {
    const item = await inboxRepo.get(db, businessId, itemId);
    if (item.state !== "unread" && item.state !== "read") throw new ValidationError("Only an open note can be revised", { itemId, state: item.state });
    const parsed = parseInput(ComposerItem, withPlainOptionLines(replacement), "composer item");
    if (parsed.type !== item.type) throw new ValidationError("A note keeps its type when revised", { itemId, type: item.type, replacement: parsed.type });
    await assertOwnedIds(db, businessId, parsed);
    const v = inBusinessWords(parsed, await businessGlossary(db, businessId));
    const sourceEventIds = [...new Set([...item.sourceEventIds, ...v.source_event_ids])];
    const entityIds = [...new Set([...item.entityIds, ...v.entity_ids])];
    const updated = one(
      await db
        .update(inboxItems)
        .set({ subject: v.subject, bodyMd: v.body_md, statusStrip: v.status_strip, exhibit: v.exhibit, decision: v.decision, blocksContinue: holdsContinue(item.type, v.blocks_continue), sourceEventIds, entityIds, state: "unread", updatedAt: new Date() })
        .where(scoped(businessId, itemId))
        .returning(),
      "inbox item",
      itemId,
    );
    // Everyone reads it afresh: the receipts of the earlier version no longer count.
    await db.delete(inboxItemReads).where(and(eq(inboxItemReads.businessId, businessId), eq(inboxItemReads.inboxItemId, itemId)));
    return updated;
  },

  async markRead(db: Executor, businessId: string, itemId: string, userId?: string | null): Promise<InboxItem> {
    const item = await inboxRepo.get(db, businessId, itemId);
    if (item.state !== "unread") return inboxRepo.get(db, businessId, itemId, userId);
    if (!userId) {
      await db.update(inboxItems).set({ state: "read" }).where(and(scoped(businessId, itemId), eq(inboxItems.state, "unread")));
      return inboxRepo.get(db, businessId, itemId);
    }
    await db.insert(inboxItemReads).values({ businessId, inboxItemId: itemId, userId }).onConflictDoNothing();
    return inboxRepo.get(db, businessId, itemId, userId);
  },

  /**
   * Moves a note to the Archive. A decision that blocks Continue and still waits for its answer cannot be archived
   * (BUILD §11.3: Continue stays blocked until red items are answered): archiving it would clear the gate with nobody
   * having decided and could never be undone. Answered notes, and blocking notes that offer nothing to choose (a
   * warning), archive as before. `force` is for the system closing a note whose question was settled some other way.
   */
  async archive(db: Executor, businessId: string, itemId: string, options: { force?: boolean } = {}): Promise<InboxItem> {
    const item = await inboxRepo.get(db, businessId, itemId);
    const choices = (item.decision as { options?: unknown[] } | null)?.options;
    // `force`: the system closing a request that was settled some other way (an expired approval), not the founder.
    // A question waits for its answer: an open decision with options (or a hard stop) is never archived by hand, whether or
    // not it holds Continue (since Nov 7, 2026 a decision no longer does).
    if (!options.force && (item.blocksContinue || item.type === "decision") && (item.state === "unread" || item.state === "read") && Array.isArray(choices) && choices.length > 0) {
      throw new ValidationError("This decision is waiting for your answer. Choose an option or write what to do; it can be archived once it is answered.", { itemId, state: item.state });
    }
    return one(await db.update(inboxItems).set({ state: "archived" }).where(scoped(businessId, itemId)).returning(), "inbox item", itemId);
  },

  /**
   * A newer update from an agent replaces its older open ones (founder, Nov 7, 2026: "the updates I receive should be
   * much, much more simplified"): the Inbox keeps one current update per agent instead of a stream, and the older ones go
   * to Archive, where they stay readable. Only plain updates are touched: never a decision, a warning, a win, a
   * milestone or a report. Returns how many were archived.
   */
  async supersedeUpdates(db: Executor, businessId: string, input: { fromAgentId: string; keepId: string }): Promise<number> {
    const rows = await db
      .update(inboxItems)
      .set({ state: "archived", updatedAt: new Date() })
      .where(and(eq(inboxItems.businessId, businessId), eq(inboxItems.fromAgentId, input.fromAgentId), eq(inboxItems.type, "update"), isNull(inboxItems.decision), inArray(inboxItems.state, ["unread", "read"]), isNull(inboxItems.archivedAt), sql`${inboxItems.id} <> ${input.keepId}`))
      .returning({ id: inboxItems.id });
    return rows.length;
  },

  /**
   * Closes notes that only informed and are no longer current (founder, Nov 7, 2026: warnings from Oct 31 about problems
   * long fixed still sat unread): an open update, report or question-less warning is archived when every task its source
   * events name has finished, stopped or failed, or when nobody touched it for `olderThan`. A decision, a hard stop, a win
   * and a milestone are never closed here. Returns the ids archived.
   */
  async archiveSettled(db: Executor, businessId: string, input: { olderThan: Date; limit?: number }): Promise<string[]> {
    const informOnly = and(
      eq(inboxItems.businessId, businessId),
      inArray(inboxItems.state, ["unread", "read"]),
      isNull(inboxItems.archivedAt),
      eq(inboxItems.blocksContinue, false),
      or(inArray(inboxItems.type, ["update", "report"]), and(eq(inboxItems.type, "warning"), isNull(inboxItems.decision))),
    );
    const open = await db.select({ id: inboxItems.id, updatedAt: inboxItems.updatedAt, sourceEventIds: inboxItems.sourceEventIds }).from(inboxItems).where(informOnly).orderBy(asc(inboxItems.createdAt)).limit(input.limit ?? 500);
    if (open.length === 0) return [];
    const eventIds = [...new Set(open.flatMap((n) => n.sourceEventIds))];
    const sources = eventIds.length > 0 ? await db.select({ id: events.id, payload: events.payload }).from(events).where(and(eq(events.businessId, businessId), inArray(events.id, eventIds))) : [];
    const taskIdsOf = new Map(sources.map((e) => [e.id, noteTaskIds(e.payload)]));
    const allTaskIds = [...new Set([...taskIdsOf.values()].flat())];
    const live = allTaskIds.length > 0 ? await db.select({ id: tasks.id, status: tasks.status, archivedAt: tasks.archivedAt }).from(tasks).where(and(eq(tasks.businessId, businessId), inArray(tasks.id, allTaskIds))) : [];
    const settledTask = new Set(live.filter((t) => t.archivedAt !== null || t.status === "done" || t.status === "stopped" || t.status === "failed").map((t) => t.id));
    const close = open.filter((n) => {
      if (n.updatedAt < input.olderThan) return true;
      const ids = [...new Set(n.sourceEventIds.flatMap((e) => taskIdsOf.get(e) ?? []))];
      return ids.length > 0 && ids.every((id) => settledTask.has(id));
    });
    if (close.length === 0) return [];
    const rows = await db
      .update(inboxItems)
      .set({ state: "archived", updatedAt: new Date() })
      .where(and(informOnly, inArray(inboxItems.id, close.map((n) => n.id))))
      .returning({ id: inboxItems.id });
    return rows.map((r) => r.id);
  },

  /**
   * Records the founder's (or the Chief of Staff's, on holiday) answer: inserts the decision row, marks the item
   * answered and, when the item blocked Continue, releases it — all in one transaction. A chosen option must be
   * one of the item's options.
   *
   * Exactly once, even when two answers race (two tabs, two members, the DecisionBar and a conversation's "Go with"):
   * the item is marked answered by an update that only matches an open item. Under READ COMMITTED the second
   * transaction's update waits for the first's row lock, re-checks the row, finds it answered and matches nothing, so
   * the second answer (and the plan its caller wrote in the same transaction) rolls back instead of running twice.
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
      const [updated] = await tx
        .update(inboxItems)
        .set({ state: "answered", blocksContinue: false })
        .where(and(scoped(businessId, itemId), notInArray(inboxItems.state, ["answered", "archived"])))
        .returning();
      if (!updated) throw new ValidationError("Inbox item is already answered", { itemId });
      const decision = one(
        await tx
          .insert(decisions)
          .values({ businessId, inboxItemId: itemId, chosenOption: v.chosenOption ?? null, freeText: v.freeText ?? null, decidedByKind: v.decidedByKind, decidedBy: v.decidedBy ?? null, planId: v.planId ?? null })
          .returning(),
        "decision",
      );
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

  /**
   * Adds a candidate (validated as a Composer item); the same source hash replaces the earlier candidate. A candidate
   * that was already served stays served (`consumedAt` is kept): an unchanged insight is a note the founder has, and
   * reviving it served the same note, and paid for it, on every Refresh (audit CML-01). Check `consumedAt` on the row.
   */
  async bufferPush(db: Executor, businessId: string, input: BufferCandidateInput): Promise<ComposerBufferRow> {
    const v = parseInput(BufferCandidateInput, input, "buffer candidate");
    return one(
      await db
        .insert(composerBuffer)
        .values({ businessId, candidate: v.candidate as Record<string, unknown>, sourceHash: v.sourceHash, priority: v.priority, valid: true })
        .onConflictDoUpdate({
          target: [composerBuffer.businessId, composerBuffer.sourceHash],
          set: { candidate: v.candidate as Record<string, unknown>, priority: v.priority, valid: true },
        })
        .returning(),
      "buffer candidate",
    );
  },

  /** Which of these source hashes were already served (their buffer row is consumed). */
  async bufferServed(db: Executor, businessId: string, sourceHashes: readonly string[]): Promise<Set<string>> {
    if (sourceHashes.length === 0) return new Set();
    const rows = await db
      .select({ sourceHash: composerBuffer.sourceHash })
      .from(composerBuffer)
      .where(and(eq(composerBuffer.businessId, businessId), inArray(composerBuffer.sourceHash, [...new Set(sourceHashes)]), isNotNull(composerBuffer.consumedAt)));
    return new Set(rows.map((r) => r.sourceHash));
  },

  /**
   * Records a candidate written on demand (Refresh's cold path) as served under its source hash, so the background
   * refill does not write the same note again. A row already there is marked served in place.
   */
  async bufferMarkServed(db: Executor, businessId: string, input: BufferCandidateInput): Promise<ComposerBufferRow> {
    const v = parseInput(BufferCandidateInput, input, "buffer candidate");
    return one(
      await db
        .insert(composerBuffer)
        .values({ businessId, candidate: v.candidate as Record<string, unknown>, sourceHash: v.sourceHash, priority: v.priority, valid: true, consumedAt: new Date() })
        .onConflictDoUpdate({ target: [composerBuffer.businessId, composerBuffer.sourceHash], set: { consumedAt: sql`coalesce(${composerBuffer.consumedAt}, now())` } })
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
