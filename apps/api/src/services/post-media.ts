/**
 * A post draft's media for the founder's browser (packages/shared `post-media.ts`; packages/db `post_media`): what the
 * Creative tab and the share panel show beside a post the team drafted, and the file itself at a signed address.
 *
 * - `draftMedia` builds each draft's `media`: whether Runway (and ElevenLabs) are connected on the founder's own key,
 *   and each stored item with where it stands. A ready, real item gets a short-lived address; a simulated one never
 *   has one (nothing was made). Nothing here reads a vendor or a key.
 * - The address is `/api/post-media/<token>`: the web app's own origin (next.config.ts rewrites it to this api's
 *   `GET /post-media/:token`), so a <video> element, a "Save" link and the device's share sheet can all read it with
 *   no bearer. The token is `<base64url(JSON {b, m, exp})>.<base64url(HMAC-SHA256)>`, keyed by SESSION_TOKEN_SECRET
 *   under its own label (a process key on a development or test stack without one), good for `POST_MEDIA_LINK_TTL_SECONDS`.
 *   It names one item of one business: whoever has it can read that file until it expires, as with any signed link.
 * - `servePostMedia` answers that route: the file of a ready, real item, or 404.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { POST_MEDIA_CONNECTORS, postMediaTools } from "@foundmill/agents";
import { repos, type Executor, type PostMediaRow } from "@foundmill/db";
import { isPostMediaKind, isPostMediaMime, isPostMediaState, mockResultsAllowed, postMediaFileName, type Env, type PostDraftMedia, type PostDraftMediaItem } from "@foundmill/shared";
import { z } from "zod";

export const POST_MEDIA_LINK_TTL_SECONDS = 60 * 60;
/** The web app's same-origin path (apps/web `same-origin-api.ts` rewrites it here). */
export const POST_MEDIA_PATH = "/api/post-media/";
const LABEL = "foundmill/post-media-link/v1";
/** Development and test without SESSION_TOKEN_SECRET: a key for this process only (links do not survive a restart). */
const PROCESS_KEY = randomBytes(32).toString("base64url");

/** The key links are signed with, or null where none may be used (staging or production without SESSION_TOKEN_SECRET). */
export function postMediaLinkKey(env: Pick<Env, "APP_ENV" | "SESSION_TOKEN_SECRET">): string | null {
  const secret = env.SESSION_TOKEN_SECRET;
  if (secret && secret.length >= 16) return secret;
  return env.APP_ENV === "development" || env.APP_ENV === "test" ? PROCESS_KEY : null;
}

const Payload = z.object({ b: z.uuid(), m: z.uuid(), exp: z.number().int() });
const mac = (key: string, body: string): Buffer => createHmac("sha256", key).update(`${LABEL}\n${body}`).digest();

export function signPostMediaLink(key: string, item: { businessId: string; mediaId: string }, now: Date = new Date()): string {
  const body = Buffer.from(JSON.stringify({ b: item.businessId, m: item.mediaId, exp: Math.floor(now.getTime() / 1000) + POST_MEDIA_LINK_TTL_SECONDS })).toString("base64url");
  return `${body}.${mac(key, body).toString("base64url")}`;
}

/** The item a token names, or null when it is not one of ours or has expired. Never throws. */
export function verifyPostMediaLink(key: string | null, token: string, now: Date = new Date()): { businessId: string; mediaId: string } | null {
  if (!key || token.length > 600) return null;
  const [body, sig, ...rest] = token.split(".");
  if (!body || !sig || rest.length > 0) return null;
  const expected = mac(key, body);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = Payload.parse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
    if (p.exp * 1000 < now.getTime()) return null;
    return { businessId: p.b, mediaId: p.m };
  } catch {
    return null;
  }
}

function itemOf(row: PostMediaRow, link: string | null, projectName: string): PostDraftMediaItem | null {
  if (!isPostMediaKind(row.kind) || !isPostMediaState(row.state)) return null;
  const simulated = row.simulated || row.state === "simulated";
  const mime = isPostMediaMime(row.mime) ? row.mime : null;
  const ready = row.state === "ready" && !simulated;
  return {
    kind: row.kind,
    state: simulated ? "simulated" : row.state,
    mediaId: row.id,
    simulated,
    mime: simulated ? null : mime,
    bytes: simulated ? null : (row.sizeBytes ?? null),
    durationSeconds: row.durationSeconds ?? null,
    ...(ready && link ? { url: `${POST_MEDIA_PATH}${link}`, fileName: postMediaFileName(projectName, row.kind, mime) } : {}),
  };
}

/**
 * Whether the project's media tools are connected, as two booleans and nothing else. Read on the service connection
 * (`serviceDb`), not the viewer's: a collaborator's RLS reads no integration rows (0094), and that rule stays. So the
 * api works the answer out itself, from only the connector key and status of the two media connectors
 * (`repos.integrations.connectionStatuses`), and hands on only the booleans: no credential, id, account name or other
 * field of an integration reaches anyone who can see the draft.
 */
export interface PostMediaToolStatus {
  video: boolean;
  voice: boolean;
}

export async function postMediaToolStatus(serviceDb: Executor, scope: { businessId: string; isDemo: boolean; env: Pick<Env, "APP_ENV"> }): Promise<PostMediaToolStatus> {
  const statuses = await repos.integrations.connectionStatuses(serviceDb, scope.businessId, Object.values(POST_MEDIA_CONNECTORS)).catch(() => []);
  const tools = postMediaTools(statuses, { mockAllowed: mockResultsAllowed(scope.env.APP_ENV, scope.isDemo) });
  return { video: tools.video === true, voice: tools.voice === true };
}

/**
 * Each draft's media (by asset id), for the drafts given (read in the viewer's own transaction, `tx`). A draft with
 * nothing stored still says whether the video tools are connected, so a text-only draft can say why; that status
 * (`tools`) is the same for every role that can see the draft: the caller works it out with `postMediaToolStatus`
 * before it opens the viewer's transaction (one connection is never asked for while another waits on it).
 */
export async function draftMedia(tx: Executor, scope: { businessId: string; businessName: string; isDemo: boolean; env: Pick<Env, "APP_ENV" | "SESSION_TOKEN_SECRET">; tools: PostMediaToolStatus; now?: Date }, assetIds: readonly string[]): Promise<Map<string, PostDraftMedia>> {
  const out = new Map<string, PostDraftMedia>();
  if (assetIds.length === 0) return out;
  const tools = scope.tools;
  const rows = await repos.postMedia.forAssets(tx, scope.businessId, assetIds);
  const key = postMediaLinkKey(scope.env);
  const now = scope.now ?? new Date();
  for (const id of assetIds) out.set(id, { videoTools: tools.video ? "connected" : "not_connected", voiceTools: tools.voice ? "connected" : "not_connected" });
  for (const row of rows) {
    const media = out.get(row.assetId);
    if (!media) continue;
    const link = key && row.state === "ready" && !row.simulated ? signPostMediaLink(key, { businessId: scope.businessId, mediaId: row.id }, now) : null;
    const item = itemOf(row, link, scope.businessName);
    if (item) media[item.kind] = item;
  }
  return out;
}

/** The file a link names: a ready, real item's bytes with its type, or null. */
export async function servePostMedia(db: Executor, env: Pick<Env, "APP_ENV" | "SESSION_TOKEN_SECRET">, token: string, now: Date = new Date()): Promise<{ content: Uint8Array; mime: string; kind: string } | null> {
  const named = verifyPostMediaLink(postMediaLinkKey(env), token, now);
  if (!named) return null;
  const found = await repos.postMedia.content(db, named.businessId, named.mediaId);
  if (!found || !isPostMediaMime(found.row.mime)) return null;
  return { content: found.content, mime: found.row.mime, kind: found.row.kind };
}
