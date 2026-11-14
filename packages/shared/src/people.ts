/**
 * The people of a project and the way in (docs/NETWORK.md F5; docs/THESIS_REVIEW.md packages 3.1, 3.3): what an
 * invitation offers, in the words a person reads. Zod-free and free of node:crypto, so a browser bundle may import it
 * as `@foundmill/shared/people`.
 *
 * **Two roles an invitation offers** (CLAUDE.md "the words for people"), and they are the membership roles of the same
 * names (`MEMBERSHIP_ROLES`): a cofounder (equal standing, any number: owner-equivalent wherever an owner is meant,
 * `isOwnerRole`) and a collaborator (someone trying out or helping, with limited access, `COLLABORATOR_SECTIONS`, and
 * an optional end date on the membership).
 */
import { ADMIN_ROLES, OWNER_ROLES, type MembershipRole } from "./constants";
import { COLLABORATOR_SECTIONS, effectivePermission, type SectionMembership } from "./permissions";

export { COLLABORATOR_SECTIONS };

export const INVITATION_ROLES = ["cofounder", "collaborator"] as const;
export type InvitationRole = (typeof INVITATION_ROLES)[number];

export const INVITATION_STATES = ["pending", "accepted", "declined", "revoked", "expired"] as const;
export type InvitationState = (typeof INVITATION_STATES)[number];

/** How long an invitation link works unless revoked first. */
export const INVITATION_TTL_DAYS = 14;
export const INVITATION_TTL_MS = INVITATION_TTL_DAYS * 86_400_000;

/** The role as a word in a sentence ("as a cofounder"). */
export const INVITATION_ROLE_WORD: Readonly<Record<InvitationRole, string>> = { cofounder: "Cofounder", collaborator: "Collaborator" };

/** One plain sentence per role: what the person can do once they accept. Shown where the role is chosen and on the invitation. */
export const INVITATION_ROLE_SENTENCE: Readonly<Record<InvitationRole, string>> = {
  cofounder: "Equal standing with you: they can see and change everything, including billing and settings.",
  collaborator: "Works with you on Product and Customers and can read the plan. Money and Settings stay with the founders.",
};

/** "a cofounder" / "a collaborator", for "Maya invited you to join Bread by Bike as a cofounder". */
export const invitationRolePhrase = (role: InvitationRole): string => `a ${INVITATION_ROLE_WORD[role].toLowerCase()}`;

/** The membership an accepted invitation becomes: the role of the same name, with the role's own section rules. */
export function invitationMembership(role: InvitationRole): { role: MembershipRole; sectionPermissions: Record<string, "read" | "write" | "none"> } {
  return { role, sectionPermissions: {} };
}

/**
 * The membership roles that may invite someone in `role`: a cofounder only by someone with an owner's standing (an
 * owner or a cofounder: equal standing is theirs to give), a collaborator also by an admin.
 */
export function rolesThatMayInvite(role: InvitationRole): readonly MembershipRole[] {
  return role === "cofounder" ? OWNER_ROLES : ADMIN_ROLES;
}

/**
 * Whether a membership may make (and keep alive) an invitation in `role`: one of `rolesThatMayInvite(role)`, holding
 * write on the Team section (`effectivePermission`), as Settings › People's own procedures require. The api checks it when
 * the invitation is made and again whenever it is read or accepted, so narrowing a person's Team access stops their links.
 */
export function mayMakeInvitation(membership: SectionMembership, role: InvitationRole): boolean {
  return rolesThatMayInvite(role).includes(membership.role) && effectivePermission(membership, "team") === "write";
}

/** Whether an invitation in `role` must name the address it is for: a cofounder's always (equal standing goes to one person). */
export const invitationNeedsEmail = (role: InvitationRole): boolean => role === "cofounder";

/**
 * An invitation that names an address, met by an account signed in with another one (or by nobody signed in, for
 * Decline): the api's `appCode` and the words the page shows. A dead link keeps `invitation_unavailable`.
 */
export const INVITATION_OTHER_ADDRESS_CODE = "invitation_other_address";
export const INVITATION_OTHER_ADDRESS_WORDS = "Sign in with the address this invitation was sent to.";

/** Invitation tokens: 32 random bytes as base64url (43 characters). Anything else is not looked up. */
export const isPeopleTokenShape = (token: unknown): token is string => typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);

/** The path of an invitation. */
export const invitationPath = (token: string): string => `/i/${token}`;

/** An address shown to the people who sent it an invitation, without the whole of it: "ma***@example.com". */
export function maskedAddress(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at <= 0) return "***";
  const local = e.slice(0, at);
  const shown = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  const out = `${shown}***@${e.slice(at + 1)}`;
  return out.length <= 120 ? out : `${out.slice(0, 119)}…`;
}
