/**
 * 0067 — one AI-generated portrait per persona catalog key (`PERSONAS` in @foundmill/shared): a platform asset, not
 * business data (no business_id). RLS on, no policies, no app-role grants: only the service role reads or writes it
 * (repos.personaPortraits; the api serves the bytes on GET /personas/:style/:key).
 * 0069 — one portrait per (style, key): the four character styles (`AGENT_STYLES`) each draw the same key as their own
 * character (`characterFor(key, style)`), so the natural key is `(style, persona_key)`; rows from before 0069 are `humans`.
 */
import { AGENT_STYLES } from "@foundmill/shared";
import { pgTable, text, unique } from "drizzle-orm/pg-core";
import { bytea, id, timestamps } from "./_common";

export const PERSONA_PORTRAIT_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;
export type PersonaPortraitMime = (typeof PERSONA_PORTRAIT_MIMES)[number];

export const personaPortraits = pgTable(
  "persona_portraits",
  {
    id: id(),
    personaKey: text("persona_key").notNull(),
    /** The character style the portrait is drawn in (0069); the same key has one row per style. */
    style: text("style", { enum: AGENT_STYLES }).notNull().default("humans"),
    mime: text("mime", { enum: PERSONA_PORTRAIT_MIMES }).notNull(),
    content: bytea("content").notNull(),
    /** The image model that made it (the routing id the gateway used), for provenance. */
    model: text("model").notNull(),
    ...timestamps(),
  },
  (t) => [unique("persona_portraits_style_persona_key_key").on(t.style, t.personaKey)],
);
export type PersonaPortrait = typeof personaPortraits.$inferSelect;
export type NewPersonaPortrait = typeof personaPortraits.$inferInsert;
