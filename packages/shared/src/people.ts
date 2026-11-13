/**
 * The people of a project and the way in (docs/NETWORK.md F5; docs/THESIS_REVIEW.md packages 2.2, 3.1, 3.3): what an
 * invitation offers, in the words a person reads. Zod-free and free of node:crypto, so a browser bundle may import
 * it as `@foundmill/shared/people`.
 *
 * **Two roles an invitation offers** (CLAUDE.md "the words for people"): a cofounder (equal standing, any number) and a
 * collaborator (someone trying out or helping, with limited access). Until the membership roles `cofounder` and
 * `collaborator` exist (package 3.3, a change of its own: every guard function and policy that checks a role has to learn
 * them), an accepted invitation is a membership in the roles that exist today, through `invitationMembership`: a
 * cofounder joins as an owner, which is the equal standing the founders have now; a collaborator joins as a member whose
 * section permissions hold them to Product and Customers. When 3.3 lands, this one function changes and nothing else.
 */
import type { MembershipRole } from "./constants";

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

/**
 * A collaborator's section permissions (BUILD §11.9 walls, packages/shared permissions.ts): read and write on Product
 * (with Development, the Product area's other half) and Customers (Distribution and the contacts), read on the Plan (the
 * roadmap is Product's; the Inbox, where the plan's notes arrive, is read only) and the Team, and nothing of Money
 * (Finance, Legal, Billing), Settings or the network.
 */
export const COLLABORATOR_SECTIONS = Object.freeze({
  product: "write",
  development: "write",
  distribution: "write",
  crm: "write",
  inbox: "read",
  team: "read",
  finance: "none",
  legal: "none",
  billing: "none",
  settings: "none",
  live: "none",
} as const);

/** The membership an accepted invitation becomes, in the roles that exist today (see the file comment). */
export function invitationMembership(role: InvitationRole): { role: MembershipRole; sectionPermissions: Record<string, "read" | "write" | "none"> } {
  return role === "cofounder" ? { role: "owner", sectionPermissions: {} } : { role: "member", sectionPermissions: { ...COLLABORATOR_SECTIONS } };
}

/** The membership roles that may invite someone in `role`: a cofounder only by an owner (it grants ownership), a collaborator by an owner or an admin. */
export function rolesThatMayInvite(role: InvitationRole): readonly MembershipRole[] {
  return role === "cofounder" ? ["owner"] : ["owner", "admin"];
}

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
