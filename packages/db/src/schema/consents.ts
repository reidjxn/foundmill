/**
 * 0079 — what a contact agreed to: one row per contact, purpose and source (a follower of the public page, package 1.6).
 * Double opt-in: pending until `confirmedAt`.
 */
import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, timestamps, tstz } from "./_common";
import { businessId } from "./_refs";
import { entities } from "./crm";
import { projectPages } from "./pages";
import { postLinks } from "./post-links";

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
    /** When they ticked the box on the page. */
    agreedAt: tstz("agreed_at").notNull().defaultNow(),
    /** When they confirmed from the email (double opt-in); null while pending. Only a confirmed record is consent. */
    confirmedAt: tstz("confirmed_at"),
    /** When the confirmation email was last asked for (at most once per 30 days). */
    confirmationSentAt: tstz("confirmation_sent_at"),
    /** sha256 hex of the nonce the latest confirmation link carries; cleared once confirmed. */
    confirmationTokenHash: text("confirmation_token_hash"),
    /** Set when the person unsubscribes from the project's mail (or it bounced, or they reported it). */
    withdrawnAt: tstz("withdrawn_at"),
    /**
     * 0134: sha256 hex of the address that agreed (and then confirmed), trimmed and lowercased (`suppressionHash`). A
     * follower update goes only to a contact whose address still has this hash, so editing a contact's address never
     * moves the consent to someone else.
     */
    emailHash: text("email_hash"),
    /**
     * 0106: the post link the visitor last arrived through before signing up (the project's own, not simulated, visited);
     * the follow is credited to that post once confirmed. Written by the services only.
     */
    postLinkId: uuid("post_link_id").references(() => postLinks.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("contact_consents_once_key").on(t.businessId, t.entityId, t.purpose, t.source),
    index("contact_consents_entity_id_idx").on(t.entityId),
    index("contact_consents_page_id_idx").on(t.pageId),
    index("contact_consents_post_link_id_idx").on(t.postLinkId),
  ],
);
export type ContactConsent = typeof contactConsents.$inferSelect;
export type NewContactConsent = typeof contactConsents.$inferInsert;
