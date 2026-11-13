/**
 * 0089 — the way in (docs/NETWORK.md F5, §11; docs/THESIS_REVIEW.md packages 2.2 and 3.1). The SQL is the source of
 * truth and holds the rules (migrations/0089_invitations.sql); these mirror it.
 *
 *   - `invitations`: business-scoped, a link to join a project as a cofounder or a collaborator. Members read every
 *     column but `tokenHash` and `email`; an owner or an admin creates and revokes (an owner alone for a cofounder).
 *   - `accountAdmissions`: account-scoped, one row per account the api admitted other than through SIGNUP_ALLOWLIST.
 *     Service role only.
 */
import { INVITATION_ROLES, INVITATION_STATES } from "@foundmill/shared";
import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { id, timestamps, tstz } from "./_common";
import { businessId } from "./_refs";

/** How an account was admitted when the invite list did not name it (services/access.ts `decideAdmission`). */
export const ADMISSION_KINDS = ["invitation", "open", "existing"] as const;
export type AdmissionKind = (typeof ADMISSION_KINDS)[number];

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    businessId: businessId(),
    /** SHA-256 of the link's token, lowercase hex. No client role reads it. */
    tokenHash: text("token_hash").notNull().unique("invitations_token_hash_key"),
    role: text("role", { enum: INVITATION_ROLES }).notNull(),
    invitedByUserId: uuid("invited_by_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    /** The address the link was emailed to, when the inviter typed one. No client role reads it. */
    email: text("email"),
    state: text("state", { enum: INVITATION_STATES }).notNull().default("pending"),
    expiresAt: tstz("expires_at").notNull(),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    acceptedAt: tstz("accepted_at"),
    declinedAt: tstz("declined_at"),
    revokedAt: tstz("revoked_at"),
    revokedByUserId: uuid("revoked_by_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    index("invitations_business_id_idx").on(t.businessId, t.createdAt.desc()),
    index("invitations_invited_by_user_id_idx").on(t.invitedByUserId),
    index("invitations_accepted_by_user_id_idx").on(t.acceptedByUserId),
    index("invitations_revoked_by_user_id_idx").on(t.revokedByUserId),
  ],
);
export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;

export const accountAdmissions = pgTable(
  "account_admissions",
  {
    id: id(),
    userId: uuid("user_id").notNull().unique("account_admissions_user_id_key").references(() => authUsers.id, { onDelete: "cascade" }),
    how: text("how", { enum: ADMISSION_KINDS }).notNull(),
    invitationId: uuid("invitation_id").references(() => invitations.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [index("account_admissions_invitation_id_idx").on(t.invitationId), index("account_admissions_how_created_at_idx").on(t.how, t.createdAt)],
);
export type AccountAdmission = typeof accountAdmissions.$inferSelect;
