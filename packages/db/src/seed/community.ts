/**
 * The demo's public communities across rebuilds (audit 2026-10-12 #232). Real founders join them and post, so a rebuild
 * never deletes a community, a member or anyone else's post. Before the demo businesses are deleted their posts are
 * detached from the business (`posts.business_id` cascades), so the demo founder's posts and every reply under them
 * survive; the rebuild then finds each of those posts again and re-attaches it instead of writing a copy.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Executor } from "../repos/_shared";
import { repos } from "../repos";
import { communities, communityMembers, posts, type Community, type Post } from "../schema";
import { SEED_COMMUNITY_SLUGS } from "./constants";

/** Keeps the demo businesses' posts in the seed communities when the businesses are deleted. Returns how many. */
export async function detachDemoPosts(db: Executor, businessIds: readonly string[]): Promise<number> {
  if (!businessIds.length) return 0;
  const seeded = db.select({ id: communities.id }).from(communities).where(inArray(communities.slug, [...SEED_COMMUNITY_SLUGS]));
  const rows = await db
    .update(posts)
    .set({ businessId: null })
    .where(and(inArray(posts.businessId, [...businessIds]), inArray(posts.communityId, seeded)))
    .returning({ id: posts.id });
  return rows.length;
}

export interface SeedCommunityInput {
  name: string;
  slug: string;
  descriptionMd: string;
  /** The demo business that runs it; null for a community nobody owns. */
  ownerBusinessId?: string | null;
  /** The demo founder, who becomes its owner member; omitted for a community the demo founder has not joined. */
  createdBy?: string | null;
}

/**
 * Creates the community, or adopts the one an earlier seed made: its members and posts stay, the demo business runs it
 * again and the demo founder is (again) its owner member. Its name and description follow the seed only while the demo
 * created it.
 */
export async function ensureSeedCommunity(db: Executor, input: SeedCommunityInput): Promise<Community> {
  const existing = await repos.social.getCommunityBySlug(db, input.slug);
  if (!existing) return repos.social.createCommunity(db, { ...input, visibility: "public" });
  const seedOwned = existing.createdBy === null || existing.createdBy === (input.createdBy ?? null);
  const [community] = await db
    .update(communities)
    .set({
      ...(seedOwned ? { name: input.name, descriptionMd: input.descriptionMd, visibility: "public" as const } : {}),
      ...(input.ownerBusinessId && (existing.ownerBusinessId === null || seedOwned) ? { ownerBusinessId: input.ownerBusinessId } : {}),
      updatedAt: new Date(),
    })
    .where(eq(communities.id, existing.id))
    .returning();
  if (input.createdBy) {
    const role = existing.createdBy === input.createdBy ? "owner" : "member";
    const [member] = await db.select().from(communityMembers).where(and(eq(communityMembers.communityId, existing.id), eq(communityMembers.userId, input.createdBy))).limit(1);
    if (!member) {
      await db.insert(communityMembers).values({ communityId: existing.id, userId: input.createdBy, businessId: input.ownerBusinessId ?? null, role });
      await db.update(communities).set({ memberCount: sql`${communities.memberCount} + 1` }).where(eq(communities.id, existing.id));
    } else {
      if (member.status !== "active") await db.update(communities).set({ memberCount: sql`${communities.memberCount} + 1` }).where(eq(communities.id, existing.id));
      await db.update(communityMembers).set({ businessId: input.ownerBusinessId ?? null, role, status: "active" }).where(eq(communityMembers.id, member.id));
    }
  }
  return community ?? existing;
}

export interface SeedPostInput {
  communityId: string;
  authorUserId: string;
  businessId: string;
  bodyMd: string;
  parentPostId?: string | null;
}

/** The demo founder's post: the one an earlier seed wrote (re-attached to the rebuilt business), or a new one. */
export async function ensureSeedPost(db: Executor, input: SeedPostInput): Promise<Post> {
  const parent = input.parentPostId ?? null;
  const [existing] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.communityId, input.communityId), eq(posts.authorUserId, input.authorUserId), eq(posts.bodyMd, input.bodyMd), parent ? eq(posts.parentPostId, parent) : isNull(posts.parentPostId)))
    .limit(1);
  if (!existing) return repos.social.createPost(db, input);
  // A moderator's decision on it (hidden, removed) stands.
  const [post] = await db.update(posts).set({ businessId: input.businessId }).where(eq(posts.id, existing.id)).returning();
  return post ?? existing;
}
