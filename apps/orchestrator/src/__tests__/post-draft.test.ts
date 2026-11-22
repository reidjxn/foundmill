/**
 * postDraft (activities/post-draft.ts; docs/NETWORK.md F3, F7): the social agent drafts a post for the founder to share
 * by tap. On a real project (staging: social is `by_tap`) the channel engine still never runs for social, and the
 * draft is written all the same, because drafting is not running the channel. The activity writes `post.drafted`
 * through the outbox, is safe to retry, and launches, schedules, publishes and measures nothing.
 */
import { CHANNEL_META, parseTeamPostRef, type ProjectPageContent } from "@foundmill/shared";
import { awardFirstFollowerMilestone, awardPageLiveMilestone, repos, resumeBusinessAgents, stopBusinessAgents } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createChannelActivities, emptyChannelState } from "../activities/channel";
import { createPostDraftActivities, socialPostedByTap } from "../activities/post-draft";
import * as workflows from "../workflows";
import { createActivities } from "../activities";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
let socialId: string;
let pageId: string;

const content: ProjectPageContent = { pitch: "Refillable skincare for sensitive skin", about: "Small batches.\n\nRefills by post.", forWhom: "People with sensitive skin", stage: "building", showFounders: false, followForm: true };
const PUBLISHED = new Date("2026-10-04T09:00:00.000Z");
const staging = () => ({ ...t.deps, env: { ...t.deps.env, APP_ENV: "staging" as const, LIVE_CONNECTORS: "" } });
const teamPosts = async () => (await repos.campaigns.listAssets(t.db, t.businessId, { includeArchived: true })).filter((a) => parseTeamPostRef(a.contentRef));
const drafted = async () => (await repos.events.list(t.db, t.businessId, { type: "post.drafted", limit: 50 })).items;

beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "pd" });
  await t.h.pg.query("update businesses set committed_at = $1, name = $2 where id = $3", ["2026-10-01T00:00:00Z", "Northwind Skincare", t.businessId]);
  const { page } = await t.h.asUser(t.fixture.ownerId).run((tx) => repos.pages.publish(tx, t.businessId, { content, slug: "northwind-pd", userId: t.fixture.ownerId, at: PUBLISHED }));
  pageId = page.id;
  await awardPageLiveMilestone(t.db, t.businessId, { pageId, at: PUBLISHED });
  socialId = (await repos.channels.upsert(t.db, t.businessId, { channelKey: "social", line: CHANNEL_META.social.line, enabled: true, kitMode: false, ownerAgentId: t.fixture.agentId })).id;
}, 120_000);
afterAll(() => t?.close());

describe("the postDraft workflow", () => {
  it("is registered with its one activity", () => {
    expect(typeof workflows.postDraft).toBe("function");
    expect(typeof createActivities(t.deps).draftSharePost).toBe("function");
  });
});

describe("draftSharePost", () => {
  it("on a real project the engine does not run for social, and the post is drafted all the same", async () => {
    // Staging, nothing connected: social is the founder's to post (`by_tap`).
    expect(await socialPostedByTap(staging(), { id: t.businessId, isDemo: false })).toBe(true);
    const engine = await createChannelActivities(staging()).channelStep({ businessId: t.businessId, channelId: socialId, channelKey: "social", step: "create", weekIndex: 0, state: emptyChannelState() });
    expect(engine.stop).toBe(true);
    expect(engine.note).toMatch(/posted by the founder.*nothing planned, launched or measured/);
    const campaignsBefore = (await repos.campaigns.list(t.db, t.businessId, { limit: 200 })).items.length;
    const metricsBefore = await repos.channels.metricsSummary(t.db, t.businessId, {});

    const out = await createPostDraftActivities(staging()).draftSharePost({ businessId: t.businessId, trigger: { kind: "page_published" } });
    expect(out).toMatchObject({ outcome: "written", usage: { calls: 1, mode: "mock" } });
    const [post] = await teamPosts();
    expect(post).toMatchObject({ kind: "post", campaignId: null, approvalState: "draft", authoredByAgentId: t.fixture.agentId, contentRef: `post-draft:page_published:page_live:${pageId}`, body: "Northwind Skincare has a page now. Refillable skincare for sensitive skin." });
    // The event, through the outbox, by the agent: ids and the kind of trigger.
    const events = await drafted();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor: { kind: "agent", id: t.fixture.agentId }, payload: { assetId: post!.id, trigger: "page_published", subject: "page_live", agentId: t.fixture.agentId } });
    expect(JSON.stringify(events[0]!.payload)).not.toContain("has a page now");
    expect((await repos.events.outboxPending(t.db, t.businessId)).some((o) => o.event.type === "post.drafted")).toBe(true);
    // Nothing launched, scheduled or measured: no campaign, no launch event, no number.
    expect((await repos.campaigns.list(t.db, t.businessId, { limit: 200 })).items.length).toBe(campaignsBefore);
    expect(await repos.channels.metricsSummary(t.db, t.businessId, {})).toEqual(metricsBefore);
    expect((await repos.events.list(t.db, t.businessId, { type: "campaign.launched", limit: 50 })).items.filter((e) => (e.payload as { channelKey?: string }).channelKey === "social")).toEqual([]);
  });

  it("is safe to retry: the same trigger again writes nothing and no second event", async () => {
    expect(await createPostDraftActivities(staging()).draftSharePost({ businessId: t.businessId, trigger: { kind: "page_published" } })).toEqual({ outcome: "skipped", reason: "already_drafted" });
    expect(await teamPosts()).toHaveLength(1);
    expect(await drafted()).toHaveLength(1);
  });

  it("the first follower: drafted from the milestone, with nothing about the person", async () => {
    const acts = createPostDraftActivities(staging());
    expect(await acts.draftSharePost({ businessId: t.businessId, trigger: { kind: "first_follower" } })).toEqual({ outcome: "skipped", reason: "nothing_to_say" });
    const consentId = "5f0a0d00-0000-4000-8000-00000000c0de";
    await awardFirstFollowerMilestone(t.db, t.businessId, { consentId, at: new Date("2026-10-04T12:00:00Z") });
    expect(await acts.draftSharePost({ businessId: t.businessId, trigger: { kind: "first_follower" } })).toMatchObject({ outcome: "written" });
    const post = (await teamPosts()).find((a) => parseTeamPostRef(a.contentRef)?.trigger === "first_follower")!;
    expect(post.body).toBe("Northwind Skincare has its first follower. Refillable skincare for sensitive skin.");
    expect(JSON.stringify([post, await drafted()])).not.toContain(consentId);
  });

  it("not where a connector would publish for the team, not while the team is stopped, not for a sample business", async () => {
    await t.h.pg.query("delete from assets where business_id = $1 and content_ref like 'post-draft:%'", [t.businessId]);
    const acts = createPostDraftActivities(staging());
    const skip = async (reason: string, set: () => Promise<unknown>, unset: () => Promise<unknown>) => {
      await set();
      try {
        expect(await acts.draftSharePost({ businessId: t.businessId, trigger: { kind: "page_published" } }), reason).toEqual({ outcome: "skipped", reason });
      } finally {
        await unset();
      }
    };
    await skip("agents_stopped", () => stopBusinessAgents(t.db, t.businessId, { reason: "kill_switch" }), () => resumeBusinessAgents(t.db, t.businessId));
    const demo = (on: boolean) => t.h.pg.query("update businesses set is_demo = $1 where id = $2", [on, t.businessId]);
    await skip("sample_business", () => demo(true), () => demo(false));
    expect(await teamPosts()).toEqual([]);
    // A development or test stack simulates every channel and says social is also by tap: the path is exercised there.
    expect(await socialPostedByTap(t.deps, { id: t.businessId, isDemo: false })).toBe(true);
    expect(await createPostDraftActivities(t.deps).draftSharePost({ businessId: t.businessId, trigger: { kind: "page_published" } })).toMatchObject({ outcome: "written" });
  });
});
