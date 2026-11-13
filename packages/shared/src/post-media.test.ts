import { describe, expect, it } from "vitest";
import { fitPostDraft, withPostText, type PostDraft } from "./post-draft";
import { POST_MEDIA_WORDS, postDraftHasRealVideo, postMediaCardLabel, postMediaFileName, postMediaLine, postMediaPostable, postMediaSignatureMatches, type PostDraftMedia, type PostDraftMediaItem } from "./post-media";
import { PostDraft as PostDraftSchema } from "./types";

const id = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const url = "/api/post-media/abcdefghijklmnopqrstuvwxyz.0123456789";
const ready: PostDraftMediaItem = { kind: "video", state: "ready", mediaId: id, simulated: false, mime: "video/mp4", bytes: 1200, durationSeconds: 5, url, fileName: "bike-fix-video.mp4" };
const simulated: PostDraftMediaItem = { kind: "video", state: "simulated", mediaId: id, simulated: true, mime: null, bytes: null, durationSeconds: 5 };
const connected = { videoTools: "connected", voiceTools: "connected" } as const;

describe("a draft's media", () => {
  it("round-trips through the draft's schema, and the text helpers keep it", () => {
    const media: PostDraftMedia = { ...connected, video: ready, voiceover: { kind: "voiceover", state: "ready", mediaId: id, simulated: false, mime: "audio/mpeg", bytes: 900, durationSeconds: 7, url, fileName: "bike-fix-voiceover.mp3" } };
    const draft: PostDraft = { text: "Our page is live.", link: "https://foundmill.app/p/bike-fix", variants: {}, media };
    const parsed = PostDraftSchema.parse(JSON.parse(JSON.stringify(draft)));
    expect(parsed.media).toEqual(media);
    expect(withPostText(draft, "New words for it.").media).toEqual(media);
    expect(fitPostDraft(draft).media).toEqual(media);
    // A draft with no media is text only, as before.
    expect(PostDraftSchema.parse({ text: "Our page is live.", variants: {} }).media).toBeUndefined();
  });

  it("refuses a simulated item that claims a file or a ready state, and any address that is not the app's own", () => {
    const bad = (video: object) => PostDraftSchema.safeParse({ text: "Our page is live.", variants: {}, media: { ...connected, video } }).success;
    expect(bad({ ...simulated, url })).toBe(false);
    expect(bad({ ...simulated, state: "ready" })).toBe(false);
    expect(bad({ ...ready, url: "https://simulated.runway.invalid/x.mp4" })).toBe(false);
    expect(bad({ ...ready, url: "javascript:alert(1)" })).toBe(false);
    expect(bad(simulated)).toBe(true);
    expect(bad(ready)).toBe(true);
  });

  it("is postable only when ready, real and with an address", () => {
    expect(postMediaPostable(ready)).toBe(true);
    expect(postMediaPostable(simulated)).toBe(false);
    // Even a malformed simulated item that says ready and has an address is never postable.
    expect(postMediaPostable({ ...ready, simulated: true })).toBe(false);
    expect(postMediaPostable({ ...ready, url: undefined })).toBe(false);
    for (const state of ["asking", "making", "declined", "failed"] as const) expect(postMediaPostable({ ...ready, state })).toBe(false);
    expect(postDraftHasRealVideo({ ...connected, video: ready })).toBe(true);
    expect(postDraftHasRealVideo({ ...connected, video: simulated })).toBe(false);
    expect(postDraftHasRealVideo({ videoTools: "not_connected", voiceTools: "not_connected" })).toBe(false);
    expect(postDraftHasRealVideo(undefined)).toBe(false);
  });

  it("says plainly where each item stands, and that a simulated one made nothing", () => {
    expect(postMediaLine(simulated)).toMatch(/^Simulated: no video was made/);
    expect(postMediaLine({ ...simulated, kind: "voiceover" })).toMatch(/^Simulated: no voiceover was made/);
    // `simulated` wins over any state.
    expect(postMediaLine({ ...ready, simulated: true })).toMatch(/^Simulated/);
    expect(postMediaLine(ready)).toBe("Short video, 5 seconds");
    expect(postMediaLine({ ...ready, state: "asking" })).toMatch(/Needs you/);
    expect(postMediaLine({ ...ready, state: "declined" })).toMatch(/text only/);
    expect(postMediaCardLabel({ ...connected, video: simulated })).toBe(POST_MEDIA_WORDS.card.simulated);
    expect(postMediaCardLabel({ ...connected, video: ready })).toBe(POST_MEDIA_WORDS.card.ready);
    expect(postMediaCardLabel({ ...connected, video: { ...ready, state: "failed" } })).toBeNull();
    expect(postMediaCardLabel(undefined)).toBeNull();
    for (const words of [POST_MEDIA_WORDS.notConnected, POST_MEDIA_WORDS.twoFiles, POST_MEDIA_WORDS.saveNote]) expect(words).not.toMatch(/\b(?:job|career|employ)/i);
  });

  it("checks a file's type from its first bytes, never from what it says it is", () => {
    const bytes = (...parts: (number[] | string)[]) => new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
    expect(postMediaSignatureMatches("video/mp4", bytes([0, 0, 0, 24], "ftypmp42"))).toBe(true);
    expect(postMediaSignatureMatches("video/mp4", bytes("<html><body>"))).toBe(false);
    expect(postMediaSignatureMatches("video/mp4", bytes("ftyp"))).toBe(false);
    expect(postMediaSignatureMatches("audio/wav", bytes("RIFF", [0, 0, 0, 0], "WAVEfmt "))).toBe(true);
    expect(postMediaSignatureMatches("audio/wav", bytes("RIFF", [0, 0, 0, 0], "AVI LIST"))).toBe(false);
    expect(postMediaSignatureMatches("audio/mpeg", bytes("ID3", [4, 0, 0]))).toBe(true);
    expect(postMediaSignatureMatches("audio/mpeg", bytes([0xff, 0xfb, 0x90, 0x64]))).toBe(true);
    expect(postMediaSignatureMatches("audio/mpeg", bytes([0xff, 0x0b]))).toBe(false);
    expect(postMediaSignatureMatches("audio/mpeg", bytes([0, 0, 0, 24], "ftypmp42"))).toBe(false);
    expect(postMediaSignatureMatches("audio/mpeg", new Uint8Array())).toBe(false);
  });

  it("names a saved file after the project", () => {
    expect(postMediaFileName("Bike Fix Café", "video", "video/mp4")).toBe("bike-fix-cafe-video.mp4");
    expect(postMediaFileName("Bike Fix", "voiceover", "audio/mpeg")).toBe("bike-fix-voiceover.mp3");
    expect(postMediaFileName("!!!", "voiceover", "audio/wav")).toBe("post-voiceover.wav");
  });
});
