/**
 * 0131 — a project's payment links (WP-07 T7): a link the founder pasted from their own Stripe account, or one the
 * finance lead made (T8). Members read; an owner or an admin writes. apps/sites reaches a link only through
 * `site_pay_link(label, key)`, which never returns an archived or a simulated one.
 */
import { bigint, char, pgTable, text, unique, uuid, boolean } from "drizzle-orm/pg-core";
import { id, timestamps, tstz } from "./_common";
import { businessId } from "./_refs";

export const PAY_LINK_SOURCES = ["pasted", "stripe"] as const;
export type PayLinkSource = (typeof PAY_LINK_SOURCES)[number];

export const payLinks = pgTable(
  "pay_links",
  {
    id: id(),
    businessId: businessId(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    priceMinor: bigint("price_minor", { mode: "number" }),
    currency: char("currency", { length: 3 }),
    url: text("url").notNull(),
    source: text("source").$type<PayLinkSource>().notNull(),
    providerLinkId: text("provider_link_id"),
    simulated: boolean("simulated").notNull().default(false),
    createdBy: uuid("created_by"),
    archivedAt: tstz("archived_at"),
    ...timestamps(),
  },
  (t) => [unique("pay_links_key_unique").on(t.businessId, t.key)],
);
export type PayLink = typeof payLinks.$inferSelect;
export type NewPayLink = typeof payLinks.$inferInsert;
