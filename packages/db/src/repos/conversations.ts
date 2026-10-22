/**
 * agent_threads + agent_messages (0020): founder ↔ agent conversations (audit-conversation §4).
 *
 * One thread per agent and subject (an Inbox item, the agent itself, or a task). Messages are appended, never edited,
 * except `setMessagePlan`, which records the plan a hand-off was staged as. `appendMessage` bumps the thread's
 * `last_message_at` and `message_count` in the same statement batch so lists can sort threads by recency. The api runs
 * every call inside `withRls` as the signed-in member (the Inbox's access model: members write, viewers read).
 */
import { AGENT_REACTIONS, CONVERSATION_AUTHOR_KINDS, CONVERSATION_SUBJECT_KINDS, QUICK_REPLY_KINDS, uuid, ValidationError, type ConversationSubjectKind } from "@foundmill/shared";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { agentMessages, agentThreads, type AgentMessage, type AgentThread } from "../schema";
import { Id, maybeOne, one, parseInput, type Executor } from "./_shared";

export const ThreadSubject = z.object({
  agentId: Id,
  subjectKind: z.enum(CONVERSATION_SUBJECT_KINDS),
  subjectId: Id,
});
export type ThreadSubject = z.input<typeof ThreadSubject>;

/** The quick-reply contract (packages/models `QuickReply`), re-checked at the storage boundary. */
export const StoredQuickReplyInput = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,24}$/),
  label: z.string().min(2).max(36),
  say: z.string().min(1).max(280),
  kind: z.enum(QUICK_REPLY_KINDS),
  option_id: z.string().max(40).nullable().default(null),
  recommended: z.boolean().default(false),
});

export const AppendMessageInput = z
  .object({
    /** Set by a caller that needs the id before the row is written (`appendExchange` and the events that name it). */
    id: Id.optional(),
    threadId: Id,
    authorKind: z.enum(CONVERSATION_AUTHOR_KINDS),
    authorUserId: Id.nullable().optional(),
    agentId: Id.nullable().optional(),
    bubbles: z.array(z.string().trim().min(1).max(2000)).min(1).max(3),
    reaction: z.enum(AGENT_REACTIONS).default("none"),
    quickReplies: z.array(StoredQuickReplyInput).max(4).default([]),
    chosenQuickReplyId: z.string().regex(/^[a-z0-9_-]{1,24}$/).nullable().optional(),
    /** The id the founder's client gave this message (founder messages only): a repeat in the same thread is the same message (0036). */
    clientMessageId: z.string().min(1).max(100).nullable().optional(),
    handOff: z.object({ instruction: z.string().min(1).max(600), gated: z.boolean().optional() }).nullable().optional(),
    refersTo: z.array(z.string().min(1).max(120)).max(5).default([]),
    entityIds: z.array(Id).max(50).default([]),
    planId: Id.nullable().optional(),
    meta: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((m, ctx) => {
    if (m.authorKind === "founder" && (m.quickReplies.length > 0 || m.handOff)) ctx.addIssue({ code: "custom", message: "a founder message carries no quick replies and no hand-off", path: ["authorKind"] });
    if (m.authorKind === "agent" && m.clientMessageId) ctx.addIssue({ code: "custom", message: "only a founder message carries a client message id", path: ["clientMessageId"] });
    if (m.authorKind === "agent" && m.chosenQuickReplyId) ctx.addIssue({ code: "custom", message: "an agent message does not press a quick reply", path: ["chosenQuickReplyId"] });
    if (m.authorKind === "agent" && m.quickReplies.filter((q) => q.recommended).length > 1) ctx.addIssue({ code: "custom", message: "at most one recommended quick reply", path: ["quickReplies"] });
  });
export type AppendMessageInput = z.input<typeof AppendMessageInput>;

export const ListThreadsFilter = z.object({
  agentId: Id.optional(),
  subjectKind: z.enum(CONVERSATION_SUBJECT_KINDS).optional(),
  subjectId: Id.optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
export type ListThreadsFilter = z.input<typeof ListThreadsFilter>;

export const conversationsRepo = {
  /** The thread for this agent and subject, or null. */
  async findThread(db: Executor, businessId: string, subject: ThreadSubject): Promise<AgentThread | null> {
    const s = parseInput(ThreadSubject, subject, "thread subject");
    return maybeOne(
      await db
        .select()
        .from(agentThreads)
        .where(and(eq(agentThreads.businessId, businessId), eq(agentThreads.agentId, s.agentId), eq(agentThreads.subjectKind, s.subjectKind), eq(agentThreads.subjectId, s.subjectId)))
        .limit(1),
    );
  },

  async getThread(db: Executor, businessId: string, threadId: string): Promise<AgentThread> {
    return one(await db.select().from(agentThreads).where(and(eq(agentThreads.businessId, businessId), eq(agentThreads.id, threadId))).limit(1), "agent thread", threadId);
  },

  /** The thread for this agent and subject, created when it does not exist yet (concurrent callers get the same row). */
  async ensureThread(db: Executor, businessId: string, subject: ThreadSubject): Promise<AgentThread> {
    const s = parseInput(ThreadSubject, subject, "thread subject");
    await db.insert(agentThreads).values({ businessId, agentId: s.agentId, subjectKind: s.subjectKind, subjectId: s.subjectId }).onConflictDoNothing();
    const found = await conversationsRepo.findThread(db, businessId, s);
    if (!found) throw new ValidationError("Could not open the conversation thread", { subject: s });
    return found;
  },

  /** Threads, most recently active first. */
  async listThreads(db: Executor, businessId: string, filter: ListThreadsFilter = {}): Promise<AgentThread[]> {
    const f = parseInput(ListThreadsFilter, filter, "thread filter");
    const where = [eq(agentThreads.businessId, businessId)];
    if (f.agentId) where.push(eq(agentThreads.agentId, f.agentId));
    if (f.subjectKind) where.push(eq(agentThreads.subjectKind, f.subjectKind as ConversationSubjectKind));
    if (f.subjectId) where.push(eq(agentThreads.subjectId, f.subjectId));
    return db
      .select()
      .from(agentThreads)
      .where(and(...where))
      .orderBy(sql`${agentThreads.lastMessageAt} desc nulls last`, desc(agentThreads.createdAt))
      .limit(f.limit);
  },

  /** The latest `limit` messages of a thread, oldest first (what the desk renders and the model reads). */
  /** True once the founder wrote to any agent: the first-week checklist's "talk to an agent" (docs/UX_AUDIT_AND_PLAN.md §6.2). */
  async anyFounderMessage(db: Executor, businessId: string): Promise<boolean> {
    const rows = await db
      .select({ id: agentMessages.id })
      .from(agentMessages)
      .where(and(eq(agentMessages.businessId, businessId), eq(agentMessages.authorKind, "founder")))
      .limit(1);
    return rows.length > 0;
  },

  async listMessages(db: Executor, businessId: string, threadId: string, options: { limit?: number } = {}): Promise<AgentMessage[]> {
    const limit = Math.max(1, Math.min(200, options.limit ?? 50));
    const rows = await db
      .select()
      .from(agentMessages)
      .where(and(eq(agentMessages.businessId, businessId), eq(agentMessages.threadId, threadId)))
      .orderBy(desc(agentMessages.createdAt), desc(agentMessages.id))
      .limit(limit);
    return rows.reverse();
  },

  async getMessage(db: Executor, businessId: string, messageId: string): Promise<AgentMessage> {
    return one(await db.select().from(agentMessages).where(and(eq(agentMessages.businessId, businessId), eq(agentMessages.id, messageId))).limit(1), "agent message", messageId);
  },

  /**
   * The exchange a message with this client id already started in the thread: the founder's message and the agent's reply
   * that followed it (null while that reply is still being written). Null when the thread has no such message. A repeat
   * of a send whose answer was lost in transit returns this instead of posting and paying for the question twice.
   */
  async findExchange(db: Executor, businessId: string, threadId: string, clientMessageId: string): Promise<{ founder: AgentMessage; reply: AgentMessage | null } | null> {
    const founder = maybeOne(await db.select().from(agentMessages).where(and(eq(agentMessages.businessId, businessId), eq(agentMessages.threadId, threadId), eq(agentMessages.clientMessageId, clientMessageId))).limit(1));
    if (!founder) return null;
    const reply = maybeOne(
      await db
        .select()
        .from(agentMessages)
        .where(and(eq(agentMessages.businessId, businessId), eq(agentMessages.threadId, threadId), eq(agentMessages.authorKind, "agent"), gt(agentMessages.createdAt, founder.createdAt)))
        .orderBy(asc(agentMessages.createdAt), asc(agentMessages.id))
        .limit(1),
    );
    return { founder, reply };
  },

  /** The newest agent message of a thread (whose quick replies the founder can press), or null. */
  async latestAgentMessage(db: Executor, businessId: string, threadId: string): Promise<AgentMessage | null> {
    return maybeOne(
      await db
        .select()
        .from(agentMessages)
        .where(and(eq(agentMessages.businessId, businessId), eq(agentMessages.threadId, threadId), eq(agentMessages.authorKind, "agent")))
        .orderBy(desc(agentMessages.createdAt), desc(agentMessages.id))
        .limit(1),
    );
  },

  /** Append one message and bump the thread's activity. `createdAt` is set explicitly so two messages written in one transaction keep their order. */
  async appendMessage(db: Executor, businessId: string, input: AppendMessageInput, options: { at?: Date } = {}): Promise<AgentMessage> {
    const m = parseInput(AppendMessageInput, input, "conversation message");
    const thread = await conversationsRepo.getThread(db, businessId, m.threadId);
    const at = options.at ?? new Date();
    const [row] = await db
      .insert(agentMessages)
      .values({
        ...(m.id ? { id: m.id } : {}),
        businessId,
        threadId: thread.id,
        authorKind: m.authorKind,
        authorUserId: m.authorUserId ?? null,
        agentId: m.agentId ?? (m.authorKind === "agent" ? thread.agentId : null),
        bubbles: m.bubbles,
        reaction: m.reaction,
        quickReplies: m.quickReplies,
        chosenQuickReplyId: m.chosenQuickReplyId ?? null,
        clientMessageId: m.clientMessageId ?? null,
        handOff: m.handOff ?? null,
        refersTo: m.refersTo,
        entityIds: m.entityIds,
        planId: m.planId ?? null,
        meta: m.meta,
        createdAt: at,
        updatedAt: at,
      })
      .returning();
    await db
      .update(agentThreads)
      .set({ lastMessageAt: sql`greatest(coalesce(${agentThreads.lastMessageAt}, ${at.toISOString()}::timestamptz), ${at.toISOString()}::timestamptz)`, messageCount: sql`${agentThreads.messageCount} + 1` })
      .where(and(eq(agentThreads.businessId, businessId), eq(agentThreads.id, thread.id)));
    return row!;
  },

  /**
   * Several messages of one thread in one insert (the founder's message and the agent's reply), with the thread's
   * activity bumped in a statement sent alongside it, so an exchange costs one round trip instead of three per message.
   * `thread` is the row the caller read in this business; messages keep their order (`at`, then a millisecond apart).
   * Returns the rows in order and the thread as it now stands.
   */
  async appendExchange(db: Executor, businessId: string, thread: AgentThread, inputs: readonly AppendMessageInput[], options: { at?: Date } = {}): Promise<{ messages: AgentMessage[]; thread: AgentThread }> {
    const ms = inputs.map((input) => parseInput(AppendMessageInput, input, "conversation message"));
    if (ms.length === 0) return { messages: [], thread };
    if (ms.some((m) => m.threadId !== thread.id)) throw new ValidationError("Every message of an exchange belongs to its thread", { threadId: thread.id });
    const at = options.at ?? new Date();
    const rows = ms.map((m, i) => {
      const createdAt = new Date(at.getTime() + i);
      return {
        id: m.id ?? uuid(),
        businessId,
        threadId: thread.id,
        authorKind: m.authorKind,
        authorUserId: m.authorUserId ?? null,
        agentId: m.agentId ?? (m.authorKind === "agent" ? thread.agentId : null),
        bubbles: m.bubbles,
        reaction: m.reaction,
        quickReplies: m.quickReplies,
        chosenQuickReplyId: m.chosenQuickReplyId ?? null,
        clientMessageId: m.clientMessageId ?? null,
        handOff: m.handOff ?? null,
        refersTo: m.refersTo,
        entityIds: m.entityIds,
        planId: m.planId ?? null,
        meta: m.meta,
        createdAt,
        updatedAt: createdAt,
      };
    });
    const last = rows[rows.length - 1]!.createdAt.toISOString();
    // Sent together; a failed insert (a repeated client message id) fails the update after it, so its error is the one thrown.
    const [inserted, updated] = await Promise.allSettled([
      db.insert(agentMessages).values(rows).returning(),
      db
        .update(agentThreads)
        .set({ lastMessageAt: sql`greatest(coalesce(${agentThreads.lastMessageAt}, ${last}::timestamptz), ${last}::timestamptz)`, messageCount: sql`${agentThreads.messageCount} + ${rows.length}` })
        .where(and(eq(agentThreads.businessId, businessId), eq(agentThreads.id, thread.id)))
        .returning(),
    ]);
    if (inserted.status === "rejected") throw inserted.reason;
    if (updated.status === "rejected") throw updated.reason;
    const byId = new Map(inserted.value.map((r) => [r.id, r]));
    return { messages: rows.map((r) => byId.get(r.id)!), thread: one(updated.value, "agent thread", thread.id) };
  },

  /**
   * Record the plan a hand-off was staged as, only if none was recorded yet (agent messages with a hand-off only).
   * Returns null when another request staged it first: the caller rolls its own plan back and uses the recorded one, so
   * a double press never leaves two plans waiting for confirmation.
   */
  async claimMessagePlan(db: Executor, businessId: string, messageId: string, planId: string): Promise<AgentMessage | null> {
    const p = parseInput(z.object({ messageId: Id, planId: Id }), { messageId, planId }, "message plan");
    const message = await conversationsRepo.getMessage(db, businessId, p.messageId);
    if (message.authorKind !== "agent" || !message.handOff) throw new ValidationError("Only an agent message with a hand-off can be staged as a plan", { messageId });
    return maybeOne(
      await db
        .update(agentMessages)
        .set({ planId: p.planId, updatedAt: new Date() })
        .where(and(eq(agentMessages.businessId, businessId), eq(agentMessages.id, p.messageId), isNull(agentMessages.planId)))
        .returning(),
    );
  },

  /** Record the plan a hand-off was staged as (agent messages with a hand-off only). */
  async setMessagePlan(db: Executor, businessId: string, messageId: string, planId: string): Promise<AgentMessage> {
    const p = parseInput(z.object({ messageId: Id, planId: Id }), { messageId, planId }, "message plan");
    const message = await conversationsRepo.getMessage(db, businessId, p.messageId);
    if (message.authorKind !== "agent" || !message.handOff) throw new ValidationError("Only an agent message with a hand-off can be staged as a plan", { messageId });
    return one(
      await db
        .update(agentMessages)
        .set({ planId: p.planId, updatedAt: new Date() })
        .where(and(eq(agentMessages.businessId, businessId), eq(agentMessages.id, p.messageId)))
        .returning(),
      "agent message",
      messageId,
    );
  },
};
