/**
 * 0173 — a Customer Update shared as a card (WP-14 T9; docs/DESIGN.md §9f). One row per shared Customer Update, a copy
 * of exactly what the public card shows, written by the api's service connection at the founder's press and deleted
 * when they stop sharing. Members read it; no client role writes it. The view is the signed-out read, the service
 * connection's only.
 */
import { UPDATE_CARD_HEADLINES } from "@foundmill/shared/update-cards";
import { boolean, date, index, pgTable, pgView, text, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_common";
import { businessId } from "./_refs";
import { journeys } from "./journey";

export const customerUpdateCards = pgTable(
  "customer_update_cards",
  {
    id: id(),
    businessId: businessId(),
    journeyId: uuid("journey_id").notNull().unique().references(() => journeys.id, { onDelete: "cascade" }),
    headline: text("headline", { enum: UPDATE_CARD_HEADLINES }).notNull(),
    /** The day of the payment in the business's own zone: a date, never a time. */
    occurredOn: date("occurred_on", { mode: "string" }).notNull(),
    leadChannelKey: text("lead_channel_key"),
    standoutAgent: text("standout_agent"),
    /** The founder's own line; the only free text on a card. */
    note: text("note"),
    /** True only for a payment delivered with Foundmill's own platform webhook secret ("Sign in with Stripe"); the card then says "Verified by". */
    verified: boolean("verified").notNull().default(false),
    createdBy: uuid("created_by").notNull(),
    ...timestamps(),
  },
  (t) => [index("customer_update_cards_business_id_idx").on(t.businessId, t.createdAt)],
);
export type CustomerUpdateCard = typeof customerUpdateCards.$inferSelect;

export const publicCustomerUpdateCards = pgView("public_customer_update_cards", {
  id: uuid("id").notNull(),
  slug: text("slug").notNull(),
  headline: text("headline", { enum: UPDATE_CARD_HEADLINES }).notNull(),
  occurredOn: date("occurred_on", { mode: "string" }).notNull(),
  leadChannelKey: text("lead_channel_key"),
  standoutAgent: text("standout_agent"),
  note: text("note"),
  verified: boolean("verified").notNull(),
}).existing();
export type PublicCustomerUpdateCard = typeof publicCustomerUpdateCards.$inferSelect;

/** The columns `public_customer_update_cards` exposes, in order (the view's test compares the catalog with this list). */
export const PUBLIC_CUSTOMER_UPDATE_CARD_COLUMNS = ["id", "slug", "headline", "occurred_on", "lead_channel_key", "standout_agent", "note", "verified"] as const;
