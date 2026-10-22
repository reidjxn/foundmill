/**
 * 0067 — one AI-generated portrait per persona catalog key (`PERSONAS` in @foundmill/shared): a platform asset, not
 * business data (no business_id). RLS on, no policies, no app-role grants: only the service role reads or writes it
 * (repos.personaPortraits; the api serves the bytes on GET /personas/:key).
 */
import { pgTable, text } from "drizzle-orm/pg-core";
import { bytea, id, timestamps } from "./_common";

export const PERSONA_PORTRAIT_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;
export type PersonaPortraitMime = (typeof PERSONA_PORTRAIT_MIMES)[number];

export const personaPortraits = pgTable("persona_portraits", {
  id: id(),
  personaKey: text("persona_key").notNull().unique(),
  mime: text("mime", { enum: PERSONA_PORTRAIT_MIMES }).notNull(),
  content: bytea("content").notNull(),
  /** The image model that made it (the routing id the gateway used), for provenance. */
  model: text("model").notNull(),
  ...timestamps(),
});
export type PersonaPortrait = typeof personaPortraits.$inferSelect;
export type NewPersonaPortrait = typeof personaPortraits.$inferInsert;
