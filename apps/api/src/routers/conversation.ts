/**
 * agent.conversation.get/send/handOff/inboxReply — talking to an agent at their desk (audit-conversation §4).
 *
 * Access follows the subject: an Inbox item uses the Inbox section permission, the agent itself or one of its tasks the
 * Team section permission (BUILD §11.9); `get` needs read, the rest write (owner/admin/member). See
 * services/conversation.ts for what each step does; nothing here executes work (a hand-off is staged and confirmed
 * through `plan.confirm`, a decision goes through `inbox.decide`'s own path).
 */
import { z } from "zod";
import { assertSubjectAccess, ConversationSubject, getConversation, replyToInboxItem, SendInput, sendConversationMessage, stageHandOff } from "../services/conversation";
import { modelLimited } from "../services/model-limits";
import { businessProcedure, Id, router, sectionWrite, writeProcedure } from "../trpc";

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

  /** Compile an agent message's hand-off and stage it for confirmation (the plan.preview shape + planId). */
  handOff: writeProcedure.input(z.object({ messageId: Id })).use(modelLimited("conversation")).mutation(({ ctx, input }) => stageHandOff(ctx, input.messageId)),

  /** Inbox free text: a question goes to the conversation (the item stays open), an instruction decides the item. */
  inboxReply: sectionWrite("inbox")
    .input(z.object({ itemId: Id, text: z.string().trim().min(1).max(2000), clientMessageId: z.string().trim().min(8).max(100).optional() }))
    .use(modelLimited("conversation"))
    .mutation(({ ctx, input }) => replyToInboxItem(ctx, input)),
});
