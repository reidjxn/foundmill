/**
 * Founder email links (retention plan, founder 2026-11-11). Public procedures: the person who opens a link may not be
 * signed in (the email is the phone surface; the app is desktop only), so the link's token is the only credential.
 *
 * email.action.get / answer — a one-click answer. The token is 256 random bits; only its sha-256 is stored, on the
 * founder_notifications row that was emailed. `get` says what the answer would do and never changes anything (a mail
 * scanner that follows links answers nothing); `answer` is the POST the page's button sends. At answer time everything
 * is checked again: the token unused and unexpired, the founder still an owner or admin of the business, the note
 * still open, and the option still the one `oneClickOption` allows (recommended, reversible, free; never an approval
 * or a sign-off). The answer then goes through the ordinary `decideInboxItem` as that founder, so a plan the policy
 * wants confirmed is only staged (it waits for the go-ahead in the app) and a hard gate never runs. The token is spent
 * before the decision, so it works at most once even under a race.
 *
 * The same two procedures serve the one-click cancel of a deletion (security review P2-3): the token a founder notice
 * carries to a founder someone else demoted or removed in the last 7 days, while a deletion of that project waits.
 * 256 random bits minted by the api, only its SHA-256 kept on their `founder_departures` row with the request it
 * cancels and its end. `get` changes nothing; `answer` (the page's button, a POST) checks everything again (unused, in
 * date, still a former founder in the window and not back as a founder, the same request still the one waiting, a
 * deployment that still admits them), spends the token first, then cancels as that person
 * (`cancelDeletionAsFormerFounder`): an audit entry of theirs, every founder told, nothing else restored.
 *
 * email.pause — "Pause every email" in each footer (and List-Unsubscribe): an HMAC-signed account id with an expiry
 * (`@foundmill/shared/email-links`). It stamps `emails_paused_at`; Settings › Preferences › Email turns them back on.
 */
import { repos, withRls, type Business, type Membership } from "@foundmill/db";
import { hasSectionAccess, isAdminRole, oneClickOption } from "@foundmill/shared";
import { emailLinkSecret, hashActionToken, isActionTokenShape, verifyPauseToken } from "@foundmill/shared/email-links";
import { z } from "zod";
import { isAdmittedNow } from "../services/access";
import { decideInboxItem, oneClickPlanAllowed } from "../services/decide";
import { cancelDeletionAsFormerFounder, CancelNotAllowedError, pendingDeletionRequest, scheduledForOf } from "../services/founder-notices";
import type { BusinessContext, RlsRunner } from "../trpc";
import { publicProcedure, router } from "../trpc";
import type { Context } from "../context";

const Token = z.object({ token: z.string().trim().max(200) });

export type EmailActionState = "ready" | "answered" | "canceled" | "used" | "expired" | "unavailable";

interface Resolved {
  state: EmailActionState;
  notification: Awaited<ReturnType<typeof repos.notifications.findByActionTokenHash>>;
  businessName: string | null;
  subject: string | null;
  option: { id: string; label: string; consequence: string } | null;
  /** Set when ready: the founder's context the answer is given in. */
  bctx: BusinessContext | null;
}

function businessContextFor(ctx: Context, userId: string, email: string | null, business: Business, membership: Membership): BusinessContext {
  const rls: RlsRunner = (fn) => withRls(ctx.db, { userId, claims: email ? { email } : undefined }, fn);
  return { ...ctx, userId, email, businessId: business.id, business, membership, role: membership.role, rls };
}

async function resolve(ctx: Context, token: string, now: Date): Promise<Resolved> {
  const none: Resolved = { state: "unavailable", notification: null, businessName: null, subject: null, option: null, bctx: null };
  if (!isActionTokenShape(token)) return none;
  const n = await repos.notifications.findByActionTokenHash(ctx.db, hashActionToken(token));
  if (!n || !n.actionItemId || !n.actionOptionId) return none;
  // A dead link says only that it is dead: nothing about the business or the note (security review P3).
  if (n.actionUsedAt) return { ...none, state: "used", notification: n };
  if (!n.actionExpiresAt || n.actionExpiresAt.getTime() < now.getTime()) return { ...none, state: "expired", notification: n };
  const { membership, business } = await repos.memberships.access(ctx.db, n.businessId, n.userId);
  // Owners and admins who may still write the Inbox (section permissions hold here as in inbox.decide), on a deployment
  // that still admits them (the allowlist protectedProcedure would apply).
  if (!membership || !business || membership.source === "example" || !isAdminRole(membership.role) || !hasSectionAccess(membership, "inbox", "write")) return { ...none, notification: n };
  const email = await repos.founders.emailOf(ctx.db, n.userId);
  if (!(await isAdmittedNow(ctx, { userId: n.userId, email, emailConfirmed: email !== null }))) return { ...none, notification: n };
  const item = await repos.notifyFacts.item(ctx.db, n.businessId, n.actionItemId);
  if (!item) return { ...none, notification: n };
  if (item.state === "answered" || item.state === "archived") return { ...none, state: "answered", notification: n };
  const isSignoff = (await repos.productSignoffs.forInboxItem(ctx.db, n.businessId, item.id)) !== null;
  const option = oneClickOption(item, { isSignoff });
  if (!option || option.id !== n.actionOptionId) return { ...none, notification: n };
  const bctx = businessContextFor(ctx, n.userId, email, business, membership);
  // The option's plan, compiled and checked as a click in the Inbox would be: internal, free, allowed, no hard gate.
  if (!(await oneClickPlanAllowed(bctx, item.id, option.id))) return { ...none, notification: n };
  return { state: "ready", notification: n, businessName: business.name, subject: item.subject, option, bctx };
}

const view = (r: Resolved) => {
  // Only a link that still works shows what it is about; a dead one shows nothing but its state.
  if (r.state !== "ready" && r.state !== "answered") return { kind: "answer" as const, state: r.state, businessName: null, subject: null, optionLabel: null, consequence: null, businessId: null, itemId: null, scheduledFor: null, until: null };
  return { kind: "answer" as const, state: r.state, businessName: r.businessName, subject: r.subject, optionLabel: r.option?.label ?? null, consequence: r.option?.consequence ?? null, businessId: r.notification?.businessId ?? null, itemId: r.notification?.actionItemId ?? null, scheduledFor: null, until: null };
};

/* ---- The one-click cancel of a deletion (a former founder's founder notice) ---- */

interface ResolvedCancel {
  state: EmailActionState;
  departure: Awaited<ReturnType<typeof repos.founderDepartures.byCancelTokenHash>>;
  businessName: string | null;
  scheduledFor: string | null;
  until: string | null;
}

async function resolveCancel(ctx: Context, hash: string, now: Date): Promise<ResolvedCancel | null> {
  const d = await repos.founderDepartures.byCancelTokenHash(ctx.db, hash);
  if (!d || !d.cancelRequestId || !d.cancelExpiresAt) return null;
  const none: ResolvedCancel = { state: "unavailable", departure: d, businessName: null, scheduledFor: null, until: null };
  if (d.cancelUsedAt) return { ...none, state: "used" };
  if (d.cancelExpiresAt.getTime() <= now.getTime()) return { ...none, state: "expired" };
  if (!(await repos.founderDepartures.formerFounder(ctx.db, d.businessId, d.userId, now))) return none;
  const email = await repos.founders.emailOf(ctx.db, d.userId);
  if (!(await isAdmittedNow(ctx, { userId: d.userId, email, emailConfirmed: email !== null }))) return none;
  const waiting = await pendingDeletionRequest(ctx.db, d.businessId);
  // Canceled already (by a founder, or by them in the app): nothing to do, and nothing about the project is shown.
  if (!waiting) return { ...none, state: "canceled" };
  // A newer request was made since: its own email carries the link that works.
  if (waiting.id !== d.cancelRequestId) return none;
  const business = await repos.businesses.get(ctx.db, d.businessId, { includeArchived: true }).catch(() => null);
  if (!business) return none;
  return { state: "ready", departure: d, businessName: business.name, scheduledFor: scheduledForOf(waiting).toISOString(), until: d.cancelExpiresAt.toISOString() };
}

const cancelView = (r: ResolvedCancel, justCanceled = false) => {
  const shows = r.state === "ready" || justCanceled;
  return { kind: "cancel_deletion" as const, state: r.state, businessName: shows ? r.businessName : null, subject: null, optionLabel: null, consequence: null, businessId: null, itemId: null, scheduledFor: shows ? r.scheduledFor : null, until: r.state === "ready" ? r.until : null };
};

export const emailRouter = router({
  action: router({
    /** What the one-click answer would do; changes nothing. */
    get: publicProcedure.input(Token).query(async ({ ctx, input }) => {
      const now = new Date();
      const cancel = isActionTokenShape(input.token) ? await resolveCancel(ctx, hashActionToken(input.token), now) : null;
      return cancel ? cancelView(cancel) : view(await resolve(ctx, input.token, now));
    }),
    /** Gives the answer as the founder the email went to (POST from the page's button). */
    answer: publicProcedure.input(Token).mutation(async ({ ctx, input }) => {
      const now = new Date();
      const cancel = isActionTokenShape(input.token) ? await resolveCancel(ctx, hashActionToken(input.token), now) : null;
      if (cancel) {
        const d = cancel.departure!;
        if (cancel.state !== "ready") return { ...cancelView(cancel), requiresConfirmation: false };
        // Spend the token first: a second click, or a second tab, gets "used".
        if (!(await repos.founderDepartures.useCancelToken(ctx.db, d.id, now))) return { ...cancelView({ ...cancel, state: "used" }), requiresConfirmation: false };
        try {
          const done = await cancelDeletionAsFormerFounder(ctx, { businessId: d.businessId, userId: d.userId, via: "email", now });
          return { ...cancelView({ ...cancel, state: "canceled" }, done.canceled), requiresConfirmation: false };
        } catch (e) {
          if (e instanceof CancelNotAllowedError) return { ...cancelView({ ...cancel, state: "unavailable" }), requiresConfirmation: false };
          throw e;
        }
      }
      const r = await resolve(ctx, input.token, now);
      if (r.state !== "ready" || !r.notification || !r.option || !r.bctx) return { ...view(r), requiresConfirmation: false };
      const n = r.notification;
      // Spend the token first: a second click, or a second tab, gets "used".
      if (!(await repos.notifications.useAction(ctx.db, n.businessId, n.id, now))) return { ...view({ ...r, state: "used" }), requiresConfirmation: false };
      const decided = await decideInboxItem(r.bctx!, { itemId: n.actionItemId!, chosenOption: r.option.id });
      await repos.audit.append(ctx.db, n.businessId, { actorKind: "user", actorId: n.userId, action: "inbox.decide.from_email", target: { kind: "inbox_item", id: n.actionItemId! }, details: { notificationId: n.id, chosenOption: r.option.id, requiresConfirmation: decided.requiresConfirmation } });
      return { ...view({ ...r, state: "answered" }), requiresConfirmation: decided.requiresConfirmation };
    }),
  }),
  /** Pauses every founder email for the account the link was signed for. */
  pause: publicProcedure.input(Token).mutation(async ({ ctx, input }) => {
    const userId = verifyPauseToken(emailLinkSecret(ctx.env), input.token);
    if (!userId) return { paused: false as const };
    await repos.emailPrefs.pauseEmails(ctx.db, userId);
    return { paused: true as const };
  }),
});
