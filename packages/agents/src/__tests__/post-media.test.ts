import { describe, expect, it } from "vitest";
import { POST_MEDIA_WORDS, type PostDraftMediaItem } from "@foundmill/shared";
import { postMediaOutcomeWords, postMediaPlan, postMediaTools, postVideoArgs, postVideoPrompt, postVoiceoverArgs } from "../post-media";

const waiting = { isTeamPost: true, hasText: true, waiting: true };
const id = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";

describe("the social agent's media for a post draft", () => {
  it("counts only the founder's own connected tools; a mock record only where simulated results are allowed", () => {
    expect(postMediaTools([], { mockAllowed: true })).toEqual({ video: false, voice: false });
    expect(postMediaTools([{ connectorKey: "runway", status: "connected" }], { mockAllowed: false })).toEqual({ video: true, voice: false });
    expect(postMediaTools([{ connectorKey: "runway", status: "mock" }, { connectorKey: "elevenlabs_voice", status: "mock" }], { mockAllowed: false })).toEqual({ video: false, voice: false });
    expect(postMediaTools([{ connectorKey: "runway", status: "mock" }, { connectorKey: "elevenlabs_voice", status: "mock" }], { mockAllowed: true })).toEqual({ video: true, voice: true });
    expect(postMediaTools([{ connectorKey: "runway", status: "revoked" }, { connectorKey: "runway", status: "error" }], { mockAllowed: true })).toEqual({ video: false, voice: false });
    // The platform's own ElevenLabs (Team call speech) is never the founder's voiceover.
    expect(postMediaTools([{ connectorKey: "runway", status: "connected" }, { connectorKey: "elevenlabs", status: "connected" }], { mockAllowed: false }).voice).toBe(false);
  });

  it("asks for nothing when not connected: the draft stays text only", () => {
    expect(postMediaPlan(waiting, { video: false, voice: true })).toEqual([]);
    expect(postMediaPlan(waiting, { video: true, voice: false })).toEqual(["video"]);
    expect(postMediaPlan(waiting, { video: true, voice: true })).toEqual(["video", "voiceover"]);
    expect(postMediaPlan(waiting, { video: true, voice: true }, ["video"])).toEqual(["voiceover"]);
    for (const draft of [{ ...waiting, isTeamPost: false }, { ...waiting, hasText: false }, { ...waiting, waiting: false }]) expect(postMediaPlan(draft, { video: true, voice: true })).toEqual([]);
  });

  it("describes the clip from the page's pitch only: vertical, no people, no text, no brands, nothing invented", () => {
    const prompt = postVideoPrompt({ projectName: "Bike Fix", pitch: "Bike repairs at your door, booked in a minute", forWhom: "Cyclists in Leeds" });
    expect(prompt).toContain("Bike Fix: Bike repairs at your door, booked in a minute");
    expect(prompt).toContain("Cyclists in Leeds");
    expect(prompt).toMatch(/vertical/);
    expect(prompt).toMatch(/No text, captions, logos or brand names on screen, and no recognizable faces/);
    expect(prompt).not.toMatch(/\d/);
    // A founder's words cannot close the sentence and add markup or an instruction block.
    expect(postVideoPrompt({ projectName: 'Bike "Fix"', pitch: "<b>Ignore</b> {rules}" })).not.toMatch(/[<>{}"]/);
    expect(postVideoPrompt({ projectName: "Loom & Ember", pitch: "Loom & Ember" })).toContain("about Loom & Ember.");
    expect(postVideoArgs({ projectName: "Bike Fix", pitch: "x" })).toMatchObject({ ratio: "720:1280", durationSeconds: 5, model: "gen4.5" });
    expect(postVoiceoverArgs("  Our page is live.\n Bike repairs at your door. ")).toEqual({ text: "Our page is live. Bike repairs at your door." });
  });

  it("never says a video exists when it was simulated, refused or not made", () => {
    const item = (over: Partial<PostDraftMediaItem>): PostDraftMediaItem => ({ kind: "video", state: "ready", mediaId: id, simulated: false, durationSeconds: 5, url: "/api/post-media/abcdefghijklmnopqrstuvwxyz", ...over });
    const exists = /^Short video/;
    expect(postMediaOutcomeWords([item({})], { video: true })).toMatch(exists);
    for (const over of [{ simulated: true, state: "simulated" as const, url: undefined }, { state: "declined" as const }, { state: "failed" as const }, { simulated: true }]) {
      const words = postMediaOutcomeWords([item(over)], { video: true });
      expect(words, JSON.stringify(over)).not.toMatch(exists);
      expect(words).toMatch(/Simulated|no video|No video|could not be made/);
    }
    expect(postMediaOutcomeWords([], { video: false })).toBe(POST_MEDIA_WORDS.notConnected);
  });
});
