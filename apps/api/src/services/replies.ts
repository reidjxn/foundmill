/**
 * Replies to the project's Foundmill address, read and answered from Customers (WP-08 T2; audit a5 GTM-04).
 *
 * `listReplies` reads what ingest kept (`repos.replies.list`, inside withRls). `answerReply` asks the gateway to send
 * the member's answer (`POST /v1/platform-mail/answer-reply`): the api never reads or sends the address, and the gateway
 * sends it only as a reply to someone who wrote in the last 30 days. What the screen says comes back as
 * `{ sent, simulated, reason }`, so a simulated answer is never shown as sent.
 */
import { repos } from "@foundmill/db";
import { REPLY_WORDS, type ReplyNotSent } from "@foundmill/shared";
import { audit, type BusinessContext } from "../trpc";

export type AnswerReplyOutcome = { sent: true; simulated: boolean; message: string } | { sent: false; reason: ReplyNotSent; message: string };

export async function listReplies(ctx: BusinessContext, input: { entityId?: string; limit: number }) {
  const rows = await ctx.rls((tx) => repos.replies.list(tx, ctx.businessId, input));
  return rows.map((m) => ({ id: m.id, entityId: m.entityId, from: m.from, direction: m.direction, receivedAt: m.at.toISOString(), subject: m.subject, text: m.text, answered: m.answered }));
}

export async function answerReply(ctx: BusinessContext, input: { interactionId: string; text: string }): Promise<AnswerReplyOutcome> {
  // The reply must be one this member can see (RLS): an id from elsewhere is "not found" before anything is asked.
  const visible = await ctx.rls((tx) => repos.replies.isInbound(tx, ctx.businessId, input.interactionId));
  if (!visible) return { sent: false, reason: "not_found", message: REPLY_WORDS.notSent.not_found };
  if (!ctx.gateway.answerReply) return { sent: false, reason: "off", message: REPLY_WORDS.notSent.off };
  const answer = await ctx.gateway.answerReply({ businessId: ctx.businessId, interactionId: input.interactionId, userId: ctx.userId, text: input.text });
  await ctx.rls((tx) => audit(tx, ctx, { action: "crm.replies.answer", target: { kind: "interaction", id: input.interactionId }, details: answer.sent ? { sent: true, simulated: answer.simulated } : { sent: false, reason: answer.reason } }));
  if (!answer.sent) return { ...answer, message: REPLY_WORDS.notSent[answer.reason] ?? REPLY_WORDS.notSent.vendor };
  return { ...answer, message: answer.simulated ? REPLY_WORDS.simulated : REPLY_WORDS.sent };
}
