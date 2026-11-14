/**
 * Posts the social agent drafts for the founder to share by tap (services/post-drafts.ts; docs/NETWORK.md F3, F7), on
 * the test stack (the mock model, no Temporal, so a draft is written in this process):
 * - when: the page goes live, a milestone is shown, the social channel is put on the board with the page already live;
 *   once per trigger; never off the board, never while the team is stopped, never for a sample business;
 * - where it lives and how the founder meets it: an asset on the Creative tab with its share draft (the link with
 *   `via`, attached by code), one quiet line on Today, gone once it is shared or set aside;
 * - what is recorded: `post.drafted` with ids only, the spend in the usage ledger, and a share as a share that was
 *   opened, never as a post;
 * - where it runs: the orchestrator's workflow when Temporal answers, and never in this process outside development
 *   and test.
 */
import { repos } from "@foundmill/db";
import { EVENTS } from "@foundmill/events";
import { TEAM_POST_WORDS, parseTeamPostRef, shareTargets, type ProjectPageContent } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { postDraftRunsInProcess, requestPostDraft, settlePostDraftRuns, type PostDraftDeps } from "../services/post-drafts";
import { createCaller } from "../router";
import { createTransactionGate } from "../services/tx-gate";
import { WORKFLOWS, createTemporalService, workflowIds, type TemporalClientLike } from "../services/temporal";
import { silentLog } from "../services/log";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "pd" });
}, 120_000);
afterAll(async () => {
  await settlePostDraftRuns();
  await hz?.close();
});
beforeEach(() => hz.limits.reset());

const page = (over: Partial<ProjectPageContent> = {}): ProjectPageContent => ({ pitch: "Candles that smell like a walk in the woods", about: "Small batches.\n\nPoured by hand in Leeds.", forWhom: "", stage: "building", showFounders: false, followForm: true, ...over });

let n = 0;
/** A committed project with an owner, a member and a viewer, and a social agent that owns the social channel (off the board). */
async function project(name: string) {
  n += 1;
  const [ownerId, memberId, viewerId] = await Promise.all(["owner", "member", "viewer"].map((r) => hz.h.createUser(`pd-${n}-${r}@test.local`)));
  const b = await repos.businesses.create(hz.db, { name: `${name} ${n}`, archetype: "b2b_saas" });
  await repos.businesses.commit(hz.db, b.id, { archetype: "b2b_saas" });
  for (const [userId, role] of [[ownerId, "owner"], [memberId, "member"], [viewerId, "viewer"]] as const) await repos.memberships.add(hz.db, b.id, { userId: userId!, role });
  const agent = await repos.agents.create(hz.db, b.id, { name: "Social Media Engine", agentType: "channel_social", layer: "worker", status: "healthy" });
  await repos.channels.upsert(hz.db, b.id, { channelKey: "social", line: "midfield", enabled: false, kitMode: false, ownerAgentId: agent.id });
  const owner = hz.caller({ userId: ownerId! });
  return { id: b.id, name: `${name} ${n}`, agentId: agent.id, ownerId: ownerId!, memberId: memberId!, viewerId: viewerId!, owner, member: hz.caller({ userId: memberId! }), viewer: hz.caller({ userId: viewerId! }) };
}
type Project = Awaited<ReturnType<typeof project>>;

const onBoard = async (b: Project) => {
  await b.owner.distribution.channels.enable({ businessId: b.id, channelKey: "social" });
  await settlePostDraftRuns();
};
const publish = async (b: Project, content: ProjectPageContent = page()) => {
  const out = await b.owner.page.publish({ businessId: b.id, content });
  await settlePostDraftRuns();
  return out;
};
const posts = async (b: Project) => (await b.owner.distribution.assets.list({ businessId: b.id })).filter((a) => parseTeamPostRef(a.contentRef));
const drafted = async (businessId: string) => (await repos.events.outboxPending(hz.db, businessId)).filter((o) => o.event.type === "post.drafted").map((o) => ({ actor: o.event.actor, payload: o.event.payload as Record<string, unknown> }));
/** An address with a post's own code as its one `via` (item 8). */
const codeLink = (address: string) => new RegExp(`^${address.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?via=s\\.[a-z2-7]{10}$`);
const pageLive = async (businessId: string) => (await repos.journeys.listMilestones(hz.db, businessId)).find((m) => (m.ref as { trophyKey?: string } | null)?.trophyKey === "page_live")!;

describe("when a draft is written", () => {
  it("the page goes live with the social channel on the board: one draft, by the social agent, with its event and its spend", async () => {
    const b = await project("Northwood");
    await onBoard(b);
    expect(await posts(b)).toEqual([]);
    const published = await publish(b);
    const [post] = await posts(b);
    const pageRow = (await repos.pages.get(hz.db, b.id))!;
    expect(post).toMatchObject({ kind: "post", campaignId: null, approvalState: "draft", authoredByAgentId: b.agentId, title: "A post about your page going live", contentRef: `post-draft:page_published:page_live:${pageRow.id}` });
    // The mock model's draft, from the project's name and the page's own line.
    expect(post!.body).toBe(`${b.name} has a page now. Candles that smell like a walk in the woods.`);
    // The link and the picture are attached by code: the page's address with the post's own code (item 8), one per
    // network and one for a copied link.
    expect(post!.sharePost).toMatchObject({ text: post!.body, link: expect.stringMatching(codeLink(published.page.url)), image: { url: `${published.page.url}/opengraph-image` } });
    for (const t of shareTargets(post!.sharePost!).filter((t) => t.kind === "tap")) {
      expect(t.shortened, t.network).toBe(false);
      expect(t.link, t.network).toMatch(codeLink(published.page.url));
      expect(t.link, t.network).not.toBe(post!.sharePost!.link);
      expect(decodeURIComponent(t.href!), t.network).not.toContain("via=p.");
    }
    // The event: ids and the kind of trigger, by the agent, never the words.
    const events = await drafted(b.id);
    expect(events).toEqual([{ actor: { kind: "agent", id: b.agentId }, payload: { assetId: post!.id, trigger: "page_published", subject: "page_live", agentId: b.agentId } }]);
    expect(JSON.stringify(events)).not.toContain("has a page now");
    // The spend is in the usage ledger like every other model call, an Estimate, booked to the agent.
    const usage = (await repos.usage.list(hz.db, b.id, {})).items.filter((u) => (u.details as { kind?: string }).kind === "post_draft");
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ agentId: b.agentId, kind: "tokens", details: { route: "projectPage", mode: "mock", label: "Estimate" } });
    // Nothing was launched or planned: no campaign, and no engine for it.
    expect((await b.owner.distribution.campaigns.list({ businessId: b.id, limit: 50 })).items).toEqual([]);
  });

  it("the channel is put on the board after the page went live: the same draft, written then; nothing before", async () => {
    const b = await project("Later");
    await publish(b);
    expect(await posts(b)).toEqual([]);
    expect(await drafted(b.id)).toEqual([]);
    await onBoard(b);
    expect(await posts(b)).toHaveLength(1);
    expect((await posts(b))[0]!.body).toContain("has a page now");
    // Off and on again, and publishing changes: the trigger already has its draft.
    await b.owner.distribution.channels.disable({ businessId: b.id, channelKey: "social" });
    await onBoard(b);
    await publish(b, page({ pitch: "Candles, poured by hand" }));
    expect(await posts(b)).toHaveLength(1);
    expect(await drafted(b.id)).toHaveLength(1);
  });

  it("off the board, with no page, or with another channel on the board: nothing is drafted and no model is asked", async () => {
    const off = await project("Off");
    await publish(off);
    await off.owner.distribution.channels.enable({ businessId: off.id, channelKey: "email_automation" });
    await settlePostDraftRuns();
    expect(await posts(off)).toEqual([]);
    const noPage = await project("No page");
    await onBoard(noPage);
    expect(await posts(noPage)).toEqual([]);
    for (const b of [off, noPage]) expect((await repos.usage.list(hz.db, b.id, {})).items.filter((u) => (u.details as { kind?: string }).kind === "post_draft")).toEqual([]);
  });

  it("while the team is stopped or the social agent is paused, nothing is drafted", async () => {
    const stopped = await project("Stopped");
    await onBoard(stopped);
    await hz.db.execute(sql`update businesses set agents_stopped_at = now(), agents_stopped_reason = 'kill_switch' where id = ${stopped.id}`);
    await publish(stopped);
    expect(await posts(stopped)).toEqual([]);
    const paused = await project("Paused");
    await onBoard(paused);
    await repos.agents.setStatus(hz.db, paused.id, paused.agentId, "paused");
    await publish(paused);
    expect(await posts(paused)).toEqual([]);
  });

  it("a sample business gets none by this path", async () => {
    const b = await project("Sample");
    await onBoard(b);
    await publish(b);
    await hz.db.execute(sql`delete from assets where business_id = ${b.id}`);
    await hz.db.execute(sql`update businesses set is_demo = true where id = ${b.id}`);
    const deps: PostDraftDeps = { db: hz.db, models: hz.deps.models, temporal: hz.deps.temporal, env: hz.deps.env, log: silentLog() };
    expect(await requestPostDraft(deps, b.id, { kind: "page_published" })).toBe("local");
    await settlePostDraftRuns();
    expect(await repos.teamPosts.waiting(hz.db, b.id)).toEqual([]);
    expect(await repos.campaigns.listAssets(hz.db, b.id, { includeArchived: true })).toEqual([]);
  });

  it("a shown milestone gets a draft with its card, once the first is no longer waiting; hiding and showing again writes nothing more", async () => {
    const b = await project("Milestone");
    await onBoard(b);
    const published = await publish(b);
    const milestone = await pageLive(b.id);
    const show = async () => {
      const out = await b.owner.journey.showMilestone({ businessId: b.id, milestoneId: milestone.id });
      await settlePostDraftRuns();
      return out;
    };
    // The page's own draft still waits: a second one about the same thing would be noise.
    await show();
    expect(await posts(b)).toHaveLength(1);
    const [first] = await posts(b);
    await b.owner.share.opened({ businessId: b.id, kind: "draft", refId: first!.id, network: "x", target: "tap" });
    await b.owner.journey.hideMilestone({ businessId: b.id, milestoneId: milestone.id });
    const shown = await show();
    const all = await posts(b);
    expect(all).toHaveLength(2);
    const card = all.find((a) => a.contentRef === `post-draft:milestone_shown:page_live:${milestone.id}`)!;
    expect(card).toMatchObject({ approvalState: "draft", title: "A post about your milestone: Page live" });
    expect(card.body).toBe(`${b.name} reached a milestone: Page live. Candles that smell like a walk in the woods.`);
    expect(card.sharePost).toMatchObject({ link: expect.stringMatching(codeLink(shown.url)), image: { url: `${shown.url}/opengraph-image` } });
    // Hidden again, its card answers not found, so the post points to the page instead.
    await b.owner.journey.hideMilestone({ businessId: b.id, milestoneId: milestone.id });
    expect((await posts(b)).find((a) => a.id === card.id)!.sharePost!.link).toMatch(codeLink(published.page.url));
    await show();
    expect(await posts(b)).toHaveLength(2);
    expect(await drafted(b.id)).toHaveLength(2);
  });
});

describe("how the founder meets it", () => {
  it("Today shows one quiet line while a post waits, for a reader of Distribution, and it goes when the post is shared", async () => {
    const b = await project("Today");
    expect((await b.owner.today.get({ businessId: b.id })).postsReady).toBeNull();
    await onBoard(b);
    await publish(b);
    const [post] = await posts(b);
    expect((await b.owner.today.get({ businessId: b.id })).postsReady).toEqual({ count: 1, assetId: post!.id });
    expect((await b.viewer.today.get({ businessId: b.id })).postsReady).toEqual({ count: 1, assetId: post!.id });
    await hz.db.execute(sql`update memberships set section_permissions = '{"distribution":"none"}'::jsonb where business_id = ${b.id} and user_id = ${b.memberId}`);
    expect((await b.member.today.get({ businessId: b.id })).postsReady).toBeNull();
    // No note, no email, no push: an offer, never a chore.
    expect((await b.owner.today.get({ businessId: b.id })).needsYou).toEqual({ items: [], total: 0 });
    expect((await repos.events.outboxPending(hz.db, b.id)).filter((o) => ["inbox.item_created", "notify.email_sent", "push.sent"].includes(o.event.type))).toEqual([]);
    expect(EVENTS["post.drafted"].narratable).toBe(false);

    // A viewer's share is recorded and changes nothing: the post is the founders' to answer.
    expect(await b.viewer.share.opened({ businessId: b.id, kind: "draft", refId: post!.id, network: "bluesky", target: "tap" })).toEqual({ recorded: true });
    expect((await b.owner.today.get({ businessId: b.id })).postsReady).not.toBeNull();
    // The owner opens a share: recorded as a share that was opened, with the post's id, and the post stops waiting.
    expect(await b.owner.share.opened({ businessId: b.id, kind: "draft", refId: post!.id, network: "x", target: "tap" })).toEqual({ recorded: true });
    expect((await b.owner.today.get({ businessId: b.id })).postsReady).toBeNull();
    const [after] = await posts(b);
    expect(after).toMatchObject({ id: post!.id, approvalState: "approved" });
    // Still there to share again on another network; nothing anywhere says it was posted.
    expect(after!.sharePost).not.toBeNull();
    const shares = (await repos.events.outboxPending(hz.db, b.id)).filter((o) => o.event.type === "share.opened").map((o) => o.event.payload);
    expect(shares).toEqual([
      { network: "bluesky", kind: "draft", refId: post!.id, target: "tap" },
      { network: "x", kind: "draft", refId: post!.id, target: "tap" },
    ]);
    const audit = (await repos.audit.list(hz.db, b.id, { limit: 100 })).items.map((a) => a.action);
    expect(audit).toContain("post.share_opened");
    expect(JSON.stringify(await repos.audit.list(hz.db, b.id, { limit: 100 }))).not.toMatch(/"posted"|post\.posted|post\.published/);
  });

  it("\"Not this one\" sets it aside: off the Creative tab, off Today, and never offered again", async () => {
    const b = await project("Dismiss");
    await onBoard(b);
    await publish(b);
    const [post] = await posts(b);
    expect(TEAM_POST_WORDS.dismiss).toBe("Not this one");
    expect(await b.owner.distribution.assets.reject({ businessId: b.id, assetId: post!.id })).toMatchObject({ approvalState: "rejected" });
    expect(await posts(b)).toEqual([]);
    expect((await b.owner.distribution.assets.list({ businessId: b.id, approvalState: "rejected" })).filter((a) => a.id === post!.id)).toEqual([]);
    expect((await b.owner.today.get({ businessId: b.id })).postsReady).toBeNull();
    // The row stays, with its audit trail; the trigger is not drafted again.
    expect(await repos.teamPosts.get(hz.db, b.id, post!.id)).toMatchObject({ approvalState: "rejected" });
    await b.owner.distribution.channels.disable({ businessId: b.id, channelKey: "social" });
    await onBoard(b);
    await publish(b, page({ about: "Small batches, poured by hand." }));
    expect(await posts(b)).toEqual([]);
    expect(await drafted(b.id)).toHaveLength(1);
  });

  it("a share names a post only when it is a team post of this business", async () => {
    const b = await project("Mine");
    const other = await project("Theirs");
    for (const p of [b, other]) {
      await onBoard(p);
      await publish(p);
    }
    const [theirs] = await posts(other);
    const refIds = async () => (await repos.events.outboxPending(hz.db, b.id)).filter((o) => o.event.type === "share.opened").map((o) => (o.event.payload as { refId: string | null }).refId);
    // Another business's post, an id that is nothing, and no id: recorded as a drafted post with no id.
    await b.owner.share.opened({ businessId: b.id, kind: "draft", refId: theirs!.id, network: "x", target: "tap" });
    await b.owner.share.opened({ businessId: b.id, kind: "draft", refId: "00000000-0000-4000-8000-00000000dead", network: "x", target: "tap" });
    await b.owner.share.opened({ businessId: b.id, kind: "draft", network: null, target: "copy" });
    expect(await refIds()).toEqual([null, null, null]);
    expect((await posts(other))[0]!.approvalState).toBe("draft");
  });
});

describe("where it runs", () => {
  it("in this process only on a development or test stack", () => {
    expect(postDraftRunsInProcess({ APP_ENV: "development" })).toBe(true);
    expect(postDraftRunsInProcess({ APP_ENV: "test" })).toBe(true);
    expect(postDraftRunsInProcess({ APP_ENV: "staging" })).toBe(false);
    expect(postDraftRunsInProcess({ APP_ENV: "production" })).toBe(false);
  });

  it("a draft asked for by a request is written even when the client closes that request first (the Board's toggle, then a reload)", async () => {
    // A request's `ctx.db` is the transaction gate's view, which starts no transaction once the client has closed the
    // request. The draft is never waited on, so it outlives the request: here the founder (or the e2e spec) reloads the
    // Board while the post is being written. The channel is saved; the post must still be.
    const b = await project("Reload");
    await publish(b);
    const closed = new AbortController();
    const models = Object.create(hz.deps.models, {
      complete: {
        value: (req: { scope?: string }) => {
          if (req.scope?.startsWith("post-draft:")) closed.abort();
          return (hz.deps.models.complete as (r: unknown) => Promise<unknown>)(req);
        },
      },
    }) as typeof hz.deps.models;
    const gate = createTransactionGate({ total: 4, perRequest: 2 });
    const request = createCaller({ ...hz.deps, models, db: gate.forRequest(hz.db, closed.signal), txGate: gate }, { userId: b.ownerId });
    await request.distribution.channels.enable({ businessId: b.id, channelKey: "social" });
    await settlePostDraftRuns();
    expect(closed.signal.aborted).toBe(true);
    expect((await repos.channels.getByKey(hz.db, b.id, "social"))!.enabled).toBe(true);
    const [post, ...more] = await posts(b);
    expect(more).toEqual([]);
    expect(post!.body).toContain("has a page now");
    expect(await drafted(b.id)).toHaveLength(1);
  });

  it("staging and production never draft on the api: when the orchestrator does not answer, nothing is written", async () => {
    const b = await project("Production");
    await repos.channels.setEnabled(hz.db, b.id, (await repos.channels.getByKey(hz.db, b.id, "social"))!.id, true);
    await publish(b);
    await hz.db.execute(sql`delete from assets where business_id = ${b.id}`);
    for (const APP_ENV of ["staging", "production"] as const) {
      const deps: PostDraftDeps = { db: hz.db, models: hz.deps.models, temporal: hz.deps.temporal, env: { ...hz.deps.env, APP_ENV }, log: silentLog() };
      expect(await requestPostDraft(deps, b.id, { kind: "page_published" })).toBe("not_started");
    }
    await settlePostDraftRuns();
    expect(await repos.campaigns.listAssets(hz.db, b.id, { includeArchived: true })).toEqual([]);
  });

  it("the orchestrator's workflow when Temporal answers: one id per business and trigger, and nothing here", async () => {
    const b = await project("Workflow");
    await repos.channels.setEnabled(hz.db, b.id, (await repos.channels.getByKey(hz.db, b.id, "social"))!.id, true);
    await publish(b);
    await hz.db.execute(sql`delete from assets where business_id = ${b.id}`);
    const started: { type: string; workflowId: string; args: unknown[] | undefined }[] = [];
    const client: TemporalClientLike = { workflow: { start: async (type, o) => void started.push({ type, workflowId: o.workflowId, args: o.args }), getHandle: () => ({ signal: async () => undefined }) } };
    const temporal = createTemporalService({ address: "127.0.0.1:1", namespace: "default", taskQueue: "test", log: silentLog(), connect: async () => client });
    const deps: PostDraftDeps = { db: hz.db, models: hz.deps.models, temporal, env: hz.deps.env, log: silentLog() };
    const milestoneId = "0b9d1c1e-1111-4222-8333-444455556666";
    expect(await requestPostDraft(deps, b.id, { kind: "page_published" })).toBe("workflow");
    expect(await requestPostDraft(deps, b.id, { kind: "milestone_shown", milestoneId })).toBe("workflow");
    await settlePostDraftRuns();
    expect(started).toEqual([
      { type: WORKFLOWS.postDraft, workflowId: `post-draft:${b.id}:page_published`, args: [{ businessId: b.id, trigger: { kind: "page_published" } }] },
      { type: "postDraft", workflowId: `post-draft:${b.id}:milestone_shown:${milestoneId}`, args: [{ businessId: b.id, trigger: { kind: "milestone_shown", milestoneId } }] },
    ]);
    expect(workflowIds.postDraft(b.id, { kind: "first_follower" })).toBe(`post-draft:${b.id}:first_follower`);
    expect(await repos.campaigns.listAssets(hz.db, b.id, { includeArchived: true })).toEqual([]);
    await temporal.close();
  });
});
