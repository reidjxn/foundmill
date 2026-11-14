/**
 * The social agent's media for a post draft (the "ready-to-post kit"; packages/shared `post-media.ts`; founder,
 * 2026-11-13): a short vertical video on the founder's own Runway account and, with it, a voiceover on their own
 * ElevenLabs account. Optional media on the existing draft, not a new drafting path: the draft's words, caps and check
 * stay as they are (`TEAM_POST_CAPS`, `checkPostDraft`), and posting stays the founder's own press.
 *
 * Pure, like the rest of this package. apps/orchestrator's `post-media.ts` runs the calls through the gateway as the
 * social channel's agent: both start tools are `irreversible` and `spendsMoney`, so the gateway asks the founder first
 * (Needs you) in augmented and assisted mode, and nothing is spent until they say yes.
 *
 * - `postMediaTools`: which of the two connectors the founder connected on their own key. Not connected is not
 *   connected: there is no key of Foundmill's own to fall back to, and the draft stays text only and says so.
 * - `postMediaPlan`: what to ask for. A video only with Runway; a voiceover only with a video (it is the video's).
 * - `postVideoPrompt` and `postVoiceoverScript`: what is sent, written by code from what is already public or already
 *   checked. The clip is described from the published page's pitch, with no people, no text and no brands on screen;
 *   the voiceover speaks the draft's own words, which passed `checkPostDraft`. Nothing else reaches either vendor.
 * - `postMediaOutcomeWords`: what is said about it afterward, from what was stored, never from what was asked: a video
 *   that was simulated, refused or not made is never called a video that exists.
 */
import { POST_MEDIA_WORDS, POST_VIDEO_DEFAULTS, postMediaLine, type PostDraftMediaItem, type PostMediaKind } from "@foundmill/shared";

/** The founder's own connector that makes each kind. */
export const POST_MEDIA_CONNECTORS = { video: "runway", voiceover: "elevenlabs_voice" } as const satisfies Record<PostMediaKind, string>;

/** The tool each kind is started with, and the one a clip is looked up with. */
export const POST_MEDIA_TOOLS = {
  video: { connector: "runway", tool: "generate_video_from_text" },
  videoTask: { connector: "runway", tool: "get_video_task" },
  videoCopy: { connector: "runway", tool: "download_video" },
  voiceover: { connector: "elevenlabs_voice", tool: "generate_voiceover" },
} as const;

/** Runway's longest prompt and ElevenLabs' longest script for a voiceover (the connectors hold the same). */
const PROMPT_MAX = 1000;
const SCRIPT_MAX = 1000;

/** How long a clip is waited for: Runway makes one in seconds to minutes; looked up about every 10 seconds. */
export const POST_VIDEO_POLL = { everySeconds: 10, attempts: 60 } as const;
/** How long the founder's OK is waited for in Needs you before the media is set aside (the post itself stays). */
export const POST_MEDIA_APPROVAL_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

/** An integration as this module reads it. */
export interface PostMediaIntegration {
  connectorKey: string;
  status: string;
}

/**
 * Which tools the founder connected on their own key. A connector counts while it is connected (or degraded, which
 * still answers); a mock record counts only where simulated results are allowed (development, tests, a sample business),
 * and everything it makes is labeled simulated.
 */
export function postMediaTools(integrations: readonly PostMediaIntegration[], options: { mockAllowed: boolean }): { video: boolean; voice: boolean } {
  const usable = (key: string) => integrations.some((i) => i.connectorKey === key && (i.status === "connected" || i.status === "degraded" || (options.mockAllowed && i.status === "mock")));
  return { video: usable(POST_MEDIA_CONNECTORS.video), voice: usable(POST_MEDIA_CONNECTORS.voiceover) };
}

/** The draft as the plan reads it. */
export interface PostMediaDraft {
  /** A team post with words (packages/shared `isTeamPost`). */
  isTeamPost: boolean;
  hasText: boolean;
  /** Still waiting to be shared (`approval_state` draft), not archived, not set aside. */
  waiting: boolean;
}

/**
 * What to ask for, in order: a video when Runway is connected, and a voiceover with it when ElevenLabs is too. Nothing
 * for a draft that is not a waiting team post with words, and nothing already asked for (`existing`).
 */
export function postMediaPlan(draft: PostMediaDraft, tools: { video: boolean; voice: boolean }, existing: readonly PostMediaKind[] = []): PostMediaKind[] {
  if (!draft.isTeamPost || !draft.hasText || !draft.waiting || !tools.video) return [];
  const want: PostMediaKind[] = tools.voice ? ["video", "voiceover"] : ["video"];
  return want.filter((k) => !existing.includes(k));
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
/** Quotation marks and anything markup-like out of a founder's words before they go into a prompt for a third party. */
const plainWords = (s: string) =>
  oneLine(s)
    .replace(/[<>{}[\]`"“”]/g, "")
    .slice(0, 300);

/**
 * The clip's description, written by code: what the project is, in the published page's own pitch, as calm everyday
 * scenes. No people's faces, no text, captions, logos or brand names on screen (Runway would invent them, and a post
 * must not show what is not true), no claims. Vertical by default (`POST_VIDEO_DEFAULTS`).
 */
export function postVideoPrompt(page: { projectName: string; pitch: string; forWhom?: string }): string {
  const name = plainWords(page.projectName) || "a small project";
  const pitch = plainWords(page.pitch);
  const forWhom = page.forWhom ? plainWords(page.forWhom) : "";
  const what = pitch && pitch.toLowerCase() !== name.toLowerCase() ? `${name}: ${pitch}` : name;
  const parts = [
    `A calm, simple vertical video about ${what}.`,
    forWhom ? `It is for ${forWhom}.` : "",
    "Show everyday, real-looking scenes of what it is about, in natural light, with slow, gentle camera movement.",
    "No text, captions, logos or brand names on screen, and no recognizable faces.",
  ];
  return parts.filter(Boolean).join(" ").slice(0, PROMPT_MAX);
}

/** The voiceover speaks the draft's own words (already checked by `checkPostDraft`), and nothing else. */
export function postVoiceoverScript(draftText: string): string {
  return oneLine(draftText).slice(0, SCRIPT_MAX);
}

/** The arguments of each start call, exactly as the gateway will see them (an approval matches the same arguments). */
export function postVideoArgs(page: { projectName: string; pitch: string; forWhom?: string }): { prompt: string; ratio: typeof POST_VIDEO_DEFAULTS.ratio; durationSeconds: number; model: "gen4.5" } {
  return { prompt: postVideoPrompt(page), ratio: POST_VIDEO_DEFAULTS.ratio, durationSeconds: POST_VIDEO_DEFAULTS.durationSeconds, model: "gen4.5" };
}
export function postVoiceoverArgs(draftText: string): { text: string } {
  return { text: postVoiceoverScript(draftText) };
}

/**
 * What is said about a draft's media once its step ends (the activity's log and the agent's line in the record), from
 * what was stored. A simulated, declined or failed video is never said to exist; only a ready, real one is "a video".
 */
export function postMediaOutcomeWords(items: readonly PostDraftMediaItem[], tools: { video: boolean }): string {
  if (!tools.video) return POST_MEDIA_WORDS.notConnected;
  if (items.length === 0) return "No video was made, so this post is text only.";
  return items.map(postMediaLine).join(" ");
}
