/**
 * A post draft's optional media, the "ready-to-post kit" (docs/NETWORK.md F3 "Tap-to-post"; founder, 2026-11-13): a
 * short vertical video made on the founder's own Runway account and, if they like, a voiceover made on their own
 * ElevenLabs account, for a post the social agent drafted. Media is added to the existing draft, never a new drafting
 * path: the draft's words, its caps (`TEAM_POST_CAPS`) and its check (`checkPostDraft`) are unchanged, and publishing
 * stays tap-to-post (the founder's own press is the only by-hand step).
 *
 * - **Where it stands** (`state`): `asking` (waiting for the founder's OK in Needs you: both tools spend the founder's
 *   own credits and cannot be undone), `making` (the vendor is making it), `ready` (copied into the project's own
 *   storage, so it stays reachable after the vendor's address expires), `simulated` (a mock connector answered: nothing
 *   was made, nothing was spent, and there is nothing to post), `declined` (the founder said no, or did not answer in
 *   time) and `failed` (the vendor refused or failed, or the project's storage was full).
 * - **Simulated is never real.** A simulated item has no file and no address: it cannot be previewed, saved or shared,
 *   and every word about it says it was simulated (`postMediaPostable` is false for it whatever else it carries).
 * - **Not connected** (`videoTools: "not_connected"`): the draft is text only and says that the video tools are not
 *   connected. There is never a fallback to a key of Foundmill's own.
 * - **Two files.** The video and the voiceover are kept as two files: nothing in the product can join them safely yet
 *   (no tested media worker), so the founder adds the voiceover in the network's own editor, or posts the video alone.
 *
 * The seam for a publishing connector (Buffer, not built): the draft with its `media` is what it takes. `mediaId` is
 * the stable reference to the stored file (packages/db `post_media`); `url` is only a short-lived link for the
 * founder's own browser, so a publisher asks the store for the bytes (or a fresh link) right before it posts.
 *
 * Pure, no Zod: browser code imports this from "@foundmill/shared/post-media". The Zod schema is in ./types.
 */

export const POST_MEDIA_KINDS = ["video", "voiceover"] as const;
export type PostMediaKind = (typeof POST_MEDIA_KINDS)[number];

export const POST_MEDIA_STATES = ["asking", "making", "ready", "simulated", "declined", "failed"] as const;
export type PostMediaState = (typeof POST_MEDIA_STATES)[number];

/** The file types a stored item may have (what Runway and ElevenLabs answer with). */
export const POST_MEDIA_MIMES = ["video/mp4", "audio/mpeg", "audio/wav"] as const;
export type PostMediaMime = (typeof POST_MEDIA_MIMES)[number];

/**
 * How much a project may keep. A clip of 10 seconds at 720p is a few MB; a voiceover of a minute at 64 kbps is under
 * 1 MB. The total is per project, across every draft: past it, a new file is not stored and the item says so.
 */
export const POST_MEDIA_LIMITS = {
  videoMaxBytes: 32 * 1024 * 1024,
  voiceoverMaxBytes: 4 * 1024 * 1024,
  perProjectBytes: 200 * 1024 * 1024,
} as const;

/** The clip the social agent asks for: vertical, five seconds (Runway's default model for words). */
export const POST_VIDEO_DEFAULTS = { ratio: "720:1280", durationSeconds: 5 } as const;

/** One piece of media on a draft. */
export interface PostDraftMediaItem {
  kind: PostMediaKind;
  state: PostMediaState;
  /** The stored item's id (packages/db `post_media`): the stable reference a publisher asks the store with. */
  mediaId: string;
  /** True when a mock connector answered: nothing was made or spent. Such an item never has a file or an address. */
  simulated: boolean;
  mime?: PostMediaMime | null;
  bytes?: number | null;
  /** How long it plays, in seconds (the clip asked for; for a voiceover, an Estimate from its length). */
  durationSeconds?: number | null;
  /** A short-lived, same-origin address for the founder's own browser. Only on a `ready` item that is not simulated. */
  url?: string;
  /** What "Save" names the file. */
  fileName?: string;
}

/** The media a draft has, and whether the founder connected the tools that make it. */
export interface PostDraftMedia {
  /** Runway on the founder's own key: the video. */
  videoTools: "connected" | "not_connected";
  /** ElevenLabs on the founder's own key: the voiceover (optional, only with a video). */
  voiceTools: "connected" | "not_connected";
  video?: PostDraftMediaItem;
  voiceover?: PostDraftMediaItem;
}

export const isPostMediaKind = (v: unknown): v is PostMediaKind => typeof v === "string" && (POST_MEDIA_KINDS as readonly string[]).includes(v);
export const isPostMediaState = (v: unknown): v is PostMediaState => typeof v === "string" && (POST_MEDIA_STATES as readonly string[]).includes(v);
export const isPostMediaMime = (v: unknown): v is PostMediaMime => typeof v === "string" && (POST_MEDIA_MIMES as readonly string[]).includes(v);

const ascii = (bytes: Uint8Array, from: number, text: string): boolean => bytes.length >= from + text.length && [...text].every((ch, i) => bytes[from + i] === ch.charCodeAt(0));

/**
 * Whether a file's first bytes are what its type says, read from the content and never from a header: an MP4 has its
 * `ftyp` box at bytes 4 to 8; a WAV is `RIFF` … `WAVE`; an MP3 starts with an `ID3` tag or an MPEG audio frame sync
 * (eleven set bits). Anything else is refused before it is stored.
 */
export function postMediaSignatureMatches(mime: PostMediaMime, bytes: Uint8Array): boolean {
  if (mime === "video/mp4") return ascii(bytes, 4, "ftyp");
  if (mime === "audio/wav") return ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WAVE");
  return ascii(bytes, 0, "ID3") || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0);
}

/** The most bytes one item of `kind` may have. */
export const postMediaMaxBytes = (kind: PostMediaKind): number => (kind === "video" ? POST_MEDIA_LIMITS.videoMaxBytes : POST_MEDIA_LIMITS.voiceoverMaxBytes);

/**
 * Whether an item can be previewed, saved and shared as a real file: it is ready, it was not simulated, and it has an
 * address. A simulated item is never postable, whatever else it carries.
 */
export function postMediaPostable(item: PostDraftMediaItem | null | undefined): item is PostDraftMediaItem & { url: string } {
  return !!item && item.state === "ready" && item.simulated !== true && typeof item.url === "string" && item.url.length > 0;
}

/** What a saved file is called: the project's name and the kind, in plain letters ("bike-fix-video.mp4"). */
export function postMediaFileName(projectName: string, kind: PostMediaKind, mime: PostMediaMime | null | undefined): string {
  const base =
    projectName
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "post";
  const ext = mime === "audio/mpeg" ? "mp3" : mime === "audio/wav" ? "wav" : "mp4";
  return `${base}-${kind}.${ext}`;
}

/** "5 seconds", "1 second". */
const seconds = (n: number): string => {
  const whole = Math.max(1, Math.round(n));
  return whole === 1 ? "1 second" : `${whole} seconds`;
};

/** The words a founder reads about a draft's media. One place, so every screen says the same. */
export const POST_MEDIA_WORDS = {
  heading: "Video",
  /** Not connected: the draft is text only, and says why. */
  notConnected: "Video tools aren't connected, so this post is text only. Runway is the service that makes a short video on your own account: connect it in Settings › Integrations (and ElevenLabs for a voiceover).",
  voiceNotConnected: "No voiceover: ElevenLabs isn't connected. Connect it in Settings › Integrations to add one.",
  asking: { video: "A short video waits for your OK in Needs you. It is paid from your own Runway account.", voiceover: "A voiceover waits for your OK in Needs you. It is paid from your own ElevenLabs plan." },
  making: { video: "Your video is being made. It shows here when it is ready.", voiceover: "Your voiceover is being made. It shows here when it is ready." },
  ready: { video: (s: number | null | undefined) => (s ? `Short video, ${seconds(s)}` : "Short video"), voiceover: (s: number | null | undefined) => (s ? `Voiceover, about ${seconds(s)}` : "Voiceover") },
  simulated: {
    video: "Simulated: no video was made and nothing was spent. There is no video to post.",
    voiceover: "Simulated: no voiceover was made and nothing was spent. There is no voiceover to post.",
  },
  declined: { video: "No video: you said no, or it was not answered in time. This post is text only.", voiceover: "No voiceover: you said no, or it was not answered in time." },
  failed: { video: "The video could not be made, so this post is text only.", voiceover: "The voiceover could not be made." },
  /** The video and the voiceover are two files. */
  twoFiles: "The video and the voiceover are two separate files. Add the voiceover in the network's own editor, or post the video without it.",
  saveVideo: "Save the video",
  saveVoiceover: "Save the voiceover",
  shareVideo: "Share with the video…",
  /** Where no network takes a file from the web: what the founder does instead. */
  saveNote: "No network takes a video from a web link. Save the video, then add it when you post, with the text above.",
  previewLabel: { video: "Preview of the video", voiceover: "Voiceover" },
  /** On the Creative tab's card. */
  card: { ready: "With a short video", simulated: "Video simulated, none made", asking: "Video waits for your OK", making: "Video being made" },
} as const;

/** The one line a founder reads about an item (its state, in words). */
export function postMediaLine(item: PostDraftMediaItem): string {
  if (item.simulated || item.state === "simulated") return POST_MEDIA_WORDS.simulated[item.kind];
  switch (item.state) {
    case "asking":
      return POST_MEDIA_WORDS.asking[item.kind];
    case "making":
      return POST_MEDIA_WORDS.making[item.kind];
    case "ready":
      return POST_MEDIA_WORDS.ready[item.kind](item.durationSeconds);
    case "declined":
      return POST_MEDIA_WORDS.declined[item.kind];
    default:
      return POST_MEDIA_WORDS.failed[item.kind];
  }
}

/** The short label on the Creative tab's card, or null when there is nothing to say (no media, or it did not happen). */
export function postMediaCardLabel(media: PostDraftMedia | null | undefined): string | null {
  const video = media?.video;
  if (!video) return null;
  if (video.simulated || video.state === "simulated") return POST_MEDIA_WORDS.card.simulated;
  if (postMediaPostable(video)) return POST_MEDIA_WORDS.card.ready;
  if (video.state === "asking") return POST_MEDIA_WORDS.card.asking;
  if (video.state === "making") return POST_MEDIA_WORDS.card.making;
  return null;
}

/**
 * Whether a draft's media says anything that a video exists. True only for a real, ready, stored video with an address.
 * Code that writes about a draft (a note, a summary, an agent's line) asks this before it says "with a video".
 */
export function postDraftHasRealVideo(media: PostDraftMedia | null | undefined): boolean {
  return postMediaPostable(media?.video);
}
