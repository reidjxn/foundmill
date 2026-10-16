/**
 * agent.conversation.get/send/handOff/inboxReply — talking to an agent at their desk (audit-conversation §4).
 *
 * Access follows the subject: an Inbox item uses the Inbox section permission, the agent itself or one of its tasks the
 * Team section permission (BUILD §11.9); `get` needs read, the rest write (owner/admin/member). See
 * services/conversation.ts for what each step does; nothing here executes work (a hand-off is staged and confirmed
 * through `plan.confirm`, a decision goes through `inbox.decide`'s own path).
 *
 * `sendStream` and `inboxReplyStream` are `send` and `inboxReply` streamed (audit MB-1, tRPC async generators over
 * `httpBatchStreamLink`): each bubble of the agent's reply as it is written, then `done` with the same result. The send
 * runs to the end even when the reader goes away (as a plain request does), so a reply is never half stored.
 */
import { z } from "zod";
import { assertSubjectAccess, ConversationSubject, getConversation, replyStream, replyToInboxItem, SendInput, sendConversationMessage, stageHandOff, type InboxReplyResult, type ReplyStreamEvent, type SendResult } from "../services/conversation";
import { modelLimited } from "../services/model-limits";
import { businessProcedure, Id, router, sectionWrite, writeProcedure } from "../trpc";

const InboxReplyInput = z.object({ itemId: Id, text: z.string().trim().min(1).max(2000), clientMessageId: z.string().trim().min(8).max(100).optional() });

export const conversationRouter = router({
  /** Thread, messages, persona (presence, current task, voice, nudges) and starters. No model call. */
  get: businessProcedure.input(z.object({ subject: ConversationSubject })).query(({ ctx, input }) => {
    assertSubjectAccess(ctx, input.subject.kind, "read");
    return getConversation(ctx, input.subject);
  }),

  /** The founder's text or a quick reply → the agent's reply (or the decide path for "Go with: …"). */
  send: writeProcedure.input(SendInput).use(modelLimited("conversation")).mutation(({ ctx, input }) => {
    assertSubjectAccess(ctx, input.subject.kind, "write");
    return sendConversationMessage(ctx, input);
  }),

  /** `send`, streamed: the reply's bubbles as they are written, then `done` with the `send` result. */
  sendStream: writeProcedure.input(SendInput).use(modelLimited("conversation")).mutation(async function* ({ ctx, input, signal }): AsyncGenerator<ReplyStreamEvent<SendResult>, void, undefined> {
    yield* replyStream<SendResult>(ctx, "agent.conversation.sendStream", signal, (emit) => {
      assertSubjectAccess(ctx, input.subject.kind, "write");
      return sendConversationMessage(ctx, input, { emit });
    });
  }),

  /** Compile an agent message's hand-off and stage it for confirmation (the plan.preview shape + planId). */
  handOff: writeProcedure.input(z.object({ messageId: Id })).use(modelLimited("conversation")).mutation(({ ctx, input }) => stageHandOff(ctx, input.messageId)),

  /** Inbox free text: a question goes to the conversation (the item stays open), an instruction decides the item. */
  inboxReply: sectionWrite("inbox")
    .input(InboxReplyInput)
    .use(modelLimited("conversation"))
    .mutation(({ ctx, input }) => replyToInboxItem(ctx, input)),

  /** `inboxReply`, streamed: a question's reply bubble by bubble, then `done` with the `inboxReply` result. */
  inboxReplyStream: sectionWrite("inbox")
    .input(InboxReplyInput)
    .use(modelLimited("conversation"))
    .mutation(async function* ({ ctx, input, signal }): AsyncGenerator<ReplyStreamEvent<InboxReplyResult>, void, undefined> {
      yield* replyStream<InboxReplyResult>(ctx, "agent.conversation.inboxReplyStream", signal, (emit) => replyToInboxItem(ctx, input, { emit }));
    }),
});
