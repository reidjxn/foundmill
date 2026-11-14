/**
 * Showcase videos of real projects (0103; docs/THESIS_REVIEW.md §13 item 15). Service connection only: apps/api writes
 * both tables, on behalf of the house's owners and of the project's founders after it has checked who they are. The
 * founders' own reads of their row go through RLS (`showcase_consents_select`: their own row, while they hold an
 * owner's standing).
 *
 * - `storyOf`: what a video may be made of, read through the public views only (`public_project_pages`,
 *   `public_project_milestones`): the name, the brand colors and the shown milestones' keys, words and dates.
 * - `eligibilityFacts`: the facts `showcaseEligibility` (packages/shared) decides on.
 * - `currentOwnerIds`: who has an owner's standing in the project now (owners and cofounders; never an example
 *   membership or one that has ended). Every settlement and every share compares the yes against this list.
 */
import { OWNER_ROLES, SHOWCASE_MILESTONE_KEYS, SHOWCASE_SHARE_NETWORK_WORDS, teamPostRef, teamPostTitle, type ShowcaseAnswer, type ShowcaseConsentDecision, type ShowcaseMilestoneKey, type ShowcasePreview, type ShowcaseRequestState, type ShowcaseWithdrawReason } from "@foundmill/shared";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { agents, assets, businesses, channels, events, inboxItems, memberships, milestones, projectPages, publicProjectMilestones, publicProjectPages, showcaseConsents, showcaseRequests, type Asset, type InboxItem, type NewShowcaseConsent, type NewShowcaseRequest, type ShowcaseConsent, type ShowcaseMedia, type ShowcaseRequest } from "../schema";
import { membershipNotEnded } from "./memberships";
import { maybeOne, type Executor } from "./_shared";

export interface ShowcaseStory {
  businessId: string;
  slug: string;
  name: string;
  brandPrimary: string;
  brandSecondary: string;
  /** The shown milestones a video may show (page live, first follower), oldest first. */
  milestones: { id: string; key: string; label: string; achievedAt: Date }[];
}

const OPEN_STATES = ["asking", "approved"] as const satisfies readonly ShowcaseRequestState[];

export const showcaseRepo = {
  /** The project's public story, or null when its page is not public. Read through the public views only. */
  async storyOf(db: Executor, subjectBusinessId: string): Promise<ShowcaseStory | null> {
    const page = maybeOne(await db.select({ slug: projectPages.slug }).from(projectPages).where(eq(projectPages.businessId, subjectBusinessId)).limit(1));
    if (!page) return null;
    const pub = maybeOne(await db.select({ slug: publicProjectPages.slug, name: publicProjectPages.name, kitPrimary: publicProjectPages.kitPrimary, kitSecondary: publicProjectPages.kitSecondary }).from(publicProjectPages).where(eq(publicProjectPages.slug, page.slug)).limit(1));
    if (!pub) return null;
    const rows = await db
      .select()
      .from(publicProjectMilestones)
      .where(and(eq(publicProjectMilestones.slug, pub.slug), inArray(publicProjectMilestones.key, [...SHOWCASE_MILESTONE_KEYS])))
      .orderBy(asc(publicProjectMilestones.achievedAt), asc(publicProjectMilestones.id));
    return { businessId: subjectBusinessId, slug: pub.slug, name: pub.name, brandPrimary: pub.kitPrimary, brandSecondary: pub.kitSecondary, milestones: rows.map((m) => ({ id: m.id, key: m.key, label: m.label, achievedAt: m.achievedAt })) };
  },

  /** Projects that show a page-live or first-follower milestone in public now (the house's list to choose from). */
  async candidateIds(db: Executor, limit = 200): Promise<string[]> {
    const rows = await db
      .selectDistinct({ businessId: projectPages.businessId })
      .from(publicProjectMilestones)
      .innerJoin(projectPages, eq(projectPages.slug, publicProjectMilestones.slug))
      .where(inArray(publicProjectMilestones.key, [...SHOWCASE_MILESTONE_KEYS]))
      .limit(Math.min(Math.max(limit, 1), 1000));
    return rows.map((r) => r.businessId);
  },

  /** What eligibility is decided on, beside the house id and the clock. */
  async eligibilityFacts(db: Executor, subjectBusinessId: string): Promise<{
    business: { id: string; name: string; isDemo: boolean; archived: boolean; showcaseMayAsk: boolean | null } | null;
    story: ShowcaseStory | null;
    shownSimulated: Map<string, boolean>;
    openRequest: boolean;
    lastRequestAt: Date | null;
    lastDeclinedAt: Date | null;
  }> {
    const business = maybeOne(await db.select({ id: businesses.id, name: businesses.name, isDemo: businesses.isDemo, archivedAt: businesses.archivedAt, showcaseMayAsk: businesses.showcaseMayAsk }).from(businesses).where(eq(businesses.id, subjectBusinessId)).limit(1));
    const story = business ? await showcaseRepo.storyOf(db, subjectBusinessId) : null;
    const shownSimulated = new Map<string, boolean>();
    if (story?.milestones.length) {
      const refs = await db.select({ id: milestones.id, ref: milestones.ref }).from(milestones).where(and(eq(milestones.businessId, subjectBusinessId), inArray(milestones.id, story.milestones.map((m) => m.id))));
      // A milestone recorded from a simulated or estimated source is never a real outcome: it cannot be featured.
      for (const r of refs) shownSimulated.set(r.id, r.ref?.simulated === true || r.ref?.estimate === true);
    }
    const requests = await db.select({ state: showcaseRequests.state, createdAt: showcaseRequests.createdAt, settledAt: showcaseRequests.settledAt }).from(showcaseRequests).where(eq(showcaseRequests.subjectBusinessId, subjectBusinessId)).orderBy(desc(showcaseRequests.createdAt)).limit(50);
    const declined = requests.filter((r) => r.state === "declined").map((r) => r.settledAt ?? r.createdAt);
    return {
      business: business ? { id: business.id, name: business.name, isDemo: business.isDemo, archived: business.archivedAt !== null, showcaseMayAsk: business.showcaseMayAsk } : null,
      story,
      shownSimulated,
      openRequest: requests.some((r) => (OPEN_STATES as readonly string[]).includes(r.state)),
      lastRequestAt: requests[0]?.createdAt ?? null,
      lastDeclinedAt: declined.length ? new Date(Math.max(...declined.map((d) => d.getTime()))) : null,
    };
  },

  /** Who has an owner's standing in the project now: owners and cofounders, never an example membership or one that ended. */
  async currentOwnerIds(db: Executor, businessId: string): Promise<string[]> {
    const rows = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.businessId, businessId), inArray(memberships.role, [...OWNER_ROLES]), ne(memberships.source, "example"), membershipNotEnded))
      .orderBy(asc(memberships.userId));
    return [...new Set(rows.map((r) => r.userId))];
  },

  async createRequest(db: Executor, values: Omit<NewShowcaseRequest, "id" | "createdAt" | "updatedAt">): Promise<ShowcaseRequest> {
    const [row] = await db.insert(showcaseRequests).values(values).returning();
    return row!;
  },

  async getRequest(db: Executor, houseId: string, requestId: string, options: { forUpdate?: boolean } = {}): Promise<ShowcaseRequest | null> {
    const q = db.select().from(showcaseRequests).where(and(eq(showcaseRequests.businessId, houseId), eq(showcaseRequests.id, requestId))).limit(1);
    return maybeOne(options.forUpdate ? await q.for("update") : await q);
  },

  /** The request a consent belongs to, by its id alone (the project side knows the request id from its own row). */
  async requestById(db: Executor, requestId: string, options: { forUpdate?: boolean } = {}): Promise<ShowcaseRequest | null> {
    const q = db.select().from(showcaseRequests).where(eq(showcaseRequests.id, requestId)).limit(1);
    return maybeOne(options.forUpdate ? await q.for("update") : await q);
  },

  /** Requests for the house's own list, newest first. */
  async listForHouse(db: Executor, houseId: string, limit = 50): Promise<ShowcaseRequest[]> {
    return db.select().from(showcaseRequests).where(eq(showcaseRequests.businessId, houseId)).orderBy(desc(showcaseRequests.createdAt)).limit(Math.min(Math.max(limit, 1), 200));
  },

  /** Every request still asking or approved (the sweep's work), oldest first. */
  async listOpen(db: Executor, limit = 500): Promise<ShowcaseRequest[]> {
    return db.select().from(showcaseRequests).where(inArray(showcaseRequests.state, [...OPEN_STATES])).orderBy(asc(showcaseRequests.createdAt)).limit(limit);
  },

  /** The open request about a project, if any. */
  async openForSubject(db: Executor, subjectBusinessId: string): Promise<ShowcaseRequest | null> {
    return maybeOne(await db.select().from(showcaseRequests).where(and(eq(showcaseRequests.subjectBusinessId, subjectBusinessId), inArray(showcaseRequests.state, [...OPEN_STATES]))).limit(1));
  },

  /** The request whose approved draft is this house asset, if any. */
  async byAsset(db: Executor, houseId: string, assetId: string): Promise<ShowcaseRequest | null> {
    return maybeOne(await db.select().from(showcaseRequests).where(and(eq(showcaseRequests.businessId, houseId), eq(showcaseRequests.assetId, assetId))).limit(1));
  },

  async updateRequest(db: Executor, requestId: string, patch: Partial<Pick<ShowcaseRequest, "preview" | "previewHash" | "assetId" | "state" | "withdrawReason" | "askedAt" | "expiresAt" | "approvedUntil" | "settledAt">> & { media?: ShowcaseMedia }): Promise<ShowcaseRequest> {
    const [row] = await db.update(showcaseRequests).set(patch).where(eq(showcaseRequests.id, requestId)).returning();
    return row!;
  },

  /**
   * Takes the request for one step of its clips, until `until`: only while it is asking and not asked yet, and nobody
   * else holds it. One atomic update, so two sweeps (two api replicas) never both start clips. True when taken.
   */
  async claimMedia(db: Executor, requestId: string, now: Date, until: Date): Promise<boolean> {
    const rows = await db
      .update(showcaseRequests)
      .set({ media: sql`jsonb_set(${showcaseRequests.media}, '{claimedUntil}', to_jsonb(${until.toISOString()}::text))` })
      .where(and(eq(showcaseRequests.id, requestId), eq(showcaseRequests.state, "asking"), isNull(showcaseRequests.askedAt), sql`coalesce((${showcaseRequests.media} ->> 'claimedUntil')::timestamptz, '-infinity'::timestamptz) <= ${now.toISOString()}::timestamptz`))
      .returning({ id: showcaseRequests.id });
    return rows.length > 0;
  },

  /** Ends an open request: the state and the reason, once. False when it was not open any more. */
  async endRequest(db: Executor, requestId: string, state: "declined" | "withdrawn" | "expired", reason: ShowcaseWithdrawReason, now: Date): Promise<boolean> {
    const rows = await db
      .update(showcaseRequests)
      .set({ state, withdrawReason: reason, settledAt: now })
      .where(and(eq(showcaseRequests.id, requestId), inArray(showcaseRequests.state, [...OPEN_STATES])))
      .returning({ id: showcaseRequests.id });
    return rows.length > 0;
  },

  // --- consents --------------------------------------------------------------------------------------------------

  async createConsent(db: Executor, values: Omit<NewShowcaseConsent, "id" | "createdAt" | "updatedAt">): Promise<ShowcaseConsent> {
    const [row] = await db.insert(showcaseConsents).values(values).onConflictDoNothing({ target: [showcaseConsents.requestId, showcaseConsents.userId] }).returning();
    if (row) return row;
    return maybeOne(await db.select().from(showcaseConsents).where(and(eq(showcaseConsents.requestId, values.requestId), eq(showcaseConsents.userId, values.userId))).limit(1))!;
  },

  /** Ties a founder's row to their own note in Needs you. */
  async linkNote(db: Executor, consentId: string, inboxItemId: string): Promise<void> {
    await db.update(showcaseConsents).set({ inboxItemId }).where(eq(showcaseConsents.id, consentId));
  },

  /** Keeps every copy of the preview in step with the request's (fresh clip addresses only: the hash does not change). */
  async refreshPreview(db: Executor, requestId: string, preview: ShowcasePreview, media: ShowcaseMedia): Promise<void> {
    await db.update(showcaseRequests).set({ preview, media }).where(eq(showcaseRequests.id, requestId));
    await db.update(showcaseConsents).set({ preview }).where(eq(showcaseConsents.requestId, requestId));
  },

  async consentsOf(db: Executor, requestId: string): Promise<ShowcaseConsent[]> {
    return db.select().from(showcaseConsents).where(eq(showcaseConsents.requestId, requestId)).orderBy(asc(showcaseConsents.createdAt));
  },

  /** One founder's own row in the project, by its id or by the note it is attached to. */
  async consentFor(db: Executor, businessId: string, userId: string, by: { consentId: string } | { inboxItemId: string }, options: { forUpdate?: boolean } = {}): Promise<ShowcaseConsent | null> {
    const which = "consentId" in by ? eq(showcaseConsents.id, by.consentId) : eq(showcaseConsents.inboxItemId, by.inboxItemId);
    const q = db.select().from(showcaseConsents).where(and(eq(showcaseConsents.businessId, businessId), eq(showcaseConsents.userId, userId), which)).limit(1);
    return maybeOne(options.forUpdate ? await q.for("update") : await q);
  },

  async answer(db: Executor, consentId: string, answer: ShowcaseAnswer, now: Date): Promise<boolean> {
    const rows = await db.update(showcaseConsents).set({ answer, answeredAt: now }).where(and(eq(showcaseConsents.id, consentId), isNull(showcaseConsents.answer), isNull(showcaseConsents.withdrawnAt))).returning({ id: showcaseConsents.id });
    return rows.length > 0;
  },

  async withdraw(db: Executor, consentId: string, now: Date): Promise<boolean> {
    const rows = await db.update(showcaseConsents).set({ withdrawnAt: now }).where(and(eq(showcaseConsents.id, consentId), eq(showcaseConsents.answer, "yes"), isNull(showcaseConsents.withdrawnAt))).returning({ id: showcaseConsents.id });
    return rows.length > 0;
  },

  /** Deletes the unposted media from every copy of the preview (a withdrawal): the clips' addresses go. */
  async deleteMedia(db: Executor, requestId: string, now: Date): Promise<void> {
    const request = maybeOne(await db.select().from(showcaseRequests).where(eq(showcaseRequests.id, requestId)).limit(1));
    if (!request) return;
    const strip = (p: ShowcasePreview): ShowcasePreview => (p.video ? { ...p, video: { clips: p.video.clips.map((c) => ({ ...c, url: null })) } } : p);
    const media: ShowcaseMedia = { ...request.media, clips: (request.media.clips ?? []).map((c) => ({ ...c, url: null })), deletedAt: now.toISOString() };
    await db.update(showcaseRequests).set({ preview: strip(request.preview), media }).where(eq(showcaseRequests.id, requestId));
    for (const c of await showcaseRepo.consentsOf(db, requestId)) await db.update(showcaseConsents).set({ preview: strip(c.preview) }).where(eq(showcaseConsents.id, c.id));
  },

  /** The founders' own notes about a request (to close them when it ends). */
  async noteIds(db: Executor, requestId: string): Promise<{ businessId: string; inboxItemId: string }[]> {
    const rows = await db.select({ businessId: showcaseConsents.businessId, inboxItemId: showcaseConsents.inboxItemId }).from(showcaseConsents).where(eq(showcaseConsents.requestId, requestId));
    return rows.flatMap((r) => (r.inboxItemId ? [{ businessId: r.businessId, inboxItemId: r.inboxItemId }] : []));
  },

  /** Closes a founder's note: answered (their own answer) or archived (the request ended). */
  async closeNote(db: Executor, businessId: string, inboxItemId: string, state: "answered" | "archived"): Promise<void> {
    await db
      .update(inboxItems)
      .set({ state, ...(state === "archived" ? { archivedAt: sql`now()` } : {}) })
      .where(and(eq(inboxItems.businessId, businessId), eq(inboxItems.id, inboxItemId), inArray(inboxItems.state, ["unread", "read", "answered"])));
  },

  /** A founder's own ask in the project's Needs you: a decision note for that person only (0103 `for_user_id`). */
  async createNote(db: Executor, businessId: string, input: { forUserId: string; subject: string; bodyMd: string; decision: ShowcaseConsentDecision }): Promise<InboxItem> {
    const [row] = await db.insert(inboxItems).values({ businessId, type: "decision", subject: input.subject, bodyMd: input.bodyMd, decision: input.decision as unknown as Record<string, unknown>, forUserId: input.forUserId }).returning();
    return row!;
  },

  /** A note to the house's people (not an ask): what to take down by hand. */
  async createHouseNote(db: Executor, houseId: string, input: { subject: string; bodyMd: string }): Promise<InboxItem> {
    const [row] = await db.insert(inboxItems).values({ businessId: houseId, type: "warning", subject: input.subject, bodyMd: input.bodyMd }).returning();
    return row!;
  },

  /** The house's social agent (the channel's owner), or null. The script and the clips are made as it. */
  async socialAgentId(db: Executor, houseId: string): Promise<string | null> {
    const row = maybeOne(
      await db
        .select({ id: agents.id })
        .from(channels)
        .innerJoin(agents, and(eq(agents.businessId, channels.businessId), eq(agents.id, channels.ownerAgentId)))
        .where(and(eq(channels.businessId, houseId), eq(channels.channelKey, "social"), isNull(agents.archivedAt)))
        .limit(1),
    );
    return row?.id ?? null;
  },

  /** The house's draft post of an approved video: a team post with the trigger `showcase_approved`. */
  async createDraftPost(db: Executor, houseId: string, input: { requestId: string; subject: ShowcaseMilestoneKey; text: string; agentId: string | null }): Promise<Asset> {
    const ref = { trigger: "showcase_approved" as const, subject: input.subject, refId: input.requestId };
    const [row] = await db.insert(assets).values({ businessId: houseId, kind: "post", title: teamPostTitle(ref), contentRef: teamPostRef(ref), body: input.text, approvalState: "draft", authoredByAgentId: input.agentId }).returning();
    return row!;
  },

  /** Sets the house's draft aside (a withdrawal): it is never offered again. */
  async rejectDraft(db: Executor, houseId: string, assetId: string): Promise<void> {
    await db.update(assets).set({ approvalState: "rejected", archivedAt: sql`now()` }).where(and(eq(assets.businessId, houseId), eq(assets.id, assetId)));
  },

  async draft(db: Executor, houseId: string, assetId: string): Promise<Asset | null> {
    return maybeOne(await db.select().from(assets).where(and(eq(assets.businessId, houseId), eq(assets.id, assetId))).limit(1));
  },

  /** The networks a share of the house's draft was opened on (`share.opened`), for the note to take it down by hand. */
  async sharedOn(db: Executor, houseId: string, assetId: string): Promise<string[]> {
    const rows = await db
      .select({ network: sql<string | null>`${events.payload} ->> 'network'` })
      .from(events)
      .where(and(eq(events.businessId, houseId), eq(events.type, "share.opened"), sql`${events.payload} ->> 'kind' = 'draft'`, sql`${events.payload} ->> 'refId' = ${assetId}`));
    // A share with no network (a copy, the device's own sheet) is named as such: it went somewhere all the same.
    return [...new Set(rows.map((r) => r.network ?? SHOWCASE_SHARE_NETWORK_WORDS.unnamed))].sort();
  },

  /** Whether every milestone named is still shown in public at `slug`. */
  async milestonesShown(db: Executor, slug: string, milestoneIds: readonly string[]): Promise<boolean> {
    if (milestoneIds.length === 0) return false;
    const rows = await db.select({ id: publicProjectMilestones.id }).from(publicProjectMilestones).where(and(eq(publicProjectMilestones.slug, slug), inArray(publicProjectMilestones.id, [...milestoneIds])));
    return new Set(rows.map((r) => r.id)).size === new Set(milestoneIds).size;
  },

  /** Whether the page at `slug` is public now (the public view lists it). */
  async pagePublic(db: Executor, slug: string): Promise<boolean> {
    return (await db.select({ slug: publicProjectPages.slug }).from(publicProjectPages).where(eq(publicProjectPages.slug, slug)).limit(1)).length > 0;
  },

  /** The project's own setting, or null when its founders have not chosen. */
  async mayAskSetting(db: Executor, businessId: string): Promise<boolean | null> {
    return maybeOne(await db.select({ v: businesses.showcaseMayAsk }).from(businesses).where(eq(businesses.id, businessId)).limit(1))?.v ?? null;
  },

  async setMayAsk(db: Executor, businessId: string, value: boolean): Promise<void> {
    await db.update(businesses).set({ showcaseMayAsk: value }).where(eq(businesses.id, businessId));
  },
};
