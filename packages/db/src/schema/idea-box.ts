/**
 * 0086 — the landing page's idea box (founder, 2026-11-13; docs/IDEA_BOX.md). A signed-out visitor's one card, held by
 * the hash of a token in their browser's cookie (and a second, the claim token, in their sign-in email), until they
 * sign in and claim it into their deck; and the waitlist that keeps it for someone not yet admitted. The api's alone:
 * RLS on, no policy, no client grant.
 */
import { bigint, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { sql } from "drizzle-orm";
import { id, timestamps, tstz } from "./_common";
import { ideas } from "./accounts";

/** Which model client drafted the card (a mock card is sample prose and says so). */
export const IDEA_DRAFT_MODEL_MODES = ["live", "mock"] as const;

export const ideaDrafts = pgTable(
  "idea_drafts",
  {
    id: id(),
    /** SHA-256 (lowercase hex) of the browser's token. */
    tokenHash: text("token_hash").notNull().unique("idea_drafts_token_hash_key"),
    /** SHA-256 of the claim token in the sign-in email; null once used. */
    claimHash: text("claim_hash").unique("idea_drafts_claim_hash_key"),
    prompt: text("prompt").notNull().default(""),
    interest: text("interest"),
    /** The validated ConceptCard. */
    card: jsonb("card").notNull(),
    modelMode: text("model_mode", { enum: IDEA_DRAFT_MODEL_MODES }).notNull(),
    costMicro: bigint("cost_micro", { mode: "number" }).notNull().default(0),
    expiresAt: tstz("expires_at").notNull(),
    heldUntil: tstz("held_until"),
    claimedBy: uuid("claimed_by").references(() => authUsers.id, { onDelete: "set null" }),
    claimedAt: tstz("claimed_at"),
    ideaId: uuid("idea_id").references(() => ideas.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    index("idea_drafts_sweep_idx")
      .on(t.expiresAt)
      .where(sql`${t.claimedAt} is null`),
    index("idea_drafts_claimed_by_idx").on(t.claimedBy),
    index("idea_drafts_idea_id_idx").on(t.ideaId),
  ],
);
export type IdeaDraftRow = typeof ideaDrafts.$inferSelect;

export const waitlistEntries = pgTable(
  "waitlist_entries",
  {
    id: id(),
    /** Null for a person with no account yet (added later by the network work). */
    userId: uuid("user_id")
      .unique("waitlist_entries_user_id_key")
      .references(() => authUsers.id, { onDelete: "cascade" }),
    /** Lower case; one row per address. */
    email: text("email").notNull().unique("waitlist_entries_email_key"),
    ideaDraftId: uuid("idea_draft_id").references(() => ideaDrafts.id, { onDelete: "set null" }),
    admittedAt: tstz("admitted_at"),
    ...timestamps(),
  },
  (t) => [index("waitlist_entries_idea_draft_id_idx").on(t.ideaDraftId)],
);
export type WaitlistEntryRow = typeof waitlistEntries.$inferSelect;
