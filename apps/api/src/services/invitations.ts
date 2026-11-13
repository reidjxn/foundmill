/**
 * Invitations to a project (docs/NETWORK.md F5, L4; docs/THESIS_REVIEW.md package 3.1; 0089 `invitations`). The one way
 * a person is added to a project: the silent add by email or account id (`team.humans.invite`) is gone. Every
 * "invite" control makes this object, and it lives in Settings › People only (the solo guard: nothing prompts a
 * founder to invite anyone).
 *
 *   - `createInvitation` (Settings › People; an owner, a cofounder or an admin with Team write, `mayMakeInvitation`; a
 *     cofounder invitation only by an owner or a cofounder, and always to an address): a pending invitation for 14
 *     days, its token returned once in the link and stored as SHA-256 only; when the founder typed an address, the
 *     gateway emails the link there (`invitation`, within its own limits, apps/gateway notify-address-email.ts).
 *     `invitation.sent`.
 *   - `listInvitations` / `revokeInvitation` (the same people): the project's invitations (addresses masked) and
 *     revoking a pending one.
 *   - `invitationByToken` (public, `/i/<token>`; the browser asks, so the per-caller limit is the visitor's own): what
 *     it is (the project's name, the inviter's display name, the role in plain words) and nothing else. An unknown,
 *     expired, revoked, used or declined token reads the same, and so does an invitation whose inviter no longer holds
 *     the right to make it.
 *   - `acceptInvitation` (signed in with a confirmed address, admitted or not): an invitation that names an address is
 *     accepted only by the account signed in with that confirmed address (else `invitation_other_address`, "Sign in
 *     with the address this invitation was sent to.", never which address: the link is not a bearer credential; a
 *     dead link stays `invitation_unavailable`); the membership in the role of the same name
 *     (`invitationMembership`: a cofounder or a collaborator, THESIS_REVIEW 3.3), once, or a new start for a
 *     collaborator whose access had ended; the admission when the person was not in yet (services/access.ts
 *     `admitThroughInvitation`: only an inviter the list, open sign-up or the time before let in, a few a day); an
 *     audit row; `invitation.accepted` and `membership.changed`; then the inviter is emailed (`invitation_accepted`).
 *     Two accepts of one token, or an accept and a revoke, are decided by the conditional UPDATE in
 *     `repos.invitations.accept` (only a pending row changes): one wins, the other reads as unavailable.
 *   - `declineInvitation` (public): the link stops working; `invitation.declined`. A link-only invitation is declined by
 *     whoever holds the token; one that names an address only by the account signed in with that confirmed address,
 *     as for accept (else `invitation_other_address`), so a forwarded link cannot be thrown away by someone else.
 *
 * Who brought a new person: an accepted invitation is the strongest reference there is, so the step that records
 * attribution for a new person looks for it first (./person-created `invitation_attribution`).
 */
import { createHash, randomBytes } from "node:crypto";
import { repos, assertSeatAvailable, membershipEnded, type InvitationRow } from "@foundmill/db";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  INVITATION_OTHER_ADDRESS_CODE,
  INVITATION_OTHER_ADDRESS_WORDS,
  INVITATION_ROLE_SENTENCE,
  INVITATION_ROLE_WORD,
  INVITATION_TTL_MS,
  invitationMembership,
  invitationPath,
  isPeopleTokenShape,
  maskedAddress,
  invitationNeedsEmail,
  mayMakeInvitation,
  NotFoundError,
  ValidationError,
  type InvitationRole,
  type InvitationState,
} from "@foundmill/shared";
import { z } from "zod";
import type { Executor } from "@foundmill/db";
import type { Context } from "../context";
import { audit, emit, type BusinessContext } from "../trpc";
import { admitThroughInvitation, rememberAdmitted } from "./access";
import { callerLimitKey } from "./pages";
import { takeOrThrow, type RateLimitStore } from "./rate-limit";

/** The token's hash as stored: SHA-256, lowercase hex. */
export const invitationTokenHash = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

/**
 * The limits, shared by every replica (`ctx.limits`):
 *   - making invitations: 20 a day per project and 40 a day per person, and at most 50 waiting at once per project;
 *   - reading one by its token (`invitationByToken`): per caller (an IPv6 caller by their /64, `callerLimitKey`), then
 *     per token (by its hash, so one link opened from many places cannot use up the ceiling for all) and a ceiling for
 *     all, taken together; a lookup that finds nothing gives both back and draws from its own `unknown` ceiling, so
 *     guesses cannot use up what real links read from;
 *   - accepting: 20 an hour per account; declining: per caller.
 */
export const INVITATION_LIMITS = {
  perProjectDay: { limit: 20, windowMs: 24 * 60 * 60_000 },
  perPersonDay: { limit: 40, windowMs: 24 * 60 * 60_000 },
  pendingAtOnce: 50,
  readPerCaller: { limit: 120, windowMs: 60_000 },
  readPerToken: { limit: 60, windowMs: 60_000 },
  readAll: { limit: 1_200, windowMs: 60_000 },
  readUnknown: { limit: 300, windowMs: 60_000 },
  acceptPerAccount: { limit: 20, windowMs: 60 * 60_000 },
  declinePerCaller: { limit: 30, windowMs: 60_000 },
} as const;

export const invitationLimitKeys = {
  project: (businessId: string) => `invite:project:${businessId}`,
  person: (userId: string) => `invite:person:${userId.toLowerCase()}`,
  readCaller: (env: Context["env"], address: string) => callerLimitKey(env, "invite-read", address),
  readToken: (tokenHash: string) => `invite-read:token:${tokenHash}`,
  readAll: "invite-read:all",
  readUnknown: "invite-read:unknown",
  accept: (userId: string) => `invite-accept:${userId.toLowerCase()}`,
  declineCaller: (env: Context["env"], address: string) => callerLimitKey(env, "invite-decline", address),
} as const;

export const CreateInvitationInput = z.object({
  role: z.enum(["cofounder", "collaborator"]),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()).optional(),
});

/** An invitation as Settings › People shows it: never its token, and the address masked. */
export interface InvitationView {
  id: string;
  role: InvitationRole;
  roleWord: string;
  /** `expired` for a pending invitation past its date. */
  state: InvitationState;
  /** "ma***@example.com" when it was emailed, else null. */
  sentTo: string | null;
  invitedByUserId: string | null;
  acceptedByUserId: string | null;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
}

const stateOf = (row: Pick<InvitationRow, "state" | "expiresAt">, now: Date): InvitationState => (row.state === "pending" && row.expiresAt.getTime() <= now.getTime() ? "expired" : row.state);

function viewOf(row: InvitationRow, address: string | undefined, now: Date): InvitationView {
  return {
    id: row.id,
    role: row.role,
    roleWord: INVITATION_ROLE_WORD[row.role],
    state: stateOf(row, now),
    sentTo: address ? maskedAddress(address) : null,
    invitedByUserId: row.invitedByUserId,
    acceptedByUserId: row.acceptedByUserId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
  };
}

const appUrl = (env: Context["env"]) => env.APP_URL.trim().replace(/\/+$/, "");

export interface CreatedInvitation {
  invitation: InvitationView;
  /** The link, shown once: the token is not stored and cannot be read back. */
  link: string;
  /** Null when no address was typed; else whether Foundmill sent it. */
  emailed: boolean | null;
}

/** Settings › People › Invite someone (see the file comment). */
export async function createInvitation(ctx: BusinessContext, raw: z.input<typeof CreateInvitationInput>): Promise<CreatedInvitation> {
  const input = CreateInvitationInput.parse(raw);
  const role = input.role as InvitationRole;
  if (!mayMakeInvitation(ctx.membership, role)) throw new ForbiddenError(role === "cofounder" ? "Only an owner or a cofounder can invite a cofounder, because a cofounder has the same standing." : "Only an owner, a cofounder or an admin with Team access can invite someone.");
  if (invitationNeedsEmail(role) && !input.email) throw new ValidationError("A cofounder invitation is for one person: type their email address. Only the account signed in with it can accept.");
  if (ctx.business.isDemo) throw new ConflictError("This is a sample business, so nobody can be invited to it. Start your own project to invite people.");
  const now = new Date();
  await takeOrThrow(ctx.limits, "Invitations", [
    { key: invitationLimitKeys.project(ctx.businessId), rule: INVITATION_LIMITS.perProjectDay },
    { key: invitationLimitKeys.person(ctx.userId), rule: INVITATION_LIMITS.perPersonDay },
  ]);
  const token = randomBytes(32).toString("base64url");
  const row = await ctx.rls(async (tx) => {
    if ((await repos.invitations.pendingCount(tx, ctx.businessId)) >= INVITATION_LIMITS.pendingAtOnce) throw new ConflictError(`${INVITATION_LIMITS.pendingAtOnce} invitations are already waiting. Revoke some you no longer need first.`);
    const created = await repos.invitations.create(tx, ctx.businessId, { tokenHash: invitationTokenHash(token), role, invitedByUserId: ctx.userId, email: input.email ?? null, expiresAt: new Date(now.getTime() + INVITATION_TTL_MS) });
    await audit(tx, ctx, { action: "invitation.created", target: { kind: "invitation", id: created.id }, details: { role, emailed: input.email !== undefined } });
    await emit(tx, ctx, { type: "invitation.sent", payload: { invitationId: created.id, role, emailed: input.email !== undefined } });
    return created;
  });
  let emailed: boolean | null = null;
  if (input.email) {
    emailed = false;
    try {
      const answer = ctx.gateway.addressEmail ? await ctx.gateway.addressEmail({ kind: "invitation", data: { invitationId: row.id, token } }) : null;
      emailed = answer?.sent === true;
      if (answer && !answer.sent) ctx.log.info({ businessId: ctx.businessId, invitationId: row.id, reason: answer.reason }, "invitation email not sent");
    } catch (e) {
      ctx.log.warn({ businessId: ctx.businessId, invitationId: row.id, code: e instanceof AppError ? e.code : "unknown" }, "invitation email not sent: the gateway did not answer");
    }
  }
  return { invitation: viewOf(row, input.email, now), link: `${appUrl(ctx.env)}${invitationPath(token)}`, emailed };
}

/** The project's invitations, newest first, with the addresses masked (read on the service connection: no client role reads them). */
export async function listInvitations(ctx: BusinessContext): Promise<InvitationView[]> {
  const rows = await ctx.rls((tx) => repos.invitations.list(tx, ctx.businessId));
  const addresses = await repos.invitations.addressesOf(ctx.db, ctx.businessId, rows.map((r) => r.id));
  const now = new Date();
  return rows.map((r) => viewOf(r, addresses.get(r.id), now));
}

/** Revokes a pending invitation (an owner, a cofounder or an admin; RLS and its guard say the same). */
export async function revokeInvitation(ctx: BusinessContext, invitationId: string): Promise<InvitationView> {
  const row = await ctx.rls(async (tx) => {
    const revoked = await repos.invitations.revoke(tx, ctx.businessId, invitationId, ctx.userId);
    if (!revoked) throw new NotFoundError("invitation", invitationId);
    await audit(tx, ctx, { action: "invitation.revoked", target: { kind: "invitation", id: revoked.id }, details: { role: revoked.role } });
    return revoked;
  });
  return viewOf(row, undefined, new Date());
}

/* ---- The invitee's side ---- */

/** What the page at `/i/<token>` shows: the invitation while it works, else the same answer for every other case. */
export type InvitationPreview = { state: "pending"; projectName: string; inviterName: string | null; role: InvitationRole; roleWord: string; roleSentence: string } | { state: "unavailable" };

const UNAVAILABLE = { state: "unavailable" } as const;
export const INVITATION_UNAVAILABLE_MESSAGE = "This invitation no longer works. Ask the person who invited you for a new link.";

type InviteeContext = Pick<Context, "db" | "env" | "limits" | "log"> & { clientAddress?: string | null };

/** The refusal of an invitation that names an address, to an account signed in with another one (or none). */
const otherAddress = () => new AppError(INVITATION_OTHER_ADDRESS_CODE, INVITATION_OTHER_ADDRESS_WORDS, 403);

/**
 * Whether `inviterUserId` still holds the right to the invitation (`mayMakeInvitation`), on a membership that has not
 * ended. `lock` (inside the accept's transaction): the inviter's row is held `for share`, so a demotion or a removal
 * that commits during the accept waits for it instead of slipping between the check and the new membership.
 */
async function inviterStillMay(db: Executor, businessId: string, inviterUserId: string, role: InvitationRole, lock = false): Promise<boolean> {
  const membership = await repos.memberships.getActive(db, businessId, inviterUserId, lock ? { lock: "share" } : {});
  return membership !== null && mayMakeInvitation(membership, role);
}

/**
 * The invitation a token names while it can be accepted: pending, in date, its project open and real, a cofounder's
 * naming an address (0091), and its inviter still one of the project's people with the right to make it
 * (`mayMakeInvitation`: the role and Team write). Else null.
 */
async function workingInvitation(db: Context["db"], token: string) {
  if (!isPeopleTokenShape(token)) return null;
  const row = await repos.invitations.byTokenHash(db, invitationTokenHash(token));
  if (!row || row.state !== "pending" || row.expiresAt.getTime() <= Date.now() || row.businessArchived || row.businessIsDemo || !row.invitedByUserId) return null;
  if (invitationNeedsEmail(row.role) && !row.email) return null;
  if (!(await inviterStillMay(db, row.businessId, row.invitedByUserId, row.role))) return null;
  return row;
}

/** The address an invitation names and the one the account signed in with, compared as the gateway stores them. */
const sameAddress = (named: string, signedIn: string | null): boolean => signedIn !== null && named.trim().toLowerCase() === signedIn.trim().toLowerCase();

/** `invitation.byToken` (public). */
export async function invitationByToken(ctx: InviteeContext, token: string): Promise<InvitationPreview> {
  if (ctx.clientAddress) await takeOrThrow(ctx.limits as RateLimitStore, "Invitations", [{ key: invitationLimitKeys.readCaller(ctx.env, ctx.clientAddress), rule: INVITATION_LIMITS.readPerCaller }]);
  // A token of the wrong shape is never looked up, so it gets no window of its own.
  const perToken = isPeopleTokenShape(token) ? [{ key: invitationLimitKeys.readToken(invitationTokenHash(token)), rule: INVITATION_LIMITS.readPerToken }] : [];
  const ticket = await takeOrThrow(ctx.limits, "Invitations", [...perToken, { key: invitationLimitKeys.readAll, rule: INVITATION_LIMITS.readAll }]);
  const row = await workingInvitation(ctx.db, token);
  if (!row) {
    await ctx.limits.refund(ticket);
    await takeOrThrow(ctx.limits, "Invitations", [{ key: invitationLimitKeys.readUnknown, rule: INVITATION_LIMITS.readUnknown }]);
    return UNAVAILABLE;
  }
  return { state: "pending", projectName: row.businessName, inviterName: row.inviterName, role: row.role, roleWord: INVITATION_ROLE_WORD[row.role], roleSentence: INVITATION_ROLE_SENTENCE[row.role] };
}

export interface AcceptedInvitation {
  businessId: string;
  /** True when the person was already one of the project's people: nothing changed and the invitation still waits. */
  already: boolean;
}

/** Who accepts: the signed-in account, and the address it signed in with (the token's, confirmed: `signedInProcedure`). */
export interface Accepter {
  userId: string;
  email: string | null;
  emailConfirmed: boolean;
}

/** `invitation.accept` (see the file comment). */
export async function acceptInvitation(ctx: Pick<Context, "db" | "env" | "limits" | "log" | "gateway">, accepter: Accepter, token: string): Promise<AcceptedInvitation> {
  const userId = accepter.userId;
  await takeOrThrow(ctx.limits, "Accepting invitations", [{ key: invitationLimitKeys.accept(userId), rule: INVITATION_LIMITS.acceptPerAccount }]);
  const unavailable = () => new AppError("invitation_unavailable", INVITATION_UNAVAILABLE_MESSAGE, 404);
  if (accepter.emailConfirmed !== true) throw unavailable();
  const working = await workingInvitation(ctx.db, token);
  if (!working) throw unavailable();
  // An invitation to an address is that address's: any other account is told to sign in with the address it was sent
  // to, and learns nothing more (not the address, not the project beyond what the page already shows).
  if (working.email !== null && !sameAddress(working.email, accepter.email)) throw otherAddress();
  const businessId = working.businessId;
  const result = await ctx.db.transaction(async (tx) => {
    const existing = await repos.memberships.get(tx, businessId, userId);
    if (existing && !membershipEnded(existing)) return { already: true as const, row: null };
    // The conditional UPDATE decides: only a row still pending (not used, declined, revoked or expired) changes.
    const accepted = await repos.invitations.accept(tx, working.id, userId);
    if (!accepted) throw unavailable();
    // The inviter's right, again inside the transaction that uses the invitation, their row locked for share: a demotion
    // that committed first wins, and one that comes later waits for this accept.
    if (!accepted.invitedByUserId || !(await inviterStillMay(tx, businessId, accepted.invitedByUserId, accepted.role, true))) throw unavailable();
    const business = await repos.businesses.get(tx, businessId);
    if (!business) throw unavailable();
    // The person is let in by this invitation only on the inviter's standing (services/access.ts); a refusal undoes it all.
    await admitThroughInvitation(ctx, tx, accepter, { id: accepted.id, invitedByUserId: accepted.invitedByUserId });
    // People are free on every plan (no limit today); the check stays for a limit that might return.
    await assertSeatAvailable(tx, business);
    const { role, sectionPermissions } = invitationMembership(accepted.role);
    // A collaborator whose access ended may be invited again: the ended row gets a new start instead of a second row.
    const membership = existing ? await repos.memberships.renewEnded(tx, businessId, userId, { role, sectionPermissions }) : await repos.memberships.add(tx, businessId, { userId, role, sectionPermissions, source: "invite" });
    if (!membership) throw unavailable();
    const actor = { businessId, userId };
    await audit(tx, actor, { action: "invitation.accepted", target: { kind: "invitation", id: accepted.id }, details: { role: accepted.role, membershipId: membership.id, renewed: existing !== null } });
    await emit(tx, actor, { type: "invitation.accepted", payload: { invitationId: accepted.id, role: accepted.role, userId } });
    // Open tabs refetch the People list; apps/stream re-checks this person's subscriptions.
    await emit(tx, actor, { type: "membership.changed", payload: { userId, change: "added" } });
    return { already: false as const, row: accepted };
  });
  if (result.already || !result.row) return { businessId, already: true };
  rememberAdmitted(userId);
  // The inviter hears it, through the one sender and within their own limits; a refusal changes nothing here.
  if (result.row.invitedByUserId) {
    try {
      const answer = await ctx.gateway.notifyEmail({ userId: result.row.invitedByUserId, kind: "invitation_accepted", businessId, data: { invitationId: result.row.id } });
      if (!answer.sent) ctx.log.info({ businessId, invitationId: result.row.id, reason: answer.reason }, "invitation accepted email not sent");
    } catch (e) {
      ctx.log.warn({ businessId, invitationId: result.row.id, code: e instanceof AppError ? e.code : "unknown" }, "invitation accepted email not sent: the gateway did not answer");
    }
  }
  return { businessId, already: false };
}

/**
 * `invitation.decline` (public): `{ ok: true }` whatever a dead token named. An invitation that names an address needs
 * `decliner`, signed in with that confirmed address (the router passes the signed-in account, or null).
 */
export async function declineInvitation(ctx: InviteeContext, token: string, decliner: Accepter | null = null): Promise<{ ok: true }> {
  if (ctx.clientAddress) await takeOrThrow(ctx.limits, "Invitations", [{ key: invitationLimitKeys.declineCaller(ctx.env, ctx.clientAddress), rule: INVITATION_LIMITS.declinePerCaller }]);
  const working = await workingInvitation(ctx.db, token);
  if (!working) return { ok: true };
  if (working.email !== null && (decliner?.emailConfirmed !== true || !sameAddress(working.email, decliner.email))) throw otherAddress();
  await ctx.db.transaction(async (tx) => {
    const declined = await repos.invitations.decline(tx, working.id);
    if (!declined) return;
    await repos.audit.append(tx, declined.businessId, { actorKind: "system", actorId: null, action: "invitation.declined", target: { kind: "invitation", id: declined.id }, details: { role: declined.role } });
    await emit(tx, { businessId: declined.businessId, userId: "" }, { type: "invitation.declined", payload: { invitationId: declined.id, role: declined.role }, actor: { kind: "system", id: "invitation" } });
  });
  return { ok: true };
}
