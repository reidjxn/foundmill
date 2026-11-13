/** 0001 — memberships (tenancy), 0065 — `source`, 0092 — the cofounder and collaborator roles and `expires_at`. Helper functions is_member/has_role/is_public live in SQL only. */
import { MEMBERSHIP_ROLES, MEMBERSHIP_SOURCES, type MembershipSource } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { emptyObject, id, timestamps, tstz } from "./_common";
import { businessId } from "./_refs";

/** How a membership came to be (0065): the tuple lives in @foundmill/shared/constants next to MEMBERSHIP_ROLES. */
export { MEMBERSHIP_SOURCES, type MembershipSource };

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    businessId: businessId(),
    userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    role: text("role", { enum: MEMBERSHIP_ROLES }).notNull(),
    sectionPermissions: jsonb("section_permissions").$type<Record<string, "read" | "write" | "none">>().notNull().default(emptyObject),
    source: text("source", { enum: MEMBERSHIP_SOURCES }).notNull().default("invite"),
    /** 0092: when a collaborator's access ends (null: no end); only a collaborator's row carries one. */
    expiresAt: tstz("expires_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("memberships_business_id_user_id_key").on(t.businessId, t.userId),
    index("memberships_user_id_idx").on(t.userId),
    index("memberships_business_id_idx").on(t.businessId),
    index("memberships_example_idx").on(t.businessId).where(sql`${t.source} = 'example'`),
  ],
);
export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;
