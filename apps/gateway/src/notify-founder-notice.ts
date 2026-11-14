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
 *   4. the reader: never the person who did it (`own_action`), but for one receipt: the person who asked for a deletion
 *      (`self`, whatever the team's size); a founder of the project now (an owner or a cofounder, not through an example
 *      membership, not ended), or the person whose role changed or who was removed, or, for a deletion and its cancel, a
 *      former founder for the request (someone else took their standing away within 30 days before it, or after it: "in
 *      the window"; every one of them, uncapped, since they may cancel it) or, beyond the window, one of the
 *      `FOUNDER_NOTICE_LIMITS.formerPerRequest` (50) people someone else most recently took out of the project who have
 *      not got the standing back (`founder_departures`); anyone else is `not_founder`;
 *   5. once per entry and person (`founder_notifications`' dedupe key `founder_notice:<audit id>`);
 *   6. their address, from `auth.users`, and no hard suppression of it (`isHardSuppressed`: a bounce or a spam report,
 *      platform-wide or for this project). Nothing else holds it back: no email switch, no pause, no daily limit, no
 *      project outreach room, and not "Don't send me invitations": these are about who runs a project the person
 *      founded and whether it is deleted;
 *   7. the one-click cancel, only when the api sent a token for this reader (a former founder, or the person just
 *      removed or demoted, while a deletion waits): its SHA-256 must be this person's `founder_cancel_links` row in this
 *      project, unused, in date, for the deletion request that is still the latest and still waiting, and the person a
 *      former founder for it. A token that does not hold is left out (the email still goes, saying to ask a founder);
 *   8. the counts. An ordinary notice: their own enforced daily ceiling (`pn:safety:day`, PLATFORM_SAFETY_DAILY_CEILING,
 *      `safety_ceiling`), never the shared `pn:all:day`, and a cap per project under it (`project_ceiling`); and per
 *      person and project at most `FOUNDER_NOTICE_LIMITS.perRecipientHour` an hour and `perRecipientDay` a day. Past
 *      either, one "more changes" email for the window, and every further notice in it is recorded as `folded`, not
 *      sent. An essential notice (`isEssentialFounderNotice`: it carries the cancel; the removal's email to the person
 *      removed; a deletion request's to a founder now, to the one who asked and to a former founder in the window)
 *      skips those and is bounded on its own (final review): `essentialPerRecipientDay` (10) a day per person across
 *      every project (`pn:safety:essential:<user>:day`), and a circuit breaker over all of them
 *      (`pn:safety:reserved:day`, PLATFORM_SAFETY_RESERVED_DAILY_CEILING, default 20,000; a warning at half, an error at
 *      the ceiling). Past either, until the end of the UTC day, one email per deletion of the person's own and one fold
 *      (marker `pn:safety-more:essential:<user>:<request|none>:<day>`): a notice that carries its own request's cancel,
 *      or a deletion request that still waits (whoever reads it), goes in full, once for that request; any other becomes
 *      one "More changes to who runs your projects" email carrying the latest deletion they may cancel (a link minted
 *      here; when it cannot be made, the fold counts as the one for none), once for that one. Past the breaker, at most
 *      `perRequestPastBreakerDay` (3) of the person's own a day in each project (keyed by person and project) and one
 *      fold for the rest (`breaker-fold`; released again when its link cannot be made). A ceiling already reached is
 *      refused before it is counted, so refused calls do not push the counters over it. Past twice
 *      the breaker (`reservedHardFactor`), nothing essential goes (`reserved_hard_ceiling`, logged as an error): the
 *      day's essential mail has a fixed ceiling, however many accounts act. Every further essential notice is recorded
 *      as `folded` (or `folded_reserved_ceiling`, `reserved_hard_ceiling`), never dropped silently.
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
import { repos, type AuditEntry } from "@foundmill/db";
import { writeAccountEvent } from "@foundmill/events";
import {
  ACCOUNT_SAFETY_EMAIL_KINDS,
  FORMER_FOUNDER_LOOKBACK_MS,
  FOUNDER_NOTICE_ACTIONS,
  FOUNDER_NOTICE_LOOKBACK_MS,
  FOUNDER_NOTICE_LIMITS,
  isEssentialFounderNotice,
  founderNoticeEmail,
  founderNoticeEssentialMoreEmail,
  founderNoticeMoreEmail,
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
import { newActionToken } from "@foundmill/shared/email-links";
import { DEV_PLATFORM_MAIL_SECRET, isConfigError, mockIntegrationRecord, PLATFORM_NOTIFY_KEY, suppressionHashOfEmail, type ToolContext } from "@foundmill/connectors";
import { redactLinks, type NotifyEmailResponse } from "./notify-email";
import { modeFor, safeError, vendorRefusedOutright, type GatewayDeps } from "./pipeline";
import { DAY_MS, windowStart } from "./rate-limit";

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
const HOUR_MS = 3_600_000;

/** Every founder notice together in a UTC day: their own ceiling, never `pn:all:day`. */
export const PLATFORM_SAFETY_CEILING_KEY = "pn:safety:day";
/**
 * The essential founder notices of a UTC day (`isEssentialFounderNotice`), every person together: a circuit breaker
 * (PLATFORM_SAFETY_RESERVED_DAILY_CEILING), past which each person gets one folded email for the day.
 */
export const PLATFORM_SAFETY_RESERVED_KEY = "pn:safety:reserved:day";
/**
 * Past the breaker: the emails one person got today for a deletion of their own in one project
 * (`perRequestPastBreakerDay`), keyed by person and project (bounds check, P2: another project's requests no longer use
 * up this one's; the project's own cap of 3 requests a day bounds it).
 */
export const founderNoticeRequestsPastBreakerKey = (userId: string, businessId: string): string => `pn:safety:essential-requests:${userId.toLowerCase()}:${businessId.toLowerCase()}:day`;
/** The essential founder notices one person got today, across every project (`essentialPerRecipientDay`). */
export const founderNoticeEssentialKey = (userId: string): string => `pn:safety:essential:${userId.toLowerCase()}:day`;
/**
 * The marker that today's one email past this person's essential share went out for one deletion they may cancel
 * (`requestId`), or for none: keyed on the request (final review, P1-A), so a deletion that becomes cancellable later in
 * the day still gets its one email with its link, and on the UTC day, as the counters are.
 */
export const founderNoticeEssentialMoreKey = (userId: string, requestId: string | null, now: number): string => `pn:safety-more:essential:${userId.toLowerCase()}:${requestId?.toLowerCase() ?? "none"}:${windowStart(now, DAY_MS)}`;
/** Past the breaker, the one fold of this person's day (it carries the latest deletion they may cancel). */
export const founderNoticeBreakerFoldKey = (userId: string, now: number): string => `pn:safety-more:essential:${userId.toLowerCase()}:breaker-fold:${windowStart(now, DAY_MS)}`;
/** How long a marker set now lasts: to the end of this UTC day, as the day's counters do. */
const untilEndOfUtcDay = (now: number): number => windowStart(now, DAY_MS) + DAY_MS - now;
/** Every founder notice about one project in a UTC day, under the platform's ceiling (`perProjectDay`). */
export const founderNoticeProjectKey = (businessId: string): string => `pn:safety:project:${businessId.toLowerCase()}:day`;
/** Founder notices one person got about one project, this hour and today. */
export const founderNoticeHourKey = (userId: string, businessId: string): string => `pn:safety:${userId.toLowerCase()}:${businessId.toLowerCase()}:hour`;
export const founderNoticeDayKey = (userId: string, businessId: string): string => `pn:safety:${userId.toLowerCase()}:${businessId.toLowerCase()}:day`;
/** The marker that the "more changes" email for this window went out. */
export const founderNoticeMoreKey = (userId: string, businessId: string, window: "hour" | "day"): string => `pn:safety-more:${userId.toLowerCase()}:${businessId.toLowerCase()}:${window}`;
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** The deletion that waits now (the latest request, not canceled after it), or null. */
async function pendingDeletion(deps: GatewayDeps, businessId: string): Promise<AuditEntry | null> {
  const latest = (await repos.audit.list(deps.db, businessId, { action: [FOUNDER_NOTICE_ACTIONS.requestDeletion, FOUNDER_NOTICE_ACTIONS.cancelDeletion], limit: 1 })).items[0];
  return latest && latest.action === FOUNDER_NOTICE_ACTIONS.requestDeletion ? latest : null;
}

/** The request a cancel entry canceled: the latest request written before it on the chain (null when none is found). */
async function canceledRequest(deps: GatewayDeps, businessId: string, cancelEntry: AuditEntry): Promise<AuditEntry | null> {
  const requests = (await repos.audit.list(deps.db, businessId, { action: FOUNDER_NOTICE_ACTIONS.requestDeletion, limit: 20 })).items;
  return requests.find((r) => Number(r.seq) < Number(cancelEntry.seq)) ?? null;
}

const scheduledOf = (entry: AuditEntry): Date | null => {
  const at = str((entry.details as Record<string, unknown>).scheduledFor);
  const d = at ? new Date(at) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

/** At most this many of a person's projects are looked through for the deletion they may still cancel. */
const LATEST_CANCEL_PROJECTS = 50;

/**
 * The latest deletion this person may still cancel, in any project: a waiting request, before its day, that they are a
 * former founder for (as the card on their home reads it). Their departures are read most recent first, at most
 * `LATEST_CANCEL_PROJECTS` of them. Null when there is none.
 */
async function latestCancelFor(deps: GatewayDeps, userId: string, now: Date): Promise<{ businessId: string; businessName: string; request: AuditEntry; until: Date } | null> {
  const departures = await repos.founderDepartures.forUser(deps.db, userId, new Date(now.getTime() - FORMER_FOUNDER_LOOKBACK_MS - 14 * DAY_MS));
  let best: { businessId: string; businessName: string; request: AuditEntry; until: Date } | null = null;
  for (const d of departures.slice(0, LATEST_CANCEL_PROJECTS)) {
    const waiting = await pendingDeletion(deps, d.businessId);
    const until = waiting ? scheduledOf(waiting) : null;
    if (!waiting || !until || until.getTime() <= now.getTime()) continue;
    if (best && waiting.createdAt.getTime() <= best.request.createdAt.getTime()) continue;
    if (!(await repos.founderDepartures.formerFounderFor(deps.db, d.businessId, userId, waiting.createdAt))) continue;
    best = { businessId: d.businessId, businessName: d.businessName, request: waiting, until };
  }
  return best;
}

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
  // Nobody is emailed about their own step, but for one receipt: the person who asked for a deletion, whatever the
  // team's size (second review, P2-2), in case it was not them.
  const isActor = userId.toLowerCase() === actorId.toLowerCase();
  if (isActor && notice !== "deletion_requested") return notSent("own_action");

  // 4. The reader: the person who asked (the receipt), the person it happened to, a founder now, or (a deletion) a
  //    former founder for the request: someone else took their standing away within 30 days before it, or after it.
  const membership = await repos.memberships.getActive(deps.db, businessId, userId).catch(() => null);
  const isFounder = !!membership && membership.source !== "example" && isOwnerRole(membership.role);
  const request = notice === "deletion_requested" ? entry : notice === "deletion_canceled" ? await canceledRequest(deps, businessId, entry) : null;
  let reader: "founder" | "subject" | "former" | "self" | undefined;
  if (isActor) reader = "self";
  else if (subjectId && subjectId.toLowerCase() === userId.toLowerCase()) reader = "subject";
  else if (isFounder) reader = "founder";
  else reader = undefined;
  // A deletion and its cancel reach every former founder for the request (someone else took their standing away within
  // 30 days before it, or after it), uncapped: they may cancel it, and their per-person share bounds what each gets
  // (final review, P1-B). Beyond that window, anyone else someone took out of the project hears too (third review), the
  // `formerPerRequest` (50) most recent of them.
  const windowDeparture = request && reader === undefined ? await repos.founderDepartures.formerFounderFor(deps.db, businessId, userId, request.createdAt) : null;
  if (reader === undefined) {
    if (windowDeparture) reader = "former";
    else if (request && (await repos.founderDepartures.formerFoundersLongAgo(deps.db, businessId, request.createdAt, { limit: FOUNDER_NOTICE_LIMITS.formerPerRequest })).some((r) => r.userId.toLowerCase() === userId.toLowerCase())) reader = "former";
    else return notSent("not_founder");
  }
  // A former founder for this request (in the window): their deletion email is essential, with or without its link.
  const inWindow = reader === "former" && notice === "deletion_requested" && windowDeparture !== null;

  // 5. Once per entry and person.
  const dedupeKey = `founder_notice:${entry.id}`;
  if (await repos.notifications.exists(deps.db, businessId, userId, dedupeKey)) return notSent("already_sent");

  // 6. Their address, and of every suppression only a hard one stops it.
  const email = await repos.founders.emailOf(deps.db, userId);
  if (!email) return notSent("no_address");
  if (await repos.channels.isHardSuppressed(deps.db, businessId, suppressionHashOfEmail(email))) return notSent("hard_suppressed");

  // 7. The one-click cancel: this person's own link, for this project and the deletion that still waits, while they
  //    are one of its former founders.
  const waiting = await pendingDeletion(deps, businessId);
  let cancel: { link: string; until: Date } | null = null;
  if (input.data.cancelToken && (reader === "former" || reader === "subject") && waiting) {
    const link = await repos.founderCancelLinks.byTokenHash(deps.db, sha256(input.data.cancelToken));
    const holds =
      !!link &&
      link.businessId === businessId &&
      link.userId.toLowerCase() === userId.toLowerCase() &&
      !link.usedAt &&
      link.expiresAt.getTime() > now.getTime() &&
      link.requestId === waiting.id &&
      (await repos.founderDepartures.formerFounderFor(deps.db, businessId, userId, waiting.createdAt)) !== null;
    if (holds) cancel = { link: `${appUrl}/a/${input.data.cancelToken}`, until: link!.expiresAt };
    else deps.log.warn({ businessId, userId, kind }, "founder notice: the cancel token did not hold; sent without it");
  }

  // 8. The counts (second, third and final reviews). An ordinary notice: founder notices have their own daily ceiling,
  //    enforced and apart from the one every other email to people shares (`pn:all:day`), a cap per project under it,
  //    and one person hears about one project at most `perRecipientHour` times an hour and `perRecipientDay` a day; past
  //    either, one email says that more changed and the rest of the window's notices are folded into it (recorded as
  //    `folded`, never sent). An essential notice skips those and has bounds of its own: `essentialPerRecipientDay` a day
  //    per person across every project, and the reserved circuit breaker over all of them; past either, one folded email
  //    for the person's day, carrying the latest deletion they may still cancel, and the rest recorded as folded. A store
  //    that is not shared right now still counts on this replica: an account-safety notice is not held back by a Redis
  //    outage.
  const essential = isEssentialFounderNotice({ notice, reader, carriesCancel: cancel !== null, inWindow });
  const ceiling = config.safetyCeiling ?? FOUNDER_NOTICE_LIMITS.safetyCeilingDefault;
  const reservedCeiling = config.safetyReservedCeiling ?? FOUNDER_NOTICE_LIMITS.reservedCeilingDefault;
  const counted: [string, number][] = [];
  let marker: string | null = null;
  // A cancel link minted here for the day's folded email: forgotten again when that email is not sent.
  let minted: { id: string; token: string } | null = null;
  const forgetMinted = async () => {
    if (!minted) return;
    const id = minted.id;
    minted = null;
    await repos.founderCancelLinks.remove(deps.db, id).catch(() => undefined);
  };
  const giveBack = async () => {
    for (const [key, windowMs] of counted.splice(0)) {
      try {
        await deps.rateLimits.release?.(key, windowMs, now.getTime());
      } catch {
        // Best effort.
      }
    }
    await releaseMarker();
  };
  // The "More changes" email did not go out (its send failed, or another call recorded this notice first): the next
  // notice of the window may send it.
  async function releaseMarker(): Promise<void> {
    if (!marker) return;
    const key = marker;
    marker = null;
    try {
      await deps.rateLimits.unclaim?.(key);
    } catch {
      // Best effort.
    }
  }
  const hit = async (key: string, windowMs: number): Promise<number> => {
    const r = await deps.rateLimits.hit(key, windowMs, now.getTime());
    counted.push([key, windowMs]);
    return r.count;
  };
  // Read before counting (bounds check, P3): a ceiling already reached is refused without a hit, so a burst of refused
  // calls does not push the counter over it; the check after the hit still decides for calls that race.
  const full = async (key: string, windowMs: number, limit: number): Promise<boolean> => (deps.rateLimits.count ? (await deps.rateLimits.count(key, windowMs, now.getTime())) >= limit : false);
  const claimFirst = async (key: string, windowMs: number): Promise<boolean> => (deps.rateLimits.claim ? await deps.rateLimits.claim(key, windowMs, now.getTime()) : false);
  let more = false;
  let foldAll = false;
  let breaker = false;
  let foldLatest: Awaited<ReturnType<typeof latestCancelFor>> = null;
  const hardCeiling = reservedCeiling * FOUNDER_NOTICE_LIMITS.reservedHardFactor;
  const heldBack = async (): Promise<NotifyEmailResponse> => {
    await giveBack();
    await repos.notifications.skip(deps.db, businessId, { userId, kind, dedupeKey, reason: "reserved_hard_ceiling" }).catch(() => undefined);
    deps.log.error({ businessId, userId, kind, ceiling: hardCeiling }, "essential founder notice not sent: past the hard daily ceiling");
    return notSent("reserved_hard_ceiling");
  };
  if (essential && (await full(PLATFORM_SAFETY_RESERVED_KEY, DAY_MS, hardCeiling))) return heldBack();
  if (!essential && (await full(PLATFORM_SAFETY_CEILING_KEY, DAY_MS, ceiling))) return notSent("safety_ceiling");
  if (!essential && (await full(founderNoticeProjectKey(businessId), DAY_MS, FOUNDER_NOTICE_LIMITS.perProjectDay))) return notSent("project_ceiling");
  if (essential) {
    const reserved = await hit(PLATFORM_SAFETY_RESERVED_KEY, DAY_MS);
    if (reserved === Math.ceil(reservedCeiling / 2) && reserved < reservedCeiling) deps.log.warn({ count: reserved, ceiling: reservedCeiling }, "essential founder notices: half of the reserved daily ceiling is used");
    if (reserved === reservedCeiling) deps.log.error({ count: reserved, ceiling: reservedCeiling }, "essential founder notices: the reserved daily ceiling is reached; past it each person gets one folded email for the day");
    // The hard stop (verification of the final review): the day's essential mail has a fixed ceiling, however many
    // accounts act. Recorded, logged, never silent; the card on the person's home still shows a deletion they may cancel.
    if (reserved > hardCeiling) return heldBack();
    breaker = reserved > reservedCeiling;
    const mine = await hit(founderNoticeEssentialKey(userId), DAY_MS);
    if (breaker || mine > FOUNDER_NOTICE_LIMITS.essentialPerRecipientDay) {
      // Past the share (or the breaker): one email per deletion of the person's own, and one fold, until the end of the
      // UTC day. A deletion of their own is the request this notice carries the cancel for, or, for a deletion request
      // that still waits, that request whoever the reader is (verification of the final review, P2: a founder's real
      // request is never folded away); its notice goes in full, once for that request. Any other notice is folded into
      // one email carrying the latest deletion they may cancel, once for that one (or for none). Past the breaker, at
      // most `perRequestPastBreakerDay` (3) of the person's own a day, and one fold for everything else.
      let own = cancel && waiting ? waiting.id : notice === "deletion_requested" && waiting && waiting.id === entry.id ? entry.id : null;
      if (own && breaker && (await hit(founderNoticeRequestsPastBreakerKey(userId, businessId), DAY_MS)) > FOUNDER_NOTICE_LIMITS.perRequestPastBreakerDay) own = null;
      foldLatest = own ? null : await latestCancelFor(deps, userId, now).catch(() => null);
      const key = own ? founderNoticeEssentialMoreKey(userId, own, now.getTime()) : breaker ? founderNoticeBreakerFoldKey(userId, now.getTime()) : founderNoticeEssentialMoreKey(userId, foldLatest?.request.id ?? null, now.getTime());
      if (!(await claimFirst(key, untilEndOfUtcDay(now.getTime())))) {
        await giveBack();
        const reason = breaker ? "folded_reserved_ceiling" : "folded";
        await repos.notifications.skip(deps.db, businessId, { userId, kind, dedupeKey, reason }).catch(() => undefined);
        if (breaker) deps.log.warn({ businessId, userId, kind }, "essential founder notice folded: past the reserved daily ceiling");
        return notSent("folded");
      }
      marker = key;
      foldAll = own === null;
    }
  } else {
    if ((await hit(PLATFORM_SAFETY_CEILING_KEY, DAY_MS)) > ceiling) {
      await giveBack();
      return notSent("safety_ceiling");
    }
    if ((await hit(founderNoticeProjectKey(businessId), DAY_MS)) > FOUNDER_NOTICE_LIMITS.perProjectDay) {
      await giveBack();
      return notSent("project_ceiling");
    }
    const overHour = (await hit(founderNoticeHourKey(userId, businessId), HOUR_MS)) > FOUNDER_NOTICE_LIMITS.perRecipientHour;
    const overDay = (await hit(founderNoticeDayKey(userId, businessId), DAY_MS)) > FOUNDER_NOTICE_LIMITS.perRecipientDay;
    if (overHour || overDay) {
      const window = overDay ? "day" : "hour";
      const key = founderNoticeMoreKey(userId, businessId, window);
      if (!(await claimFirst(key, window === "day" ? DAY_MS : HOUR_MS))) {
        await giveBack();
        await repos.notifications.skip(deps.db, businessId, { userId, kind, dedupeKey, reason: "folded" }).catch(() => undefined);
        return notSent("folded");
      }
      marker = key;
      more = true;
    }
  }

  // The folded email carries the latest deletion this person may still cancel, through a link minted here for it (the
  // notice in hand carried no cancel of its own: one that did went in full above).
  let foldCancel: { link: string; until: Date; projectName: string } | null = null;
  if (foldAll && foldLatest) {
    const fresh = newActionToken();
    const row = await repos.founderCancelLinks.create(deps.db, { businessId: foldLatest.businessId, userId, requestId: foldLatest.request.id, tokenHash: fresh.hash, expiresAt: foldLatest.until }).catch(() => null);
    if (row) {
      minted = { id: row.id, token: fresh.token };
      foldCancel = { link: `${appUrl}/a/${fresh.token}`, until: foldLatest.until, projectName: foldLatest.businessName };
    } else if (breaker) {
      // Past the breaker, the same (bounds check, P3): this fold went without the link, so the day's fold marker is
      // released and a later notice may still bring the latest cancel.
      await releaseMarker();
    } else {
      // The link could not be made (verification of the final review, P3): this email does not stand for that request,
      // so its marker is released (the request's own email can still go) and the fold counts as the one for none.
      await releaseMarker();
      const none = founderNoticeEssentialMoreKey(userId, null, now.getTime());
      if (!(await claimFirst(none, untilEndOfUtcDay(now.getTime())))) {
        await giveBack();
        await repos.notifications.skip(deps.db, businessId, { userId, kind, dedupeKey, reason: "folded" }).catch(() => undefined);
        return notSent("folded");
      }
      marker = none;
    }
  }
  const offersCancel = foldAll ? foldCancel !== null : cancel !== null;

  // 9. The words, from the gateway's own reads.
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
    reader === "founder" || reader === "self"
      ? withVia(`${appUrl}/b/${businessId}/settings/${notice === "deletion_requested" || notice === "deletion_canceled" ? "danger" : "members"}`)
      : reader === "subject" && notice === "role_changed"
        ? withVia(`${appUrl}/b/${businessId}/today`)
        : null;
  const cancelWords = cancel ? { link: cancel.link, until: noticeMoment(cancel.until, zone) } : null;
  const words = foldAll
    ? founderNoticeEssentialMoreEmail({ appName: APP_NAME, recipientName, link: `${appUrl}/`, cancel: foldCancel ? { link: foldCancel.link, until: noticeMoment(foldCancel.until, zone), projectName: foldCancel.projectName } : null })
    : more
    ? founderNoticeMoreEmail({ appName: APP_NAME, recipientName, projectName: business.name, isFounder: reader === "founder" || reader === "self", link: reader === "founder" || reader === "self" ? withVia(`${appUrl}/b/${businessId}/today`) : null, cancel: cancelWords })
    : founderNoticeEmail({
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
    cancel: cancelWords,
    link,
  });
  const stored = redactLinks(words, [input.data.cancelToken, ...(minted ? [minted.token] : [])]);
  const claimed = await repos.notifications.claim(deps.db, businessId, { id: notificationId, userId, kind, dedupeKey, subject: words.subject, bodyText: stored.text, bodyHtml: stored.html });
  if (!claimed) {
    await giveBack();
    await forgetMinted();
    return notSent("already_sent");
  }

  const ctx: ToolContext = { businessId, agentId: NIL_ID, sessionId: NIL_ID, integration: mockIntegrationRecord(PLATFORM_NOTIFY_KEY, businessId), log: deps.log, mode };
  const connector = deps.registry.get(PLATFORM_NOTIFY_KEY, mode);
  let result;
  try {
    result = await connector.callTool("send_notification", { from: { email: platformMailAddress(config.notifyLocalPart, config.domain), name: APP_NAME }, to: { email }, subject: words.subject, text: words.text, html: words.html, accountSafety: true }, ctx);
  } catch (e) {
    await giveBack();
    // A send that threw may still have gone out: a link minted for it is kept (it works once, for its own request).
    await repos.notifications.markFailed(deps.db, businessId, notificationId, isConfigError(e) ? "unconfigured" : "error");
    if (isConfigError(e)) return notSent("unconfigured");
    throw e;
  }
  if (!result.ok) {
    if (vendorRefusedOutright(result.error)) await giveBack();
    else await releaseMarker();
    await forgetMinted();
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
        payload: { notice, businessId, notificationId, offersCancel, simulated },
        idempotencyKey: dedupeKey,
        otherAccountIds: [actorId, ...(subjectId ? [subjectId] : [])].filter((id) => id.toLowerCase() !== userId.toLowerCase()),
      }),
    );
  } catch (e) {
    deps.log.error({ businessId, userId, kind, err: safeError(e) }, "founder notice sent but founder_notice.sent could not be written");
  }
  await repos.audit
    .append(deps.db, businessId, { actorKind: "system", action: "gateway.notify.founder_notice_sent", target: { kind: "audit_entry", id: entry.id }, details: { service, mode, simulated, notice, reader, userId, notificationId, offersCancel, more, essential, foldedAll: foldAll, breaker } })
    .catch((e: unknown) => deps.log.warn({ businessId, reason: e instanceof Error ? e.name : "unknown" }, "founder notice audit not written"));
  deps.log.info({ businessId, userId, kind, notice, mode }, "founder notice sent");
  // Whether the email that went carried a cancel, for the api's record (final review, P3).
  return { sent: true, simulated, eventId, offersCancel };
}
