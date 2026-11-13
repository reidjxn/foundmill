/**
 * Founder notices (security review P2-3, Nov 13, 2026; reworked after the second review the same day). Someone with a
 * founder's standing could lower another founder's role, remove them, then ask for the project's deletion, and the
 * warning reached only the Inbox of the people still in it. Now each of those steps, and a canceled deletion, tells the
 * founders:
 *
 *   - `tellFounders` asks the gateway's one sender (`/v1/notify/email`, kind `founder_notice`) for one email per person:
 *     every founder now (an owner or a cofounder), the person whose role changed or who was removed, and, for a deletion,
 *     every former founder for the request (someone else took their standing away within 30 days before it, or after it;
 *     uncapped, and each of their emails carries the one-click cancel) and, beyond that window, the
 *     `FOUNDER_NOTICE_LIMITS.formerPerRequest` (50) people someone else most recently took out of the project who are not
 *     founders now (`founder_departures`, 0097). Never the person who did it, but for one receipt: the person who asked for
 *     a deletion, whatever the team's size. Ids only: the gateway reads the audit entry and everyone again, and holds the
 *     counts (the ordinary notices' ceilings and per-project fold; the essential ones' per-person day and circuit
 *     breaker). Asked after the change committed, `NOTICE_CONCURRENCY` at a time; a refusal or an unreachable gateway
 *     changes nothing here.
 *   - While a deletion waits, a former founder's email carries a one-click cancel: a random 256-bit token minted here for
 *     that one email, its SHA-256 kept in `founder_cancel_links` with the request it cancels and its end (that request's
 *     scheduled day). A link never replaces another, and the row goes again when its email is not sent.
 *   - `founderChangeNote` is the Inbox note for a lowered role or a removal, from the Chief of Staff, written in the
 *     change's own transaction and only when another founder than the one who made it is there to read it.
 *   - `cancelDeletionAsFormerFounder` is the cancel for someone who is out: from `/a/<token>` (email.ts) or the card on
 *     their home (`founder.formerProjects.cancel`), for the one request the link or the card named, checked under the
 *     audit chain's lock. It cancels the deletion and restores nothing else: they stay out. Rejoining is a separate,
 *     ordinary invitation.
 *   - `takeFounderChange`: one person may lower a founder's role, or ask for a deletion, `FOUNDER_NOTICE_LIMITS.actorPerDay`
 *     times a day in one project and `actorPerDayAll` times a day across every project, and a project has at most
 *     `projectRequestsPerDay` (3) deletion requests and `projectLowersPerDay` (10) founders lowered a day, whoever asks. A cancel is never limited: it
 *     is the safe direction. It returns the refund, which the caller runs when the change's transaction fails.
 *   - `recentlyLowered` makes a removal a founder's removal once per demotion: not again when a removal of that person
 *     already followed the demotion (re-invited and removed again).
 *
 * The purge needs no change: the cancel right lasts until the request's own scheduled day, which is the day the sweep
 * purges on.
 */
import { BUSINESS_DELETION_CANCEL_ACTION, BUSINESS_DELETION_REQUEST_ACTION, repos, type AuditEntry, type Db, type DbTx, type Executor } from "@foundmill/db";
import { AppError, FORMER_FOUNDER_LOOKBACK_MS, FOUNDER_NOTICE_ACTIONS, FOUNDER_NOTICE_LIMITS, founderChangeNote as noteWords, formerFounderCanceledLine, noticeDay, noticeMoment, OWNER_ROLES, type FounderNotice } from "@foundmill/shared";
import { newActionToken } from "@foundmill/shared/email-links";
import type { ApiGatewayClient } from "./gateway";
import type { ApiLogger } from "./log";
import type { RateLimitStore } from "./rate-limit";

export interface NoticeDeps {
  db: Db;
  gateway: Pick<ApiGatewayClient, "notifyEmail">;
  log: ApiLogger;
}

export interface TellFoundersInput {
  businessId: string;
  /** The audit entry the gateway reads the notice from. */
  auditId: string;
  notice: FounderNotice;
  actorUserId: string;
  /** Whose role changed, or who was removed. */
  subjectUserId?: string | null;
  now?: Date;
}

export interface TellFoundersResult {
  /** Everyone asked for, and what the gateway answered for each (`sent`, or its reason). */
  asked: { userId: string; sent: boolean; reason: string | null; offersCancel: boolean }[];
}

const DAY_MS = 86_400_000;
/** How many founder notices one change asks the gateway for at a time (final review, P3). */
export const NOTICE_CONCURRENCY = 5;

/** Runs `work` over `items` with at most `limit` at once, keeping their order in the answer. */
async function inBatches<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return out;
}

/** The deletion that waits now (the latest request, not canceled after it), or null. */
export async function pendingDeletionRequest(db: Executor, businessId: string): Promise<AuditEntry | null> {
  const latest = (await repos.audit.list(db, businessId, { action: [BUSINESS_DELETION_REQUEST_ACTION, BUSINESS_DELETION_CANCEL_ACTION], limit: 1 })).items[0];
  return latest && latest.action === BUSINESS_DELETION_REQUEST_ACTION ? latest : null;
}

/** The request a cancel entry canceled: the latest request written before it on the chain. */
async function canceledRequest(db: Executor, businessId: string, cancelEntry: AuditEntry): Promise<AuditEntry | null> {
  const requests = (await repos.audit.list(db, businessId, { action: BUSINESS_DELETION_REQUEST_ACTION, limit: 20 })).items;
  return requests.find((r) => Number(r.seq) < Number(cancelEntry.seq)) ?? null;
}

/** The day a waiting request is due. */
export const scheduledForOf = (request: AuditEntry): Date => {
  const at = (request.details as { scheduledFor?: unknown }).scheduledFor;
  const d = typeof at === "string" ? new Date(at) : null;
  return d && !Number.isNaN(d.getTime()) ? d : new Date(request.createdAt.getTime() + 7 * DAY_MS);
};

export class FounderChangeLimitError extends AppError {
  constructor(what: "lower" | "request", scope: "project" | "all" | "everyone", retryAfterMs: number) {
    const hours = Math.max(1, Math.ceil(retryAfterMs / 3_600_000));
    const when = hours === 1 ? "in an hour" : `in ${hours} hours`;
    const step = what === "lower" ? "A founder's role can be lowered" : "A deletion can be asked for";
    super(
      "founder_change_limit",
      scope === "project"
        ? `${step} ${FOUNDER_NOTICE_LIMITS.actorPerDay} times a day by one person in a project, and that is used up for now. Try again ${when}.`
        : scope === "all"
          ? `One person can lower founders' roles and ask for deletions ${FOUNDER_NOTICE_LIMITS.actorPerDayAll} times a day across every project, and that is used up for now. Try again ${when}.`
          : `This project has had ${what === "lower" ? "as many founders' roles lowered" : "as many deletion requests"} today as a day allows. Try again ${when}.`,
      429,
      { retryAfterMs },
    );
  }
}

/** Gives a taken founder change back (best effort): the change it paid for did not happen. */
export type FounderChangeRefund = () => Promise<void>;

/**
 * Takes one of the person's founder changes: `actorPerDay` of this kind in this project, and `actorPerDayAll` of both
 * kinds across every project (third review: an actor with many projects must not fill the platform's notices), and one
 * of the project's own (`projectRequestsPerDay` deletion requests, `projectLowersPerDay` founders lowered), whoever asks
 * (verification of the final review: each extra account no longer adds its own). Throws a plain refusal; a refused take
 * records nothing. Returns the refund: the caller runs it when the change's transaction fails after the take (final
 * review, P3), so a change that did not happen costs nothing.
 */
export async function takeFounderChange(ctx: { limits: RateLimitStore; businessId: string; userId: string }, what: "lower" | "request"): Promise<FounderChangeRefund> {
  const actor = ctx.userId.toLowerCase();
  const project = await ctx.limits.take([{ key: `founder-change:${what}:${ctx.businessId}:${actor}`, rule: { limit: FOUNDER_NOTICE_LIMITS.actorPerDay, windowMs: DAY_MS } }]);
  if (!project.ok) throw new FounderChangeLimitError(what, "project", project.retryAfterMs);
  const all = await ctx.limits.take([{ key: `founder-change:all:${actor}`, rule: { limit: FOUNDER_NOTICE_LIMITS.actorPerDayAll, windowMs: DAY_MS } }]);
  if (!all.ok) {
    await ctx.limits.refund(project.ticket);
    throw new FounderChangeLimitError(what, "all", all.retryAfterMs);
  }
  const everyone = await ctx.limits.take([{ key: `founder-change:${what}:project:${ctx.businessId.toLowerCase()}`, rule: { limit: what === "request" ? FOUNDER_NOTICE_LIMITS.projectRequestsPerDay : FOUNDER_NOTICE_LIMITS.projectLowersPerDay, windowMs: DAY_MS } }]);
  if (!everyone.ok) {
    await Promise.all([ctx.limits.refund(project.ticket), ctx.limits.refund(all.ticket)]);
    throw new FounderChangeLimitError(what, "everyone", everyone.retryAfterMs);
  }
  return async () => {
    await Promise.all([ctx.limits.refund(project.ticket), ctx.limits.refund(all.ticket), ctx.limits.refund(everyone.ticket)]).catch(() => undefined);
  };
}

/** Runs `change`; when it throws, gives back the founder change `refund` holds (if one was taken), then rethrows. */
export async function refundingOnFailure<T>(refund: { current: FounderChangeRefund | null }, change: () => Promise<T>): Promise<T> {
  try {
    return await change();
  } catch (e) {
    const give = refund.current;
    refund.current = null;
    if (give) await give();
    throw e;
  }
}

export async function tellFounders(deps: NoticeDeps, input: TellFoundersInput): Promise<TellFoundersResult> {
  const actor = input.actorUserId.toLowerCase();
  const subject = input.subjectUserId?.toLowerCase() ?? null;
  const [founders, entry, waiting] = await Promise.all([
    repos.memberships.list(deps.db, input.businessId, { roles: OWNER_ROLES, activeOnly: true }),
    repos.audit.get(deps.db, input.businessId, input.auditId).catch(() => null),
    pendingDeletionRequest(deps.db, input.businessId),
  ]);
  // The request this notice is about, for a deletion: the former founders are counted from it.
  const request = input.notice === "deletion_requested" ? entry : input.notice === "deletion_canceled" && entry ? await canceledRequest(deps.db, input.businessId, entry) : null;
  // Who may still cancel the deletion that waits now (for a role change or a removal made while one waits); for a
  // request, the request itself, read once.
  const formerForWaiting = waiting ? await repos.founderDepartures.formerFoundersFor(deps.db, input.businessId, waiting.createdAt) : [];
  // A deletion and its cancel reach the former founders for the request (within 30 days before it, or after it), every
  // one of them, uncapped: they may cancel it, and the gateway's per-person share bounds what each gets (final review,
  // P1-B: 50 sock puppets taken out later must not push the one who may cancel out). Beyond that window, everyone else
  // someone took out of the project hears too (third review), the `formerPerRequest` (50) most recent of them.
  const inWindow = request ? (waiting && waiting.id === request.id ? formerForWaiting : await repos.founderDepartures.formerFoundersFor(deps.db, input.businessId, request.createdAt)) : [];
  const longAgo = request ? await repos.founderDepartures.formerFoundersLongAgo(deps.db, input.businessId, request.createdAt, { limit: FOUNDER_NOTICE_LIMITS.formerPerRequest }) : [];
  const former = [...inWindow, ...longAgo];
  const recipients = new Set<string>(founders.map((m) => m.userId.toLowerCase()));
  if (subject) recipients.add(subject);
  for (const d of former) recipients.add(d.userId.toLowerCase());
  // Nobody hears about their own step, but for the receipt of a deletion request (second review, P2-2).
  if (input.notice !== "deletion_requested") recipients.delete(actor);
  else recipients.add(actor);

  const asked = await inBatches([...recipients], NOTICE_CONCURRENCY, async (userId) => {
    // A deletion waits and this person can no longer cancel it in the app: this email carries its own one-click cancel.
    const mayCancel = waiting && input.notice !== "deletion_canceled" && userId !== actor && formerForWaiting.some((d) => d.userId.toLowerCase() === userId);
    let link: { id: string; token: string } | null = null;
    if (mayCancel) {
      const minted = newActionToken();
      const row = await repos.founderCancelLinks.create(deps.db, { businessId: input.businessId, userId, requestId: waiting.id, tokenHash: minted.hash, expiresAt: scheduledForOf(waiting) }).catch(() => null);
      link = row ? { id: row.id, token: minted.token } : null;
    }
    // A link whose email the gateway refused is forgotten: nobody holds its token, and an older link keeps working.
    const forget = async () => {
      if (link) await repos.founderCancelLinks.remove(deps.db, link.id).catch(() => undefined);
    };
    try {
      const answer = await deps.gateway.notifyEmail({ userId, kind: "founder_notice", businessId: input.businessId, data: { auditId: input.auditId, ...(link ? { cancelToken: link.token } : {}) } });
      if (!answer.sent) {
        await forget();
        deps.log.info({ businessId: input.businessId, userId, notice: input.notice, reason: answer.reason }, "founder notice not sent");
      }
      // The gateway says whether the email it sent carried a cancel (it may have folded it into the day's one email,
      // with another link, or none): that is what is recorded (final review, P3).
      return { userId, sent: answer.sent, reason: answer.sent ? null : answer.reason, offersCancel: answer.sent && (answer.offersCancel ?? link !== null) };
    } catch (e) {
      // No answer is not "not sent": the gateway may have sent it, so the link stays (third review). It works only for
      // its own request, once, until that request's day.
      deps.log.warn({ businessId: input.businessId, userId, notice: input.notice, code: e instanceof AppError ? e.code : "unknown", keptLink: link !== null }, "founder notice: the gateway did not answer; any cancel link is kept");
      return { userId, sent: false, reason: "unreachable", offersCancel: false };
    }
  });
  return { asked };
}

/**
 * The founder's role a member had until someone else lowered it within `FORMER_FOUNDER_LOOKBACK_MS` (30 days), or
 * null. A founder is always stepped down before they can be removed, so this is what makes a removal a founder's
 * removal: once per demotion (final review, P3), so null when a removal of this person was already recorded after it
 * (re-invited and removed again is an ordinary removal). On the service connection (an admin who removes someone cannot
 * read the project's departures under RLS), read before the removal's transaction opens.
 */
export async function recentlyLowered(db: Executor, businessId: string, userId: string, now: Date = new Date()): Promise<"owner" | "cofounder" | null> {
  const latest = await repos.founderDepartures.latest(db, businessId, userId);
  if (!latest || latest.how !== "demoted" || now.getTime() - latest.departedAt.getTime() > FORMER_FOUNDER_LOOKBACK_MS) return null;
  const removedSince = await repos.audit.latestMatching(db, businessId, FOUNDER_NOTICE_ACTIONS.remove, { userId }, latest.departedAt);
  return removedSince ? null : latest.priorRole;
}

/** Asks for the notices and never throws: the change they are about has already happened. */
export async function tellFoundersQuietly(deps: NoticeDeps, input: TellFoundersInput): Promise<void> {
  await tellFounders(deps, input).catch((e: unknown) => deps.log.warn({ businessId: input.businessId, notice: input.notice, reason: e instanceof Error ? e.name : "unknown" }, "founder notices not asked for"));
}

/**
 * The profile names of who did it and whom it was about, on the service connection (a person reads only their own
 * profile under RLS), read before the change's transaction opens.
 */
export async function noticeNames(db: Executor, actorUserId: string, subjectUserId: string): Promise<{ actor: string | null; subject: string | null }> {
  const [actor, subject] = await Promise.all([repos.founders.get(db, actorUserId).catch(() => null), repos.founders.get(db, subjectUserId).catch(() => null)]);
  return { actor: actor?.displayName?.trim() || null, subject: subject?.displayName?.trim() || null };
}

/**
 * The Inbox note for a founder's role lowered or a founder removed, in the change's transaction (the actor's RLS
 * connection). Written only when another founder than the actor is there to read it, and only with a Chief of Staff.
 */
export async function founderChangeNote(tx: DbTx | Executor, input: { /** The two profile names, read before the transaction (`noticeNames`). */ names: { actor: string | null; subject: string | null }; businessId: string; actorUserId: string; subjectUserId: string; notice: "role_changed" | "removed"; fromRole: string; toRole?: string | null; timeZone: string | null; now?: Date }): Promise<string | null> {
  const founders = await repos.memberships.list(tx, input.businessId, { roles: OWNER_ROLES, activeOnly: true });
  if (!founders.some((m) => m.userId !== input.actorUserId)) return null;
  const chief = await repos.agents.chiefOfStaff(tx, input.businessId);
  if (!chief) return null;
  const words = noteWords({ notice: input.notice, actorName: input.names.actor, subjectName: input.names.subject, fromRole: input.fromRole, toRole: input.toRole ?? null, when: noticeMoment(input.now ?? new Date(), input.timeZone) });
  const item = await repos.inbox.createItem(
    tx,
    input.businessId,
    { type: "update", from_agent_id: chief.id, subject: words.subject, body_md: words.body, status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: null, blocks_continue: false, source_event_ids: [], entity_ids: [] },
    { fromUserId: input.actorUserId, state: "unread" },
  );
  return item.id;
}

export class CancelNotAllowedError extends AppError {
  constructor() {
    super("cancel_not_allowed", "This deletion can no longer be canceled from here. The project's founders can cancel it in Settings › Danger zone.", 403);
  }
}

export interface FormerCancelResult {
  canceled: boolean;
  businessName: string;
  scheduledFor: string | null;
}

/**
 * A former founder for the waiting request (someone else demoted or removed them within 30 days before it, or after it)
 * cancels that request, as themselves (the audit entry is theirs, marked `formerFounder`). `requestId` is the request
 * the link or the card named: under the audit chain's lock it must still be the one waiting. Nothing else changes: they
 * stay out. The warning the request left is settled, the Chief of Staff says who canceled, and every founder hears it.
 */
export async function cancelDeletionAsFormerFounder(deps: NoticeDeps, input: { businessId: string; userId: string; requestId: string; via: "email" | "home"; now?: Date }): Promise<FormerCancelResult> {
  const now = input.now ?? new Date();
  const business = await repos.businesses.get(deps.db, input.businessId, { includeArchived: true }).catch(() => null);
  if (!business) throw new CancelNotAllowedError();
  const { request, entry } = await deps.db.transaction(async (tx) => {
    // The audit chain's own lock (audit.append takes it again): a cancel and a request at once are judged one after the
    // other, so the cancel is written only over the request it named, still the latest.
    await repos.audit.lockChain(tx, input.businessId);
    const waiting = await pendingDeletionRequest(tx, input.businessId);
    if (!waiting) return { request: null, entry: null };
    if (waiting.id !== input.requestId) throw new CancelNotAllowedError();
    const departure = await repos.founderDepartures.formerFounderFor(tx, input.businessId, input.userId, waiting.createdAt);
    if (!departure) throw new CancelNotAllowedError();
    const scheduledFor = scheduledForOf(waiting);
    if (scheduledFor.getTime() <= now.getTime()) throw new CancelNotAllowedError();
    const written = await repos.audit.append(tx, input.businessId, { actorKind: "user", actorId: input.userId, action: BUSINESS_DELETION_CANCEL_ACTION, target: { kind: "business", id: input.businessId }, details: { cancelledAt: now.toISOString(), hadBeenScheduledFor: scheduledFor.toISOString(), requestId: waiting.id, formerFounder: true, departedAt: departure.departedAt.toISOString(), via: input.via } });
    const warningId = (waiting.details as { inboxItemId?: string | null }).inboxItemId ?? null;
    if (warningId) await repos.inbox.archive(tx, input.businessId, warningId).catch(() => undefined);
    const chief = await repos.agents.chiefOfStaff(tx, input.businessId);
    if (chief) {
      const name = (await repos.founders.get(tx, input.userId).catch(() => null))?.displayName ?? null;
      const day = noticeDay(scheduledFor, business.timeZone);
      await repos.inbox.createItem(
        tx,
        input.businessId,
        {
          type: "update",
          from_agent_id: chief.id,
          subject: "Deletion canceled",
          body_md: `The permanent deletion of ${business.name} that was scheduled for ${day} was canceled. Nothing was deleted and the business keeps working. ${formerFounderCanceledLine(name, noticeDay(departure.departedAt, business.timeZone))} A founder can schedule the deletion again from Settings › Danger zone.`,
          status_strip: [],
          exhibit: { kind: "none", spec_ref: null },
          decision: null,
          blocks_continue: false,
          source_event_ids: [],
          entity_ids: [],
        },
        { fromUserId: input.userId, state: "unread" },
      );
    }
    return { request: waiting, entry: written };
  });
  if (!request || !entry) return { canceled: false, businessName: business.name, scheduledFor: null };
  await tellFoundersQuietly(deps, { businessId: input.businessId, auditId: entry.id, notice: "deletion_canceled", actorUserId: input.userId, now });
  return { canceled: true, businessName: business.name, scheduledFor: scheduledForOf(request).toISOString() };
}

/** What the card on a former founder's home shows: each project they may still keep from deletion. */
export interface FormerProjectCard {
  businessId: string;
  businessName: string;
  /** The waiting request the card cancels. */
  requestId: string;
  scheduledFor: string;
  /** The last moment they may cancel: the request's own scheduled day. */
  until: string;
}

export async function formerProjectCards(db: Db, userId: string, now: Date = new Date()): Promise<FormerProjectCard[]> {
  // A waiting request is at most a week or so old; its former founders left at most 30 days before it, or after it.
  const departures = await repos.founderDepartures.forUser(db, userId, new Date(now.getTime() - FORMER_FOUNDER_LOOKBACK_MS - 14 * DAY_MS));
  const cards: FormerProjectCard[] = [];
  for (const d of departures) {
    const waiting = await pendingDeletionRequest(db, d.businessId);
    if (!waiting) continue;
    const scheduledFor = scheduledForOf(waiting);
    if (scheduledFor.getTime() <= now.getTime()) continue;
    if (!(await repos.founderDepartures.formerFounderFor(db, d.businessId, userId, waiting.createdAt))) continue;
    cards.push({ businessId: d.businessId, businessName: d.businessName, requestId: waiting.id, scheduledFor: scheduledFor.toISOString(), until: scheduledFor.toISOString() });
  }
  return cards;
}
