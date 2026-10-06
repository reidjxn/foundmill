/** 0001 — memberships (tenancy). Helper functions is_member/has_role/is_public live in SQL only. */
import { MEMBERSHIP_ROLES } from "@founder-manager/shared";
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { emptyObject, id, timestamps } from "./_common";
import { businessId } from "./_refs";

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    businessId: businessId(),
    userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    role: text("role", { enum: MEMBERSHIP_ROLES }).notNull(),
    sectionPermissions: jsonb("section_permissions").$type<Record<string, "read" | "write" | "none">>().notNull().default(emptyObject),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("memberships_business_id_user_id_key").on(t.businessId, t.userId),
    index("memberships_user_id_idx").on(t.userId),
    index("memberships_business_id_idx").on(t.businessId),
  ],
);
export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;
