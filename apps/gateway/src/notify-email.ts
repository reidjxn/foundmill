/**
 * `POST /v1/notify/email` (docs/THESIS_REVIEW.md packages 1.5 and 5.1): Foundmill's own email to one of its users, about
 * their own project. Only the api asks (service token `svc: api`): its notify pass picked a note that waited a day for
 * the person's answer. No agent reaches this (the `platform_notify` connector is service-only) and no Cedar ask applies:
 * the person is a user being told about their own project, not someone outside it.
 *
 * The api sends ids only (`{ userId, kind, businessId, data: { inboxItemId } }`); the gateway trusts none of it beyond
 * the ids and reads everything again, in this order, before any vendor call:
 *
 *   1. platform mail switched on (PLATFORM_MAIL_DOMAIN) and configured for where it runs (live, or outside development
 *      and test: the signing secret, an https INGEST_PUBLIC_URL and an https APP_URL); a mock send only where simulated
 *      results are allowed (`mockResultsAllowed`), never for a person's project on staging or production;
 *   2. the business: live and not a sample (`is_demo`): nobody is emailed about a sample;
 *   3. the person: a member of it, not through an example membership, who can read the Inbox;
 *   4. their own switch for this kind (`account_preferences.notifications.email`), on;
 *   5. the note: this business's, still needing an answer, unopened by the person on any device, at least a day old;
 *   6. their address, from `auth.users` (never from the request);
 *   7. the counts, in Redis shared by every replica: one email a day per person and project, three a day per person
 *      across projects, and the deployment's daily ceiling for the platform domain (the same `pm:all:day` every project's
 *      message counts against). Outside development and test a count that is not shared refuses the send.
 *
 * The words are built here (`decisionWaitingEmail`, packages/shared) from the gateway's own reads: the person's name, the
 * project's, the agent's as the person names agents, the note's subject without its entity markup. The footer's link
 * turns this kind off for the person (`notifyOffToken`, signed under its own label). After the send, one
 * `notify.email_sent` (user id only, never the address; `simulated`) through the outbox, keyed per person and UTC day in
 * the business, and an audit row with the same. Every "not sent" is an answer (`sent: false`, a reason and a plain
 * sentence), never an error. The address never reaches a log line, the audit or an event.
 */
import { z } from "zod";
import { APP_NAME } from "@foundmill/config";
import { notifyEmailDayKey, repos } from "@foundmill/db";
import {
  agentLabel,
  decisionWaitingEmail,
  EMAIL_NOTIFICATION_KINDS,
  ENTITY_MARKUP_RE,
  hasSectionAccess,
  mockResultsAllowed,
  NOTIFY_EMAIL_REFUSALS,
  NOTIFY_PER_PERSON_PER_DAY,
  NOTIFY_PER_PROJECT_PER_DAY,
  NOTIFY_WAIT_MS,
  PLATFORM_MAIL_SECRET_MIN_LENGTH,
  platformMailAddress,
  type NotifyEmailNotSent,
} from "@foundmill/shared";
import { DEV_PLATFORM_MAIL_SECRET, isConfigError, mockIntegrationRecord, notifyOffToken, notifyOffUrl, PLATFORM_NOTIFY_KEY, type ToolContext } from "@foundmill/connectors";
import { writeGatewayEvent } from "./events";
import { modeFor, safeError, vendorRefusedOutright, type GatewayDeps } from "./pipeline";
import { PLATFORM_MAIL_CEILING_KEY } from "./platform-mail";
import { DAY_MS } from "./rate-limit";

export const NOTIFY_EMAIL_ROUTE = "/v1/notify/email";

export const NotifyEmailRequest = z.strictObject({
  userId: z.guid(),
  kind: z.enum(EMAIL_NOTIFICATION_KINDS),
  businessId: z.guid(),
  data: z.strictObject({ inboxItemId: z.guid() }),
});
export type NotifyEmailRequest = z.infer<typeof NotifyEmailRequest>;

export type NotifyEmailResponse = { sent: true; simulated: boolean; eventId: string | null } | { sent: false; reason: NotifyEmailNotSent; message: string };

/** Counter keys, in fixed UTC-day windows: per person and project, and per person. */
export const notifyProjectDayKey = (userId: string, businessId: string): string => `pn:${userId}:${businessId}:day`;
export const notifyPersonDayKey = (userId: string): string => `pn:${userId}:day`;

const NIL_ID = "00000000-0000-0000-0000-000000000000";

export async function sendNotifyEmail(deps: GatewayDeps, input: NotifyEmailRequest, service: string): Promise<NotifyEmailResponse> {
  const now = deps.now?.() ?? new Date();
  const config = deps.platformMail;
  const { userId, businessId, kind } = input;
  const inboxItemId = input.data.inboxItemId;
  const notSent = (reason: NotifyEmailNotSent): NotifyEmailResponse => {
    deps.log.info({ businessId, userId, kind, reason }, "notify email not sent");
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

  // 2. A live business that is not a sample.
  const business = await repos.businesses.get(deps.db, businessId).catch(() => null);
  if (!business) return notSent("not_member");
  if (business.isDemo) return notSent("sample");
  if (mode === "mock" && deps.appEnv !== undefined && !mockResultsAllowed(deps.appEnv, business.isDemo)) return notSent("simulated");

  // 3. A member (not an example visitor) who can read the Inbox.
  const membership = await repos.memberships.get(deps.db, businessId, userId).catch(() => null);
  if (!membership || membership.source === "example" || !hasSectionAccess(membership, "inbox", "read")) return notSent("not_member");

  // 4. Their own switch.
  const prefs = await repos.preferences.get(deps.db, userId);
  if (!prefs.email[kind]) return notSent("turned_off");

  // 5. The note still waits for them, and has waited a day.
  const item = await repos.notifyEmail.stillWaiting(deps.db, businessId, inboxItemId, userId);
  if (!item || now.getTime() - item.createdAt.getTime() < NOTIFY_WAIT_MS) return notSent("not_waiting");

  // 6. Their address, from their account.
  const email = await repos.founders.emailOf(deps.db, userId);
  if (!email) return notSent("no_address");

  // 7. One a day per project, three a day in all, and the domain's ceiling; shared by every replica.
  const counted: string[] = [];
  const release = async () => {
    for (const key of counted.splice(0)) await deps.rateLimits.release?.(key, DAY_MS, now.getTime());
  };
  const shared = () => devStack || deps.rateLimits.durable === true;
  for (const [key, cap, reason] of [
    [notifyProjectDayKey(userId, businessId), NOTIFY_PER_PROJECT_PER_DAY, "per_project"],
    [notifyPersonDayKey(userId), NOTIFY_PER_PERSON_PER_DAY, "per_person"],
    [PLATFORM_MAIL_CEILING_KEY, config.ceiling, "ceiling"],
  ] as const) {
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

  // The words, from the gateway's own reads.
  const profile = await repos.founders.get(deps.db, userId).catch(() => null);
  const agent = item.fromAgentId ? await repos.agents.get(deps.db, businessId, item.fromAgentId).catch(() => null) : null;
  const agentName = agent ? agentLabel({ name: agent.name, role: agent.role, personaKey: agent.personaKey, agentType: agent.agentType, layer: agent.layer }, prefs.anthropomorphicAgents, prefs.agentStyle) : null;
  const offUrl = notifyOffUrl(config.unsubscribeBase, notifyOffToken(secret, userId, kind));
  const words = decisionWaitingEmail({
    personName: profile?.displayName ?? null,
    projectName: business.name,
    agentName,
    holdsContinue: item.blocksContinue,
    noteSubject: item.subject.replace(ENTITY_MARKUP_RE, "$2"),
    waitedMs: now.getTime() - item.createdAt.getTime(),
    link: `${appUrl}/b/${businessId}/inbox/${inboxItemId}`,
    offLink: offUrl,
    appName: APP_NAME,
  });

  const ctx: ToolContext = { businessId, agentId: NIL_ID, sessionId: NIL_ID, integration: mockIntegrationRecord(PLATFORM_NOTIFY_KEY, businessId), log: deps.log, mode };
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
    deps.log.warn({ businessId, userId, kind, code: result.error?.code, status: result.error?.status }, "notify email refused by the provider");
    return notSent("vendor");
  }
  const data = (result.data ?? {}) as { messageId?: unknown };
  const messageId = typeof data.messageId === "string" && data.messageId ? data.messageId.slice(0, 200) : `unknown-${now.getTime()}`;
  const simulated = mode === "mock";
  let eventId: string | null = null;
  try {
    const event = await deps.db.transaction((tx) =>
      writeGatewayEvent(tx, { businessId, type: "notify.email_sent", actor: { kind: "system", id: "notify-email" }, entityIds: [], payload: { kind, userId, inboxItemId, messageId, simulated } }, notifyEmailDayKey(kind, userId, now)),
    );
    eventId = event.id;
  } catch (e) {
    deps.log.error({ businessId, userId, kind, err: safeError(e) }, "notify email sent but notify.email_sent could not be written");
  }
  await repos.audit
    .append(deps.db, businessId, { actorKind: "system", action: "gateway.notify.email_sent", target: { kind: "inbox_item", id: inboxItemId }, details: { service, mode, simulated, kind, userId } })
    .catch((e: unknown) => deps.log.warn({ businessId, reason: e instanceof Error ? e.name : "unknown" }, "notify email audit not written"));
  deps.log.info({ businessId, userId, kind, mode }, "notify email sent");
  return { sent: true, simulated, eventId };
}
