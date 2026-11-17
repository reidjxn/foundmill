/**
 * `POST /v1/platform-mail/answer-reply` (WP-08 T2): a founder's answer to a reply that reached the project's Foundmill
 * address. Only the api asks (service token `svc: api`), after `crm.replies.answer` checked that the member may write in
 * Customers. No agent tool reaches this: the founder pressing Send is the approval, as for any message they write
 * themselves.
 *
 * The api sends ids and the founder's words, never an address: the address is read here from the record the reply
 * came from (`repos.replies.forAnswer`), and never leaves the gateway. In order:
 *
 *   1. platform mail switched on and configured, and a mock send only where simulated results are allowed (a person's
 *      project on staging or production is refused, so a simulated answer is never reported as sent);
 *   2. the kept reply: this business's, inbound, and its record live (not merged away, no deletion requested);
 *   3. a reply only while this person wrote to the project in the last 30 days (`classifyProjectMail` with
 *      `purpose: "reply"`): then it is transactional and needs no postal address; otherwise it is refused, never sent
 *      as marketing;
 *   4. every guard of `preparePlatformMail`, unchanged: the founder's own sender, the content, the suppression list, the
 *      project's address and its pause, the project's day and the deployment's ceiling.
 *
 * A send that went out writes `mail.sent` (actor: the member) and the answer on the record (`repos.replies.recordAnswer`),
 * and an audit row with the interaction id and a prefix of the address hash. A simulated send (development, test, a
 * sample business) writes neither and answers `simulated: true`, so the screen says nothing was sent.
 */
import { z } from "zod";
import { repos } from "@foundmill/db";
import { answerSubject, REPLY_ANSWER_MAX, type ReplyNotSent } from "@foundmill/shared";
import { isConfigError, mockIntegrationRecord, PLATFORM_MAIL_KEY, type ToolContext } from "@foundmill/connectors";
import { writeGatewayEvent } from "./events";
import { modeFor, vendorRefusedOutright, type GatewayDeps } from "./pipeline";
import { classifyProjectMail, PLATFORM_MAIL_POLICY, platformMailSwitchRefusal, preparePlatformMail } from "./platform-mail";

export const ANSWER_REPLY_ROUTE = "/v1/platform-mail/answer-reply";

export const AnswerReplyRequest = z.strictObject({
  businessId: z.guid(),
  interactionId: z.guid(),
  /** The member who wrote the answer (the api checked their access). */
  userId: z.guid(),
  text: z.string().trim().min(1).max(REPLY_ANSWER_MAX),
});
export type AnswerReplyRequest = z.infer<typeof AnswerReplyRequest>;

export type AnswerReplyResponse = { sent: true; simulated: boolean } | { sent: false; reason: ReplyNotSent };

const NIL_ID = "00000000-0000-0000-0000-000000000000";

const POLICY_REASON: Record<string, ReplyNotSent> = {
  [PLATFORM_MAIL_POLICY.off]: "off",
  [PLATFORM_MAIL_POLICY.unconfigured]: "unconfigured",
  [PLATFORM_MAIL_POLICY.simulated]: "simulated",
  [PLATFORM_MAIL_POLICY.own_sender]: "own_sender",
  [PLATFORM_MAIL_POLICY.content]: "content",
  [PLATFORM_MAIL_POLICY.suppressed]: "suppressed",
  [PLATFORM_MAIL_POLICY.paused]: "paused",
  [PLATFORM_MAIL_POLICY.daily_cap]: "daily_cap",
  [PLATFORM_MAIL_POLICY.ceiling]: "ceiling",
  [PLATFORM_MAIL_POLICY.store]: "store",
  // A reply that is not transactional is refused at step 3; this only catches a classification that changed since.
  [PLATFORM_MAIL_POLICY.no_postal_address]: "not_recent",
};

export async function answerReply(deps: GatewayDeps, input: AnswerReplyRequest, service: string): Promise<AnswerReplyResponse> {
  const now = deps.now?.() ?? new Date();
  const notSent = (reason: ReplyNotSent): AnswerReplyResponse => {
    deps.log.info({ businessId: input.businessId, interactionId: input.interactionId, reason }, "answer to a reply not sent");
    return { sent: false, reason };
  };
  const business = await repos.businesses.get(deps.db, input.businessId).catch(() => null);
  if (!business) return notSent("not_found");
  const mode = modeFor(deps, PLATFORM_MAIL_KEY);
  const mailDeps = { db: deps.db, rateLimits: deps.rateLimits, config: deps.platformMail, ...(deps.appEnv !== undefined ? { appEnv: deps.appEnv } : {}) };

  // 1. Switched on, configured, and never a simulated send reported to a person's project.
  const off = platformMailSwitchRefusal(mailDeps, { business, mode });
  if (off) return notSent(POLICY_REASON[off.policyId] ?? "off");

  // 2. The reply, and the address it came from.
  const reply = await repos.replies.forAnswer(deps.db, input.businessId, input.interactionId);
  if (!reply) return notSent("not_found");

  // 3. Only a reply: this person wrote to the project within the window.
  const mailClass = await classifyProjectMail(deps.db, input.businessId, { purpose: "reply", email: reply.email, now: now.getTime() });
  if (mailClass !== "transactional") return notSent("not_recent");

  // 4. Every guard of the project's address.
  const args = { to: { email: reply.email }, subject: answerSubject(reply.subject), text: input.text, purpose: "reply" as const };
  const decision = await preparePlatformMail(mailDeps, { business, args, mode, now: now.getTime(), log: deps.log });
  if (!decision.ok) return notSent(POLICY_REASON[decision.policyId] ?? "vendor");
  const prepared = decision.prepared;

  const ctx: ToolContext = { businessId: input.businessId, agentId: NIL_ID, sessionId: NIL_ID, integration: mockIntegrationRecord(PLATFORM_MAIL_KEY, input.businessId), log: deps.log, mode, platformMail: prepared.envelope };
  const connector = deps.registry.get(PLATFORM_MAIL_KEY, mode);
  let result;
  try {
    result = await connector.callTool("send_mail", args, ctx);
  } catch (e) {
    await prepared.release();
    if (isConfigError(e)) return notSent("unconfigured");
    throw e;
  }
  if (!result.ok) {
    // A definite refusal sent nothing and is given back; a timeout or a 5xx may have gone out and stays counted.
    if (vendorRefusedOutright(result.error)) await prepared.release();
    return notSent("vendor");
  }
  const simulated = mode === "mock";
  if (!simulated) {
    // The message has gone: a failure to record it is logged, never returned as a failure.
    const data = (result.data ?? {}) as { messageId?: unknown };
    try {
      await deps.db.transaction(async (tx) => {
        await writeGatewayEvent(tx, {
          businessId: input.businessId,
          type: "mail.sent",
          actor: { kind: "user", id: input.userId },
          payload: { messageRef: prepared.envelope.messageRef, messageId: typeof data.messageId === "string" && data.messageId ? data.messageId.slice(0, 200) : prepared.envelope.messageRef, recipientHash: prepared.recipientHash, fromLocalPart: prepared.localPart, channelKey: null, agentId: null, sessionId: null, simulated: false },
        });
        await repos.replies.recordAnswer(tx, input.businessId, { entityId: reply.entityId, subject: args.subject, text: input.text, at: now });
      });
    } catch (e) {
      deps.log.error({ businessId: input.businessId, reason: e instanceof Error ? e.name : "unknown" }, "answer sent from the project's address but not recorded");
    }
  }
  await repos.audit
    .append(deps.db, input.businessId, { actorKind: "user", actorId: input.userId, action: "gateway.platform_mail.reply_answer", target: { kind: "interaction", id: input.interactionId }, details: { service, mode, simulated, mailClass: prepared.mailClass, fromLocalPart: prepared.localPart, emailHashPrefix: prepared.recipientHash.slice(0, 12) } })
    .catch((e: unknown) => deps.log.warn({ businessId: input.businessId, reason: e instanceof Error ? e.name : "unknown" }, "reply answer audit not written"));
  return { sent: true, simulated };
}
