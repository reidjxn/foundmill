/**
 * `POST /v1/notify/email` (docs/THESIS_REVIEW.md packages 1.5 and 5.1): Foundmill's own email to one of its users, about
 * their own project, and the one sender of every kind of it (founder, 2026-11-12). Two services ask (service token):
 * the api's notify pass for a decision waiting on the person, the orchestrator's notify sweep for the rest (a win, a
 * milestone, a finished Autopilot run, used-up credits, the morning brief, the weekly review). No agent reaches this
 * (the `platform_notify` connector is service-only) and no Cedar ask applies: the person is a user being told about
 * their own project, not someone outside it.
 *
 * The caller sends ids only (`{ userId, kind, businessId, data: { inboxItemId | milestoneId | runId | day } }`); the
 * gateway trusts none of it beyond the ids and reads everything again, in this order, before any vendor call:
 *
 *   1. platform mail switched on (PLATFORM_MAIL_DOMAIN) and configured for where it runs (live, or outside development
 *      and test: the signing secret, an https INGEST_PUBLIC_URL and an https APP_URL); a mock send only where simulated
 *      results are allowed (`mockResultsAllowed`), never for a person's project on staging or production;
 *   2. the business: live and not a sample (`is_demo`): nobody is emailed about a sample;
 *   3. the person: a member of it now (not through an example membership, not one that has ended), who can read the Inbox;
 *   4. their own switch for this kind (`account_preferences.notifications.email`, the one preference), on, and their
 *      emails not paused (`emails_paused_at`, the pause link);
 *   5. what it is about, by kind. A waiting decision: this business's, still needing an answer, unopened by the person
 *      on any device; when it holds up the team's work (`holdingUpWork`: it holds Continue, an approval or a spec or
 *      roadmap sign-off waits on it) 30 minutes after the person was last here (`NOTIFY_HOLDING_WAIT_MS`, never while
 *      they are: `present`), otherwise a day (`NOTIFY_WAIT_MS`); no older than the lookback, and never emailed to this
 *      person before (`notify.email_sent`, the Redis marker `pn:item:<user>:<item>`). The other kinds: a project that
 *      has started (`loadNotifyFacts`), the win, milestone, run or credits note named, within the day's lookback; a
 *      brief with news (item 10: four sections, its What worked real outcomes only, `briefExtrasFor`). Every kind once (`founder_notifications`' dedupe key `<kind>:<id or day>`);
 *   6. their address, from `auth.users` (never from the request);
 *   7. the counts, in Redis shared by every replica: one email a day per person and project, three a day per person
 *      across every kind and project (the morning brief and weekly review count toward neither: `LIMITED_EMAIL_KINDS`),
 *      and this email's own daily ceiling (`pn:all:day`, PLATFORM_NOTIFY_DAILY_CEILING) for all, never the projects'
 *      `pm:all:day`; and, so the projects' own mail always has room, none while `pm:all:day` is above 75% of
 *      PLATFORM_MAIL_DAILY_CEILING (`busy`). Outside development and test a count that is not shared refuses the send.
 *
 * The words are built here (`decisionWaitingEmail`, `retentionEmail`, packages/shared) from the gateway's own reads:
 * the person's name, the project's, the agent's as the person names agents, the note's subject as the Inbox shows it
 * to this person (their Finance and CRM walls) without its entity markup, every one of them without links, domains or
 * addresses (`withoutLinks`). The footer turns this kind off (`notifyOffToken`) or pauses every email (a signed pause
 * link). A recommended, reversible, in-policy option may be offered as a one-click answer (`oneClickOption`), its
 * token stored hashed. Links into the app carry `via=email&n=<notification id>` so the return they bring is counted.
 * The email is kept on its `founder_notifications` row (readable only by its person) with the links' tokens removed.
 * After the send, one `notify.email_sent` (user id only, never the address; `simulated`) through the outbox and an
 * audit row with the same. Every "not sent" is an answer (`sent: false`, a reason and a plain sentence), never an
 * error. The address never reaches a log line, the audit or an event.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { APP_NAME } from "@foundmill/config";
import { loadBriefFacts, loadNotifyFacts, notifyEmailDayKey, repos } from "@foundmill/db";
import { inboxWalls, isWalled, noteAsSeenBy } from "@foundmill/db/inbox-redaction";
import {
  addDaysToKey,
  agentLabel,
  BOOKED_SECTION,
  briefIsEmpty,
  briefStats,
  CREDITS_SUBJECTS,
  dailyStreak,
  dayKeyIn,
  decisionWaitingEmail,
  EMAIL_NOTIFICATION_KINDS,
  ENTITY_MARKUP_RE,
  FOUNDER_NOTIFICATION_LIMITS,
  hasSectionAccess,
  invitationAcceptedEmail,
  LIMITED_EMAIL_KINDS,
  mockResultsAllowed,
  NOTIFY_EMAIL_REFUSALS,
  NOTIFY_HOLDING_WAIT_MS,
  NOTIFY_ITEM_MARKER_MS,
  NOTIFY_LOOKBACK_MS,
  NOTIFY_PROJECT_MAIL_HEADROOM,
  NOTIFY_PER_PERSON_PER_DAY,
  NOTIFY_PER_PROJECT_PER_DAY,
  NOTIFY_WAIT_MS,
  oneClickOption,
  OUTCOME_SECTION,
  PLATFORM_MAIL_SECRET_MIN_LENGTH,
  platformMailAddress,
  realOutcomes,
  retentionEmail,
  runTasksDone,
  vacationDayKeys,
  type BriefExtras,
  type BusinessNotifyFacts,
  type EmailNotificationKind,
  type InvitationRole,
  type NotifyEmailNotSent,
  type NotifyEmailText,
  type NotifyItemLike,
  type RetentionEmailPlan,
} from "@foundmill/shared";
import { newActionToken, signPauseToken } from "@foundmill/shared/email-links";
import { DEV_PLATFORM_MAIL_SECRET, isConfigError, mockIntegrationRecord, notifyOffToken, notifyOffUrl, PLATFORM_NOTIFY_KEY, type ToolContext } from "@foundmill/connectors";
import { writeGatewayEvent } from "./events";
import { modeFor, safeError, vendorRefusedOutright, type GatewayDeps } from "./pipeline";
import { PLATFORM_MAIL_CEILING_KEY, PLATFORM_NOTIFY_DEFAULT_CEILING } from "./platform-mail";
import { DAY_MS } from "./rate-limit";

export const NOTIFY_EMAIL_ROUTE = "/v1/notify/email";

/**
 * Ids only, one per kind: `decision_waiting`, `win` and `credits` name an Inbox note; `milestone` a milestone (or its
 * Inbox note); `run_finished` an Autopilot run; `daily_brief` and `weekly_review` the person's day ("2026-11-12").
 */
export const NotifyEmailRequest = z
  .strictObject({
    userId: z.guid(),
    kind: z.enum(EMAIL_NOTIFICATION_KINDS),
    businessId: z.guid(),
    data: z.strictObject({
      inboxItemId: z.guid().optional(),
      milestoneId: z.guid().optional(),
      runId: z.guid().optional(),
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      invitationId: z.guid().optional(),
    }),
  })
  .refine(
    ({ kind, data }) => {
      switch (kind) {
        case "decision_waiting":
        case "win":
        case "credits":
          return !!data.inboxItemId;
        case "milestone":
          return !!data.milestoneId || !!data.inboxItemId;
        case "run_finished":
          return !!data.runId;
        case "daily_brief":
        case "weekly_review":
          return !!data.day;
        case "invitation_accepted":
          return !!data.invitationId;
      }
    },
    { message: "the ids this kind needs are missing" },
  );
export type NotifyEmailRequest = z.infer<typeof NotifyEmailRequest>;

export type NotifyEmailResponse = { sent: true; simulated: boolean; eventId: string | null } | { sent: false; reason: NotifyEmailNotSent; message: string };

/** Counter keys, in fixed UTC-day windows: per person and project, and per person. */
export const notifyProjectDayKey = (userId: string, businessId: string): string => `pn:${userId}:${businessId}:day`;
export const notifyPersonDayKey = (userId: string): string => `pn:${userId}:day`;
/** This email's own ceiling, every person together (never the projects' `pm:all:day`). */
export const PLATFORM_NOTIFY_CEILING_KEY = "pn:all:day";
/** The marker that this person was emailed about this note (kept `NOTIFY_ITEM_MARKER_MS`). */
export const notifyItemKey = (userId: string, inboxItemId: string): string => `pn:item:${userId.toLowerCase()}:${inboxItemId.toLowerCase()}`;

const NIL_ID = "00000000-0000-0000-0000-000000000000";

/** What one kind's own checks found: the words' inputs, the record's dedupe key and the notes it is about. */
type Subject =
  | { kind: "decision_waiting"; item: { id: string; subject: string; fromAgentId: string | null; blocksContinue: boolean; createdAt: Date }; dedupeKey: string; inboxItemIds: string[]; waiting: NotifyItemLike[] }
  | { kind: "retention"; plan: RetentionEmailPlan; dedupeKey: string; inboxItemIds: string[]; waiting: NotifyItemLike[] }
  | { kind: "invitation_accepted"; role: InvitationRole; personName: string | null; dedupeKey: string; inboxItemIds: string[]; waiting: NotifyItemLike[] };

/** The email with each token replaced by a placeholder, for the stored copy (founder_notifications keeps no live link). */
export function redactLinks(email: { text: string; html: string }, tokens: readonly (string | null | undefined)[]): { text: string; html: string } {
  let { text, html } = email;
  for (const t of tokens) {
    if (!t) continue;
    for (const form of [t, encodeURIComponent(t)]) {
      text = text.split(form).join("[link in the email]");
      html = html.split(form).join("[link in the email]");
    }
  }
  return { text, html };
}

export async function sendNotifyEmail(deps: GatewayDeps, input: NotifyEmailRequest, service: string): Promise<NotifyEmailResponse> {
  const now = deps.now?.() ?? new Date();
  const config = deps.platformMail;
  const { userId, businessId, kind } = input;
  const ref = input.data.inboxItemId ?? input.data.milestoneId ?? input.data.runId ?? input.data.day ?? input.data.invitationId ?? "";
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

  // 3. A member (not an example visitor, not a collaborator whose access ended) who can read the Inbox.
  const membership = await repos.memberships.getActive(deps.db, businessId, userId).catch(() => null);
  if (!membership || membership.source === "example" || !hasSectionAccess(membership, "inbox", "read")) return notSent("not_member");

  // 4. Their own switch for this kind, and every email not paused (one preference: `notifications.email`).
  const prefs = await repos.preferences.get(deps.db, userId);
  if (!prefs.email[kind]) return notSent("turned_off");
  const extra = await repos.emailPrefs.get(deps.db, userId);
  if (extra.emailsPausedAt) return notSent("paused");

  // 5. What the email is about, read again here, by kind.
  const facts: BusinessNotifyFacts | null = kind === "decision_waiting" || kind === "invitation_accepted" ? null : await loadNotifyFacts(deps.db, businessId, now);
  let subject: Subject;
  if (kind === "invitation_accepted") {
    // The invitation this person made, in this business, accepted within the day's lookback; the person who joined by
    // the name on their profile, if they have one yet. A project need not have started (people join before).
    const invitation = await repos.invitations.get(deps.db, businessId, input.data.invitationId!);
    if (!invitation || invitation.state !== "accepted" || invitation.invitedByUserId !== userId || !invitation.acceptedAt || now.getTime() - invitation.acceptedAt.getTime() > FOUNDER_NOTIFICATION_LIMITS.lookbackMs) return notSent("not_waiting");
    const joined = invitation.acceptedByUserId ? await repos.founders.get(deps.db, invitation.acceptedByUserId).catch(() => null) : null;
    subject = { kind: "invitation_accepted", role: invitation.role, personName: joined?.displayName?.trim() || null, dedupeKey: `invitation_accepted:${invitation.id}`, inboxItemIds: [], waiting: [] };
  } else if (kind === "decision_waiting") {
    const inboxItemId = input.data.inboxItemId!;
    const item = await repos.notifyEmail.stillWaiting(deps.db, businessId, inboxItemId, userId);
    if (!item) return notSent("not_waiting");
    // Founder, 2026-11-12: 30 minutes after the person left, for a note that holds up the team's work; a day otherwise.
    const holding = (await repos.notifyEmail.holdingUpWork(deps.db, businessId, [inboxItemId])).has(inboxItemId);
    if (holding) {
      const lastSeen = (await repos.presence.lastSeenByUser(deps.db, businessId, [userId])).get(userId) ?? null;
      const since = Math.max(item.createdAt.getTime(), lastSeen?.getTime() ?? 0);
      if (now.getTime() - since < NOTIFY_HOLDING_WAIT_MS) return notSent(lastSeen && now.getTime() - lastSeen.getTime() < NOTIFY_HOLDING_WAIT_MS ? "present" : "not_waiting");
    } else if (now.getTime() - item.createdAt.getTime() < NOTIFY_WAIT_MS) return notSent("not_waiting");
    if (now.getTime() - item.createdAt.getTime() > NOTIFY_LOOKBACK_MS) return notSent("too_old");
    if ((await repos.notifyEmail.emailedItems(deps.db, businessId, userId, [inboxItemId])).has(inboxItemId)) return notSent("already_sent");
    // The subject as the Inbox shows it to this person (inbox.get's walls): behind a Finance wall no amount, behind a CRM
    // wall no customer's name. Read before anything is counted, so a failed read takes nothing.
    let noteSubject = item.subject;
    if (isWalled(inboxWalls(membership))) {
      const [note] = await repos.inbox.byIds(deps.db, businessId, [inboxItemId]);
      if (!note) return notSent("not_waiting");
      noteSubject = (await noteAsSeenBy(deps.db, businessId, membership, note)).subject;
    }
    const full = await repos.notifyFacts.item(deps.db, businessId, inboxItemId);
    subject = { kind: "decision_waiting", item: { ...item, subject: noteSubject }, dedupeKey: `decision_waiting:${inboxItemId}`, inboxItemIds: [inboxItemId], waiting: full ? [full] : [] };
  } else {
    // A project that has not started (no commit yet) gets no brief, win or milestone email; a waiting note still does.
    if (!facts) return notSent("not_started");
    const recent = (at: Date) => now.getTime() - at.getTime() <= FOUNDER_NOTIFICATION_LIMITS.lookbackMs;
    const plan = retentionPlanOf(kind as Exclude<EmailNotificationKind, "decision_waiting" | "invitation_accepted">, input.data, facts, userId, recent);
    if (!plan) return notSent("not_waiting");
    if (plan.kind === "daily_brief" || plan.kind === "weekly_review") {
      // Today's brief already went out: its window now starts at it, so say so before reading the window.
      if (await repos.notifications.exists(deps.db, businessId, userId, `${kind}:${ref}`)) return notSent("already_sent");
      // The four sections (item 10): real outcomes, what's booked and what's next, as this person may see them.
      const brief = await briefExtrasFor(deps, { businessId, userId, membership, prefs, timeZone: extra.timeZone ?? business.timeZone, weekly: plan.kind === "weekly_review", now });
      plan.stats = briefStats(facts, brief.since);
      plan.extras = brief.extras;
      if (briefIsEmpty(plan.stats, plan.waiting, plan.extras, now)) return notSent("nothing_new");
    }
    const itemIds = plan.kind === "win" || plan.kind === "credits" ? [plan.item.id] : plan.kind === "milestone" ? (plan.itemId ? [plan.itemId] : []) : plan.waiting.slice(0, 5).map((i) => i.id);
    subject = { kind: "retention", plan, dedupeKey: `${kind}:${ref}`, inboxItemIds: itemIds, waiting: plan.kind === "run_finished" || plan.kind === "daily_brief" || plan.kind === "weekly_review" ? plan.waiting : [] };
  }
  if (await repos.notifications.exists(deps.db, businessId, userId, subject.dedupeKey)) return notSent("already_sent");

  // 6. Their address, from their account.
  const email = await repos.founders.emailOf(deps.db, userId);
  if (!email) return notSent("no_address");

  // 7. Once (the marker), the projects' room, and the counts, shared by every replica: one a day per project and three a
  //    day per person for every kind but the briefs (founder 2026-11-12), and this email's own ceiling for all.
  const limited = (LIMITED_EMAIL_KINDS as readonly EmailNotificationKind[]).includes(kind);
  const shared = () => devStack || deps.rateLimits.durable === true;
  const itemKey = kind === "decision_waiting" ? notifyItemKey(userId, input.data.inboxItemId!) : `pn:item:${userId.toLowerCase()}:${subject.dedupeKey.toLowerCase()}`;
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
    if (!shared()) {
      await release();
      return notSent("store");
    }
    if (projectMail > config.ceiling * NOTIFY_PROJECT_MAIL_HEADROOM) {
      await release();
      return notSent("busy");
    }
  }
  const caps: [string, number, NotifyEmailNotSent][] = [
    ...(limited ? ([[notifyProjectDayKey(userId, businessId), NOTIFY_PER_PROJECT_PER_DAY, "per_project"], [notifyPersonDayKey(userId), NOTIFY_PER_PERSON_PER_DAY, "per_person"]] as [string, number, NotifyEmailNotSent][]) : []),
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

  // 8. The words, from the gateway's own reads; the record first, so its id travels in the links.
  const notificationId = randomUUID();
  const offUrl = notifyOffUrl(config.unsubscribeBase, notifyOffToken(secret, userId, kind));
  const pauseToken = config.pauseSecret ? signPauseToken(config.pauseSecret, userId, now.getTime()) : null;
  const pauseLink = pauseToken ? `${appUrl}/email/pause?t=${encodeURIComponent(pauseToken)}` : offUrl;
  const answer = await oneClickFor(deps, businessId, membership, subject.waiting);
  const action = answer ? newActionToken() : null;
  const answerLink = action ? `${appUrl}/a/${action.token}` : null;
  const profile = await repos.founders.get(deps.db, userId).catch(() => null);
  const withVia = (url: string) => `${url}${url.includes("?") ? "&" : "?"}via=email&n=${notificationId}`;
  let words: NotifyEmailText;
  if (subject.kind === "invitation_accepted") {
    words = invitationAcceptedEmail({ appName: APP_NAME, recipientName: profile?.displayName ?? null, personName: subject.personName, projectName: business.name, role: subject.role, link: withVia(`${appUrl}/b/${businessId}/settings/members`), offLink: offUrl, pauseLink });
  } else if (subject.kind === "decision_waiting") {
    const item = subject.item;
    const agent = item.fromAgentId ? await repos.agents.get(deps.db, businessId, item.fromAgentId).catch(() => null) : null;
    const agentName = agent ? agentLabel({ name: agent.name, role: agent.role, personaKey: agent.personaKey, agentType: agent.agentType, layer: agent.layer }, prefs.anthropomorphicAgents, prefs.agentStyle) : null;
    words = decisionWaitingEmail({
      personName: profile?.displayName ?? null,
      projectName: business.name,
      agentName,
      holdsContinue: item.blocksContinue,
      noteSubject: item.subject.replace(ENTITY_MARKUP_RE, "$2"),
      waitedMs: now.getTime() - item.createdAt.getTime(),
      link: withVia(`${appUrl}/b/${businessId}/inbox/${item.id}`),
      offLink: offUrl,
      appName: APP_NAME,
      ...(pauseToken ? { pauseLink } : {}),
      answer: answer && answerLink ? { label: answer.option.label, consequence: answer.option.consequence, link: answerLink } : null,
    });
  } else {
    const hideSubjects = !hasSectionAccess(membership, "crm", "read") || !hasSectionAccess(membership, "finance", "read");
    const streak = subject.plan.kind === "daily_brief" || subject.plan.kind === "weekly_review" ? await streakOf(deps, businessId, business.timeZone, userId, now) : null;
    words = retentionEmail(subject.plan, {
      appUrl,
      appName: APP_NAME,
      businessId,
      businessName: business.name,
      notificationId,
      recipientName: profile?.displayName ?? null,
      offLink: offUrl,
      pauseLink,
      hideSubjects,
      streak,
      now,
      oneClick: answer && answerLink ? { itemId: answer.item.id, label: answer.option.label, consequence: answer.option.consequence, url: answerLink } : null,
    });
  }
  const stored = redactLinks(words, [action?.token, pauseToken]);
  const claimed = await repos.notifications.claim(deps.db, businessId, {
    id: notificationId,
    userId,
    kind,
    dedupeKey: subject.dedupeKey,
    subject: words.subject,
    bodyText: stored.text,
    bodyHtml: stored.html,
    inboxItemIds: subject.inboxItemIds,
    action: answer && action ? { itemId: answer.item.id, optionId: answer.option.id, tokenHash: action.hash, expiresAt: new Date(now.getTime() + FOUNDER_NOTIFICATION_LIMITS.actionTtlMs) } : null,
  });
  if (!claimed) {
    await release();
    return notSent("already_sent");
  }

  const ctx: ToolContext = { businessId, agentId: NIL_ID, sessionId: NIL_ID, integration: mockIntegrationRecord(PLATFORM_NOTIFY_KEY, businessId), log: deps.log, mode };
  const connector = deps.registry.get(PLATFORM_NOTIFY_KEY, mode);
  let result;
  try {
    result = await connector.callTool("send_notification", { from: { email: platformMailAddress(config.notifyLocalPart, config.domain), name: APP_NAME }, to: { email }, subject: words.subject, text: words.text, html: words.html, unsubscribeUrl: offUrl }, ctx);
  } catch (e) {
    await release();
    await repos.notifications.markFailed(deps.db, businessId, notificationId, isConfigError(e) ? "unconfigured" : "error");
    if (isConfigError(e)) return notSent("unconfigured");
    throw e;
  }
  if (!result.ok) {
    // A definite refusal sent nothing and is given back; a timeout or a 5xx may have gone out and stays counted.
    if (vendorRefusedOutright(result.error)) await release();
    await repos.notifications.markFailed(deps.db, businessId, notificationId, "vendor");
    deps.log.warn({ businessId, userId, kind, code: result.error?.code, status: result.error?.status }, "notify email refused by the provider");
    return notSent("vendor");
  }
  const data = (result.data ?? {}) as { messageId?: unknown };
  const messageId = typeof data.messageId === "string" && data.messageId ? data.messageId.slice(0, 200) : `unknown-${now.getTime()}`;
  const simulated = mode === "mock";
  await repos.notifications.markSent(deps.db, businessId, notificationId, { mode, providerMessageId: messageId, at: now });
  // The note the email was about, when it was about one (never the waiting notes a brief lists: those can still get
  // their own email).
  const aboutItemId = subject.kind === "invitation_accepted" ? null : subject.kind === "decision_waiting" ? subject.item.id : subject.plan.kind === "win" || subject.plan.kind === "credits" ? subject.plan.item.id : subject.plan.kind === "milestone" ? subject.plan.itemId : null;
  let eventId: string | null = null;
  try {
    const event = await deps.db.transaction((tx) =>
      writeGatewayEvent(
        tx,
        { businessId, type: "notify.email_sent", actor: { kind: "system", id: "notify-email" }, entityIds: [], payload: { kind, userId, inboxItemId: aboutItemId, messageId, simulated, notificationId, offersAnswer: answer !== null } },
        kind === "decision_waiting" ? notifyEmailDayKey(kind, userId, now) : `notify.email:${subject.dedupeKey}:${userId.toLowerCase()}`,
      ),
    );
    eventId = event.id;
  } catch (e) {
    deps.log.error({ businessId, userId, kind, err: safeError(e) }, "notify email sent but notify.email_sent could not be written");
  }
  await repos.audit
    .append(deps.db, businessId, { actorKind: "system", action: "gateway.notify.email_sent", target: subject.inboxItemIds[0] ? { kind: "inbox_item", id: subject.inboxItemIds[0] } : { kind: "founder_notification", id: notificationId }, details: { service, mode, simulated, kind, userId, notificationId } })
    .catch((e: unknown) => deps.log.warn({ businessId, reason: e instanceof Error ? e.name : "unknown" }, "notify email audit not written"));
  deps.log.info({ businessId, userId, kind, mode }, "notify email sent");
  return { sent: true, simulated, eventId };
}

/** The retention kind's plan from the facts the gateway read itself; null when what the ids name is not there (or too old). */
function retentionPlanOf(kind: Exclude<EmailNotificationKind, "decision_waiting" | "invitation_accepted">, data: NotifyEmailRequest["data"], facts: BusinessNotifyFacts, userId: string, recent: (at: Date) => boolean): RetentionEmailPlan | null {
  switch (kind) {
    case "win": {
      const item = facts.recentItems.find((i) => i.id === data.inboxItemId && i.type === "customer_won");
      return item && recent(item.createdAt) ? { kind, item } : null;
    }
    case "credits": {
      const item = facts.recentItems.find((i) => i.id === data.inboxItemId && i.type === "warning" && CREDITS_SUBJECTS.includes(i.subject));
      return item && recent(item.createdAt) && item.state !== "answered" && item.state !== "archived" ? { kind, item } : null;
    }
    case "milestone": {
      if (data.milestoneId) {
        const m = facts.milestones.find((x) => x.id === data.milestoneId);
        return m && recent(m.achievedAt) ? { kind, label: m.label, itemId: null } : null;
      }
      const note = facts.recentItems.find((i) => i.id === data.inboxItemId && i.type === "milestone");
      return note && recent(note.createdAt) ? { kind, label: note.subject, itemId: note.id } : null;
    }
    case "run_finished": {
      const run = facts.runEnds.find((r) => r.runId === data.runId);
      if (!run || run.startedBy !== userId || !recent(run.endedAt)) return null;
      return { kind, run, tasksDone: runTasksDone(facts.cycles, run), waiting: facts.openDecisions };
    }
    case "daily_brief":
    case "weekly_review": {
      const since = new Date(facts.now.getTime() - (kind === "weekly_review" ? 7 : 1) * DAY_MS);
      return { kind, day: data.day!, stats: briefStats(facts, since), waiting: facts.openDecisions };
    }
  }
}

/**
 * The brief's window and its extra sections for one person (item 10, Nov 13, 2026). The window starts at this person's
 * last brief from this business (a day back when there is none, a week at most; a week for the weekly review). What
 * worked is the real outcomes only (`realOutcomes`: nothing simulated), each kind behind the wall of the section it
 * belongs to (`OUTCOME_SECTION`), booked facts behind theirs (`BOOKED_SECTION`), What's next only with Development read.
 */
async function briefExtrasFor(
  deps: GatewayDeps,
  q: { businessId: string; userId: string; membership: Parameters<typeof hasSectionAccess>[0]; prefs: { anthropomorphicAgents: boolean; agentStyle: Parameters<typeof agentLabel>[2] }; timeZone: string | null; weekly: boolean; now: Date },
): Promise<{ since: Date; extras: BriefExtras }> {
  const facts = await loadBriefFacts(deps.db, q.businessId, q.userId, q.now);
  const week = q.now.getTime() - 7 * DAY_MS;
  const since = new Date(q.weekly ? week : facts.lastBriefAt ? Math.max(facts.lastBriefAt.getTime(), week) : q.now.getTime() - DAY_MS);
  const can = (section: Parameters<typeof hasSectionAccess>[1] | null) => section === null || hasSectionAccess(q.membership, section, "read");
  const outcomes = realOutcomes(facts.events, since, q.now).filter((o) => can(OUTCOME_SECTION[o.kind]));
  const agentNames = Object.fromEntries(facts.agents.map((a) => [a.id, agentLabel(a, q.prefs.anthropomorphicAgents, q.prefs.agentStyle)]));
  return {
    since,
    extras: {
      outcomes,
      booked: facts.booked.filter((b) => can(BOOKED_SECTION[b.kind])),
      next: can("development") ? { running: facts.running, queued: facts.queued, autopilotNextAt: facts.autopilotNextAt, stopped: facts.stopped } : null,
      timeZone: q.timeZone,
      agentNames,
      recipientUserId: q.userId,
    },
  };
}

/** The first waiting note a one-click answer may answer (`oneClickOption`), for someone who may answer in the Inbox. */
async function oneClickFor(deps: GatewayDeps, businessId: string, membership: Parameters<typeof hasSectionAccess>[0], waiting: readonly NotifyItemLike[]): Promise<{ item: NotifyItemLike; option: { id: string; label: string; consequence: string } } | null> {
  if (!hasSectionAccess(membership, "inbox", "write")) return null;
  for (const item of waiting.slice(0, 5)) {
    const isSignoff = (await repos.productSignoffs.forInboxItem(deps.db, businessId, item.id)) !== null;
    const option = oneClickOption(item, { isSignoff });
    if (option) return { item, option };
  }
  return null;
}

/** The person's daily streak in the business, for the brief's line (packages/shared streak.ts). */
async function streakOf(deps: GatewayDeps, businessId: string, timeZone: string | null, userId: string, now: Date): Promise<{ current: number; visitedToday: boolean }> {
  const today = dayKeyIn(now, timeZone);
  const [visitDays, holidays] = await Promise.all([repos.presence.visitDays(deps.db, businessId, userId, { from: addDaysToKey(today, -400), to: today }), repos.holidays.list(deps.db, businessId, 50)]);
  const s = dailyStreak({ today, visitDays, vacationDays: vacationDayKeys(holidays, now, (d) => dayKeyIn(d, timeZone)) });
  return { current: s.current, visitedToday: s.visitedToday };
}
