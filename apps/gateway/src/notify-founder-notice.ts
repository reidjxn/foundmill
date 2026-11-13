/**
 * `POST /v1/notify/email` for an account-safety notice (`ACCOUNT_SAFETY_EMAIL_KINDS`: `founder_notice`; security review
 * P2-3, Nov 13, 2026). The same sender, connector (`platform_notify`) and address as every email Foundmill sends a
 * person, for the email every founder of a project gets, and the person it happened to, when:
 *   - a founder's role goes below a founder's (`team.humans.role`, an owner or a cofounder to anything lower);
 *   - a founder is removed (`team.humans.remove`);
 *   - the project's deletion is asked for or canceled (`business.request_deletion`, `business.cancel_deletion`).
 *
 * Only the api asks, with ids only: `{ userId, kind: "founder_notice", businessId, data: { auditId, cancelToken? } }`.
 * The gateway trusts none of it beyond the ids and reads everything again before any vendor call:
 *   1. platform mail switched on and configured for where it runs, as for every kind;
 *   2. the business (archived too: a deletion can be asked for there), not a sample;
 *   3. the audit entry, which says which notice it is, who did it (`actorId`), when, and about whom; written within the
 *      day (`FOUNDER_NOTICE_LOOKBACK_MS`);
 *   4. the reader: never the person who did it (`own_action`: nobody is emailed about what they did themselves, so a
 *      founder on their own gets nothing from their own steps); a founder of the project now (an owner or a cofounder,
 *      not through an example membership, not ended), or the person whose role changed or who was removed, or, for a
 *      deletion, a founder someone else demoted or removed in the last 7 days who has not got the standing back
 *      (`founder_departures`); anyone else is `not_founder`;
 *   5. once per entry and person (`founder_notifications`' dedupe key `founder_notice:<audit id>`);
 *   6. their address, from `auth.users`, and no hard suppression of it (`isHardSuppressed`: a bounce or a spam report,
 *      platform-wide or for this project). Nothing else holds it back: no email switch, no pause, no daily limit, no
 *      project outreach room, and not "Don't send me invitations": these are about who runs a project the person
 *      founded and whether it is deleted. The send still counts toward this email's own daily ceiling (`pn:all:day`), so
 *      the other kinds see the load, but is never refused by it;
 *   7. the one-click cancel, only when the api sent a token for this reader (a former founder, or the person just
 *      removed or demoted, while a deletion waits): its SHA-256 must be this person's departure's in this project,
 *      unused, in date, for the deletion request that is still the latest and still waiting. A token that does not
 *      hold is left out (the email still goes, saying to ask a founder).
 *
 * The words are `founderNoticeEmail` (packages/shared people-email.ts) over the gateway's own reads (the profile names of
 * the reader, the actor and the person it was about, the project's name, the reader's time zone), every one through
 * `withoutLinks`. No off link and no List-Unsubscribe header (`accountSafety: true` on the connector). The email is kept
 * on its `founder_notifications` row with the token taken out. After the send: the account event `founder_notice.sent`
 * on the reader's own account events (the reader may no longer belong to the project, so not a `notify.email_sent` in
 * it) and an audit row on the project. The address never reaches a log line, the audit or an event.
 */
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { APP_NAME } from "@foundmill/config";
import { cancelWindowEnd, repos, type AuditEntry } from "@foundmill/db";
import { writeAccountEvent } from "@foundmill/events";
import {
  ACCOUNT_SAFETY_EMAIL_KINDS,
  FOUNDER_NOTICE_ACTIONS,
  FOUNDER_NOTICE_LOOKBACK_MS,
  founderNoticeEmail,
  founderNoticeOf,
  isOwnerRole,
  mockResultsAllowed,
  noticeDay,
  noticeMoment,
  NOTIFY_EMAIL_REFUSALS,
  PLATFORM_MAIL_SECRET_MIN_LENGTH,
  platformMailAddress,
  type AccountSafetyEmailKind,
  type FounderNotice,
  type NotifyEmailNotSent,
} from "@foundmill/shared";
import { DEV_PLATFORM_MAIL_SECRET, isConfigError, mockIntegrationRecord, PLATFORM_NOTIFY_KEY, suppressionHashOfEmail, type ToolContext } from "@foundmill/connectors";
import { PLATFORM_NOTIFY_CEILING_KEY, redactLinks, type NotifyEmailResponse } from "./notify-email";
import { modeFor, safeError, vendorRefusedOutright, type GatewayDeps } from "./pipeline";
import { DAY_MS } from "./rate-limit";

const Token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const FounderNoticeRequest = z.strictObject({
  userId: z.guid(),
  kind: z.literal("founder_notice"),
  businessId: z.guid(),
  data: z.strictObject({ auditId: z.guid(), cancelToken: Token.optional() }),
});
export type FounderNoticeRequest = z.infer<typeof FounderNoticeRequest>;

export const isAccountSafetyKind = (kind: unknown): kind is AccountSafetyEmailKind => typeof kind === "string" && (ACCOUNT_SAFETY_EMAIL_KINDS as readonly string[]).includes(kind);

const NIL_ID = "00000000-0000-0000-0000-000000000000";
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** The deletion that waits now (the latest request, not canceled after it), or null. */
async function pendingDeletion(deps: GatewayDeps, businessId: string): Promise<AuditEntry | null> {
  const latest = (await repos.audit.list(deps.db, businessId, { action: [FOUNDER_NOTICE_ACTIONS.requestDeletion, FOUNDER_NOTICE_ACTIONS.cancelDeletion], limit: 1 })).items[0];
  return latest && latest.action === FOUNDER_NOTICE_ACTIONS.requestDeletion ? latest : null;
}

const scheduledOf = (entry: AuditEntry): Date | null => {
  const at = str((entry.details as Record<string, unknown>).scheduledFor);
  const d = at ? new Date(at) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

export async function sendFounderNotice(deps: GatewayDeps, input: FounderNoticeRequest, service: string): Promise<NotifyEmailResponse> {
  const now = deps.now?.() ?? new Date();
  const config = deps.platformMail;
  const { userId, businessId, kind } = input;
  const notSent = (reason: NotifyEmailNotSent): NotifyEmailResponse => {
    deps.log.info({ businessId, userId, kind, reason }, "founder notice not sent");
    return { sent: false, reason, message: NOTIFY_EMAIL_REFUSALS[reason] };
  };

  // 1. Switched on and configured for where it runs.
  if (!config?.domain) return notSent("off");
  const mode = modeFor(deps, PLATFORM_NOTIFY_KEY);
  const devStack = deps.appEnv === undefined || deps.appEnv === "development" || deps.appEnv === "test";
  const strict = mode === "live" || !devStack;
  const secret = config.signingSecret && config.signingSecret.length >= PLATFORM_MAIL_SECRET_MIN_LENGTH ? config.signingSecret : strict ? null : DEV_PLATFORM_MAIL_SECRET;
  const appUrl = config.appUrl ?? "";
  if (!secret || !config.notifyLocalPart || !appUrl || (strict && (!/^https:\/\//.test(config.unsubscribeBase) || !/^https:\/\//.test(appUrl)))) return notSent("unconfigured");

  // 2. The business, archived or not, and not a sample.
  const business = await repos.businesses.get(deps.db, businessId, { includeArchived: true }).catch(() => null);
  if (!business) return notSent("not_pending");
  if (business.isDemo) return notSent("sample");
  if (mode === "mock" && deps.appEnv !== undefined && !mockResultsAllowed(deps.appEnv, business.isDemo)) return notSent("simulated");

  // 3. The audit entry: which notice, who, when, about whom.
  const entry = await repos.audit.get(deps.db, businessId, input.data.auditId).catch(() => null);
  const notice: FounderNotice | null = entry ? founderNoticeOf({ action: entry.action, details: entry.details as Record<string, unknown> }) : null;
  if (!entry || !notice || entry.actorKind !== "user" || !entry.actorId) return notSent("not_pending");
  if (now.getTime() - entry.createdAt.getTime() > FOUNDER_NOTICE_LOOKBACK_MS) return notSent("too_old");
  const details = entry.details as Record<string, unknown>;
  const actorId = entry.actorId;
  const subjectId = notice === "role_changed" || notice === "removed" ? str(details.userId) : null;
  if (userId.toLowerCase() === actorId.toLowerCase()) return notSent("own_action");

  // 4. The reader: a founder now, the person it happened to, or (a deletion) a founder someone else took out lately.
  const membership = await repos.memberships.getActive(deps.db, businessId, userId).catch(() => null);
  const isFounder = !!membership && membership.source !== "example" && isOwnerRole(membership.role);
  let reader: "founder" | "subject" | "former";
  if (subjectId && subjectId.toLowerCase() === userId.toLowerCase()) reader = "subject";
  else if (isFounder) reader = "founder";
  else if ((notice === "deletion_requested" || notice === "deletion_canceled") && (await repos.founderDepartures.formerFounder(deps.db, businessId, userId, now))) reader = "former";
  else return notSent("not_founder");

  // 5. Once per entry and person.
  const dedupeKey = `founder_notice:${entry.id}`;
  if (await repos.notifications.exists(deps.db, businessId, userId, dedupeKey)) return notSent("already_sent");

  // 6. Their address, and only a hard suppression stops it.
  const email = await repos.founders.emailOf(deps.db, userId);
  if (!email) return notSent("no_address");
  if (await repos.channels.isHardSuppressed(deps.db, businessId, suppressionHashOfEmail(email))) return notSent("hard_suppressed");

  // 7. The one-click cancel, only for this reader, this project and the deletion that still waits.
  const waiting = await pendingDeletion(deps, businessId);
  let cancel: { link: string; until: Date } | null = null;
  if (input.data.cancelToken && reader !== "founder" && waiting) {
    const row = await repos.founderDepartures.byCancelTokenHash(deps.db, sha256(input.data.cancelToken));
    const holds =
      !!row &&
      row.businessId === businessId &&
      row.userId.toLowerCase() === userId.toLowerCase() &&
      (row.how === "demoted" || row.how === "removed") &&
      !row.cancelUsedAt &&
      !!row.cancelExpiresAt &&
      row.cancelExpiresAt.getTime() > now.getTime() &&
      row.cancelRequestId === waiting.id &&
      cancelWindowEnd(row.departedAt).getTime() > now.getTime();
    if (holds) cancel = { link: `${appUrl}/a/${input.data.cancelToken}`, until: row.cancelExpiresAt! };
    else deps.log.warn({ businessId, userId, kind }, "founder notice: the cancel token did not hold; sent without it");
  }

  // The day's ceiling sees the load, best effort; it never refuses this email.
  let counted = false;
  try {
    await deps.rateLimits.hit(PLATFORM_NOTIFY_CEILING_KEY, DAY_MS, now.getTime());
    counted = true;
  } catch {
    // A store that is down does not hold an account-safety notice back.
  }
  const giveBack = async () => {
    if (!counted) return;
    counted = false;
    try {
      await deps.rateLimits.release?.(PLATFORM_NOTIFY_CEILING_KEY, DAY_MS, now.getTime());
    } catch {
      // Best effort, as the count was.
    }
  };

  // 8. The words, from the gateway's own reads.
  const prefs = await repos.emailPrefs.get(deps.db, userId).catch(() => null);
  const zone = prefs?.timeZone ?? business.timeZone ?? null;
  const nameOf = async (id: string | null) => (id ? ((await repos.founders.get(deps.db, id).catch(() => null))?.displayName?.trim() || null) : null);
  const [recipientName, actorName, subjectName] = await Promise.all([nameOf(userId), nameOf(actorId), nameOf(subjectId)]);
  const actorMembership = await repos.memberships.getActive(deps.db, businessId, actorId).catch(() => null);
  const actorFormer = notice === "deletion_canceled" && !(actorMembership && isOwnerRole(actorMembership.role)) ? await repos.founderDepartures.latest(deps.db, businessId, actorId).catch(() => null) : null;
  const scheduled = notice === "deletion_requested" ? scheduledOf(entry) : waiting ? scheduledOf(waiting) : null;
  const notificationId = randomUUID();
  const withVia = (url: string) => `${url}${url.includes("?") ? "&" : "?"}via=email&n=${notificationId}`;
  const link =
    reader === "founder"
      ? withVia(`${appUrl}/b/${businessId}/settings/${notice === "deletion_requested" || notice === "deletion_canceled" ? "danger" : "members"}`)
      : reader === "subject" && notice === "role_changed"
        ? withVia(`${appUrl}/b/${businessId}/today`)
        : null;
  const words = founderNoticeEmail({
    appName: APP_NAME,
    notice,
    reader,
    recipientName,
    actorName,
    subjectName,
    projectName: business.name,
    when: noticeMoment(entry.createdAt, zone),
    fromRole: str(details.fromRole) ?? str(details.formerRole) ?? str(details.role),
    toRole: notice === "role_changed" ? str(details.role) : null,
    scheduledFor: scheduled ? noticeDay(scheduled, zone) : null,
    actorFormerUntil: actorFormer ? noticeDay(actorFormer.departedAt, zone) : null,
    cancel: cancel ? { link: cancel.link, until: noticeMoment(cancel.until, zone) } : null,
    link,
  });
  const stored = redactLinks(words, [input.data.cancelToken]);
  const claimed = await repos.notifications.claim(deps.db, businessId, { id: notificationId, userId, kind, dedupeKey, subject: words.subject, bodyText: stored.text, bodyHtml: stored.html });
  if (!claimed) {
    await giveBack();
    return notSent("already_sent");
  }

  const ctx: ToolContext = { businessId, agentId: NIL_ID, sessionId: NIL_ID, integration: mockIntegrationRecord(PLATFORM_NOTIFY_KEY, businessId), log: deps.log, mode };
  const connector = deps.registry.get(PLATFORM_NOTIFY_KEY, mode);
  let result;
  try {
    result = await connector.callTool("send_notification", { from: { email: platformMailAddress(config.notifyLocalPart, config.domain), name: APP_NAME }, to: { email }, subject: words.subject, text: words.text, html: words.html, accountSafety: true }, ctx);
  } catch (e) {
    await giveBack();
    await repos.notifications.markFailed(deps.db, businessId, notificationId, isConfigError(e) ? "unconfigured" : "error");
    if (isConfigError(e)) return notSent("unconfigured");
    throw e;
  }
  if (!result.ok) {
    if (vendorRefusedOutright(result.error)) await giveBack();
    await repos.notifications.markFailed(deps.db, businessId, notificationId, "vendor");
    deps.log.warn({ businessId, userId, kind, code: result.error?.code, status: result.error?.status }, "founder notice refused by the provider");
    return notSent("vendor");
  }
  const data = (result.data ?? {}) as { messageId?: unknown };
  const messageId = typeof data.messageId === "string" && data.messageId ? data.messageId.slice(0, 200) : `unknown-${now.getTime()}`;
  const simulated = mode === "mock";
  await repos.notifications.markSent(deps.db, businessId, notificationId, { mode, providerMessageId: messageId, at: now });
  let eventId: string | null = null;
  try {
    eventId = await deps.db.transaction((tx) =>
      writeAccountEvent(tx as unknown as Parameters<typeof writeAccountEvent>[0], {
        userId,
        type: "founder_notice.sent",
        actor: { kind: "system", id: "notify" },
        payload: { notice, businessId, notificationId, offersCancel: cancel !== null, simulated },
        idempotencyKey: dedupeKey,
        otherAccountIds: [actorId, ...(subjectId ? [subjectId] : [])].filter((id) => id.toLowerCase() !== userId.toLowerCase()),
      }),
    );
  } catch (e) {
    deps.log.error({ businessId, userId, kind, err: safeError(e) }, "founder notice sent but founder_notice.sent could not be written");
  }
  await repos.audit
    .append(deps.db, businessId, { actorKind: "system", action: "gateway.notify.founder_notice_sent", target: { kind: "audit_entry", id: entry.id }, details: { service, mode, simulated, notice, reader, userId, notificationId, offersCancel: cancel !== null } })
    .catch((e: unknown) => deps.log.warn({ businessId, reason: e instanceof Error ? e.name : "unknown" }, "founder notice audit not written"));
  deps.log.info({ businessId, userId, kind, notice, mode }, "founder notice sent");
  return { sent: true, simulated, eventId };
}
