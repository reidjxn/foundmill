/** 0017 — the business's logo (one row per business; written by the api with the service role after its checks). */
import { char, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { bytea, id, timestamps } from "./_common";
import { businessId } from "./_refs";

export const BUSINESS_LOGO_SOURCES = ["upload", "generated"] as const;
export const BUSINESS_LOGO_MIMES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const;

export const businessLogos = pgTable(
  "business_logos",
  {
    id: id(),
    businessId: businessId(),
    source: text("source", { enum: BUSINESS_LOGO_SOURCES }).notNull(),
    mime: text("mime", { enum: BUSINESS_LOGO_MIMES }).notNull(),
    /** Image bytes as checked by `checkLogo` (@foundmill/shared/logo): a raster, or a sanitised SVG document. */
    content: bytea("content").notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("business_logos_business_idx").on(t.businessId)],
);
export type BusinessLogo = typeof businessLogos.$inferSelect;
export type NewBusinessLogo = typeof businessLogos.$inferInsert;
