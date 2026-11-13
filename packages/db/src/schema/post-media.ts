/**
 * 0103 — a post draft's media (packages/shared `post-media.ts`): a short video made on the founder's own Runway account
 * and a voiceover made on their own ElevenLabs account, for a post the social agent drafted. One row per draft and
 * kind. `content` is the file itself, copied into the project's own storage once it is made (Runway's address expires
 * within a day or two, and a voiceover arrives inline), so it stays reachable for tap-to-post and for a publishing
 * connector later. A simulated row never has content.
 */
import { boolean, char, index, integer, pgTable, real, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { bytea, id, timestamps } from "./_common";
import { businessId } from "./_refs";
import { assets } from "./distribution";

export const postMedia = pgTable(
  "post_media",
  {
    id: id(),
    businessId: businessId(),
    /** The draft (an `assets` row, kind `post`) the media belongs to. Deleted with it. */
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    /** `video` or `voiceover` (`POST_MEDIA_KINDS`). */
    kind: text("kind").notNull(),
    /** Where it stands (`POST_MEDIA_STATES`). */
    state: text("state").notNull(),
    /** The founder's own connector that makes it: `runway` or `elevenlabs_voice`. */
    connectorKey: text("connector_key").notNull(),
    /** The approval the gateway asked for (Needs you), while it is open or once answered. */
    approvalId: uuid("approval_id"),
    /** Runway's task id while the clip is being made. */
    vendorRef: text("vendor_ref"),
    simulated: boolean("simulated").notNull().default(false),
    mime: text("mime"),
    sha256: char("sha256", { length: 64 }),
    sizeBytes: integer("size_bytes"),
    durationSeconds: real("duration_seconds"),
    content: bytea("content"),
    /** Why it failed, as a code (never vendor text). */
    errorCode: text("error_code"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("post_media_asset_kind_idx").on(t.assetId, t.kind),
    index("post_media_business_id_idx").on(t.businessId, t.createdAt),
  ],
);
export type PostMedia = typeof postMedia.$inferSelect;
export type NewPostMedia = typeof postMedia.$inferInsert;
