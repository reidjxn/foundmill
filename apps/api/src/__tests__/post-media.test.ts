/**
 * A post draft's media at the api (services/post-media.ts): what the Creative tab and the share panel get beside a
 * post the team drafted, and the file at its signed address.
 * - not connected: the draft is text only and says the video tools are not connected;
 * - a ready, real item round-trips: listed with a same-origin address, served byte for byte at it;
 * - a simulated item is labeled and has no address, and its file can never be fetched;
 * - a link is good for one item of one business, and not past its hour.
 */
import { repos } from "@foundmill/db";
import { PostDraftMedia as PostDraftMediaSchema, parseTeamPostRef, postMediaPostable, type PostDraft, type ProjectPageContent } from "@foundmill/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { settlePostDraftRuns } from "../services/post-drafts";
import { POST_MEDIA_LINK_TTL_SECONDS, POST_MEDIA_PATH, postMediaLinkKey, signPostMediaLink, verifyPostMediaLink } from "../services/post-media";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "pmd" });
}, 120_000);
afterAll(async () => {
  await settlePostDraftRuns();
  await hz?.close();
});
beforeEach(() => hz.limits.reset());

const content: ProjectPageContent = { pitch: "Candles that smell like a walk in the woods", about: "Small batches.", forWhom: "", stage: "building", showFounders: false, followForm: true };
const CLIP = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]);

async function project(name: string) {
  const [ownerId, viewerId] = await Promise.all(["owner", "viewer"].map((r) => hz.h.createUser(`pmd-${name}-${r}@test.local`)));
  const b = await repos.businesses.create(hz.db, { name, archetype: "b2b_saas" });
  await repos.businesses.commit(hz.db, b.id, { archetype: "b2b_saas" });
  for (const [userId, role] of [[ownerId, "owner"], [viewerId, "viewer"]] as const) await repos.memberships.add(hz.db, b.id, { userId: userId!, role });
  const agent = await repos.agents.create(hz.db, b.id, { name: "Social Media Engine", agentType: "channel_social", layer: "worker", status: "healthy" });
  await repos.channels.upsert(hz.db, b.id, { channelKey: "social", line: "midfield", enabled: false, kitMode: false, ownerAgentId: agent.id });
  const owner = hz.caller({ userId: ownerId! });
  await owner.distribution.channels.enable({ businessId: b.id, channelKey: "social" });
  await owner.page.publish({ businessId: b.id, content });
  await settlePostDraftRuns();
  const viewer = hz.caller({ userId: viewerId! });
  const list = async () => (await viewer.distribution.assets.list({ businessId: b.id })).filter((a) => parseTeamPostRef(a.contentRef));
  const [post] = await list();
  return { id: b.id, owner, viewer, list, postId: post!.id };
}

/** The share draft, its media held to the schema a publisher will read (the test stack's own address is http, so the link is not). */
const shareOf = async (b: Awaited<ReturnType<typeof project>>): Promise<PostDraft> => {
  const [post] = await b.list();
  const share = post!.sharePost as PostDraft;
  return { ...share, ...(share.media ? { media: PostDraftMediaSchema.parse(share.media) } : {}) };
};

describe("a post draft's media at the api", () => {
  it("not connected: the draft is text only and says the video tools are not connected", async () => {
    const b = await project("Woodwick One");
    const share = await shareOf(b);
    expect(share.media).toEqual({ videoTools: "not_connected", voiceTools: "not_connected" });
    expect(share.media?.video).toBeUndefined();
  });

  it("a ready, real video round-trips: listed with a same-origin address and served byte for byte", async () => {
    const b = await project("Woodwick Two");
    await repos.integrations.upsert(hz.db, b.id, { connectorKey: "runway", status: "connected", authKind: "api_key", accountLabel: "Runway" });
    const { row } = await repos.postMedia.open(hz.db, b.id, { assetId: b.postId, kind: "video", connectorKey: "runway" });
    await repos.postMedia.store(hz.db, b.id, row.id, { content: CLIP, mime: "video/mp4", durationSeconds: 5 });
    const share = await shareOf(b);
    expect(share.media).toMatchObject({ videoTools: "connected", voiceTools: "not_connected", video: { kind: "video", state: "ready", simulated: false, mime: "video/mp4", bytes: CLIP.byteLength, durationSeconds: 5, fileName: "woodwick-two-video.mp4" } });
    expect(postMediaPostable(share.media!.video)).toBe(true);
    const url = share.media!.video!.url!;
    expect(url.startsWith(POST_MEDIA_PATH)).toBe(true);

    const app = createApp(hz.deps);
    const res = await app.request(`/post-media/${url.slice(POST_MEDIA_PATH.length)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("cache-control")).toMatch(/^private/);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(CLIP);
  });

  it("a simulated video is labeled, has no address, and its row's file can never be fetched", async () => {
    const b = await project("Woodwick Three");
    await repos.integrations.upsert(hz.db, b.id, { connectorKey: "runway", status: "mock", authKind: "api_key", accountLabel: "Runway (mock)" });
    const { row } = await repos.postMedia.open(hz.db, b.id, { assetId: b.postId, kind: "video", connectorKey: "runway" });
    await repos.postMedia.markSimulated(hz.db, b.id, row.id, { durationSeconds: 5 });
    const share = await shareOf(b);
    expect(share.media?.video).toMatchObject({ state: "simulated", simulated: true, mime: null, bytes: null });
    expect(share.media?.video?.url).toBeUndefined();
    expect(postMediaPostable(share.media?.video)).toBe(false);
    // Even a correctly signed link to it finds nothing.
    const key = postMediaLinkKey(hz.deps.env)!;
    const res = await createApp(hz.deps).request(`/post-media/${signPostMediaLink(key, { businessId: b.id, mediaId: row.id })}`);
    expect(res.status).toBe(404);
  });

  it("a collaborator sees the video tools as connected when a founder has connected Runway, and is told nothing else of the integration", async () => {
    const b = await project("Woodwick Four");
    const collaboratorId = await hz.h.createUser("pmd-woodwick-four-collaborator@test.local");
    await repos.memberships.add(hz.db, b.id, { userId: collaboratorId, role: "collaborator" });
    const collaborator = hz.caller({ userId: collaboratorId });
    // A founder connected Runway on their own key: the row holds an account name and settings a collaborator may not read (0094).
    const runway = await repos.integrations.upsert(hz.db, b.id, { connectorKey: "runway", status: "connected", authKind: "api_key", accountLabel: "Maya's Runway account", settings: { workspace: "maya-studio" } });
    // Their RLS still reads no integration rows: the rule stays as it is.
    const own = await collaborator.integrations.list({ businessId: b.id }).catch(() => null);
    expect(own?.integrations ?? []).toEqual([]);
    const assets = await collaborator.distribution.assets.list({ businessId: b.id });
    const post = assets.find((a) => a.id === b.postId)!;
    const media = (post.sharePost as PostDraft).media!;
    expect(media).toEqual({ videoTools: "connected", voiceTools: "not_connected" });
    expect(Object.keys(media).sort()).toEqual(["videoTools", "voiceTools"]);
    // Nothing of the integration rides anywhere in what the collaborator gets.
    const seen = JSON.stringify(assets);
    for (const leak of [runway.id, "Maya's Runway account", "maya-studio", "api_key", "accountLabel", "connectorKey"]) expect(seen).not.toContain(leak);
  });

  it("the founders' view is unchanged: the owner sees the same status", async () => {
    const b = await project("Woodwick Five");
    await repos.integrations.upsert(hz.db, b.id, { connectorKey: "runway", status: "connected", authKind: "api_key", accountLabel: "Runway" });
    await repos.integrations.upsert(hz.db, b.id, { connectorKey: "elevenlabs_voice", status: "connected", authKind: "api_key", accountLabel: "ElevenLabs" });
    const [post] = (await b.owner.distribution.assets.list({ businessId: b.id })).filter((a) => a.id === b.postId);
    expect((post!.sharePost as PostDraft).media).toEqual({ videoTools: "connected", voiceTools: "connected" });
    // An archived or disconnected integration is not connected, for every role.
    await repos.integrations.upsert(hz.db, b.id, { connectorKey: "elevenlabs_voice", status: "disconnected", authKind: "api_key", accountLabel: "ElevenLabs" });
    const [again] = (await b.viewer.distribution.assets.list({ businessId: b.id })).filter((a) => a.id === b.postId);
    expect((again!.sharePost as PostDraft).media).toEqual({ videoTools: "connected", voiceTools: "not_connected" });
  });

  it("a link names one item of one business, is refused when forged, and expires within the hour", async () => {
    const key = postMediaLinkKey(hz.deps.env)!;
    const item = { businessId: crypto.randomUUID(), mediaId: crypto.randomUUID() };
    const now = new Date("2026-11-13T12:00:00Z");
    const token = signPostMediaLink(key, item, now);
    expect(verifyPostMediaLink(key, token, now)).toEqual(item);
    expect(verifyPostMediaLink(key, token, new Date(now.getTime() + (POST_MEDIA_LINK_TTL_SECONDS + 1) * 1000))).toBeNull();
    expect(verifyPostMediaLink("another-secret-of-enough-length", token, now)).toBeNull();
    const [body, sig] = token.split(".");
    const other = Buffer.from(JSON.stringify({ b: item.businessId, m: crypto.randomUUID(), exp: 9_999_999_999 })).toString("base64url");
    expect(verifyPostMediaLink(key, `${other}.${sig}`, now)).toBeNull();
    expect(verifyPostMediaLink(key, `${body}.`, now)).toBeNull();
    expect(verifyPostMediaLink(null, token, now)).toBeNull();
    expect(postMediaLinkKey({ APP_ENV: "production", SESSION_TOKEN_SECRET: undefined })).toBeNull();
    expect((await createApp(hz.deps).request("/post-media/not-a-token")).status).toBe(404);
  });
});
