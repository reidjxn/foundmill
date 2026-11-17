/**
 * A post draft's media (the "ready-to-post kit"; packages/shared `post-media.ts`, packages/agents `post-media.ts`;
 * founder, 2026-11-13): after the social agent drafted a post, a short vertical video on the founder's own Runway
 * account and, with it, a voiceover on their own ElevenLabs account. The `postDraftMedia` workflow runs these steps.
 *
 * - **Only on the founder's own key.** Nothing is asked for unless the business connected Runway (`postMediaTools`).
 *   Not connected means the draft stays text only and the share panel says so; there is never a key of Foundmill's own.
 * - **Ask first.** Every call goes through the gateway as the social channel's agent, on a token outside any session.
 *   Starting a clip or a voiceover is `irreversible` and `spendsMoney`, so in augmented and assisted mode the gateway
 *   asks the founder (Needs you) and `startPostMedia` answers `asking`; the workflow waits in `approval:<id>`, and the
 *   call is made again with the same arguments once the founder said yes (the gateway runs it once under that approval).
 * - **Simulated is never real.** A mock connector's answer makes the row `simulated`: no file is kept, nothing can be
 *   previewed or posted, and every word about it says it was simulated.
 * - **Kept, not linked.** Runway's address for a finished clip expires within a day or two and a voiceover arrives
 *   inline, so both are copied into the project's own storage (packages/db `post_media`, with its per-file and
 *   per-project limits). The clip is fetched by the gateway (`runway:download_video`, route-only), never from here.
 * - **Two files.** The video and the voiceover stay two files: no tested media worker can join them yet.
 *
 * Nothing here publishes, schedules or measures anything. A step that cannot go on records why (a code) and stops; the
 * post itself is untouched.
 */
import { postMediaPlan, postMediaTools, postVideoArgs, postVoiceoverArgs, POST_MEDIA_CONNECTORS, POST_MEDIA_TOOLS } from "@foundmill/agents";
import { repos, type PostMediaRow } from "@foundmill/db";
import { isTeamPost, mockResultsAllowed, readPageContent, type PostMediaKind } from "@foundmill/shared";
import type { OrchestratorDeps } from "../deps";
import type { GatewayCallResponse } from "../gateway-client";

export interface PostMediaInput {
  businessId: string;
  /** The draft (an `assets` row, kind `post`). */
  assetId: string;
}

export interface PostMediaStepInput extends PostMediaInput {
  kind: PostMediaKind;
  /**
   * The arguments the first try sent, handed back once the founder said yes: the approval covers exactly those, so a
   * page edited while the founder thought it over does not make the gateway ask a second time.
   */
  args?: Record<string, unknown>;
}

export type PostMediaStep =
  | { status: "skipped"; reason: string }
  | { status: "asking"; mediaId: string; approvalId: string; args: Record<string, unknown> }
  | { status: "making"; mediaId: string; taskId: string }
  | { status: "done"; mediaId: string; state: string };

/** How a finished step ended, for the workflow's result and the log. */
export type PostVideoCheck = { status: "waiting" } | { status: "done"; state: string };

const FINAL = new Set(["ready", "simulated", "declined", "failed"]);
const TOKEN_TTL_SECONDS = 300;

/** A gateway answer's envelope, as the tools' results arrive. */
interface ResultEnvelope {
  ok?: boolean;
  data?: unknown;
  simulated?: boolean;
  error?: { code?: string; status?: number; retryable?: boolean };
}

/**
 * Whether a failed clip copy may be tried again at the next lookup: only Runway being busy (429) or its storage timing
 * out or failing (5xx, which the connector marks retryable). Everything else is permanent: a clip too large, an address
 * off Runway's storage, a redirect, an answer that is not a video. Trying those again would download up to ~32 MB per
 * lookup for nothing.
 */
export function clipCopyMayRetry(error: ResultEnvelope["error"]): boolean {
  if (!error) return false;
  if (error.code === "rate_limited" || error.status === 429) return true;
  return error.retryable === true && typeof error.status === "number" && error.status >= 500;
}

/** A failed copy's error as the row keeps it: a short code, never vendor text. */
const errorCodeOf = (error: ResultEnvelope["error"]): string => {
  const code = typeof error?.code === "string" ? error.code.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40) : "";
  return /^[a-z]/.test(code) ? code : "copy_failed";
};
const envelopeOf = (res: GatewayCallResponse): ResultEnvelope => (res.result && typeof res.result === "object" ? (res.result as ResultEnvelope) : {});
const record = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
/** The tool's own output: inside the untrusted envelope (`content`), or as it came. */
const contentOf = (data: unknown): Record<string, unknown> => {
  const d = record(data);
  return d.untrusted === true ? record(d.content) : d;
};
const isSimulated = (env: ResultEnvelope, content: Record<string, unknown>): boolean => env.simulated === true || content.simulated === true;
const TASK_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createPostMediaActivities(deps: OrchestratorDeps) {
  const log = deps.log;

  /** The draft, its business and the agent that wrote it, or why there is nothing to do. */
  async function load(input: PostMediaInput) {
    const [asset, business] = await Promise.all([repos.teamPosts.get(deps.db, input.businessId, input.assetId), repos.businesses.get(deps.db, input.businessId).catch(() => null)]);
    if (!asset || !business) return { skip: "no_draft" as const };
    if (business.agentsStoppedAt || business.archivedAt) return { skip: "agents_stopped" as const };
    return { asset, business, agentId: asset.authoredByAgentId };
  }

  async function tools(businessId: string, isDemo: boolean) {
    const integrations = await repos.integrations.list(deps.db, businessId).catch(() => []);
    return postMediaTools(integrations, { mockAllowed: mockResultsAllowed(deps.env.APP_ENV, isDemo) });
  }

  async function call(businessId: string, agentId: string, connector: string, tool: string, args: Record<string, unknown>): Promise<GatewayCallResponse> {
    const minted = await deps.gateway.mintSessionToken({ businessId, agentId, sessionId: null, allowedTools: [`${connector}:${tool}`], ttlSeconds: TOKEN_TTL_SECONDS });
    return deps.gateway.call(minted.token, { connector, tool, args }, { timeoutMs: 120_000 });
  }

  const fail = async (businessId: string, row: PostMediaRow, errorCode: string): Promise<PostMediaStep> => {
    await repos.postMedia.update(deps.db, businessId, row.id, { state: "failed", errorCode });
    log.info({ businessId, mediaId: row.id, kind: row.kind, errorCode }, "post media: not made");
    return { status: "done", mediaId: row.id, state: "failed" };
  };

  /** Stores a finished file, or records why it could not be (too large, the project's storage full). */
  async function keep(businessId: string, row: PostMediaRow, bytes: Uint8Array, mime: "video/mp4" | "audio/mpeg" | "audio/wav", durationSeconds: number | null): Promise<PostMediaStep> {
    const stored = await repos.postMedia.store(deps.db, businessId, row.id, { content: bytes, mime, durationSeconds });
    if (!stored.stored) {
      log.info({ businessId, mediaId: row.id, kind: row.kind, reason: stored.reason }, "post media: not kept");
      return { status: "done", mediaId: row.id, state: stored.reason === "simulated" ? "simulated" : "failed" };
    }
    log.info({ businessId, mediaId: row.id, kind: row.kind, bytes: bytes.byteLength }, "post media: kept");
    return { status: "done", mediaId: row.id, state: "ready" };
  }

  return {
    /** What to ask for this draft: a video when Runway is connected on the founder's own key, and a voiceover with it. */
    async planPostMedia(input: PostMediaInput): Promise<{ kinds: PostMediaKind[] }> {
      const loaded = await load(input);
      if ("skip" in loaded) return { kinds: [] };
      const { asset, business } = loaded;
      if (business.isDemo || !loaded.agentId) return { kinds: [] };
      const existing = (await repos.postMedia.forAssets(deps.db, input.businessId, [asset.id])).map((r) => r.kind as PostMediaKind);
      const kinds = postMediaPlan({ isTeamPost: isTeamPost(asset), hasText: !!asset.body?.trim(), waiting: asset.approvalState === "draft" && !asset.archivedAt }, await tools(input.businessId, business.isDemo), existing);
      log.info({ businessId: input.businessId, assetId: asset.id, kinds }, "post media: plan");
      return { kinds };
    },

    /**
     * Starts one kind: the clip or the voiceover, through the gateway. Answers `asking` while the founder's OK is
     * needed (call it again once they said yes: the same arguments run once under that approval), `making` once a clip
     * was started, and `done` when the row is final (a voiceover arrives whole, a simulated answer makes nothing).
     */
    async startPostMedia(input: PostMediaStepInput): Promise<PostMediaStep> {
      const loaded = await load(input);
      if ("skip" in loaded) return { status: "skipped", reason: String(loaded.skip) };
      const { asset, business, agentId } = loaded;
      if (!agentId || !asset.body?.trim()) return { status: "skipped", reason: "no_author" };
      const { row } = await repos.postMedia.open(deps.db, input.businessId, { assetId: asset.id, kind: input.kind, connectorKey: POST_MEDIA_CONNECTORS[input.kind] });
      if (FINAL.has(row.state)) return { status: "done", mediaId: row.id, state: row.state };
      if (row.state === "making" && row.vendorRef) return { status: "making", mediaId: row.id, taskId: row.vendorRef };
      // Still connected on the founder's own key, now that the founder may have answered days later.
      const connected = await tools(input.businessId, business.isDemo);
      if (!(input.kind === "video" ? connected.video : connected.voice)) return fail(input.businessId, row, "not_connected");

      let args: Record<string, unknown>;
      if (input.args) {
        args = input.args;
      } else if (input.kind === "video") {
        const page = await repos.pages.get(deps.db, input.businessId);
        const published = page?.published ? readPageContent(page.published) : null;
        if (!published) return fail(input.businessId, row, "page_not_live");
        args = postVideoArgs({ projectName: business.name, pitch: published.pitch, forWhom: published.forWhom });
      } else {
        args = postVoiceoverArgs(asset.body);
      }
      const t = input.kind === "video" ? POST_MEDIA_TOOLS.video : POST_MEDIA_TOOLS.voiceover;
      const res = await call(input.businessId, agentId, t.connector, t.tool, args);
      if (res.outcome === "ask") {
        if (!res.approvalId) return fail(input.businessId, row, "no_approval");
        // Asked again after the founder said yes would only ask again: the wait already ended.
        if (row.approvalId && row.approvalId !== res.approvalId) {
          const before = await repos.approvals.get(deps.db, input.businessId, row.approvalId).catch(() => null);
          if (before?.outcome === "approved") return fail(input.businessId, row, "asked_again");
        }
        await repos.postMedia.update(deps.db, input.businessId, row.id, { state: "asking", approvalId: res.approvalId });
        return { status: "asking", mediaId: row.id, approvalId: res.approvalId, args };
      }
      if (res.outcome !== "allow") return fail(input.businessId, row, res.outcome === "rate_limited" ? "rate_limited" : "refused");
      const env = envelopeOf(res);
      if (env.ok === false) return fail(input.businessId, row, "vendor_error");
      const content = contentOf(env.data);

      if (input.kind === "video") {
        // The task id: from the content, or from the typed facts when a reader stood in for the content.
        const facts = record(record(env.data).facts);
        const taskId = [content.taskId, facts.taskId].find((v): v is string => typeof v === "string" && TASK_ID_RE.test(v));
        const seconds = typeof args.durationSeconds === "number" ? args.durationSeconds : null;
        if (isSimulated(env, content)) {
          await repos.postMedia.markSimulated(deps.db, input.businessId, row.id, { durationSeconds: seconds });
          log.info({ businessId: input.businessId, mediaId: row.id }, "post media: simulated, no video made");
          return { status: "done", mediaId: row.id, state: "simulated" };
        }
        if (!taskId) return fail(input.businessId, row, "no_task");
        await repos.postMedia.update(deps.db, input.businessId, row.id, { state: "making", vendorRef: taskId.toLowerCase(), durationSeconds: seconds });
        return { status: "making", mediaId: row.id, taskId: taskId.toLowerCase() };
      }

      const seconds = typeof content.approxSeconds === "number" ? content.approxSeconds : null;
      if (isSimulated(env, content)) {
        await repos.postMedia.markSimulated(deps.db, input.businessId, row.id, { durationSeconds: seconds });
        log.info({ businessId: input.businessId, mediaId: row.id }, "post media: simulated, no voiceover made");
        return { status: "done", mediaId: row.id, state: "simulated" };
      }
      const mime = content.mime === "audio/mpeg" || content.mime === "audio/wav" ? content.mime : null;
      if (!mime || typeof content.base64 !== "string" || !content.base64) return fail(input.businessId, row, "no_audio");
      return keep(input.businessId, row, new Uint8Array(Buffer.from(content.base64, "base64")), mime, seconds);
    },

    /** Looks a clip up once: copies it into the project's storage when it is finished, records a failure when it failed. */
    async checkPostVideo(input: { businessId: string; mediaId: string }): Promise<PostVideoCheck> {
      const row = await repos.postMedia.get(deps.db, input.businessId, input.mediaId);
      if (!row || FINAL.has(row.state)) return { status: "done", state: row?.state ?? "failed" };
      const asset = await repos.teamPosts.get(deps.db, input.businessId, row.assetId);
      if (!asset?.authoredByAgentId || !row.vendorRef) {
        await fail(input.businessId, row, "no_task");
        return { status: "done", state: "failed" };
      }
      const t = POST_MEDIA_TOOLS.videoCopy;
      const res = await call(input.businessId, asset.authoredByAgentId, t.connector, t.tool, { taskId: row.vendorRef });
      if (res.outcome === "rate_limited") return { status: "waiting" };
      if (res.outcome !== "allow") {
        await fail(input.businessId, row, "refused");
        return { status: "done", state: "failed" };
      }
      const env = envelopeOf(res);
      const out = contentOf(env.data);
      if (env.ok === false) {
        if (clipCopyMayRetry(env.error)) return { status: "waiting" };
        await fail(input.businessId, row, errorCodeOf(env.error));
        return { status: "done", state: "failed" };
      }
      if (isSimulated(env, out)) {
        await repos.postMedia.markSimulated(deps.db, input.businessId, row.id);
        return { status: "done", state: "simulated" };
      }
      if (out.ready !== true) {
        if (out.status === "FAILED" || out.status === "CANCELLED") {
          await fail(input.businessId, row, out.status === "FAILED" ? "vendor_failed" : "vendor_canceled");
          return { status: "done", state: "failed" };
        }
        return { status: "waiting" };
      }
      if (typeof out.base64 !== "string" || !out.base64) {
        await fail(input.businessId, row, "no_video");
        return { status: "done", state: "failed" };
      }
      const kept = await keep(input.businessId, row, new Uint8Array(Buffer.from(out.base64, "base64")), "video/mp4", row.durationSeconds ?? null);
      return kept.status === "done" ? { status: "done", state: kept.state } : { status: "done", state: "failed" };
    },

    /** The founder said no, or did not answer in time: the post stays text only. */
    async setAsidePostMedia(input: { businessId: string; mediaId: string; outcome: string }): Promise<void> {
      await repos.postMedia.update(deps.db, input.businessId, input.mediaId, { state: "declined", errorCode: input.outcome === "rejected" ? null : input.outcome.replace(/[^a-z_]/g, "").slice(0, 40) || null });
    },

    /** A clip that was never finished in time. */
    async giveUpPostVideo(input: { businessId: string; mediaId: string }): Promise<void> {
      await repos.postMedia.update(deps.db, input.businessId, input.mediaId, { state: "failed", errorCode: "timed_out" });
    },
  };
}
