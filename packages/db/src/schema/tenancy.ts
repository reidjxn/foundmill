/** 0001 — memberships (tenancy), 0065 — `source`. Helper functions is_member/has_role/is_public live in SQL only. */
import { MEMBERSHIP_ROLES } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { emptyObject, id, timestamps } from "./_common";
import { businessId } from "./_refs";

/**
 * How a membership came to be (0065): `invite` (team.humans.invite, the seeds' owners, every row before 0065),
 * `founder` (the owner seat Commit writes), `example` (business.example.open: a read-only walk around a seeded demo
 * business, always a viewer, never a seat, never staff).
 */
export const MEMBERSHIP_SOURCES = ["invite", "founder", "example"] as const;
export type MembershipSource = (typeof MEMBERSHIP_SOURCES)[number];

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    businessId: businessId(),
    userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    role: text("role", { enum: MEMBERSHIP_ROLES }).notNull(),
    sectionPermissions: jsonb("section_permissions").$type<Record<string, "read" | "write" | "none">>().notNull().default(emptyObject),
    source: text("source", { enum: MEMBERSHIP_SOURCES }).notNull().default("invite"),
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
