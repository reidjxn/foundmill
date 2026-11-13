/**
 * Founder notices (security review P2-3, Nov 13, 2026). Someone with a founder's standing could lower another founder's
 * role, remove them, then ask for the project's deletion, and the warning reached only the Inbox of the people still in
 * it. Now each of those steps, and a canceled deletion, tells the founders:
 *
 *   - `tellFounders` asks the gateway's one sender (`/v1/notify/email`, kind `founder_notice`) for one email per person:
 *     every founder now (an owner or a cofounder), the person whose role changed or who was removed, and, for a deletion,
 *     every founder someone else demoted or removed in the last 7 days (`founder_departures`, 0094). Never the person who
 *     did it, so a founder on their own gets nothing from their own steps. Ids only: the gateway reads the audit entry
 *     and everyone again. Asked after the change committed; a refusal or an unreachable gateway changes nothing here.
 *   - While a deletion waits, a founder demoted or removed lately gets a one-click cancel in their email: a random 256-bit
 *     token minted here, its SHA-256 kept on their departure with the request it cancels and its end (the 7 days from
 *     the departure), the token itself sent to the gateway for that email only (`setCancelToken`).
 *   - `founderChangeNote` is the Inbox note for a lowered role or a removal, from the Chief of Staff, written in the
 *     change's own transaction and only when another founder than the one who made it is there to read it.
 *   - `cancelDeletionAsFormerFounder` is the cancel for someone who is out: from `/a/<token>` (email.ts) or the card on
 *     their home (`founder.formerProjects.cancel`). It cancels the deletion and restores nothing else: they stay out.
 *     Rejoining is a separate, ordinary invitation.
 *
 * The purge needs no change (task 3 of the review): the grace is `BUSINESS_DELETION_DELAY_DAYS` (7) from the request, so
 * a deletion asked for within 7 days of a founder's removal is never due before that founder's own 7 days have run.
 */
import { BUSINESS_DELETION_CANCEL_ACTION, BUSINESS_DELETION_REQUEST_ACTION, cancelWindowEnd, repos, type AuditEntry, type Db, type DbTx, type Executor, type FounderDepartureView } from "@foundmill/db";
import { AppError, founderChangeNote as noteWords, formerFounderCanceledLine, noticeDay, noticeMoment, OWNER_ROLES, type FounderNotice } from "@foundmill/shared";
import { newActionToken } from "@foundmill/shared/email-links";
import type { ApiGatewayClient } from "./gateway";
import type { ApiLogger } from "./log";

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

/** The deletion that waits now (the latest request, not canceled after it), or null. */
export async function pendingDeletionRequest(db: Executor, businessId: string): Promise<AuditEntry | null> {
  const latest = (await repos.audit.list(db, businessId, { action: [BUSINESS_DELETION_REQUEST_ACTION, BUSINESS_DELETION_CANCEL_ACTION], limit: 1 })).items[0];
  return latest && latest.action === BUSINESS_DELETION_REQUEST_ACTION ? latest : null;
}

/** The day a waiting request is due. */
export const scheduledForOf = (request: AuditEntry): Date => {
  const at = (request.details as { scheduledFor?: unknown }).scheduledFor;
  const d = typeof at === "string" ? new Date(at) : null;
  return d && !Number.isNaN(d.getTime()) ? d : new Date(request.createdAt.getTime() + 7 * 86_400_000);
};

/** Mints the one-click cancel for this departure and this request; the token, or null when the departure carries none. */
async function cancelTokenFor(db: Db, departure: FounderDepartureView, request: AuditEntry): Promise<string | null> {
  const minted = newActionToken();
  const ok = await repos.founderDepartures.setCancelToken(db, departure.id, { tokenHash: minted.hash, requestId: request.id, expiresAt: scheduledForOf(request) });
  return ok ? minted.token : null;
}

export async function tellFounders(deps: NoticeDeps, input: TellFoundersInput): Promise<TellFoundersResult> {
  const now = input.now ?? new Date();
  const actor = input.actorUserId.toLowerCase();
  const subject = input.subjectUserId?.toLowerCase() ?? null;
  const [founders, former, waiting] = await Promise.all([
    repos.memberships.list(deps.db, input.businessId, { roles: OWNER_ROLES, activeOnly: true }),
    repos.founderDepartures.formerFounders(deps.db, input.businessId, now),
    pendingDeletionRequest(deps.db, input.businessId),
  ]);
  const recipients = new Map<string, { departure: FounderDepartureView | null }>();
  for (const m of founders) recipients.set(m.userId.toLowerCase(), { departure: null });
  const departureOf = (userId: string) => former.find((d) => d.userId.toLowerCase() === userId) ?? null;
  if (subject) recipients.set(subject, { departure: departureOf(subject) });
  if (input.notice === "deletion_requested" || input.notice === "deletion_canceled") for (const d of former) recipients.set(d.userId.toLowerCase(), { departure: d });
  recipients.delete(actor);

  const asked = await Promise.all(
    [...recipients.entries()].map(async ([userId, { departure }]) => {
      // A deletion waits and this person can no longer cancel it in the app: their email carries the one-click cancel.
      const cancelToken = waiting && departure && input.notice !== "deletion_canceled" ? await cancelTokenFor(deps.db, departure, waiting).catch(() => null) : null;
      try {
        const answer = await deps.gateway.notifyEmail({ userId, kind: "founder_notice", businessId: input.businessId, data: { auditId: input.auditId, ...(cancelToken ? { cancelToken } : {}) } });
        if (!answer.sent) deps.log.info({ businessId: input.businessId, userId, notice: input.notice, reason: answer.reason }, "founder notice not sent");
        return { userId, sent: answer.sent, reason: answer.sent ? null : answer.reason, offersCancel: cancelToken !== null };
      } catch (e) {
        deps.log.warn({ businessId: input.businessId, userId, notice: input.notice, code: e instanceof AppError ? e.code : "unknown" }, "founder notice not sent: the gateway did not answer");
        return { userId, sent: false, reason: "unreachable", offersCancel: cancelToken !== null };
      }
    }),
  );
  return { asked };
}

/**
 * The founder's role a member had until someone else lowered it in the last 7 days (`owner` or `cofounder`), or null.
 * A founder is always stepped down before they can be removed, so this is what makes a removal a founder's removal.
 * Read in the removal's own transaction (the actor's RLS connection: a founder reads the project's departures).
 */
export async function recentlyLowered(tx: DbTx | Executor, businessId: string, userId: string, now: Date = new Date()): Promise<"owner" | "cofounder" | null> {
  const latest = await repos.founderDepartures.latest(tx, businessId, userId);
  if (!latest || latest.how !== "demoted" || cancelWindowEnd(latest.departedAt).getTime() <= now.getTime()) return null;
  return latest.priorRole;
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
 * A founder someone else demoted or removed in the last 7 days cancels a waiting deletion of that project, as
 * themselves (the audit entry is theirs, marked `formerFounder`). Nothing else changes: they stay out. The warning the
 * request left is settled, the Chief of Staff says who canceled, and every founder hears it (`tellFounders`).
 */
export async function cancelDeletionAsFormerFounder(deps: NoticeDeps, input: { businessId: string; userId: string; via: "email" | "home"; now?: Date }): Promise<FormerCancelResult> {
  const now = input.now ?? new Date();
  const departure = await repos.founderDepartures.formerFounder(deps.db, input.businessId, input.userId, now);
  const business = await repos.businesses.get(deps.db, input.businessId, { includeArchived: true }).catch(() => null);
  if (!departure || !business) throw new CancelNotAllowedError();
  const { request, entry } = await deps.db.transaction(async (tx) => {
    // The audit chain's own lock (audit.append takes it again): a cancel and a request at once are judged one after the
    // other, so the cancel is written only over a request that is still the latest.
    await repos.audit.lockChain(tx, input.businessId);
    const waiting = await pendingDeletionRequest(tx, input.businessId);
    if (!waiting) return { request: null, entry: null };
    const scheduledFor = scheduledForOf(waiting).toISOString();
    const written = await repos.audit.append(tx, input.businessId, { actorKind: "user", actorId: input.userId, action: BUSINESS_DELETION_CANCEL_ACTION, target: { kind: "business", id: input.businessId }, details: { cancelledAt: now.toISOString(), hadBeenScheduledFor: scheduledFor, formerFounder: true, departedAt: departure.departedAt.toISOString(), via: input.via } });
    const warningId = (waiting.details as { inboxItemId?: string | null }).inboxItemId ?? null;
    if (warningId) await repos.inbox.archive(tx, input.businessId, warningId).catch(() => undefined);
    const chief = await repos.agents.chiefOfStaff(tx, input.businessId);
    if (chief) {
      const name = (await repos.founders.get(tx, input.userId).catch(() => null))?.displayName ?? null;
      const day = noticeDay(scheduledForOf(waiting), business.timeZone);
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
  scheduledFor: string;
  /** The last moment they may cancel (7 days from their departure, or the deletion's day if sooner). */
  until: string;
}

export async function formerProjectCards(db: Db, userId: string, now: Date = new Date()): Promise<FormerProjectCard[]> {
  const departures = await repos.founderDepartures.forUser(db, userId, new Date(now.getTime() - 7 * 86_400_000));
  const cards: FormerProjectCard[] = [];
  for (const d of departures) {
    if (!(await repos.founderDepartures.formerFounder(db, d.businessId, userId, now))) continue;
    const waiting = await pendingDeletionRequest(db, d.businessId);
    if (!waiting) continue;
    const scheduledFor = scheduledForOf(waiting);
    const end = cancelWindowEnd(d.departedAt);
    cards.push({ businessId: d.businessId, businessName: d.businessName, scheduledFor: scheduledFor.toISOString(), until: new Date(Math.min(end.getTime(), scheduledFor.getTime())).toISOString() });
  }
  return cards;
}
