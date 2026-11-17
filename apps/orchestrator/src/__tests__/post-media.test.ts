/**
 * A post draft's media (activities/post-media.ts, workflows/postDraftMedia.ts): a short video and a voiceover on the
 * founder's own Runway and ElevenLabs accounts, for a post the social agent drafted.
 * - not connected: nothing is asked for, and the draft stays text only;
 * - outward and costly calls ask first: the gateway's `ask` leaves the row `asking` with its approval, and the same
 *   arguments are sent again once the founder said yes;
 * - a finished clip is copied through the gateway's route-only tool and kept byte for byte; a voiceover is kept as it came;
 * - a simulated answer keeps no file and is never ready;
 * - the draft's caps are untouched: media is not a draft.
 */
import { GATEWAY_TOOL_NAMES, createDefaultRegistry } from "@foundmill/connectors";
import { POST_MEDIA_TOOLS } from "@foundmill/agents";
import { CHANNEL_META, TEAM_POST_CAPS, type ProjectPageContent } from "@foundmill/shared";
import { awardPageLiveMilestone, repos } from "@foundmill/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createActivities } from "../activities";
import { createPostMediaActivities } from "../activities/post-media";
import type { GatewayCallRequest, GatewayCallResponse } from "../gateway-client";
import * as workflows from "../workflows";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
let assetId: string;
const content: ProjectPageContent = { pitch: "Bike repairs at your door, booked in a minute", about: "A van full of parts comes to the bike.", forWhom: "Cyclists in Leeds", stage: "building", showFounders: false, followForm: true };
const TASK_ID = "17f20503-6c24-4c16-946b-35dbbce2af2f";
const CLIP = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50, 9, 9]);
const AUDIO = new Uint8Array([73, 68, 51, 4, 0, 0, 0, 1, 2, 3]);

/** A gateway that answers as the real one would: ask until the founder approved, then the tool's answer. */
function fakeGateway(opts: { simulated?: boolean; ask?: boolean; clipReadyAfter?: number } = {}) {
  const calls: GatewayCallRequest[] = [];
  const approved = new Set<string>();
  let lookups = 0;
  const allow = (data: unknown): GatewayCallResponse => ({ outcome: "allow", result: { ok: true, data, untrusted: false, costMinor: 0, ...(opts.simulated ? { simulated: true } : {}) } });
  const call = async (_token: string, req: GatewayCallRequest): Promise<GatewayCallResponse> => {
    calls.push(req);
    const key = `${req.connector}:${req.tool}:${JSON.stringify(req.args)}`;
    if ((req.tool === "generate_video_from_text" || req.tool === "generate_voiceover") && opts.ask !== false && !approved.has(key)) {
      approved.add(key); // the founder says yes before the next try
      return { outcome: "ask", approvalId: crypto.randomUUID(), reasons: ["spends money"] };
    }
    if (req.tool === "generate_video_from_text") return allow({ untrusted: true, content: { taskId: TASK_ID, estimatedCredits: 60, model: "gen4.5", ratio: "720:1280", durationSeconds: 5, ...(opts.simulated ? { simulated: true } : {}) }, facts: { taskId: TASK_ID } });
    if (req.tool === "generate_voiceover") {
      const bytes = opts.simulated ? new Uint8Array([82, 73, 70, 70]) : AUDIO;
      return allow({ untrusted: true, content: { mime: opts.simulated ? "audio/wav" : "audio/mpeg", base64: Buffer.from(bytes).toString("base64"), bytes: bytes.byteLength, characters: 40, approxSeconds: 2.7, voiceId: "MockVoiceNorthwind01", model: "m", ...(opts.simulated ? { simulated: true } : {}) } });
    }
    if (req.tool === "download_video") {
      lookups++;
      if (opts.simulated) return allow({ taskId: TASK_ID, status: "SUCCEEDED", ready: false, mime: null, base64: null, bytes: 0, simulated: true });
      if (lookups < (opts.clipReadyAfter ?? 1)) return allow({ taskId: TASK_ID, status: "RUNNING", ready: false, mime: null, base64: null, bytes: 0 });
      return allow({ taskId: TASK_ID, status: "SUCCEEDED", ready: true, mime: "video/mp4", base64: Buffer.from(CLIP).toString("base64"), bytes: CLIP.byteLength });
    }
    return { outcome: "deny", reasons: ["unexpected"] };
  };
  return { calls, call };
}

const withGateway = (g: ReturnType<typeof fakeGateway>) => createPostMediaActivities({ ...t.deps, gateway: { ...t.deps.gateway, call: g.call } });
/** A waiting team post: the first through the repository, the rest as rows like it (one subject waits at a time). */
let drafts = 0;
const newDraft = async () => {
  if (drafts++ === 0) {
    const out = await repos.teamPosts.write(t.db, t.businessId, { ref: { trigger: "milestone_shown", subject: "page_live", refId: crypto.randomUUID() }, text: "Bike Fix has a page now. Bike repairs at your door, booked in a minute.", authoredByAgentId: t.fixture.agentId, caps: { perDay: 100, perWeek: 100 } });
    return out.asset!.id;
  }
  const res = await t.h.pg.query<{ id: string }>(
    "insert into assets (business_id, kind, title, content_ref, body, approval_state, authored_by_agent_id) values ($1, 'post', 'A post about your page going live', $2, $3, 'draft', $4) returning id",
    [t.businessId, `post-draft:milestone_shown:page_live:${crypto.randomUUID()}`, "Bike Fix has a page now. Bike repairs at your door, booked in a minute.", t.fixture.agentId],
  );
  return res.rows[0]!.id;
};

beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "pm" });
  await t.h.pg.query("update businesses set committed_at = $1, name = $2 where id = $3", ["2026-10-01T00:00:00Z", "Bike Fix", t.businessId]);
  const { page } = await t.h.asUser(t.fixture.ownerId).run((tx) => repos.pages.publish(tx, t.businessId, { content, slug: "bike-fix-pm", userId: t.fixture.ownerId, at: new Date("2026-10-04T09:00:00Z") }));
  await awardPageLiveMilestone(t.db, t.businessId, { pageId: page.id, at: new Date("2026-10-04T09:00:00Z") });
  await repos.channels.upsert(t.db, t.businessId, { channelKey: "social", line: CHANNEL_META.social.line, enabled: true, kitMode: false, ownerAgentId: t.fixture.agentId });
  assetId = await newDraft();
}, 120_000);
afterAll(() => t?.close());

describe("the postDraftMedia workflow", () => {
  it("is registered, with tools that exist on the connectors and that ask first", () => {
    expect(typeof workflows.postDraftMedia).toBe("function");
    expect(workflows.POST_DRAFT_MEDIA_PATCH).toBe("post-draft-media");
    for (const name of ["planPostMedia", "startPostMedia", "checkPostVideo", "setAsidePostMedia", "giveUpPostVideo"] as const) expect(typeof createActivities(t.deps)[name]).toBe("function");
    for (const tool of Object.values(POST_MEDIA_TOOLS)) expect(GATEWAY_TOOL_NAMES[tool.connector], `${tool.connector}:${tool.tool}`).toContain(tool.tool);
    const registry = createDefaultRegistry();
    expect(registry.get("runway", "mock").policyHints.generate_video_from_text).toEqual({ irreversible: true, spendsMoney: true });
    expect(registry.get("elevenlabs_voice", "mock").policyHints.generate_voiceover).toEqual({ irreversible: true, spendsMoney: true });
  });
});

describe("a post draft's media", () => {
  beforeEach(async () => {
    await t.h.pg.query("delete from integrations where business_id = $1 and connector_key in ('runway', 'elevenlabs_voice')", [t.businessId]);
  });
  const connect = async (...keys: ("runway" | "elevenlabs_voice")[]) => {
    for (const connectorKey of keys) await repos.integrations.upsert(t.db, t.businessId, { connectorKey, status: "connected", authKind: "api_key", accountLabel: connectorKey });
  };

  it("not connected: nothing is asked for, nothing reaches the gateway, and the draft stays text only", async () => {
    const g = fakeGateway();
    expect(await withGateway(g).planPostMedia({ businessId: t.businessId, assetId })).toEqual({ kinds: [] });
    // ElevenLabs alone is not enough: a voiceover is the video's.
    await connect("elevenlabs_voice");
    expect(await withGateway(g).planPostMedia({ businessId: t.businessId, assetId })).toEqual({ kinds: [] });
    expect(g.calls).toHaveLength(0);
    expect(await repos.postMedia.forAssets(t.db, t.businessId, [assetId])).toEqual([]);
  });

  it("asks first, then makes the clip once approved, copies it through the gateway and keeps it byte for byte", async () => {
    await connect("runway", "elevenlabs_voice");
    const g = fakeGateway({ clipReadyAfter: 2 });
    const acts = withGateway(g);
    expect(await acts.planPostMedia({ businessId: t.businessId, assetId })).toEqual({ kinds: ["video", "voiceover"] });

    const asked = await acts.startPostMedia({ businessId: t.businessId, assetId, kind: "video" });
    expect(asked).toMatchObject({ status: "asking" });
    if (asked.status !== "asking") throw new Error("expected asking");
    const row = await repos.postMedia.get(t.db, t.businessId, asked.mediaId);
    expect(row).toMatchObject({ state: "asking", approvalId: asked.approvalId, connectorKey: "runway", simulated: false });
    // The clip is described from the page's own pitch, vertical, five seconds.
    expect(g.calls[0]).toMatchObject({ connector: "runway", tool: "generate_video_from_text", args: { ratio: "720:1280", durationSeconds: 5 } });
    expect(String(g.calls[0]!.args.prompt)).toContain("Bike repairs at your door, booked in a minute");

    const making = await acts.startPostMedia({ businessId: t.businessId, assetId, kind: "video", args: asked.args });
    expect(making).toEqual({ status: "making", mediaId: asked.mediaId, taskId: TASK_ID });
    expect(g.calls[1]!.args).toEqual(g.calls[0]!.args);
    expect(await acts.checkPostVideo({ businessId: t.businessId, mediaId: asked.mediaId })).toEqual({ status: "waiting" });
    expect(await acts.checkPostVideo({ businessId: t.businessId, mediaId: asked.mediaId })).toEqual({ status: "done", state: "ready" });
    expect(g.calls.filter((c) => c.tool === "download_video").every((c) => c.args.taskId === TASK_ID)).toBe(true);
    const kept = await repos.postMedia.content(t.db, t.businessId, asked.mediaId);
    expect(new Uint8Array(kept!.content)).toEqual(CLIP);
    expect(kept!.row).toMatchObject({ state: "ready", mime: "video/mp4", sizeBytes: CLIP.byteLength, durationSeconds: 5 });

    // The voiceover speaks the draft's own words, asks first too, and is kept as it came.
    const voiceAsked = await acts.startPostMedia({ businessId: t.businessId, assetId, kind: "voiceover" });
    expect(voiceAsked.status).toBe("asking");
    expect(g.calls.at(-1)!.args).toEqual({ text: "Bike Fix has a page now. Bike repairs at your door, booked in a minute." });
    const voice = await acts.startPostMedia({ businessId: t.businessId, assetId, kind: "voiceover", ...(voiceAsked.status === "asking" ? { args: voiceAsked.args } : {}) });
    expect(voice).toMatchObject({ status: "done", state: "ready" });
    if (voice.status !== "done") throw new Error("expected done");
    expect(new Uint8Array((await repos.postMedia.content(t.db, t.businessId, voice.mediaId))!.content)).toEqual(AUDIO);

    // Nothing more to ask for, and a second start is a no-op.
    expect(await acts.planPostMedia({ businessId: t.businessId, assetId })).toEqual({ kinds: [] });
    expect(await acts.startPostMedia({ businessId: t.businessId, assetId, kind: "video" })).toEqual({ status: "done", mediaId: asked.mediaId, state: "ready" });
  });

  it("a simulated answer keeps no file and is never ready, for the clip and the voiceover", async () => {
    await connect("runway", "elevenlabs_voice");
    const draft = await newDraft();
    const g = fakeGateway({ simulated: true, ask: false });
    const acts = withGateway(g);
    const video = await acts.startPostMedia({ businessId: t.businessId, assetId: draft, kind: "video" });
    const voice = await acts.startPostMedia({ businessId: t.businessId, assetId: draft, kind: "voiceover" });
    expect(video).toMatchObject({ status: "done", state: "simulated" });
    expect(voice).toMatchObject({ status: "done", state: "simulated" });
    for (const row of await repos.postMedia.forAssets(t.db, t.businessId, [draft])) {
      expect(row).toMatchObject({ state: "simulated", simulated: true, sizeBytes: null, sha256: null });
      expect(await repos.postMedia.content(t.db, t.businessId, row.id)).toBeNull();
    }
  });

  it("a permanent copy failure ends after one download; only 429 and 5xx are looked up again", async () => {
    await connect("runway");
    /** Runs the workflow's lookups (at most 60) with a copy that always fails with `error`; returns how many were made. */
    const lookupsUntilDone = async (error: { code: string; status: number; retryable?: boolean }) => {
      const draft = await newDraft();
      const g = fakeGateway({ ask: false });
      const acts = withGateway({
        ...g,
        call: async (token, req) => (req.tool === "download_video" ? (g.calls.push(req), { outcome: "allow", result: { ok: false, error: { message: "x", ...error }, untrusted: false, costMinor: 0 } }) : g.call(token, req)),
      });
      const started = await acts.startPostMedia({ businessId: t.businessId, assetId: draft, kind: "video" });
      if (started.status !== "making") throw new Error(`expected making, got ${started.status}`);
      let last = { status: "waiting" } as Awaited<ReturnType<typeof acts.checkPostVideo>>;
      for (let i = 0; i < 60 && last.status === "waiting"; i++) last = await acts.checkPostVideo({ businessId: t.businessId, mediaId: started.mediaId });
      return { downloads: g.calls.filter((c) => c.tool === "download_video").length, last, row: await repos.postMedia.get(t.db, t.businessId, started.mediaId) };
    };
    for (const error of [
      { code: "clip_too_large", status: 413 },
      { code: "clip_host_not_allowed", status: 502 },
      { code: "clip_not_video", status: 415 },
      { code: "clip_redirected", status: 502 },
      { code: "invalid_url", status: 502 },
      { code: "blocked_address", status: 400 },
    ]) {
      const out = await lookupsUntilDone(error);
      expect(out.downloads, error.code).toBe(1);
      expect(out.last).toEqual({ status: "done", state: "failed" });
      expect(out.row).toMatchObject({ state: "failed", errorCode: error.code });
    }
    for (const error of [{ code: "rate_limited", status: 429, retryable: true }, { code: "vendor_error", status: 504, retryable: true }, { code: "vendor_error", status: 503, retryable: true }]) {
      const out = await lookupsUntilDone(error);
      expect(out.downloads, `${error.status}`).toBe(60);
      expect(out.last).toEqual({ status: "waiting" });
      expect(out.row?.state).toBe("making");
    }
  });

  it("a voiceover whose bytes are not audio is not kept, whatever type it was labeled", async () => {
    await connect("runway", "elevenlabs_voice");
    const draft = await newDraft();
    const g = fakeGateway({ ask: false });
    const page = new TextEncoder().encode("<html><script>x</script></html>");
    const acts = withGateway({
      ...g,
      call: async (token, req) =>
        req.tool === "generate_voiceover"
          ? { outcome: "allow", result: { ok: true, untrusted: true, costMinor: 0, data: { untrusted: true, content: { mime: "audio/mpeg", base64: Buffer.from(page).toString("base64"), bytes: page.byteLength, characters: 40, approxSeconds: 2.7, voiceId: "MockVoiceNorthwind01", model: "m" } } } }
          : g.call(token, req),
    });
    const voice = await acts.startPostMedia({ businessId: t.businessId, assetId: draft, kind: "voiceover" });
    expect(voice).toMatchObject({ status: "done", state: "failed" });
    if (voice.status !== "done") throw new Error("expected done");
    expect(await repos.postMedia.get(t.db, t.businessId, voice.mediaId)).toMatchObject({ state: "failed", errorCode: "not_media", sizeBytes: null });
    expect(await repos.postMedia.content(t.db, t.businessId, voice.mediaId)).toBeNull();
  });

  it("a declined OK sets the media aside; the post itself is untouched", async () => {
    await connect("runway");
    const draft = await newDraft();
    const acts = withGateway(fakeGateway());
    const asked = await acts.startPostMedia({ businessId: t.businessId, assetId: draft, kind: "video" });
    if (asked.status !== "asking") throw new Error("expected asking");
    await acts.setAsidePostMedia({ businessId: t.businessId, mediaId: asked.mediaId, outcome: "rejected" });
    expect(await repos.postMedia.get(t.db, t.businessId, asked.mediaId)).toMatchObject({ state: "declined" });
    expect(await repos.teamPosts.get(t.db, t.businessId, draft)).toMatchObject({ approvalState: "draft" });
  });

  it("is not a draft: the caps count drafts only, and a set-aside draft gets no media", async () => {
    await connect("runway", "elevenlabs_voice");
    const before = await repos.teamPosts.sources(t.db, t.businessId, { kind: "page_published" });
    await withGateway(fakeGateway()).startPostMedia({ businessId: t.businessId, assetId: await newDraft(), kind: "video" });
    const after = await repos.teamPosts.sources(t.db, t.businessId, { kind: "page_published" });
    expect(after!.inLastDay).toBe(before!.inLastDay + 1); // the new draft, not its media
    expect(TEAM_POST_CAPS).toEqual({ perDay: 2, perWeek: 5 });
    const aside = await newDraft();
    await repos.teamPosts.dismiss(t.db, t.businessId, aside);
    expect(await withGateway(fakeGateway()).planPostMedia({ businessId: t.businessId, assetId: aside })).toEqual({ kinds: [] });
  });
});
