/**
 * What a shared team post led to (0106; item 8, approved by the network session Nov 13, 2026; packages/shared
 * `post-outcomes.ts`). Service connection only: members read both tables through RLS, nobody in a project writes them.
 *
 * - `postLinks.mint`: the post's public codes, one per network and one for a copied or sent link (network null), in the
 *   transaction that stores the draft (`teamPosts.write`). Never for a sample business (the caller checks).
 * - `postLinks.visit`: the first time a browser that is not a member's opened a link, its `first_visited_at`; later
 *   visits change nothing. A post's visits are not counted per post (page counts: `page-visits.ts`, 0175).
 * - `postLinks.followable`: the link a follow may keep: the project's own, not simulated, visited.
 * - `postAttributions.creditFollow` / `creditReply` / `creditPayment`: one real outcome credited to one post, in the
 *   transaction that records the outcome. Last touch (the follow keeps the link the visitor last arrived with); at most
 *   one post per outcome (`outcome_event_id` unique); one reply and one payment per attributed follower (`origin_id`).
 *   A reply or a payment through a follower counts within 30 days of the follow.
 * - `postAttributions.countsByAsset` and `weekSummary`: what the Creative tab and the social channel's learning read.
 *
 * Nothing here joins two businesses: every read and every write names the business, and the table triggers refuse a row
 * that points to another business's. The replier's or payer's contact id is read inside the business's transaction and
 * never stored.
 */
import { POST_NETWORKS, type PostNetwork } from "@foundmill/shared/post-draft";
import {
  NO_POST_OUTCOMES,
  POST_OUTCOME_WINDOW_MS,
  postWeekSummary,
  type PostOutcomeCounts,
  type PostOutcomeKind,
} from "@foundmill/shared/post-outcomes";
import { parseTeamPostRef, type TeamPostCodes } from "@foundmill/shared/team-posts";
import { POST_CODE_ALPHABET, POST_CODE_LENGTH, isPostCode } from "@foundmill/shared/via";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import {
  assets,
  contactConsents,
  postAttributions,
  postLinks,
  type PostAttribution,
  type PostLink,
} from "../schema";
import { maybeOne, type Executor } from "./_shared";

/** Ten random characters from `a-z2-7` (32 symbols: one byte's low five bits each, so every symbol is equally likely). */
export function newPostCode(): string {
  const bytes = randomBytes(POST_CODE_LENGTH);
  let out = "";
  for (const b of bytes) out += POST_CODE_ALPHABET.charAt(b & 31);
  return out;
}

/** Every network and the general link (null), in that order. */
const LINK_NETWORKS: readonly (PostNetwork | null)[] = [...POST_NETWORKS, null];

export interface PostLinkView {
  id: string;
  businessId: string;
  assetId: string;
  network: PostNetwork | null;
  simulated: boolean;
  firstVisitedAt: Date | null;
}

const view = (r: PostLink): PostLinkView => ({
  id: r.id,
  businessId: r.businessId,
  assetId: r.assetId,
  network: (r.network ?? null) as PostNetwork | null,
  simulated: r.simulated,
  firstVisitedAt: r.firstVisitedAt ?? null,
});

export const postLinksRepo = {
  /**
   * The post's codes, minted once: one link per network and one with no network. A post that already has its links keeps
   * them (the unique pair). A clash of codes (one in 10^15) is tried again with a new code.
   */
  async mint(
    db: Executor,
    businessId: string,
    assetId: string,
    options: { simulated?: boolean } = {},
  ): Promise<PostLink[]> {
    const out: PostLink[] = [];
    for (const network of LINK_NETWORKS) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const rows = await db
          .insert(postLinks)
          .values({
            businessId,
            assetId,
            network,
            code: newPostCode(),
            simulated: options.simulated === true,
          })
          .onConflictDoNothing()
          .returning();
        if (rows[0]) {
          out.push(rows[0]);
          break;
        }
        // The post already has this network's link: keep it.
        const existing = maybeOne(
          await db
            .select()
            .from(postLinks)
            .where(
              and(
                eq(postLinks.businessId, businessId),
                eq(postLinks.assetId, assetId),
                network === null ? isNull(postLinks.network) : eq(postLinks.network, network),
              ),
            )
            .limit(1),
        );
        if (existing) {
          out.push(existing);
          break;
        }
      }
    }
    return out;
  },

  /** The codes of each of `assetIds` (the business's own), for the share panel. A post with no links is absent. */
  async codesFor(
    db: Executor,
    businessId: string,
    assetIds: readonly string[],
  ): Promise<Map<string, TeamPostCodes>> {
    const out = new Map<string, TeamPostCodes>();
    if (!assetIds.length) return out;
    const rows = await db
      .select({ assetId: postLinks.assetId, network: postLinks.network, code: postLinks.code })
      .from(postLinks)
      .where(and(eq(postLinks.businessId, businessId), inArray(postLinks.assetId, [...assetIds])));
    for (const r of rows) {
      const codes = out.get(r.assetId) ?? { link: null, networks: {} };
      if (r.network) codes.networks[r.network as PostNetwork] = r.code;
      else codes.link = r.code;
      out.set(r.assetId, codes);
    }
    return out;
  },

  /** The link a code names, of any business, or null (not a code, unknown). The caller checks what it may do with it. */
  async byCode(db: Executor, code: string): Promise<PostLinkView | null> {
    if (!isPostCode(code)) return null;
    const row = maybeOne(
      await db.select().from(postLinks).where(eq(postLinks.code, code)).limit(1),
    );
    return row ? view(row) : null;
  },

  /**
   * A browser opened the link: stamps `first_visited_at` the first time and returns the link then; null for a later
   * visit, a simulated link and an unknown code. The caller has already left a member's own visit out.
   */
  async visit(db: Executor, code: string, at: Date = new Date()): Promise<PostLinkView | null> {
    if (!isPostCode(code)) return null;
    const row = maybeOne(
      await db
        .update(postLinks)
        .set({ firstVisitedAt: at, updatedAt: at })
        .where(
          and(
            eq(postLinks.code, code),
            eq(postLinks.simulated, false),
            isNull(postLinks.firstVisitedAt),
          ),
        )
        .returning(),
    );
    return row ? view(row) : null;
  },

  /** The link a follow of `businessId` may keep: the business's own, not simulated, already visited. Else null. */
  async followable(
    db: Executor,
    businessId: string,
    code: string | null | undefined,
  ): Promise<string | null> {
    if (!isPostCode(code)) return null;
    const row = maybeOne(
      await db
        .select({ id: postLinks.id })
        .from(postLinks)
        .where(
          and(
            eq(postLinks.code, code),
            eq(postLinks.businessId, businessId),
            eq(postLinks.simulated, false),
            isNotNull(postLinks.firstVisitedAt),
          ),
        )
        .limit(1),
    );
    return row?.id ?? null;
  },
};

/** One credit written, with what its event says. */
export type PostCredit = Pick<
  PostAttribution,
  "id" | "linkId" | "assetId" | "network" | "outcomeKind" | "outcomeEventId"
>;

const credited = (r: PostAttribution): PostCredit => ({
  id: r.id,
  linkId: r.linkId,
  assetId: r.assetId,
  network: r.network,
  outcomeKind: r.outcomeKind,
  outcomeEventId: r.outcomeEventId,
});

async function insertCredit(
  db: Executor,
  values: {
    businessId: string;
    link: { id: string; assetId: string; network: string | null };
    outcomeKind: PostOutcomeKind;
    outcomeEventId: string;
    originId: string;
    at: Date;
  },
): Promise<PostCredit | null> {
  const rows = await db
    .insert(postAttributions)
    .values({
      businessId: values.businessId,
      linkId: values.link.id,
      assetId: values.link.assetId,
      network: values.link.network as PostNetwork | null,
      outcomeKind: values.outcomeKind,
      outcomeEventId: values.outcomeEventId,
      originId: values.originId,
      outcomeAt: values.at,
    })
    .onConflictDoNothing()
    .returning();
  return rows[0] ? credited(rows[0]) : null;
}

/** The follow credited for one of `entityId`'s consents in the business, within the window before `at`, or null. */
async function followOf(
  db: Executor,
  businessId: string,
  entityId: string,
  at: Date,
): Promise<PostAttribution | null> {
  return (
    maybeOne(
      await db
        .select({ a: postAttributions })
        .from(postAttributions)
        .innerJoin(
          contactConsents,
          and(
            eq(contactConsents.id, postAttributions.originId),
            eq(contactConsents.businessId, businessId),
          ),
        )
        .where(
          and(
            eq(postAttributions.businessId, businessId),
            eq(postAttributions.outcomeKind, "follow"),
            eq(contactConsents.entityId, entityId),
            gte(postAttributions.outcomeAt, new Date(at.getTime() - POST_OUTCOME_WINDOW_MS)),
            lte(postAttributions.outcomeAt, at),
          ),
        )
        .orderBy(desc(postAttributions.outcomeAt))
        .limit(1),
    )?.a ?? null
  );
}

export interface WeekSummaryInput {
  /** The start of the week (inclusive) and its end (exclusive). */
  since: Date;
  until: Date;
  /** The week's number as the channel's learnings name it (`w3`); null for "last 7 days". */
  week: number | null;
}

export const postAttributionsRepo = {
  /**
   * The person confirmed that they follow the project (`page.followed`, in the confirmation's transaction): the follow
   * is credited to the post link the signup kept, when that link is still the business's own, not simulated and
   * visited. Null when there is nothing to credit or the outcome was credited already.
   */
  async creditFollow(
    db: Executor,
    input: { businessId: string; consentId: string; outcomeEventId: string; at: Date },
  ): Promise<PostCredit | null> {
    const link = maybeOne(
      await db
        .select({ id: postLinks.id, assetId: postLinks.assetId, network: postLinks.network })
        .from(contactConsents)
        .innerJoin(
          postLinks,
          and(
            eq(postLinks.id, contactConsents.postLinkId),
            eq(postLinks.businessId, input.businessId),
          ),
        )
        .where(
          and(
            eq(contactConsents.businessId, input.businessId),
            eq(contactConsents.id, input.consentId),
            isNotNull(contactConsents.confirmedAt),
            eq(postLinks.simulated, false),
            isNotNull(postLinks.firstVisitedAt),
          ),
        )
        .limit(1),
    );
    if (!link) return null;
    return insertCredit(db, {
      businessId: input.businessId,
      link,
      outcomeKind: "follow",
      outcomeEventId: input.outcomeEventId,
      originId: input.consentId,
      at: input.at,
    });
  },

  /**
   * A real reply (the caller checked: a vendor's delivery, positive or neutral, not simulated) from `entityId`: credited
   * to the post an attributed follow of theirs came through, within 30 days of following. One reply per follower.
   */
  async creditReply(
    db: Executor,
    input: { businessId: string; entityId: string; outcomeEventId: string; at: Date },
  ): Promise<PostCredit | null> {
    const follow = await followOf(db, input.businessId, input.entityId, input.at);
    if (!follow) return null;
    return insertCredit(db, {
      businessId: input.businessId,
      link: { id: follow.linkId, assetId: follow.assetId, network: follow.network },
      outcomeKind: "reply",
      outcomeEventId: input.outcomeEventId,
      originId: follow.id,
      at: input.at,
    });
  },

  /**
   * A real payment (the caller checked: a vendor's delivery, not simulated). With the post's code (`postCode`, the pay
   * button's reference, once the payment link ships): credited to that link when it is the business's own and not
   * simulated. Without one: credited through an attributed follow of the payer within 30 days. One payment per follower.
   */
  async creditPayment(
    db: Executor,
    input: {
      businessId: string;
      entityId: string | null;
      outcomeEventId: string;
      at: Date;
      postCode?: string | null;
    },
  ): Promise<PostCredit | null> {
    if (isPostCode(input.postCode)) {
      const link = maybeOne(
        await db
          .select({ id: postLinks.id, assetId: postLinks.assetId, network: postLinks.network })
          .from(postLinks)
          .where(
            and(
              eq(postLinks.code, input.postCode),
              eq(postLinks.businessId, input.businessId),
              eq(postLinks.simulated, false),
            ),
          )
          .limit(1),
      );
      if (link)
        return insertCredit(db, {
          businessId: input.businessId,
          link,
          outcomeKind: "payment",
          outcomeEventId: input.outcomeEventId,
          originId: input.outcomeEventId,
          at: input.at,
        });
    }
    if (!input.entityId) return null;
    const follow = await followOf(db, input.businessId, input.entityId, input.at);
    if (!follow) return null;
    return insertCredit(db, {
      businessId: input.businessId,
      link: { id: follow.linkId, assetId: follow.assetId, network: follow.network },
      outcomeKind: "payment",
      outcomeEventId: input.outcomeEventId,
      originId: follow.id,
      at: input.at,
    });
  },

  /**
   * What the morning brief's "What worked" reads (`loadBriefFacts`, then `RealOutcome.viaPost`): for each of `outcomeEventIds` credited to a post,
   * the network and the day the founder opened its share (else the day it was drafted), for `viaPostWords`. Ids in,
   * nothing about the person out.
   */
  async viaPostFor(db: Executor, businessId: string, outcomeEventIds: readonly string[]): Promise<Map<string, { network: PostNetwork | null; sharedAt: Date }>> {
    const out = new Map<string, { network: PostNetwork | null; sharedAt: Date }>();
    if (!outcomeEventIds.length) return out;
    const rows = await db
      .select({ eventId: postAttributions.outcomeEventId, network: postAttributions.network, state: assets.approvalState, createdAt: assets.createdAt, updatedAt: assets.updatedAt })
      .from(postAttributions)
      .innerJoin(assets, and(eq(assets.id, postAttributions.assetId), eq(assets.businessId, businessId)))
      .where(and(eq(postAttributions.businessId, businessId), inArray(postAttributions.outcomeEventId, [...outcomeEventIds])));
    for (const r of rows) out.set(r.eventId, { network: (r.network ?? null) as PostNetwork | null, sharedAt: r.state === "approved" ? r.updatedAt : r.createdAt });
    return out;
  },

  /** What each of `assetIds` led to, all time. A post with no outcome is absent. */
  async countsByAsset(
    db: Executor,
    businessId: string,
    assetIds: readonly string[],
  ): Promise<Map<string, PostOutcomeCounts>> {
    const out = new Map<string, PostOutcomeCounts>();
    if (!assetIds.length) return out;
    const rows = await db
      .select({
        assetId: postAttributions.assetId,
        kind: postAttributions.outcomeKind,
        n: sql<number>`count(*)::int`,
      })
      .from(postAttributions)
      .where(
        and(
          eq(postAttributions.businessId, businessId),
          inArray(postAttributions.assetId, [...assetIds]),
        ),
      )
      .groupBy(postAttributions.assetId, postAttributions.outcomeKind);
    for (const r of rows)
      out.set(r.assetId, { ...(out.get(r.assetId) ?? NO_POST_OUTCOMES), [r.kind]: Number(r.n) });
    return out;
  },

  /**
   * The social channel's learning for one week: at most three lines, one per post and place that led to something,
   * most outcomes first (`w3: post "…" (X): 2 follows, 1 reply (Counted, real people)`). A quiet week gives none.
   */
  async weekSummary(db: Executor, businessId: string, input: WeekSummaryInput): Promise<string[]> {
    // The post is named by its code-written subject (`content_ref`), never by its words: these lines reach agents.
    const rows = await db
      .select({ assetId: postAttributions.assetId, network: postAttributions.network, kind: postAttributions.outcomeKind, n: sql<number>`count(*)::int`, contentRef: assets.contentRef })
      .from(postAttributions)
      .innerJoin(assets, and(eq(assets.id, postAttributions.assetId), eq(assets.businessId, businessId)))
      .where(and(eq(postAttributions.businessId, businessId), gte(postAttributions.outcomeAt, input.since), sql`${postAttributions.outcomeAt} < ${input.until}`))
      .groupBy(postAttributions.assetId, postAttributions.network, postAttributions.outcomeKind, assets.contentRef);
    return postWeekSummary(
      rows.map((r) => ({ assetId: r.assetId, subject: parseTeamPostRef(r.contentRef)?.subject ?? null, network: (r.network ?? null) as PostNetwork | null, kind: r.kind, n: Number(r.n) })),
      input.week,
    );
  },
};
