/**
 * `POST /v1/platform-mail/send-update` (WP-08 T3; audit a5 GTM-01): the founders' update to their followers, sent from
 * the project's Foundmill address after a founder pressed Send (`updates.send`, `sectionAdmin("distribution")` in the
 * api). Only the api asks (service token `svc: api`); no agent tool reaches it: an agent may draft an update, never send
 * one. The api sends ids, never an address: the followers are read here, and no address leaves the gateway in the answer,
 * the logs, the audit or an event.
 *
 * In order, before anything is sent:
 *   1. platform mail switched on and configured, and a mock send only where simulated results are allowed (a person's
 *      project on staging or production is refused, so a simulated send is never reported as sent);
 *   2. the consent rule (WP-08 T10, `recipientBasis`), per follower below: only `consent` is sent to;
 *   3. the update: this business's, a draft or a send that is not finished, with words that pass `updateProblems`;
 *   4. the founders' postal address: a follower update is commercial (US CAN-SPAM), so without one the whole send is
 *      refused and the founders' note is raised (once while open, `repos.postalAddress.raiseNote`);
 *   5. the member who pressed it is an owner or an admin of the business, and a draft moves to sending only from the
 *      words they previewed (`seenUpdatedAt`) and never once deleted.
 * Then, for at most `PROJECT_UPDATE_BATCH_MAX` followers who confirmed, have not withdrawn and have no delivery row for
 * this update (and whose address is still the one that agreed), one per address, one at a time: the row is claimed
 * first (two presses never send to one person twice), the person's basis
 * must be `consent`, and every guard of `preparePlatformMail` runs for that one message (suppression, the project's day
 * cap, the deployment's ceiling). The first cap or ceiling refusal stops the press and leaves the rest for "Send the
 * rest". A real message writes `mail.sent` (actor: the member, `updateId`); the press writes `update.sent` and its counts.
 * A simulated send (development, test, a sample business) records nothing and answers `simulated: true`.
 */
import { z } from "zod";
import { repos } from "@foundmill/db";
import { aiFooterLine, firstNameOf, PROJECT_UPDATE_BATCH_MAX, updateProblems, updateText, type RecipientBasis } from "@foundmill/shared";
import { isConfigError, mockIntegrationRecord, PLATFORM_MAIL_KEY, type ToolContext } from "@foundmill/connectors";
import { writeGatewayEvent } from "./events";
import { recipientBasis } from "./recipient-basis";
import { modeFor, vendorRefusedOutright, type GatewayDeps } from "./pipeline";
import { PLATFORM_MAIL_POLICY, platformMailSwitchRefusal, preparePlatformMail, raisePostalAddressNote } from "./platform-mail";

export const SEND_UPDATE_ROUTE = "/v1/platform-mail/send-update";

export const SendUpdateRequest = z.strictObject({
  businessId: z.guid(),
  updateId: z.guid(),
  userId: z.guid(),
  /** When the words the founder previewed were saved (`updatedAt`): a draft edited since is not sent. */
  seenUpdatedAt: z.iso.datetime({ offset: true }).optional(),
});
export type SendUpdateRequest = z.infer<typeof SendUpdateRequest>;

/** WP-08 T10's check (`recipient-basis.ts`); `GatewayDeps.recipientBasis` replaces it in tests only. */
export type RecipientBasisCheck = (db: GatewayDeps["db"], businessId: string, email: string, now: Date) => Promise<RecipientBasis>;

export interface SendUpdateResponse {
  sent: number;
  skipped: number;
  remaining: number;
  simulated: boolean;
  /** Why the press stopped before everyone was reached, as a word (`PROJECT_UPDATE_REFUSALS`); null when it did not. */
  refusal: string | null;
}

const NIL_ID = "00000000-0000-0000-0000-000000000000";

/** A refusal that stops the whole press (nothing more can go out today or at all), by policy id. */
const STOPS: Record<string, string> = {
  [PLATFORM_MAIL_POLICY.off]: "off",
  [PLATFORM_MAIL_POLICY.unconfigured]: "unconfigured",
  [PLATFORM_MAIL_POLICY.simulated]: "simulated",
  [PLATFORM_MAIL_POLICY.own_sender]: "own_sender",
  [PLATFORM_MAIL_POLICY.paused]: "paused",
  [PLATFORM_MAIL_POLICY.no_postal_address]: "no_postal_address",
  [PLATFORM_MAIL_POLICY.daily_cap]: "daily_cap",
  [PLATFORM_MAIL_POLICY.ceiling]: "ceiling",
  [PLATFORM_MAIL_POLICY.store]: "store",
  [PLATFORM_MAIL_POLICY.content]: "content",
};

export async function sendFollowerUpdate(deps: GatewayDeps, input: SendUpdateRequest, service: string): Promise<SendUpdateResponse> {
  const now = deps.now?.() ?? new Date();
  const businessId = input.businessId;
  const answer = (over: Partial<SendUpdateResponse> & { refusal: string | null }): SendUpdateResponse => ({ sent: 0, skipped: 0, remaining: 0, simulated: false, ...over });
  const refuse = (refusal: string) => {
    deps.log.info({ businessId, updateId: input.updateId, refusal }, "follower update not sent");
    return answer({ refusal });
  };
  const business = await repos.businesses.get(deps.db, businessId).catch(() => null);
  if (!business) return refuse("not_found");
  const mode = modeFor(deps, PLATFORM_MAIL_KEY);
  const mailDeps = { db: deps.db, rateLimits: deps.rateLimits, config: deps.platformMail, ...(deps.appEnv !== undefined ? { appEnv: deps.appEnv } : {}) };

  // 1. Switched on, configured, and never a simulated send reported to a person's project.
  const off = platformMailSwitchRefusal(mailDeps, { business, mode });
  if (off) return refuse(STOPS[off.policyId] ?? "off");
  // 2. The consent rule (WP-08 T10): the same check every mail tool's call goes through.
  const basisOf: RecipientBasisCheck = deps.recipientBasis ?? recipientBasis;
  // 3. The update.
  const update = await repos.updates.get(deps.db, businessId, input.updateId);
  if (!update) return refuse("not_found");
  if (update.status !== "draft" && update.status !== "sending") return refuse("not_draft");
  if (updateProblems(update.subject, update.body)) return refuse("content");
  // 4. The postal address (the per-message guard raises the founders' note; this stops before any follower is claimed).
  if (!(await repos.postalAddress.addressOf(deps.db, businessId))) {
    await raisePostalAddressNote(deps.db, businessId, { agentId: null, now: now.getTime() }).catch((e: unknown) => deps.log.warn({ businessId, reason: e instanceof Error ? e.name : "unknown" }, "postal address note not raised"));
    return refuse("no_postal_address");
  }

  // 5. The member who pressed it is still an owner or an admin here (the api checked; this is the second lock).
  if (!(await repos.memberships.hasRole(deps.db, businessId, input.userId, ["owner", "admin"]))) return refuse("not_found");

  const simulated = mode === "mock";
  const checker = await repos.founders.get(deps.db, input.userId).catch(() => null);
  const text = updateText(update.body, aiFooterLine({ draftedByAgent: update.draftedByAgentId !== null, checkerFirstName: firstNameOf(checker?.displayName) }));
  if (!simulated) {
    // Only the words the founder saw, and never an update deleted since (a press racing "Delete draft").
    const started = await repos.updates.startSend(deps.db, businessId, update.id, { userId: input.userId, at: now, seenUpdatedAt: input.seenUpdatedAt ? new Date(input.seenUpdatedAt) : null });
    if (!started) return refuse(update.status === "draft" ? "changed" : "not_draft");
  }

  const recipients = await repos.updates.pendingRecipients(deps.db, businessId, update.id, PROJECT_UPDATE_BATCH_MAX);
  let sentNow = 0;
  let refusal: string | null = null;
  const connector = deps.registry.get(PLATFORM_MAIL_KEY, mode);
  try {
    for (const r of recipients) {
      // A simulated press claims nobody: nothing went out, so nothing is recorded and it can be pressed again.
      if (!simulated && !(await repos.updates.claim(deps.db, businessId, { updateId: update.id, entityId: r.entityId, recipientHash: r.recipientHash, at: now }))) continue;
      const settle = (outcome: Parameters<typeof repos.updates.settle>[2]["outcome"]) => (simulated ? Promise.resolve() : repos.updates.settle(deps.db, businessId, { updateId: update.id, entityId: r.entityId, outcome, at: now }));
      // Until the vendor is called, a failure gives this person back for the next press; after it, they may have it.
      let reachedVendor = false;
      try {
        if ((await basisOf(deps.db, businessId, r.email, now)) !== "consent") {
          await settle({ state: "skipped", reason: "no_basis" });
          continue;
        }
        const args = { to: { email: r.email }, subject: update.subject, text };
        const decision = await preparePlatformMail(mailDeps, { business, args, mode, now: now.getTime(), log: deps.log });
        if (!decision.ok) {
          if (decision.policyId === PLATFORM_MAIL_POLICY.suppressed) {
            await settle({ state: "skipped", reason: "suppressed" });
            continue;
          }
          // A cap, the ceiling or a pause: this person waits for "Send the rest", and the press stops here.
          await settle({ state: "release" });
          refusal = STOPS[decision.policyId] ?? "vendor";
          break;
        }
        const prepared = decision.prepared;
        const ctx: ToolContext = { businessId, agentId: NIL_ID, sessionId: NIL_ID, integration: mockIntegrationRecord(PLATFORM_MAIL_KEY, businessId), log: deps.log, mode, platformMail: prepared.envelope };
        let result;
        try {
          reachedVendor = true;
          result = await connector.callTool("send_mail", args, ctx);
        } catch (e) {
          await prepared.release();
          if (isConfigError(e)) {
            reachedVendor = false;
            await settle({ state: "release" });
            refusal = "unconfigured";
            break;
          }
          throw e;
        }
        if (!result.ok) {
          // A definite refusal sent nothing: the count is given back and the person waits for the next press. After a
          // timeout or a 5xx the message may have gone, so it is not offered again. Either way the press stops: the
          // email service is not taking messages right now.
          if (vendorRefusedOutright(result.error)) {
            await prepared.release();
            await settle({ state: "release" });
          } else await settle({ state: "skipped", reason: "refused" });
          refusal = "vendor";
          break;
        }
        sentNow += 1;
        if (simulated) {
          // Nothing left Foundmill: the day's counts are given back.
          await prepared.release();
          continue;
        }
        await settle({ state: "sent", messageRef: prepared.envelope.messageRef });
        const data = (result.data ?? {}) as { messageId?: unknown };
        await deps.db
          .transaction((tx) =>
            writeGatewayEvent(tx, {
              businessId,
              type: "mail.sent",
              actor: { kind: "user", id: input.userId },
              payload: { messageRef: prepared.envelope.messageRef, messageId: typeof data.messageId === "string" && data.messageId ? data.messageId.slice(0, 200) : prepared.envelope.messageRef, recipientHash: prepared.recipientHash, fromLocalPart: prepared.localPart, channelKey: null, agentId: null, sessionId: null, simulated: false, updateId: update.id },
            }),
          )
          .catch((e: unknown) => deps.log.error({ businessId, reason: e instanceof Error ? e.name : "unknown" }, "follower update message sent but mail.sent not written"));
      } catch (e) {
        // This person only: given back when nothing reached the vendor, else not offered again. The press stops.
        await settle(reachedVendor ? { state: "skipped", reason: "refused" } : { state: "release" }).catch(() => undefined);
        deps.log.error({ businessId, updateId: update.id, reason: e instanceof Error ? e.name : "unknown" }, "follower update stopped on an error");
        refusal = "vendor";
        break;
      }
    }
  } finally {
    if (!simulated) await recordPress(deps, { businessId, updateId: update.id, userId: input.userId, service, mode, sentNow, refusal, now });
  }

  if (simulated) return answer({ sent: sentNow, remaining: Math.max(0, (await repos.updates.pendingCount(deps.db, businessId, update.id)) - sentNow), simulated: true, refusal });
  const done = await repos.updates.get(deps.db, businessId, update.id);
  return answer({ sent: done?.sentCount ?? sentNow, skipped: done?.skippedCount ?? 0, remaining: done?.remainingCount ?? 0, refusal });
}

/** After every real press, whatever happened in it: the counts from the rows, `update.sent` and the audit row. */
async function recordPress(deps: GatewayDeps, input: { businessId: string; updateId: string; userId: string; service: string; mode: string; sentNow: number; refusal: string | null; now: Date }): Promise<void> {
  const { businessId } = input;
  try {
    const done = await repos.updates.finishBatch(deps.db, businessId, input.updateId, input.now);
    if (!done) return;
    await deps.db.transaction((tx) => writeGatewayEvent(tx, { businessId, type: "update.sent", actor: { kind: "user", id: input.userId }, payload: { updateId: done.id, sent: done.sentCount, skipped: done.skippedCount, remaining: done.remainingCount } }));
    await repos.audit.append(deps.db, businessId, { actorKind: "user", actorId: input.userId, action: "gateway.platform_mail.follower_update", target: { kind: "project_update", id: done.id }, details: { service: input.service, mode: input.mode, sentNow: input.sentNow, sent: done.sentCount, skipped: done.skippedCount, remaining: done.remainingCount, refusal: input.refusal } });
  } catch (e) {
    deps.log.error({ businessId, reason: e instanceof Error ? e.name : "unknown" }, "follower update press not fully recorded");
  }
}
