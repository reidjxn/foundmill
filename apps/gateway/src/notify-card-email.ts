/**
 * `POST /v1/notify/email` for a person with a kept card and no project yet (WP-04 T12): kind `getting_started` with
 * `businessId: null` and `data: { ideaId, stage }`, stage `card_saved` (an hour after the card) or `card_week` (a week
 * after). Only the orchestrator's sweep asks, with ids only. The same sender, connector, address and ceiling as every
 * email Foundmill sends a person; the gateway trusts nothing but the ids and reads everything again:
 *   1. platform mail switched on and configured for where it runs; a mock send only where simulated results are allowed;
 *   2. the card: this person's, kept, not started and not archived, and the person has no project (`cardHolders`);
 *   3. the person's own switch for `getting_started`, and their emails not paused;
 *   4. the stage due now by the notifier's own rule (`dueCardEmail`), from the record of what was sent;
 *   5. the address, from `auth.users`, not suppressed platform-wide (a bounce, a spam report, "Don't send me invitations");
 *   6. once (a marker in Redis), then the person's three a day (the same count as their projects' email, as one of the
 *      first two: `LIFECYCLE_PER_PERSON_PER_DAY`) and Foundmill's own ceiling.
 * The record is a `founder_notifications` row with no business (0132), readable only by its person. No event and no
 * audit row: there is no project to write them in. The address never reaches a log line.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { APP_NAME, APP_POSTAL_ADDRESS } from "@foundmill/config";
import { repos } from "@foundmill/db";
import { cardEmail, dueCardEmail, LIFECYCLE_PER_PERSON_PER_DAY, LIFECYCLE_TIMING, mockResultsAllowed, NOTIFY_EMAIL_REFUSALS, NOTIFY_ITEM_MARKER_MS, NOTIFY_PROJECT_MAIL_HEADROOM, PLATFORM_MAIL_SECRET_MIN_LENGTH, platformMailAddress, type NotifyEmailNotSent } from "@foundmill/shared";
import { signPauseToken } from "@foundmill/shared/email-links";
import { DEV_PLATFORM_MAIL_SECRET, isConfigError, mockIntegrationRecord, notifyOffToken, notifyOffUrl, PLATFORM_NOTIFY_KEY, suppressionHashOfEmail, type ToolContext } from "@foundmill/connectors";
import { notifyPersonDayKey, PLATFORM_NOTIFY_CEILING_KEY, redactLinks, type NotifyEmailResponse } from "./notify-email";
import { modeFor, vendorRefusedOutright, type GatewayDeps } from "./pipeline";
import { PLATFORM_MAIL_CEILING_KEY, PLATFORM_NOTIFY_DEFAULT_CEILING } from "./platform-mail";
import { DAY_MS } from "./rate-limit";

export const CardEmailRequest = z.strictObject({
  userId: z.guid(),
  kind: z.literal("getting_started"),
  businessId: z.null(),
  data: z.strictObject({ ideaId: z.guid(), stage: z.enum(["card_saved", "card_week"]) }),
});
export type CardEmailRequest = z.infer<typeof CardEmailRequest>;

/** A request for the card email: `getting_started` with no business. */
export const isCardEmailRequest = (body: unknown): boolean => {
  const b = body as { kind?: unknown; businessId?: unknown } | null;
  return b?.kind === "getting_started" && b.businessId === null;
};

const NIL_ID = "00000000-0000-0000-0000-000000000000";

export async function sendCardEmail(deps: GatewayDeps, input: CardEmailRequest, service: string): Promise<NotifyEmailResponse> {
  const now = deps.now?.() ?? new Date();
  const config = deps.platformMail;
  const { userId, data } = input;
  const notSent = (reason: NotifyEmailNotSent): NotifyEmailResponse => {
    deps.log.info({ userId, kind: input.kind, stage: data.stage, reason }, "card email not sent");
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
  if (mode === "mock" && deps.appEnv !== undefined && !mockResultsAllowed(deps.appEnv, false)) return notSent("simulated");

  // 2. The card, as the sweep reads it: this person's newest kept card, with no project yet.
  const [card] = await repos.notifyFacts.cardHolders(deps.db, new Date(now.getTime() - LIFECYCLE_TIMING.cardWithinMs), { only: { userId, ideaId: data.ideaId } });
  if (!card) return notSent("not_pending");

  // 3. Their switch and the pause.
  const prefs = await repos.preferences.get(deps.db, userId);
  if (!prefs.email.getting_started) return notSent("turned_off");
  const extra = await repos.emailPrefs.get(deps.db, userId);
  if (extra.emailsPausedAt) return notSent("paused");

  // 4. Due now, by the notifier's rule, from the record.
  const history = (await repos.notifications.lifecycleHistory(deps.db, null, [userId])).get(userId) ?? [];
  const due = dueCardEmail(card, { lastSeenAt: null, history }, now);
  if (!due || due.stage !== data.stage) return notSent("not_waiting");

  // 5. The address, and the platform's suppression list.
  const email = await repos.founders.emailOf(deps.db, userId);
  if (!email) return notSent("no_address");
  if (await repos.channels.isSuppressed(deps.db, NIL_ID, { emailHash: suppressionHashOfEmail(email) })) return notSent("hard_suppressed");

  // 6. Once, the projects' room, then the counts, shared by every replica.
  const shared = () => devStack || deps.rateLimits.durable === true;
  const itemKey = `pn:item:${userId.toLowerCase()}:${due.dedupeKey.toLowerCase()}`;
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
  const caps: [string, number, NotifyEmailNotSent][] = [
    [notifyPersonDayKey(userId), LIFECYCLE_PER_PERSON_PER_DAY, "per_person"],
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

  // The words, the record (its id travels in the link), the send.
  const notificationId = randomUUID();
  const offUrl = notifyOffUrl(config.unsubscribeBase, notifyOffToken(secret, userId, "getting_started"));
  const pauseToken = config.pauseSecret ? signPauseToken(config.pauseSecret, userId, now.getTime()) : null;
  const pauseLink = pauseToken ? `${appUrl}/email/pause?t=${encodeURIComponent(pauseToken)}` : offUrl;
  const profile = await repos.founders.get(deps.db, userId).catch(() => null);
  const words = cardEmail({ stage: due.stage as "card_saved" | "card_week", appName: APP_NAME, recipientName: profile?.displayName ?? null, ideaTitle: card.title, link: `${appUrl}/new/commit/${card.ideaId}?via=email`, offLink: offUrl, pauseLink, postalAddress: APP_POSTAL_ADDRESS });
  const stored = redactLinks(words, [pauseToken]);
  const claimed = await repos.notifications.claim(deps.db, null, { id: notificationId, userId, kind: "getting_started", dedupeKey: due.dedupeKey, subject: words.subject, bodyText: stored.text, bodyHtml: stored.html });
  if (!claimed) {
    await release();
    return notSent("already_sent");
  }
  const ctx: ToolContext = { businessId: NIL_ID, agentId: NIL_ID, sessionId: NIL_ID, integration: mockIntegrationRecord(PLATFORM_NOTIFY_KEY, NIL_ID), log: deps.log, mode };
  const connector = deps.registry.get(PLATFORM_NOTIFY_KEY, mode);
  let result;
  try {
    result = await connector.callTool("send_notification", { from: { email: platformMailAddress(config.notifyLocalPart, config.domain), name: APP_NAME }, to: { email }, subject: words.subject, text: words.text, html: words.html, unsubscribeUrl: offUrl }, ctx);
  } catch (e) {
    await release();
    await repos.notifications.markFailed(deps.db, null, notificationId, isConfigError(e) ? "unconfigured" : "error");
    if (isConfigError(e)) return notSent("unconfigured");
    throw e;
  }
  if (!result.ok) {
    if (vendorRefusedOutright(result.error)) await release();
    await repos.notifications.markFailed(deps.db, null, notificationId, "vendor");
    deps.log.warn({ userId, kind: input.kind, code: result.error?.code, status: result.error?.status }, "card email refused by the provider");
    return notSent("vendor");
  }
  const messageId = typeof (result.data as { messageId?: unknown } | undefined)?.messageId === "string" ? String((result.data as { messageId: string }).messageId).slice(0, 200) : `unknown-${now.getTime()}`;
  await repos.notifications.markSent(deps.db, null, notificationId, { mode, providerMessageId: messageId, at: now });
  deps.log.info({ userId, kind: input.kind, stage: due.stage, mode, service }, "card email sent");
  return { sent: true, simulated: mode === "mock", eventId: null };
}
