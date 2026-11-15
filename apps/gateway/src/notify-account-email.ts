/**
 * `POST /v1/notify/email` for an account about the account itself, with no project (`ACCOUNT_EMAIL_KINDS`; WP-03 T2):
 * the same sender, connector (`platform_notify`), address (`<PLATFORM_NOTIFY_LOCAL_PART>@<PLATFORM_MAIL_DOMAIN>`) and
 * daily ceiling as every email Foundmill sends a person, for `waitlist_admitted`: once per waitlist entry, when the
 * person's place opens (the orchestrator's `waitlist-admissions` sweep asks, for an entry it or the operator admitted).
 * Only the orchestrator asks, with ids only. The gateway trusts none of it beyond them and reads everything again:
 *   1. platform mail switched on and configured for where it runs, as for every kind;
 *   2. the entry: it exists, belongs to `userId`, has `admitted_at` set and `notified_at` null (else `not_pending`);
 *   3. the address, from `auth.users` (never from the request), not suppressed platform-wide (a bounce, a spam report,
 *      "Don't send me invitations" or this email's own footer link);
 *   4. once per entry (a marker in Redis), then the counts shared by every replica: three a day per address (an HMAC
 *      of it, the same count as invitations to it) and Foundmill's own ceiling (`pn:all:day`). Never the account's own
 *      three a day: it answers something the person did.
 * No preference applies. The footer link and the List-Unsubscribe header stop every email to the address (the
 * platform-wide suppression of `invitationsOffToken`). Mock mode answers `simulated: true` in development and test and
 * is refused elsewhere (`simulated`), so a simulated send is never recorded as the email on staging or production; the
 * orchestrator sets `notified_at`. No audit row (there is no project) and no event. The address never reaches a log line.
 */
import { z } from "zod";
import { APP_NAME } from "@foundmill/config";
import { repos } from "@foundmill/db";
import {
  ACCOUNT_EMAIL_KINDS,
  mockResultsAllowed,
  NOTIFY_EMAIL_REFUSALS,
  NOTIFY_ITEM_MARKER_MS,
  NOTIFY_PER_PERSON_PER_DAY,
  NOTIFY_PROJECT_MAIL_HEADROOM,
  PLATFORM_MAIL_SECRET_MIN_LENGTH,
  platformMailAddress,
  waitlistAdmittedEmail,
  type AccountEmailKind,
  type NotifyEmailNotSent,
} from "@foundmill/shared";
import { DEV_PLATFORM_MAIL_SECRET, invitationsOffToken, invitationsOffUrl, isConfigError, mockIntegrationRecord, PLATFORM_NOTIFY_KEY, suppressionHashOfEmail, type ToolContext } from "@foundmill/connectors";
import { notifyAddressDayKey } from "./notify-address-email";
import { PLATFORM_NOTIFY_CEILING_KEY, type NotifyEmailResponse } from "./notify-email";
import { modeFor, vendorRefusedOutright, type GatewayDeps } from "./pipeline";
import { PLATFORM_MAIL_CEILING_KEY, PLATFORM_NOTIFY_DEFAULT_CEILING } from "./platform-mail";
import { DAY_MS } from "./rate-limit";

export const AccountEmailRequest = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("waitlist_admitted"), userId: z.guid(), data: z.strictObject({ waitlistEntryId: z.guid() }) })]);
export type AccountEmailRequest = z.infer<typeof AccountEmailRequest>;

export const isAccountEmailKind = (kind: unknown): kind is AccountEmailKind => typeof kind === "string" && (ACCOUNT_EMAIL_KINDS as readonly string[]).includes(kind);

/** The marker that this kind of email went out for this row. */
export const notifyAccountItemKey = (kind: AccountEmailKind, id: string): string => `pn:acct-item:${kind}:${id.toLowerCase()}`;

const NIL_ID = "00000000-0000-0000-0000-000000000000";

export async function sendAccountEmail(deps: GatewayDeps, input: AccountEmailRequest, service: string): Promise<NotifyEmailResponse> {
  const now = deps.now?.() ?? new Date();
  const config = deps.platformMail;
  const rowId = input.data.waitlistEntryId;
  const notSent = (reason: NotifyEmailNotSent): NotifyEmailResponse => {
    deps.log.info({ kind: input.kind, rowId, reason }, "account email not sent");
    return { sent: false, reason, message: NOTIFY_EMAIL_REFUSALS[reason] };
  };

  // 1. Switched on and configured for where it runs.
  if (!config?.domain) return notSent("off");
  const mode = modeFor(deps, PLATFORM_NOTIFY_KEY);
  const devStack = deps.appEnv === undefined || deps.appEnv === "development" || deps.appEnv === "test";
  const strict = mode === "live" || !devStack;
  const secret = config.signingSecret && config.signingSecret.length >= PLATFORM_MAIL_SECRET_MIN_LENGTH ? config.signingSecret : strict ? null : DEV_PLATFORM_MAIL_SECRET;
  const appUrl = config.appUrl ?? "";
  if (!secret || !config.notifyLocalPart || !appUrl || (strict && (!/^https:\/\//.test(appUrl) || !/^https:\/\//.test(config.unsubscribeBase)))) return notSent("unconfigured");

  // 2. The entry: this person's, admitted, not yet emailed.
  const entry = await repos.waitlist.forEmail(deps.db, rowId, now);
  if (!entry || entry.userId?.toLowerCase() !== input.userId.toLowerCase() || !entry.admittedAt || entry.notifiedAt) return notSent("not_pending");
  if (mode === "mock" && deps.appEnv !== undefined && !mockResultsAllowed(deps.appEnv, false)) return notSent("simulated");

  // 3. The address, from the account, and the platform's suppression list.
  const email = await repos.founders.emailOf(deps.db, input.userId);
  if (!email) return notSent("no_address");
  const emailHash = suppressionHashOfEmail(email);
  // The nil business: only platform-scope rows can match.
  if (await repos.channels.isSuppressed(deps.db, NIL_ID, { emailHash })) return notSent("suppressed");
  const offUrl = invitationsOffUrl(config.unsubscribeBase, invitationsOffToken(secret, emailHash));
  const words = waitlistAdmittedEmail({ appName: APP_NAME, cardName: entry.cardName, link: `${appUrl}/start`, offLink: offUrl });

  // 4. Once, then the counts, shared by every replica.
  const shared = () => devStack || deps.rateLimits.durable === true;
  const itemKey = notifyAccountItemKey(input.kind, rowId);
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
  const ceiling = config.notifyCeiling ?? PLATFORM_NOTIFY_DEFAULT_CEILING;
  const caps: [string, number, NotifyEmailNotSent][] = [
    [notifyAddressDayKey(secret, email), NOTIFY_PER_PERSON_PER_DAY, "per_address"],
    [PLATFORM_NOTIFY_CEILING_KEY, ceiling, "ceiling"],
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

  const ctx: ToolContext = { businessId: NIL_ID, agentId: NIL_ID, sessionId: NIL_ID, integration: mockIntegrationRecord(PLATFORM_NOTIFY_KEY, NIL_ID), log: deps.log, mode };
  const connector = deps.registry.get(PLATFORM_NOTIFY_KEY, mode);
  let result;
  try {
    result = await connector.callTool("send_notification", { from: { email: platformMailAddress(config.notifyLocalPart, config.domain), name: APP_NAME }, to: { email }, subject: words.subject, text: words.text, html: words.html, unsubscribeUrl: offUrl }, ctx);
  } catch (e) {
    await release();
    if (isConfigError(e)) return notSent("unconfigured");
    throw e;
  }
  if (!result.ok) {
    // A definite refusal sent nothing and is given back; a timeout or a 5xx may have gone out and stays counted.
    if (vendorRefusedOutright(result.error)) await release();
    deps.log.warn({ kind: input.kind, rowId, code: result.error?.code, status: result.error?.status }, "account email refused by the provider");
    return notSent("vendor");
  }
  deps.log.info({ kind: input.kind, rowId, mode, service }, "account email sent");
  return { sent: true, simulated: mode === "mock", eventId: null };
}
