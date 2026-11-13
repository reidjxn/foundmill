/**
 * `POST /v1/notify/email` for an address rather than an account (`ADDRESS_EMAIL_KINDS`; docs/NETWORK.md F5, F20): the
 * same sender, connector (`platform_notify`), address (`<PLATFORM_NOTIFY_LOCAL_PART>@<PLATFORM_MAIL_DOMAIN>`) and
 * daily ceiling as every email Foundmill sends a person, for the message that goes to someone who may have no account
 * yet: `invitation`, once per invitation, to the address the inviter typed, with its link (`/i/<token>`).
 * Only the api asks. It sends the invitation's id and the token it minted; the gateway trusts none of it beyond them and
 * reads everything again before any vendor call:
 *   1. platform mail switched on and configured for where it runs, as for the person's own kinds;
 *   2. the invitation the token names (its SHA-256 equal to the row's, so the api cannot be made to mail a link it did
 *      not mint for that row), with the id sent, pending and in date, on a real, open project;
 *   3. the address, from that row (never from the request), not on the project's or the platform's suppression list;
 *   4. once per invitation (a marker in Redis), then the counts shared by every replica: three a day per address (an
 *      HMAC of it), three a day per person when the address is an account's (the founder's limit of 2026-11-12,
 *      `NOTIFY_PER_PERSON_PER_DAY`), this email's own ceiling (`pn:all:day`) and the projects' room (`busy`).
 * No preference applies (nobody holds one: it is one message the inviter asked for) and so there is no off link; it says
 * why it came and what ignoring it does. No `notify.email_sent` (that is a person's event and there is no person yet);
 * the send is audited on the project without the address. The address never reaches a log line, the audit or an event.
 */
import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import { APP_NAME } from "@foundmill/config";
import { repos } from "@foundmill/db";
import {
  ADDRESS_EMAIL_KINDS,
  INVITATION_ROLES,
  invitationEmail,
  mockResultsAllowed,
  NOTIFY_EMAIL_REFUSALS,
  NOTIFY_ITEM_MARKER_MS,
  NOTIFY_PER_PERSON_PER_DAY,
  NOTIFY_PROJECT_MAIL_HEADROOM,
  PLATFORM_MAIL_SECRET_MIN_LENGTH,
  platformMailAddress,
  type AddressEmailKind,
  type InvitationRole,
  type NotifyEmailNotSent,
  type NotifyEmailText,
} from "@foundmill/shared";
import { DEV_PLATFORM_MAIL_SECRET, isConfigError, mockIntegrationRecord, PLATFORM_NOTIFY_KEY, suppressionHashOfEmail, type ToolContext } from "@foundmill/connectors";
import type { NotifyEmailResponse } from "./notify-email";
import { notifyPersonDayKey, PLATFORM_NOTIFY_CEILING_KEY } from "./notify-email";
import { modeFor, vendorRefusedOutright, type GatewayDeps } from "./pipeline";
import { PLATFORM_MAIL_CEILING_KEY, PLATFORM_NOTIFY_DEFAULT_CEILING } from "./platform-mail";
import { DAY_MS } from "./rate-limit";

const Token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const AddressEmailRequest = z.strictObject({ kind: z.literal("invitation"), data: z.strictObject({ invitationId: z.guid(), token: Token }) });
export type AddressEmailRequest = z.infer<typeof AddressEmailRequest>;

export const isAddressEmailKind = (kind: unknown): kind is AddressEmailKind => typeof kind === "string" && (ADDRESS_EMAIL_KINDS as readonly string[]).includes(kind);

/** The per-address day key: an HMAC of the address under the signing secret with its own label, never the address. */
export const notifyAddressDayKey = (secret: string, email: string): string => `pn:addr:${createHmac("sha256", `fm-notify-address:${secret}`).update(email.trim().toLowerCase()).digest("base64url")}:day`;
/** The marker that this kind of email went out for this row. */
export const notifyAddressItemKey = (kind: AddressEmailKind, id: string): string => `pn:addr-item:${kind}:${id.toLowerCase()}`;

const NIL_ID = "00000000-0000-0000-0000-000000000000";
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

interface Plan {
  email: string;
  rowId: string;
  /** The project the invitation is for (the audit and the suppression list). */
  businessId: string;
  words: NotifyEmailText;
}

export async function sendAddressEmail(deps: GatewayDeps, input: AddressEmailRequest, service: string): Promise<NotifyEmailResponse> {
  const now = deps.now?.() ?? new Date();
  const config = deps.platformMail;
  const rowId = input.data.invitationId;
  const notSent = (reason: NotifyEmailNotSent): NotifyEmailResponse => {
    deps.log.info({ kind: input.kind, rowId, reason }, "address email not sent");
    return { sent: false, reason, message: NOTIFY_EMAIL_REFUSALS[reason] };
  };

  // 1. Switched on and configured for where it runs.
  if (!config?.domain) return notSent("off");
  const mode = modeFor(deps, PLATFORM_NOTIFY_KEY);
  const devStack = deps.appEnv === undefined || deps.appEnv === "development" || deps.appEnv === "test";
  const strict = mode === "live" || !devStack;
  const secret = config.signingSecret && config.signingSecret.length >= PLATFORM_MAIL_SECRET_MIN_LENGTH ? config.signingSecret : strict ? null : DEV_PLATFORM_MAIL_SECRET;
  const appUrl = config.appUrl ?? "";
  if (!secret || !config.notifyLocalPart || !appUrl || (strict && !/^https:\/\//.test(appUrl))) return notSent("unconfigured");

  // 2 and 3. The invitation, its state, its token and its address.
  const found = await repos.invitations.byTokenHash(deps.db, sha256(input.data.token));
  if (!found || found.id !== input.data.invitationId || found.state !== "pending" || found.expiresAt.getTime() <= now.getTime() || found.businessArchived || !found.email) return notSent("not_pending");
  if (found.businessIsDemo) return notSent("sample");
  if (mode === "mock" && deps.appEnv !== undefined && !mockResultsAllowed(deps.appEnv, false)) return notSent("simulated");
  if (await repos.channels.isSuppressed(deps.db, found.businessId, { emailHash: suppressionHashOfEmail(found.email) })) return notSent("not_pending");
  const role = (INVITATION_ROLES as readonly string[]).includes(found.role) ? (found.role as InvitationRole) : null;
  if (!role) return notSent("not_pending");
  const plan: Plan = { email: found.email, rowId: found.id, businessId: found.businessId, words: invitationEmail({ appName: APP_NAME, inviterName: found.inviterName, projectName: found.businessName, role, link: `${appUrl}/i/${input.data.token}`, expiresAt: found.expiresAt }) };

  // 4. Once, then the counts, shared by every replica.
  const shared = () => devStack || deps.rateLimits.durable === true;
  const itemKey = notifyAddressItemKey(input.kind, plan.rowId);
  let marked = false;
  const counted: string[] = [];
  const release = async () => {
    for (const key of counted.splice(0)) await deps.rateLimits.release?.(key, DAY_MS, now.getTime());
    if (marked) {
      marked = false;
      await deps.rateLimits.unclaim?.(itemKey);
    }
  };
  if (!deps.rateLimits.claim || !deps.rateLimits.count) {
    if (!devStack) return notSent("store");
  } else {
    marked = await deps.rateLimits.claim(itemKey, NOTIFY_ITEM_MARKER_MS, now.getTime());
    if (!shared()) {
      await release();
      return notSent("store");
    }
    if (!marked) return notSent("already_sent");
    const projectMail = await deps.rateLimits.count(PLATFORM_MAIL_CEILING_KEY, DAY_MS, now.getTime());
    if (projectMail > config.ceiling * NOTIFY_PROJECT_MAIL_HEADROOM) {
      await release();
      return notSent("busy");
    }
  }
  const account = await repos.founders.userIdByEmail(deps.db, plan.email).catch(() => null);
  const caps: [string, number, NotifyEmailNotSent][] = [
    [notifyAddressDayKey(secret, plan.email), NOTIFY_PER_PERSON_PER_DAY, "per_address"],
    ...(account ? ([[notifyPersonDayKey(account), NOTIFY_PER_PERSON_PER_DAY, "per_person"]] as [string, number, NotifyEmailNotSent][]) : []),
    [PLATFORM_NOTIFY_CEILING_KEY, config.notifyCeiling ?? PLATFORM_NOTIFY_DEFAULT_CEILING, "ceiling"],
  ];
  for (const [key, cap, reason] of caps) {
    const hit = await deps.rateLimits.hit(key, DAY_MS, now.getTime());
    counted.push(key);
    if (!shared()) {
      await release();
      return notSent("store");
    }
    if (hit.count > cap) {
      await release();
      return notSent(reason);
    }
  }

  const ctx: ToolContext = { businessId: plan.businessId, agentId: NIL_ID, sessionId: NIL_ID, integration: mockIntegrationRecord(PLATFORM_NOTIFY_KEY, plan.businessId), log: deps.log, mode };
  const connector = deps.registry.get(PLATFORM_NOTIFY_KEY, mode);
  let result;
  try {
    result = await connector.callTool("send_notification", { from: { email: platformMailAddress(config.notifyLocalPart, config.domain), name: APP_NAME }, to: { email: plan.email }, subject: plan.words.subject, text: plan.words.text, html: plan.words.html }, ctx);
  } catch (e) {
    await release();
    if (isConfigError(e)) return notSent("unconfigured");
    throw e;
  }
  if (!result.ok) {
    // A definite refusal sent nothing and is given back; a timeout or a 5xx may have gone out and stays counted.
    if (vendorRefusedOutright(result.error)) await release();
    deps.log.warn({ kind: input.kind, rowId: plan.rowId, code: result.error?.code, status: result.error?.status }, "address email refused by the provider");
    return notSent("vendor");
  }
  const simulated = mode === "mock";
  await repos.audit
    .append(deps.db, plan.businessId, { actorKind: "system", action: "gateway.notify.invitation_sent", target: { kind: "invitation", id: plan.rowId }, details: { service, mode, simulated } })
    .catch((e: unknown) => deps.log.warn({ businessId: plan.businessId, reason: e instanceof Error ? e.name : "unknown" }, "invitation email audit not written"));
  deps.log.info({ kind: input.kind, rowId: plan.rowId, mode }, "address email sent");
  return { sent: true, simulated, eventId: null };
}
