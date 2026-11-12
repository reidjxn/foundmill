/**
 * Posts the team writes for the founder to share by tap (docs/NETWORK.md F3, F7): where a draft lives (`assets`, no
 * new table), one draft per trigger, the caps, the drop, the founder's two answers, the walls between businesses, and
 * the whole path (`draftTeamPost`) with the mock model: the existing gates, and that nothing private reaches the model.
 */
import { buildPostDraftRequest, postDraftFacts } from "@foundmill/agents";
import { createModelClient, type CompleteRequest, type ModelClient } from "@foundmill/models";
import { CHANNEL_META, TEAM_POST_CAPS, parseTeamPostRef, teamPostRef, teamPostShareDraft, type ProjectPageContent } from "@foundmill/shared";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { awardFirstFollowerMilestone, awardPageLiveMilestone } from "../../milestones";
import { repos } from "../../repos";
import { periodOf } from "../../repos/usage";
import * as s from "../../schema";
import { draftTeamPost, type TeamPostDraftOptions } from "../../team-post-draft";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "../rls/fixtures";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let pageId: string;
let pageLiveId: string;
let socialId: string;

const NOW = new Date("2026-11-12T16:00:00Z");
const PUBLISHED = new Date("2026-11-12T09:00:00Z");
const content = (over: Partial<ProjectPageContent> = {}): ProjectPageContent => ({ pitch: "Sourdough, baked each morning in Leeds", about: "Small batches.\n\nAt your door before breakfast.", forWhom: "People in Leeds who want real bread", stage: "building", showFounders: true, followForm: true, ...over });
const commit = (businessId: string) => r.h.db.update(s.businesses).set({ committedAt: new Date("2026-10-01T00:00:00Z"), name: businessId === A.businessId ? "Maple Bakes" : "Bravo Candles" }).where(eq(s.businesses.id, businessId));
const assetsOf = (businessId: string) => r.h.db.select().from(s.assets).where(eq(s.assets.businessId, businessId));
const teamRows = async (businessId: string) => (await assetsOf(businessId)).filter((a) => parseTeamPostRef(a.contentRef));
const clear = (businessId: string) => r.h.db.delete(s.assets).where(and(eq(s.assets.businessId, businessId), sql`${s.assets.contentRef} like 'post-draft:%'`));
const audits = async (businessId: string, action: string) => (await r.h.db.select().from(s.auditLog).where(and(eq(s.auditLog.businessId, businessId), eq(s.auditLog.action, action)))) as { details: Record<string, unknown>; actorKind: string; actorId: string | null }[];
const pageRef = () => ({ trigger: "page_published", subject: "page_live", refId: pageId }) as const;

/** A committed business with a live page and the social channel on the board, owned by its first agent. */
async function ready(f: BusinessFixture, slug: string, at = PUBLISHED) {
  await commit(f.businessId);
  const { page } = await r.as(f.ownerId, (tx) => repos.pages.publish(tx, f.businessId, { content: content(), slug, userId: f.ownerId, at }));
  const live = await r.svc((tx) => awardPageLiveMilestone(tx, f.businessId, { pageId: page.id, at }));
  const social = await r.svc((tx) => repos.channels.upsert(tx, f.businessId, { channelKey: "social", line: CHANNEL_META.social.line, enabled: true, kitMode: false, ownerAgentId: f.agentId }));
  return { pageId: page.id, pageLiveId: live!.id, socialId: social.id };
}

beforeAll(async () => {
  r = await setupRepoHarness("tp");
  ({ A, B } = r);
  ({ pageId, pageLiveId, socialId } = await ready(A, "maple-bakes"));
  await commit(B.businessId);
}, 120_000);
afterAll(() => r?.close());

describe("repos.teamPosts.sources", () => {
  it("reads what a draft is decided from: the name, the published page's four fields, the channel, its agent, and the trigger's row", async () => {
    await clear(A.businessId);
    const src = (await repos.teamPosts.sources(r.db, A.businessId, { kind: "page_published" }, NOW))!;
    expect(src.business).toMatchObject({ id: A.businessId, name: "Maple Bakes", isDemo: false, stopped: false });
    expect(src.page).toEqual({ id: pageId, slug: "maple-bakes", pitch: "Sourdough, baked each morning in Leeds", about: "Small batches.\n\nAt your door before breakfast.", forWhom: "People in Leeds who want real bread", stage: "building" });
    expect(src.channel).toEqual({ id: socialId, enabled: true });
    expect(src.agent).toMatchObject({ id: A.agentId, paused: false });
    expect(src.ref).toEqual(pageRef());
    // The date "Page live" was reached, which is when the page first went live.
    expect(src.at).toEqual(PUBLISHED);
    expect(src).toMatchObject({ cardShown: false, alreadyForTrigger: false, waitingForSubject: false, inLastDay: 0, inLastWeek: 0 });
  });

  it("names nothing when there is nothing real: no page, a milestone that is not on the page, no first follower", async () => {
    const none = (await repos.teamPosts.sources(r.db, B.businessId, { kind: "page_published" }, NOW))!;
    expect(none).toMatchObject({ page: null, ref: null, channel: null, agent: null });
    expect((await repos.teamPosts.sources(r.db, A.businessId, { kind: "first_follower" }, NOW))!.ref).toBeNull();
    // "Page live" is reached but the founder has not put it on the page.
    expect((await repos.teamPosts.sources(r.db, A.businessId, { kind: "milestone_shown", milestoneId: pageLiveId }, NOW))!.ref).toBeNull();
    // Another business's milestone is not this one's.
    expect((await repos.teamPosts.sources(r.db, B.businessId, { kind: "milestone_shown", milestoneId: pageLiveId }, NOW))!.ref).toBeNull();
    expect(await repos.teamPosts.sources(r.db, "00000000-0000-4000-8000-000000000000", { kind: "page_published" }, NOW)).toBeNull();
  });

  it("a shown milestone is a subject only when it was recorded from one real event: never a customer or revenue one", async () => {
    await repos.journeys.setMilestoneShown(r.db, A.businessId, pageLiveId, true);
    const shown = (await repos.teamPosts.sources(r.db, A.businessId, { kind: "milestone_shown", milestoneId: pageLiveId }, NOW))!;
    expect(shown.ref).toEqual({ trigger: "milestone_shown", subject: "page_live", refId: pageLiveId });
    expect(shown.cardShown).toBe(true);
    const customer = (await r.svc((tx) => repos.journeys.awardMilestone(tx, A.businessId, { kind: "customer", label: "First customer: Ada Lovelace", achievedAt: NOW, ref: { trophyKey: "customer_1", entityId: A.entityId } })))!;
    // Even if one were made public around the api, it is not something a post is drafted about.
    await r.h.db.execute(sql`set session_replication_role = replica`);
    await r.h.db.update(s.milestones).set({ visibility: "public" }).where(eq(s.milestones.id, customer.id));
    await r.h.db.execute(sql`set session_replication_role = origin`);
    expect((await repos.teamPosts.sources(r.db, A.businessId, { kind: "milestone_shown", milestoneId: customer.id }, NOW))!.ref).toBeNull();
    await repos.journeys.setMilestoneShown(r.db, A.businessId, pageLiveId, false);
  });

  it("the first follower's post names the milestone, never the person", async () => {
    const consentId = "5f0a0d00-0000-4000-8000-00000000c0de";
    const at = new Date("2026-11-14T10:00:00Z");
    const first = await r.svc((tx) => awardFirstFollowerMilestone(tx, A.businessId, { consentId, at }));
    const src = (await repos.teamPosts.sources(r.db, A.businessId, { kind: "first_follower" }, NOW))!;
    expect(src.ref).toEqual({ trigger: "first_follower", subject: "first_follower", refId: first!.id });
    expect(src.at).toEqual(at);
    expect(JSON.stringify(src)).not.toContain(consentId);
  });
});

describe("repos.teamPosts.write", () => {
  it("stores the draft as an asset the Creative tab already lists, with an audit row and its event in one transaction", async () => {
    await clear(A.businessId);
    const seen: string[] = [];
    const out = await repos.teamPosts.write(r.db, A.businessId, { ref: pageRef(), text: "Maple Bakes has a page now.", authoredByAgentId: A.agentId, model: { route: "projectPage", calls: 1, costMinor: 1, costLabel: "Estimate" }, now: NOW, onWritten: async (_tx, asset) => void seen.push(asset.id) });
    expect(out).toMatchObject({ written: true, skip: null });
    expect(out.asset).toMatchObject({ businessId: A.businessId, campaignId: null, kind: "post", title: "A post about your page going live", contentRef: teamPostRef(pageRef()), body: "Maple Bakes has a page now.", approvalState: "draft", authoredByAgentId: A.agentId, archivedAt: null });
    expect(seen).toEqual([out.asset!.id]);
    // The founder's own list (RLS) shows it; the owner reads it like any asset.
    expect((await r.as(A.ownerId, (tx) => repos.campaigns.listAssets(tx, A.businessId, {}))).map((a) => a.id)).toContain(out.asset!.id);
    const [audit] = await audits(A.businessId, "post.drafted");
    expect(audit).toMatchObject({ actorKind: "agent", actorId: A.agentId });
    expect(audit!.details).toMatchObject({ trigger: "page_published", subject: "page_live", refId: pageId, model: { costLabel: "Estimate" } });
    // Never the words.
    expect(JSON.stringify(audit!.details)).not.toContain("has a page now");
  });

  it("writes once per trigger: a second delivery writes nothing, whatever became of the first draft", async () => {
    const again = await repos.teamPosts.write(r.db, A.businessId, { ref: pageRef(), text: "Another try.", authoredByAgentId: A.agentId, now: NOW });
    expect(again).toEqual({ written: false, asset: null, skip: "already_drafted" });
    const [post] = await teamRows(A.businessId);
    await repos.teamPosts.dismiss(r.db, A.businessId, post!.id);
    expect((await repos.teamPosts.write(r.db, A.businessId, { ref: pageRef(), text: "Another try.", authoredByAgentId: A.agentId, now: NOW })).skip).toBe("already_drafted");
    await repos.campaigns.archiveAsset(r.db, A.businessId, post!.id);
    expect((await repos.teamPosts.write(r.db, A.businessId, { ref: pageRef(), text: "Another try.", authoredByAgentId: A.agentId, now: NOW })).skip).toBe("already_drafted");
    expect(await teamRows(A.businessId)).toHaveLength(1);
  });

  it("two deliveries at once write one draft", async () => {
    await clear(A.businessId);
    const both = await Promise.all([1, 2].map((n) => repos.teamPosts.write(r.db, A.businessId, { ref: pageRef(), text: `Draft ${n} of Maple Bakes.`, authoredByAgentId: A.agentId, now: NOW })));
    expect(both.filter((o) => o.written)).toHaveLength(1);
    expect(both.find((o) => !o.written)?.skip).toBe("already_drafted");
    expect(await teamRows(A.businessId)).toHaveLength(1);
  });

  it("never leaves two drafts about the same thing waiting; once the first is shared, the shown milestone gets its own", async () => {
    const shownRef = { trigger: "milestone_shown", subject: "page_live", refId: pageLiveId } as const;
    expect((await repos.teamPosts.write(r.db, A.businessId, { ref: shownRef, text: "Maple Bakes reached a milestone.", authoredByAgentId: A.agentId, now: NOW })).skip).toBe("already_waiting");
    const [waiting] = await repos.teamPosts.waiting(r.db, A.businessId);
    await repos.teamPosts.markShared(r.db, A.businessId, waiting!.id);
    const out = await repos.teamPosts.write(r.db, A.businessId, { ref: shownRef, text: "Maple Bakes reached a milestone.", authoredByAgentId: A.agentId, now: NOW });
    expect(out.written).toBe(true);
    expect(out.asset!.title).toBe("A post about your milestone: Page live");
  });

  it("rolls back with its event: a draft whose event cannot be written is not stored", async () => {
    await clear(A.businessId);
    await expect(repos.teamPosts.write(r.db, A.businessId, { ref: pageRef(), text: "Maple Bakes has a page now.", authoredByAgentId: A.agentId, now: NOW, onWritten: async () => Promise.reject(new Error("outbox down")) })).rejects.toThrow("outbox down");
    expect(await teamRows(A.businessId)).toHaveLength(0);
  });
});

describe("the caps", () => {
  const ref = (n: number) => ({ trigger: "milestone_shown", subject: n % 2 ? "page_live" : "first_follower", refId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` }) as const;
  const writeAt = async (n: number, at: Date) => {
    const out = await repos.teamPosts.write(r.db, A.businessId, { ref: ref(n), text: `Post number ${n} about Maple Bakes.`, authoredByAgentId: null, now: at });
    // Shared at once, so "one waiting per subject" is not what stops the next.
    if (out.asset) await repos.teamPosts.markShared(r.db, A.businessId, out.asset.id);
    return out;
  };
  const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);

  it("stop at the daily number, then at the weekly one, and count from the clock, not the calendar", async () => {
    await clear(A.businessId);
    for (let i = 1; i <= TEAM_POST_CAPS.perDay; i++) expect((await writeAt(i, hours(i))).written, `draft ${i}`).toBe(true);
    expect((await writeAt(90, hours(TEAM_POST_CAPS.perDay + 1))).skip).toBe("daily_cap");
    // A day later the daily count is clear; the week's is not.
    let n = TEAM_POST_CAPS.perDay;
    for (let day = 1; n < TEAM_POST_CAPS.perWeek; day++) {
      for (let k = 0; k < TEAM_POST_CAPS.perDay && n < TEAM_POST_CAPS.perWeek; k++) expect((await writeAt(++n, hours(day * 30 + k))).written, `draft ${n}`).toBe(true);
    }
    expect(await teamRows(A.businessId)).toHaveLength(TEAM_POST_CAPS.perWeek);
    expect((await writeAt(91, hours(4 * 25))).skip).toBe("weekly_cap");
    // Eight days after the first, the oldest have left the week.
    expect((await writeAt(92, hours(8 * 24 + 3))).written).toBe(true);
    const src = (await repos.teamPosts.sources(r.db, A.businessId, { kind: "page_published" }, hours(8 * 24 + 4)))!;
    expect(src.inLastDay).toBe(1);
    expect(src.inLastWeek).toBeLessThanOrEqual(TEAM_POST_CAPS.perWeek);
  });

  it("a dropped attempt leaves no words, is never tried again, and counts", async () => {
    await clear(A.businessId);
    await repos.teamPosts.drop(r.db, A.businessId, { ref: pageRef(), reason: "invented_figure", authoredByAgentId: A.agentId, model: { calls: 2, costMinor: 2, costLabel: "Estimate" }, now: NOW });
    const [row] = await teamRows(A.businessId);
    expect(row).toMatchObject({ body: null, approvalState: "rejected", contentRef: teamPostRef(pageRef()) });
    expect(row!.archivedAt).not.toBeNull();
    // Not on the Creative tab, not waiting.
    expect(await repos.campaigns.listAssets(r.db, A.businessId, {})).toHaveLength((await assetsOf(A.businessId)).length - 1);
    expect(await repos.teamPosts.waiting(r.db, A.businessId)).toEqual([]);
    expect((await repos.teamPosts.write(r.db, A.businessId, { ref: pageRef(), text: "Maple Bakes has a page now.", authoredByAgentId: A.agentId, now: NOW })).skip).toBe("already_drafted");
    expect((await repos.teamPosts.sources(r.db, A.businessId, { kind: "page_published" }, NOW))!).toMatchObject({ alreadyForTrigger: true, inLastDay: 1 });
    const [audit] = await audits(A.businessId, "post.draft_dropped");
    expect(audit!.details).toMatchObject({ reason: "invented_figure", trigger: "page_published" });
    // A second drop of the same trigger changes nothing.
    await repos.teamPosts.drop(r.db, A.businessId, { ref: pageRef(), reason: "hype", authoredByAgentId: A.agentId, now: NOW });
    expect(await teamRows(A.businessId)).toHaveLength(1);
  });
});

describe("the founder's two answers", () => {
  it("a share stops a waiting post from waiting, once; \"Not this one\" sets it aside; neither touches another asset", async () => {
    await clear(A.businessId);
    const { asset } = await repos.teamPosts.write(r.db, A.businessId, { ref: pageRef(), text: "Maple Bakes has a page now.", authoredByAgentId: A.agentId, now: NOW });
    expect((await repos.teamPosts.waiting(r.db, A.businessId)).map((a) => a.id)).toEqual([asset!.id]);
    // The owner answers through RLS, as the api does.
    expect(await r.as(A.ownerId, (tx) => repos.teamPosts.markShared(tx, A.businessId, asset!.id))).toMatchObject({ approvalState: "approved" });
    expect(await r.as(A.ownerId, (tx) => repos.teamPosts.markShared(tx, A.businessId, asset!.id))).toBeNull();
    expect(await repos.teamPosts.waiting(r.db, A.businessId)).toEqual([]);
    // A shared post is not set aside afterwards by "Not this one".
    expect(await repos.teamPosts.dismiss(r.db, A.businessId, asset!.id)).toBeNull();

    const follower = (await repos.teamPosts.sources(r.db, A.businessId, { kind: "first_follower" }, NOW))!.ref!;
    const second = await repos.teamPosts.write(r.db, A.businessId, { ref: follower, text: "Maple Bakes has its first follower.", authoredByAgentId: A.agentId, now: NOW });
    expect(await repos.teamPosts.dismiss(r.db, A.businessId, second.asset!.id)).toMatchObject({ approvalState: "rejected" });
    expect(await repos.teamPosts.waiting(r.db, A.businessId)).toEqual([]);
    expect(await repos.teamPosts.get(r.db, A.businessId, second.asset!.id)).toMatchObject({ approvalState: "rejected" });

    // A campaign's own creative is not a team post: none of this reaches it.
    const creative = await repos.campaigns.createAsset(r.db, A.businessId, { campaignId: A.campaignId, kind: "post", title: "Campaign post", body: "From the engine.", approvalState: "draft" });
    expect(await repos.teamPosts.get(r.db, A.businessId, creative.id)).toBeNull();
    expect(await repos.teamPosts.markShared(r.db, A.businessId, creative.id)).toBeNull();
    expect(await repos.teamPosts.dismiss(r.db, A.businessId, creative.id)).toBeNull();
    expect((await repos.campaigns.getAsset(r.db, A.businessId, creative.id)).approvalState).toBe("draft");
  });

  it("says which milestones are on the page now", async () => {
    expect(await repos.teamPosts.shownMilestoneIds(r.db, A.businessId, [])).toEqual(new Set());
    expect(await repos.teamPosts.shownMilestoneIds(r.db, A.businessId, [pageLiveId])).toEqual(new Set());
    await repos.journeys.setMilestoneShown(r.db, A.businessId, pageLiveId, true);
    expect(await repos.teamPosts.shownMilestoneIds(r.db, A.businessId, [pageLiveId])).toEqual(new Set([pageLiveId]));
    expect(await repos.teamPosts.shownMilestoneIds(r.db, B.businessId, [pageLiveId])).toEqual(new Set());
    await repos.journeys.setMilestoneShown(r.db, A.businessId, pageLiveId, false);
  });
});

describe("between businesses", () => {
  it("another business cannot read, share or set aside a post, by the service's scoping or as its own people", async () => {
    await clear(A.businessId);
    const { asset } = await repos.teamPosts.write(r.db, A.businessId, { ref: pageRef(), text: "Maple Bakes has a page now.", authoredByAgentId: A.agentId, now: NOW });
    const id = asset!.id;
    expect(await repos.teamPosts.get(r.db, B.businessId, id)).toBeNull();
    expect(await repos.teamPosts.markShared(r.db, B.businessId, id)).toBeNull();
    expect(await repos.teamPosts.dismiss(r.db, B.businessId, id)).toBeNull();
    expect(await repos.teamPosts.waiting(r.db, B.businessId)).toEqual([]);
    expect((await repos.teamPosts.sources(r.db, B.businessId, { kind: "page_published" }, NOW))!).toMatchObject({ alreadyForTrigger: false, waitingForSubject: false, inLastDay: 0 });
    // As B's owner, through RLS: A's post is not there to read, and cannot be changed even when A's business id is named.
    for (const userId of [B.ownerId, B.adminId, B.memberId]) {
      expect(await r.as(userId, (tx) => repos.teamPosts.get(tx, A.businessId, id))).toBeNull();
      expect(await r.as(userId, (tx) => repos.teamPosts.waiting(tx, A.businessId))).toEqual([]);
      expect(await r.as(userId, (tx) => repos.teamPosts.markShared(tx, A.businessId, id))).toBeNull();
      expect(await r.as(userId, (tx) => repos.teamPosts.dismiss(tx, A.businessId, id))).toBeNull();
      await expect(r.as(userId, (tx) => tx.insert(s.assets).values({ businessId: A.businessId, kind: "post", title: "x", contentRef: teamPostRef(pageRef()), body: "Planted.", approvalState: "draft" }))).rejects.toThrow(RLS_DENIED);
    }
    expect((await repos.campaigns.getAsset(r.db, A.businessId, id)).approvalState).toBe("draft");
    // A viewer of A's own business reads it and cannot answer for the founders.
    expect(await r.as(A.viewerId, (tx) => repos.teamPosts.get(tx, A.businessId, id))).toMatchObject({ id });
    try {
      expect(await r.as(A.viewerId, (tx) => repos.teamPosts.dismiss(tx, A.businessId, id))).toBeNull();
    } catch (err) {
      expect((err as Error).message).toMatch(RLS_DENIED);
    }
    expect((await repos.campaigns.getAsset(r.db, A.businessId, id)).approvalState).toBe("draft");
  });
});

describe("draftTeamPost", () => {
  const silent = { debug() {}, info() {}, warn() {}, error() {} };
  const mock = createModelClient({ mode: "mock", logger: silent });
  /** The mock model, keeping every request it was sent. */
  function recording(): { models: ModelClient; requests: CompleteRequest<unknown>[] } {
    const requests: CompleteRequest<unknown>[] = [];
    const models = { mode: mock.mode, complete: (req: CompleteRequest<unknown>) => (requests.push(req), mock.complete(req as never)) } as unknown as ModelClient;
    return { models, requests };
  }
  const options = (over: Partial<TeamPostDraftOptions> = {}): TeamPostDraftOptions & { events: string[] } => {
    const events: string[] = [];
    return { events, channelByTap: async () => true, onWritten: async (_tx, { asset }) => void events.push(asset.id), ...over };
  };
  const deps = (models: ModelClient) => ({ db: r.db, models, appUrl: "https://foundmill.example", now: () => NOW });

  it("writes one draft from the mock model, by the social agent, with its event; a second request writes nothing and calls no model", async () => {
    await clear(A.businessId);
    const { models, requests } = recording();
    const o = options();
    const out = await draftTeamPost(deps(models), A.businessId, { kind: "page_published" }, o);
    expect(out).toMatchObject({ outcome: "written", usage: { calls: 1, mode: "mock" } });
    const [row] = await teamRows(A.businessId);
    expect(row).toMatchObject({ kind: "post", approvalState: "draft", campaignId: null, authoredByAgentId: A.agentId, contentRef: teamPostRef(pageRef()), body: "Maple Bakes has a page now. Sourdough, baked each morning in Leeds." });
    expect(o.events).toEqual([row!.id]);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.attribution).toEqual({ businessId: A.businessId, agentId: A.agentId, kind: "post_draft" });
    expect(await draftTeamPost(deps(models), A.businessId, { kind: "page_published" }, options())).toEqual({ outcome: "skipped", reason: "already_drafted" });
    expect(requests).toHaveLength(1);
  });

  it("gives the model only what is public: nothing of a follower, a customer, the people or the money", async () => {
    await clear(A.businessId);
    // A follower with a name and an address, beside the fixture's customers (Ada Lovelace, ada@…), its payments (49.00)
    // and its people.
    await r.h.db.insert(s.entities).values({ businessId: A.businessId, kind: "person", displayName: "Fern Follower", identifiers: { email: "fern.follower@inbox.test" }, lawfulBasis: "consent" });
    const { models, requests } = recording();
    const first = (await repos.teamPosts.sources(r.db, A.businessId, { kind: "first_follower" }, NOW))!;
    expect(first.ref).not.toBeNull();
    await draftTeamPost(deps(models), A.businessId, { kind: "first_follower" }, options());
    await draftTeamPost(deps(models), A.businessId, { kind: "page_published" }, options());
    expect(requests.length).toBeGreaterThanOrEqual(1);
    const sent = JSON.stringify(requests.map((q) => ({ system: q.system, messages: q.messages })));
    for (const secret of ["Fern", "fern.follower", "inbox.test", "Ada", "Lovelace", "Analytical Engines", "ada@", "4900", "49.00", "@test.local", "tp-a-owner", A.ownerId, A.entityId, first.ref!.refId, "showFounders", "followForm"]) expect(sent, secret).not.toContain(secret);
    // What it does carry: the name, the page's public words, and the fact.
    const user = String(requests[0]!.messages[0]!.content);
    expect(user).toContain('"project_name":"Maple Bakes"');
    expect(user).toContain("The first person confirmed that they follow the project, on Nov 14, 2026.");
    expect(user).toContain("Sourdough, baked each morning in Leeds");
    // The same request the pure builder makes from the name, the page's four fields and the fact: nothing is added on the way.
    const src = (await repos.teamPosts.sources(r.db, A.businessId, { kind: "first_follower" }, NOW))!;
    expect(Object.keys(src.page!).sort()).toEqual(["about", "forWhom", "id", "pitch", "slug", "stage"]);
    const link = teamPostShareDraft({ text: "", ref: src.ref!, page: { origin: "https://foundmill.example", slug: src.page!.slug, projectName: "Maple Bakes", pitch: src.page!.pitch } }).link;
    const built = buildPostDraftRequest(postDraftFacts({ businessName: "Maple Bakes", page: src.page!, trigger: "first_follower", subject: "first_follower", at: src.at!, timeZone: src.business.timeZone, link }));
    expect({ system: requests[0]!.system, messages: requests[0]!.messages }).toEqual({ system: built.system, messages: built.messages });
  });

  it("holds every existing gate before any model is asked", async () => {
    const gate = async (reason: string, set: () => Promise<unknown>, unset: () => Promise<unknown>, over: Partial<TeamPostDraftOptions> = {}) => {
      await clear(A.businessId);
      const { models, requests } = recording();
      await set();
      try {
        expect(await draftTeamPost(deps(models), A.businessId, { kind: "page_published" }, options(over)), reason).toEqual({ outcome: "skipped", reason });
        expect(requests, reason).toHaveLength(0);
        expect(await teamRows(A.businessId), reason).toHaveLength(0);
      } finally {
        await unset();
      }
    };
    const biz = (patch: Partial<typeof s.businesses.$inferInsert>) => r.h.db.update(s.businesses).set(patch).where(eq(s.businesses.id, A.businessId));
    const none = async () => undefined;
    await gate("sample_business", () => biz({ isDemo: true }), () => biz({ isDemo: false }));
    await gate("agents_stopped", () => biz({ agentsStoppedAt: NOW, agentsStoppedReason: "kill_switch" }), () => biz({ agentsStoppedAt: null, agentsStoppedReason: null }));
    await gate("off_the_board", () => repos.channels.setEnabled(r.db, A.businessId, socialId, false), () => repos.channels.setEnabled(r.db, A.businessId, socialId, true));
    await gate("agent_paused", () => repos.agents.setStatus(r.db, A.businessId, A.agentId, "paused"), () => repos.agents.setStatus(r.db, A.businessId, A.agentId, "healthy"));
    await gate("not_by_tap", none, none, { channelByTap: async () => false });
    await gate("page_not_live", () => r.as(A.ownerId, (tx) => repos.pages.unpublish(tx, A.businessId, { userId: A.ownerId })), () => r.as(A.ownerId, (tx) => repos.pages.publish(tx, A.businessId, { content: content(), slug: "maple-bakes", userId: A.ownerId, at: PUBLISHED })));
    // Credits used up on the platform key: nothing is asked, and nothing is spent.
    const period = periodOf(NOW);
    await gate("no_credits", () => repos.usage.chargeCredits(r.db, A.businessId, period, 1_000_000, { includedMinor: 100 }), () => r.h.db.delete(s.creditBalances).where(eq(s.creditBalances.businessId, A.businessId)));
    // A business with no page and no channel is skipped at the first rule it meets.
    const { models, requests } = recording();
    expect(await draftTeamPost(deps(models), B.businessId, { kind: "page_published" }, options())).toEqual({ outcome: "skipped", reason: "off_the_board" });
    expect(requests).toHaveLength(0);
  });

  it("drops a draft the check refuses twice, spends two calls at most, and never tries that trigger again", async () => {
    await clear(A.businessId);
    const requests: CompleteRequest<unknown>[] = [];
    const bad = { mode: "mock", complete: async (req: CompleteRequest<unknown>) => (requests.push(req), { ...(await mock.complete(req as never)), json: { text: "Maple Bakes already has 10,000 customers!", short: "" } }) } as unknown as ModelClient;
    const o = options();
    expect(await draftTeamPost(deps(bad), A.businessId, { kind: "page_published" }, o)).toMatchObject({ outcome: "dropped", reason: "invented_figure", usage: { calls: 2 } });
    expect(requests).toHaveLength(2);
    expect(o.events).toEqual([]);
    expect(await repos.teamPosts.waiting(r.db, A.businessId)).toEqual([]);
    expect(await draftTeamPost(deps(bad), A.businessId, { kind: "page_published" }, options())).toEqual({ outcome: "skipped", reason: "already_drafted" });
    expect(requests).toHaveLength(2);
    // Nothing of the refused words is kept anywhere.
    expect(JSON.stringify(await assetsOf(A.businessId))).not.toContain("10,000");
    expect(JSON.stringify(await audits(A.businessId, "post.draft_dropped"))).not.toContain("10,000");
  });

  it("a second business's fixture still drafts nothing by this path until it has a page and a channel of its own", async () => {
    const C = await createBusinessFixture(r.h, "tp-c");
    const { models } = recording();
    expect(await draftTeamPost(deps(models), C.businessId, { kind: "first_follower" }, options())).toMatchObject({ outcome: "skipped" });
    expect(await teamRows(C.businessId)).toHaveLength(0);
  });
});
