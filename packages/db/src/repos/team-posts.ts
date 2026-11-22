/**
 * Posts the team writes for the founder to share by tap (docs/NETWORK.md F3, F7; packages/shared `team-posts.ts`;
 * packages/agents `post-draft.ts`). A team post is an `assets` row: kind `post`, no campaign, `content_ref` =
 * `post-draft:<trigger>:<subject>:<id>` and the words in `body`. No table and no column of its own.
 *
 * - `sources`: everything a draft is decided and written from, read in one place so the model can be handed only what
 *   is public: the business's name and time zone, the four public fields of its published page, where the social
 *   channel and its agent stand, and what was already drafted. Nothing about a follower, a customer or money is read.
 * - `write` and `drop` take a lock per business and check again inside it, so a trigger delivered twice writes once
 *   and the caps hold. `write` also mints the post's public codes (0106 `post_links`: one per network and one for a
 *   copied or sent link) in the same transaction, except for a sample business. A dropped attempt leaves an archived row with no words: the trigger is not tried again, and
 *   the attempt counts toward the caps.
 * - `markShared` and `dismiss` are the founder's two answers: a share that was opened (`approved`: their own press is
 *   the only approval a post needs) and "Not this one" (`rejected`). Nothing here says a post was posted.
 *
 * Service connection: the orchestrator's activity and the api's in-process run. The founder's own reads and answers go
 * through the `assets` routes and their RLS.
 */
import { isShowableTrophyKey } from "@foundmill/journey";
import { TEAM_POST_CAPS, TEAM_POST_DAY_MS, TEAM_POST_REF_PREFIX, TEAM_POST_WEEK_MS, isTeamPostSubject, parseTeamPostRef, readPageContent, teamPostRef, teamPostTitle, type PageStage, type TeamPostRef } from "@foundmill/shared";
import { and, desc, eq, gte, inArray, isNull, like, sql } from "drizzle-orm";
import { agents, assets, businesses, channels, events, milestones, postLinks, projectPages, type Asset } from "../schema";
import { auditRepo } from "./audit";
import { postLinksRepo } from "./post-attributions";
import { maybeOne, type Executor } from "./_shared";

/** What made the team write: the event, and the row it names where it names one. */
export type TeamPostTriggerInput = { kind: "page_published" } | { kind: "milestone_shown"; milestoneId: string } | { kind: "first_follower" };

/** Why a write did nothing. */
export type TeamPostWriteSkip = "already_drafted" | "already_waiting" | "daily_cap" | "weekly_cap";

export interface TeamPostSources {
  business: { id: string; name: string; isDemo: boolean; timeZone: string | null; stopped: boolean };
  /** The page while it is published: its address and the four public fields of the published copy. */
  page: { id: string; slug: string; pitch: string; about: string; forWhom: string; stage: PageStage } | null;
  /** The social channel's row, when the business has one. */
  channel: { id: string; enabled: boolean } | null;
  /** The channel's agent: the post's author. */
  agent: { id: string; name: string; paused: boolean } | null;
  /** What the trigger names, or null when it names nothing a post can be about. */
  ref: TeamPostRef | null;
  /** When it happened. */
  at: Date | null;
  /** True while the milestone a `milestone_shown` post names is on the page (its card answers). */
  cardShown: boolean;
  /** A draft was already written or tried for this trigger. */
  alreadyForTrigger: boolean;
  /** A draft about the same thing is still waiting to be shared. */
  waitingForSubject: boolean;
  inLastDay: number;
  inLastWeek: number;
}

const teamPosts = (businessId: string) => and(eq(assets.businessId, businessId), eq(assets.kind, "post"), like(assets.contentRef, `${TEAM_POST_REF_PREFIX}%`));
const trophyKey = sql<string | null>`${milestones.ref} ->> 'trophyKey'`;

/** One lock per business for the writers of team posts, held to the end of the transaction. */
async function lock(tx: Executor, businessId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('team_posts'), hashtext(${businessId}::text))`);
}

async function countSince(db: Executor, businessId: string, since: Date): Promise<number> {
  const rows = await db.select({ n: sql<number>`count(*)::int` }).from(assets).where(and(teamPosts(businessId), gte(assets.createdAt, since)));
  return Number(rows[0]?.n ?? 0);
}

/** Whether any row (waiting, shared, set aside or dropped) holds this reference. */
async function existsForRef(db: Executor, businessId: string, ref: TeamPostRef): Promise<boolean> {
  const rows = await db.select({ id: assets.id }).from(assets).where(and(eq(assets.businessId, businessId), eq(assets.contentRef, teamPostRef(ref)))).limit(1);
  return rows.length > 0;
}

async function waitingRows(db: Executor, businessId: string): Promise<Asset[]> {
  return db.select().from(assets).where(and(teamPosts(businessId), eq(assets.approvalState, "draft"), isNull(assets.archivedAt))).orderBy(desc(assets.createdAt));
}

/** Why a write would do nothing now, or null. Called before the model is asked and again inside the write's lock. */
async function writeSkip(db: Executor, businessId: string, ref: TeamPostRef, now: Date, caps: { perDay: number; perWeek: number }): Promise<TeamPostWriteSkip | null> {
  if (await existsForRef(db, businessId, ref)) return "already_drafted";
  if ((await waitingRows(db, businessId)).some((a) => parseTeamPostRef(a.contentRef)?.subject === ref.subject)) return "already_waiting";
  if ((await countSince(db, businessId, new Date(now.getTime() - TEAM_POST_DAY_MS))) >= caps.perDay) return "daily_cap";
  if ((await countSince(db, businessId, new Date(now.getTime() - TEAM_POST_WEEK_MS))) >= caps.perWeek) return "weekly_cap";
  return null;
}

export interface WriteTeamPostInput {
  ref: TeamPostRef;
  /** The post's words, already checked (packages/agents `finalisePostDraft`). */
  text: string;
  authoredByAgentId: string | null;
  /** Route, model, calls and cost (an Estimate), kept in the audit row. Never the words. */
  model?: Record<string, unknown>;
  now?: Date;
  caps?: { perDay: number; perWeek: number };
  /** The draft's event, written through the outbox in the same transaction. */
  onWritten?: (tx: Executor, asset: Asset) => Promise<unknown>;
  /**
   * The post goes out through a mock connector (a publish that is simulated): its links are minted `simulated` and never
   * resolve. A post the founder shares by tap is shared for real, whatever the connectors, so this is false for it.
   */
  simulatedLinks?: boolean;
}

export const teamPostsRepo = {
  /**
   * What a draft is decided and written from. The trigger is resolved to the row it names: the page for
   * `page_published` (at the date "Page live" was reached, else the page's own), a shown milestone that may be shown
   * in public for `milestone_shown`, the "First follower" milestone for `first_follower`.
   */
  async sources(db: Executor, businessId: string, trigger: TeamPostTriggerInput, now: Date = new Date()): Promise<TeamPostSources | null> {
    const business = maybeOne(
      await db
        .select({ id: businesses.id, name: businesses.name, isDemo: businesses.isDemo, timeZone: businesses.timeZone, stoppedAt: businesses.agentsStoppedAt, archivedAt: businesses.archivedAt })
        .from(businesses)
        .where(eq(businesses.id, businessId))
        .limit(1),
    );
    if (!business) return null;
    const [pageRow, channelRow] = await Promise.all([
      maybeOne(await db.select().from(projectPages).where(eq(projectPages.businessId, businessId)).limit(1)),
      maybeOne(await db.select({ id: channels.id, enabled: channels.enabled, archivedAt: channels.archivedAt, ownerAgentId: channels.ownerAgentId }).from(channels).where(and(eq(channels.businessId, businessId), eq(channels.channelKey, "social"))).limit(1)),
    ]);
    const published = pageRow?.published ? readPageContent(pageRow.published) : null;
    const page = pageRow && published ? { id: pageRow.id, slug: pageRow.slug, pitch: published.pitch, about: published.about, forWhom: published.forWhom, stage: published.stage } : null;
    const agentRow = channelRow?.ownerAgentId
      ? maybeOne(await db.select({ id: agents.id, name: agents.name, status: agents.status, archivedAt: agents.archivedAt }).from(agents).where(and(eq(agents.businessId, businessId), eq(agents.id, channelRow.ownerAgentId))).limit(1))
      : null;

    const milestoneByKey = async (key: string) => maybeOne(await db.select().from(milestones).where(and(eq(milestones.businessId, businessId), isNull(milestones.archivedAt), sql`${trophyKey} = ${key}`)).limit(1));
    let ref: TeamPostRef | null = null;
    let at: Date | null = null;
    let cardShown = false;
    if (trigger.kind === "page_published") {
      if (pageRow && page) {
        ref = { trigger: "page_published", subject: "page_live", refId: pageRow.id };
        at = (await milestoneByKey("page_live"))?.achievedAt ?? pageRow.publishedAt ?? null;
      }
    } else if (trigger.kind === "first_follower") {
      const milestone = await milestoneByKey("first_follower");
      if (milestone) {
        ref = { trigger: "first_follower", subject: "first_follower", refId: milestone.id };
        at = milestone.achievedAt;
      }
    } else {
      const milestone = maybeOne(await db.select().from(milestones).where(and(eq(milestones.businessId, businessId), eq(milestones.id, trigger.milestoneId), isNull(milestones.archivedAt))).limit(1));
      const key = typeof milestone?.ref?.trophyKey === "string" ? milestone.ref.trophyKey : null;
      // Only a milestone that is on the page now, recorded from one real event (never a counted or estimated one).
      if (milestone && key && isTeamPostSubject(key) && isShowableTrophyKey(key) && milestone.visibility === "public") {
        ref = { trigger: "milestone_shown", subject: key, refId: milestone.id };
        at = milestone.achievedAt;
        cardShown = true;
      }
    }

    const skip = ref ? await writeSkip(db, businessId, ref, now, { perDay: Number.MAX_SAFE_INTEGER, perWeek: Number.MAX_SAFE_INTEGER }) : null;
    const [inLastDay, inLastWeek] = await Promise.all([countSince(db, businessId, new Date(now.getTime() - TEAM_POST_DAY_MS)), countSince(db, businessId, new Date(now.getTime() - TEAM_POST_WEEK_MS))]);
    return {
      business: { id: business.id, name: business.name, isDemo: business.isDemo, timeZone: business.timeZone ?? null, stopped: business.stoppedAt !== null || business.archivedAt !== null },
      page,
      channel: channelRow && !channelRow.archivedAt ? { id: channelRow.id, enabled: channelRow.enabled } : null,
      agent: agentRow && !agentRow.archivedAt ? { id: agentRow.id, name: agentRow.name, paused: agentRow.status === "paused" } : null,
      ref,
      at,
      cardShown,
      alreadyForTrigger: skip === "already_drafted",
      waitingForSubject: skip === "already_waiting",
      inLastDay,
      inLastWeek,
    };
  },

  /**
   * Stores a draft: an `assets` row (post, draft, no campaign) with the reference and the words, an audit row that
   * names the agent, and `onWritten` for its event, in one transaction under the business's lock. Writes nothing when
   * the trigger already has a row, a draft about the same thing still waits, or a cap is reached.
   */
  async write(db: Executor, businessId: string, input: WriteTeamPostInput): Promise<{ written: boolean; asset: Asset | null; skip: TeamPostWriteSkip | null }> {
    const now = input.now ?? new Date();
    return db.transaction(async (tx) => {
      await lock(tx, businessId);
      const skip = await writeSkip(tx, businessId, input.ref, now, input.caps ?? TEAM_POST_CAPS);
      if (skip) return { written: false, asset: null, skip };
      const [asset] = await tx
        .insert(assets)
        .values({ businessId, campaignId: null, kind: "post", title: teamPostTitle(input.ref), contentRef: teamPostRef(input.ref), body: input.text.slice(0, 8000), approvalState: "draft", authoredByAgentId: input.authoredByAgentId, createdAt: now })
        .returning();
      if (!asset) return { written: false, asset: null, skip: null };
      // The post's own codes (0106), so a real outcome that comes back through one of its links is credited to it. A
      // sample business shows nothing in public and gets none.
      const business = maybeOne(await tx.select({ isDemo: businesses.isDemo }).from(businesses).where(eq(businesses.id, businessId)).limit(1));
      if (business && !business.isDemo) await postLinksRepo.mint(tx, businessId, asset.id, { simulated: input.simulatedLinks === true });
      await auditRepo.append(tx, businessId, {
        actorKind: input.authoredByAgentId ? "agent" : "system",
        actorId: input.authoredByAgentId,
        action: "post.drafted",
        target: { kind: "asset", id: asset.id },
        details: { trigger: input.ref.trigger, subject: input.ref.subject, refId: input.ref.refId, ...(input.model ? { model: input.model } : {}) },
      });
      await input.onWritten?.(tx, asset);
      return { written: true, asset, skip: null };
    });
  },

  /**
   * An attempt whose answers were refused twice: an archived row with the reference and no words, so the trigger is
   * never tried (and paid for) again and the attempt counts toward the caps. The audit row keeps the reason code.
   */
  async drop(db: Executor, businessId: string, input: { ref: TeamPostRef; reason: string; authoredByAgentId: string | null; model?: Record<string, unknown>; now?: Date }): Promise<void> {
    const now = input.now ?? new Date();
    await db.transaction(async (tx) => {
      await lock(tx, businessId);
      if (await existsForRef(tx, businessId, input.ref)) return;
      const [row] = await tx
        .insert(assets)
        .values({ businessId, campaignId: null, kind: "post", title: teamPostTitle(input.ref), contentRef: teamPostRef(input.ref), body: null, approvalState: "rejected", authoredByAgentId: input.authoredByAgentId, createdAt: now, archivedAt: now })
        .returning({ id: assets.id });
      if (!row) return;
      await auditRepo.append(tx, businessId, {
        actorKind: input.authoredByAgentId ? "agent" : "system",
        actorId: input.authoredByAgentId,
        action: "post.draft_dropped",
        target: { kind: "asset", id: row.id },
        details: { trigger: input.ref.trigger, subject: input.ref.subject, refId: input.ref.refId, reason: input.reason, ...(input.model ? { model: input.model } : {}) },
      });
    });
  },

  /** One team post of the business that is not archived, or null (any other asset is null too). */
  async get(db: Executor, businessId: string, assetId: string): Promise<Asset | null> {
    return maybeOne(await db.select().from(assets).where(and(teamPosts(businessId), eq(assets.id, assetId), isNull(assets.archivedAt))).limit(1));
  },

  /** The team's posts that wait to be shared, newest first. */
  async waiting(db: Executor, businessId: string): Promise<Asset[]> {
    return waitingRows(db, businessId);
  },

  /**
   * The founder opened a share for a waiting post: it stops waiting (`approved`). Conditional on the row's state, so a
   * second press changes nothing; the row when it changed, else null.
   */
  async markShared(db: Executor, businessId: string, assetId: string): Promise<Asset | null> {
    return maybeOne(await db.update(assets).set({ approvalState: "approved" }).where(and(teamPosts(businessId), eq(assets.id, assetId), eq(assets.approvalState, "draft"), isNull(assets.archivedAt))).returning());
  },

  /**
   * Which of `assetIds` the founder said they posted (`post.published`, WP-08 T4): the network, the day of the first
   * answer, and whether a visit came back through the post's own link. Read from the events; a post with none is absent.
   */
  async published(db: Executor, businessId: string, assetIds: readonly string[]): Promise<Map<string, { network: string | null; url: string | null; at: Date; visited: boolean }>> {
    const out = new Map<string, { network: string | null; url: string | null; at: Date; visited: boolean }>();
    if (assetIds.length === 0) return out;
    const rows = await db.select({ payload: events.payload, at: events.occurredAt }).from(events).where(and(eq(events.businessId, businessId), eq(events.type, "post.published"), inArray(sql`${events.payload} ->> 'assetId'`, [...assetIds]))).orderBy(events.occurredAt);
    for (const r of rows) {
      const p = r.payload as { assetId: string; network: string | null; url: string | null; visited: boolean };
      const seen = out.get(p.assetId);
      out.set(p.assetId, seen ? { ...seen, visited: seen.visited || p.visited } : { network: p.network, url: p.url ?? null, at: r.at, visited: p.visited });
    }
    return out;
  },

  /** True when a browser first opened this post's link for `network` (not a member, not simulated). */
  async linkVisited(db: Executor, businessId: string, assetId: string, network: string | null): Promise<boolean> {
    const rows = await db.select({ at: postLinks.firstVisitedAt }).from(postLinks).where(and(eq(postLinks.businessId, businessId), eq(postLinks.assetId, assetId), eq(postLinks.simulated, false), network ? eq(postLinks.network, network as never) : isNull(postLinks.network))).limit(1);
    return rows[0]?.at != null;
  },

  /** "Not this one": a waiting post is set aside (`rejected`) and is not offered again. The row when it changed, else null. */
  async dismiss(db: Executor, businessId: string, assetId: string): Promise<Asset | null> {
    return maybeOne(await db.update(assets).set({ approvalState: "rejected" }).where(and(teamPosts(businessId), eq(assets.id, assetId), eq(assets.approvalState, "draft"), isNull(assets.archivedAt))).returning());
  },

  /** The milestones among `ids` that are on the page now (their cards answer). */
  async shownMilestoneIds(db: Executor, businessId: string, ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await db.select({ id: milestones.id }).from(milestones).where(and(eq(milestones.businessId, businessId), isNull(milestones.archivedAt), eq(milestones.visibility, "public"), inArray(milestones.id, [...ids])));
    return new Set(rows.map((r) => r.id));
  },
};
