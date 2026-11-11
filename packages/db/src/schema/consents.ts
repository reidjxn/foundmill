/** 0079 — what a contact agreed to: one row per contact, purpose and source (a follower of the public page, package 1.6). */
import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, timestamps, tstz } from "./_common";
import { businessId } from "./_refs";
import { entities } from "./crm";
import { projectPages } from "./pages";

export const CONSENT_PURPOSES = ["email"] as const;
export const CONSENT_SOURCES = ["page"] as const;

/**
 * A contact's recorded consent: when they agreed, the exact sentence they agreed to and where (the page's address at the
 * time and the page row). Members read; only the services write (the api's public follow, on the service connection),
 * so nobody in the project can rewrite what a person agreed to. Goes with the contact when it is purged.
 */
export const contactConsents = pgTable(
  "contact_consents",
  {
    id: id(),
    businessId: businessId(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    purpose: text("purpose", { enum: CONSENT_PURPOSES }).notNull(),
    source: text("source", { enum: CONSENT_SOURCES }).notNull(),
    /** The page's address when they agreed (`/p/<sourceRef>`). */
    sourceRef: text("source_ref").notNull(),
    pageId: uuid("page_id").references(() => projectPages.id, { onDelete: "set null" }),
    /** The sentence beside the box they ticked, word for word. */
    consentText: text("consent_text").notNull(),
    agreedAt: tstz("agreed_at").notNull().defaultNow(),
    withdrawnAt: tstz("withdrawn_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("contact_consents_once_key").on(t.businessId, t.entityId, t.purpose, t.source),
    index("contact_consents_entity_id_idx").on(t.entityId),
    index("contact_consents_page_id_idx").on(t.pageId),
  ],
);
export type ContactConsent = typeof contactConsents.$inferSelect;
export type NewContactConsent = typeof contactConsents.$inferInsert;
