import { describe, expect, it } from "vitest";
import {
  CARD_PATH_PREFIX,
  MILESTONE_NEEDS_PAGE_MESSAGE,
  MILESTONE_SAMPLE_MESSAGE,
  MILESTONE_SHOW_WORDS,
  cardDescription,
  cardPath,
  cardTallImagePath,
  cardTitle,
  cardUrl,
  storyDescription,
  storyPath,
  storyTitle,
  storyUrl,
  storyWords,
} from "./project-story";

const ID = "7a21e15f-87b0-4000-ac49-c98b9d627e98";

describe("a project's story and its cards", () => {
  it("addresses: the story under the page, a card under /m/, with one slash whatever the origin ends with", () => {
    expect(storyPath("maple-bakes")).toBe("/p/maple-bakes/story");
    expect(storyUrl("https://foundmill.example/", "maple-bakes")).toBe("https://foundmill.example/p/maple-bakes/story");
    expect(CARD_PATH_PREFIX).toBe("/m/");
    expect(cardPath(ID)).toBe(`/m/${ID}`);
    expect(cardUrl("https://foundmill.example", ID)).toBe(`https://foundmill.example/m/${ID}`);
    expect(cardTallImagePath(ID)).toBe(`/m/${ID}/story-image`);
  });

  it("the words: a heading in the project's name, the proof, and what verified means in plain words", () => {
    const words = storyWords("Foundmill");
    expect(words.heading("Maple\nBakes")).toBe("How Maple Bakes was built");
    expect(words.verified).toBe("Verified by Foundmill");
    expect(words.verifiedNote).toBe("Foundmill recorded each of these when it happened. None was typed in.");
    expect(words.verifiedNoteOne).toBe("Foundmill recorded this when it happened. It was not typed in.");
    expect(words.seeProject("Maple Bakes")).toBe("See Maple Bakes");
  });

  it("titles and descriptions are one line, cut at a word, and never count anything", () => {
    expect(storyTitle("Maple Bakes")).toBe("How Maple Bakes was built");
    expect(storyTitle("A very long project name that goes on and on and on and on and on and on, far too long").length).toBeLessThanOrEqual(70);
    expect(storyDescription("Maple Bakes", "Foundmill")).toBe("What Maple Bakes has done so far, each step recorded by Foundmill when it happened.");
    expect(cardTitle("Page live", "Maple Bakes")).toBe("Page live: Maple Bakes");
    expect(cardDescription("Maple Bakes", "Nov 12, 2026", "Foundmill")).toBe("Maple Bakes reached this on Nov 12, 2026. Verified by Foundmill.");
    for (const text of [storyTitle("Maple Bakes"), storyDescription("Maple Bakes", "Foundmill"), cardTitle("First follower", "Maple Bakes"), ...Object.values(MILESTONE_SHOW_WORDS)]) {
      expect(text).not.toMatch(/\d+ (milestones?|followers?|customers?)/i);
      expect(text).not.toContain("\n");
    }
  });

  it("the console's words and refusals are plain sentences", () => {
    expect(MILESTONE_SHOW_WORDS).toMatchObject({ show: "Show on your page", shown: "On your page", hide: "Hide", copy: "Copy card link" });
    expect(MILESTONE_NEEDS_PAGE_MESSAGE).toBe("Publish your project's page first. A milestone is shown on that page.");
    expect(MILESTONE_SAMPLE_MESSAGE).toMatch(/^This is a sample business/);
  });
});
