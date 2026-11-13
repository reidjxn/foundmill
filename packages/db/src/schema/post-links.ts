/**
 * 0102 — what a shared team post led to (item 8; packages/shared `post-outcomes.ts`). Members read; only the services
 * write. Nothing here names a person: no entity id, no address, no IP, no device, no amount.
 */
import { POST_NETWORKS } from "@foundmill/shared/post-draft";
import { POST_OUTCOME_KINDS } from "@foundmill/shared/post-outcomes";
import { boolean, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, timestamps, tstz } from "./_common";
import { businessId } from "./_refs";
import { assets } from "./distribution";

/**
 * One public code of a post the team drafted: one per network, and one (network null) for a copied link, a message and
 * the device's own share sheet. Minted in the transaction that stores the draft; never for a sample business. A link
 * minted for a publish through a mock connector is `simulated` and never resolves.
 */
export const postLinks = pgTable(
  "post_links",
  {
    id: id(),
    businessId: businessId(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    /** The network the link was made for; null for a copied or sent link. */
    network: text("network", { enum: POST_NETWORKS }),
    /** The public code (`s.<code>`): ten characters from `a-z2-7`. */
    code: text("code").notNull(),
    simulated: boolean("simulated").notNull().default(false),
    /** When a browser first opened the link (not a member of the project); later visits change nothing. */
    firstVisitedAt: tstz("first_visited_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("post_links_code_key").on(t.code),
    uniqueIndex("post_links_asset_network_key").on(t.assetId, t.network),
    index("post_links_business_id_idx").on(t.businessId),
  ],
);
export type PostLink = typeof postLinks.$inferSelect;
export type NewPostLink = typeof postLinks.$inferInsert;

/**
 * One real outcome credited to one post (last touch; at most one post per outcome). `originId` is what the outcome came
 * from: the consent record for a `follow`, the follow's own row for a `reply` or a `payment` through a follower, and the
 * payment's event for a payment that carried the post's code. One reply and one payment per follower at most.
 */
export const postAttributions = pgTable(
  "post_attributions",
  {
    id: id(),
    businessId: businessId(),
    linkId: uuid("link_id")
      .notNull()
      .references(() => postLinks.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").notNull(),
    network: text("network", { enum: POST_NETWORKS }),
    outcomeKind: text("outcome_kind", { enum: POST_OUTCOME_KINDS }).notNull(),
    outcomeEventId: uuid("outcome_event_id").notNull(),
    originId: uuid("origin_id").notNull(),
    outcomeAt: tstz("outcome_at").notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("post_attributions_outcome_event_key").on(t.outcomeEventId),
    uniqueIndex("post_attributions_origin_kind_key").on(t.originId, t.outcomeKind),
    index("post_attributions_business_id_idx").on(t.businessId, t.outcomeAt),
    index("post_attributions_link_id_idx").on(t.linkId),
    index("post_attributions_asset_id_idx").on(t.assetId),
  ],
);
export type PostAttribution = typeof postAttributions.$inferSelect;
export type NewPostAttribution = typeof postAttributions.$inferInsert;
