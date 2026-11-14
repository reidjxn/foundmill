/**
 * `POST /v1/platform-mail/confirm-follow` (package 1.6, double opt-in): the one email a person gets after they signed up
 * on a project's public page, asking them to confirm. Only the api asks (service token `svc: api`), right after it
 * wrote the pending consent record and reserved the send on it; no agent tool reaches this, and it needs no founder
 * approval: the person asked for it, and it says only what they asked for.
 *
 * The api sends ids, the address and the link's nonce, never any words: the subject and body are fixed
 * (`FOLLOW_CONFIRM_EMAIL`), around the project's name as the sender shows it (`platformMailSenderName`). In order:
 *
 *   1. platform mail switched on and configured (as for any send from a project's address; a mock send only where
 *      simulated results are allowed);
 *   2. the record: this business's, pending (not confirmed, not withdrawn, the contact live), for exactly this address,
 *      and carrying the nonce the api just reserved (so the api cannot be made to mail an address it did not record);
 *   3. the suppression list (the business's and the platform's);
 *   4. the project's address (`project_mail`) and that Foundmill has not paused it;
 *   5. the follow confirmations' own day for the project and their own ceiling for the deployment
 *      (`FOLLOW_CONFIRM_DAILY_CAP` on `pm:<id>:follow`, `FOLLOW_CONFIRM_DAILY_CEILING` on `pm:all:follow`): never the
 *      project's mail day or the outbound ceiling, so signups, which anyone can make, never use up the email the
 *      founders and their team send (security audit 2026-11-13, finding 10).
 *
 * It does not step aside for the founder's own SendGrid (that is for the team's mail; this one is the platform's). Every
 * "not sent" is an answer (`sent: false` with a reason), never an error, so the api leaves the record pending and the
 * founder sees "Not confirmed yet". No `mail.sent` event: this is not the project's outreach. The audit row carries the
 * consent id and a prefix of the address hash, never the address.
 */
import { z } from "zod";
import { APP_NAME, tierShowsBuiltOnMark } from "@foundmill/config";
import { repos } from "@foundmill/db";
import { builtOnWords, FOLLOW_CONFIRM_EMAIL, FOLLOW_CONFIRM_TTL_MS, mockResultsAllowed, PLATFORM_MAIL_SECRET_MIN_LENGTH, platformMailAddress } from "@foundmill/shared";
import {
  DEV_PLATFORM_MAIL_SECRET,
  followConfirmNonceHash,
  followConfirmToken,
  followConfirmUrl,
  isConfigError,
  mockIntegrationRecord,
  PLATFORM_MAIL_KEY,
  platformMailCustomArgs,
  platformMailSenderName,
  platformUnsubscribeToken,
  platformUnsubscribeUrl,
  suppressionHashOfEmail,
  type ToolContext,
} from "@foundmill/connectors";
import { randomUUID } from "node:crypto";
import { modeFor, vendorRefusedOutright, type GatewayDeps } from "./pipeline";
import { FOLLOW_CONFIRM_CEILING_KEY, FOLLOW_CONFIRM_DAILY_CAP, FOLLOW_CONFIRM_DAILY_CEILING, followConfirmDayKey, PLATFORM_MAIL_POLICY, takePlatformMailDay } from "./platform-mail";

export const CONFIRM_FOLLOW_ROUTE = "/v1/platform-mail/confirm-follow";

export const ConfirmFollowRequest = z.strictObject({
  businessId: z.guid(),
  consentId: z.guid(),
  email: z.email().max(254),
  /** The random nonce the api reserved on the record (its sha256 is `confirmation_token_hash`). */
  nonce: z.string().regex(/^[A-Za-z0-9_-]{32,64}$/),
});
export type ConfirmFollowRequest = z.infer<typeof ConfirmFollowRequest>;

/** Why nothing went out: the api only needs to know it did not. */
export type ConfirmFollowNotSent = "off" | "unconfigured" | "simulated" | "not_pending" | "suppressed" | "paused" | "daily_cap" | "ceiling" | "store" | "vendor";
export type ConfirmFollowResponse = { sent: true; simulated: boolean } | { sent: false; reason: ConfirmFollowNotSent };

const NIL_ID = "00000000-0000-0000-0000-000000000000";

const POLICY_REASON: Record<string, ConfirmFollowNotSent> = {
  [PLATFORM_MAIL_POLICY.daily_cap]: "daily_cap",
  [PLATFORM_MAIL_POLICY.ceiling]: "ceiling",
  [PLATFORM_MAIL_POLICY.store]: "store",
};

export async function sendFollowConfirmation(deps: GatewayDeps, input: ConfirmFollowRequest, service: string): Promise<ConfirmFollowResponse> {
  const now = deps.now?.() ?? new Date();
  const config = deps.platformMail;
  const notSent = async (reason: ConfirmFollowNotSent): Promise<ConfirmFollowResponse> => {
    deps.log.info({ businessId: input.businessId, consentId: input.consentId, reason }, "follow confirmation not sent");
    return { sent: false, reason };
  };
  // 1. Switched on and configured for where it runs.
  if (!config?.domain) return notSent("off");
  const mode = modeFor(deps, PLATFORM_MAIL_KEY);
  const devStack = deps.appEnv === undefined || deps.appEnv === "development" || deps.appEnv === "test";
  const strict = mode === "live" || !devStack;
  const secret = config.signingSecret && config.signingSecret.length >= PLATFORM_MAIL_SECRET_MIN_LENGTH ? config.signingSecret : strict ? null : DEV_PLATFORM_MAIL_SECRET;
  if (!secret || (strict && !/^https:\/\//.test(config.unsubscribeBase))) return notSent("unconfigured");
  const business = await repos.businesses.get(deps.db, input.businessId).catch(() => null);
  if (!business) return notSent("not_pending");
  if (mode === "mock" && deps.appEnv !== undefined && !mockResultsAllowed(deps.appEnv, business.isDemo)) return notSent("simulated");

  // 2. The pending record the api reserved, for exactly this address.
  const email = input.email.trim().toLowerCase();
  const pending = await repos.followers.pendingConfirmation(deps.db, input.businessId, input.consentId);
  if (!pending || pending.email !== email || pending.tokenHash !== followConfirmNonceHash(input.nonce)) return notSent("not_pending");

  // 3. Never to an address that asked not to be emailed, or bounced.
  const emailHash = suppressionHashOfEmail(email);
  if (await repos.channels.isSuppressed(deps.db, input.businessId, { emailHash })) return notSent("suppressed");

  // 4. The project's address, kept once chosen.
  const row = await repos.projectMail.ensure(deps.db, input.businessId);
  if (row.status !== "active") return notSent("paused");

  // 5. The confirmations' own day and ceiling, never the project's mail day or the outbound ceiling.
  const counted = await takePlatformMailDay(deps, {
    businessId: input.businessId,
    cap: config.followCap ?? FOLLOW_CONFIRM_DAILY_CAP,
    ceiling: config.followCeiling ?? FOLLOW_CONFIRM_DAILY_CEILING,
    devStack,
    now: now.getTime(),
    keys: { project: followConfirmDayKey(input.businessId), all: FOLLOW_CONFIRM_CEILING_KEY },
  });
  if (!counted.ok) return notSent(POLICY_REASON[counted.policyId] ?? "store");

  const messageRef = randomUUID();
  const { projectName, fromName } = platformMailSenderName(business.name, row.localPart);
  const link = followConfirmUrl(config.unsubscribeBase, followConfirmToken(secret, { businessId: input.businessId, consentId: input.consentId, emailHash, expiresAt: Math.floor((now.getTime() + FOLLOW_CONFIRM_TTL_MS) / 1000), nonce: input.nonce }));
  const ctx: ToolContext = {
    businessId: input.businessId,
    agentId: NIL_ID,
    sessionId: NIL_ID,
    integration: mockIntegrationRecord(PLATFORM_MAIL_KEY, input.businessId),
    log: deps.log,
    mode,
    platformMail: {
      from: { email: platformMailAddress(row.localPart, config.domain), name: fromName },
      projectName,
      messageRef,
      unsubscribeUrl: platformUnsubscribeUrl(config.unsubscribeBase, platformUnsubscribeToken(secret, input.businessId, emailHash)),
      customArgs: platformMailCustomArgs(secret, input.businessId, messageRef, emailHash),
    },
  };
  const connector = deps.registry.get(PLATFORM_MAIL_KEY, mode);
  let result;
  try {
    result = await connector.callTool("send_mail", { to: { email }, subject: FOLLOW_CONFIRM_EMAIL.subject(projectName), text: FOLLOW_CONFIRM_EMAIL.text(projectName, APP_NAME, link, tierShowsBuiltOnMark(business.planTier) ? builtOnWords(APP_NAME).foot(projectName) : null) }, ctx);
  } catch (e) {
    if (isConfigError(e)) {
      await counted.release();
      return notSent("unconfigured");
    }
    throw e;
  }
  if (!result.ok) {
    // A definite refusal sent nothing and is given back; a timeout or a 5xx may have gone out and stays counted.
    if (vendorRefusedOutright(result.error)) await counted.release();
    return notSent("vendor");
  }
  await repos.audit
    .append(deps.db, input.businessId, { actorKind: "system", action: "gateway.platform_mail.follow_confirmation", target: { kind: "contact_consent", id: input.consentId }, details: { service, mode, simulated: mode === "mock", fromLocalPart: row.localPart, emailHashPrefix: emailHash.slice(0, 12) } })
    .catch((e: unknown) => deps.log.warn({ businessId: input.businessId, reason: e instanceof Error ? e.name : "unknown" }, "follow confirmation audit not written"));
  return { sent: true, simulated: mode === "mock" };
}
