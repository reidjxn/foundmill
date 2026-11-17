import { describe, expect, it } from "vitest";
import { aiFooterLine, PROJECT_UPDATE_BODY_MAX, PROJECT_UPDATE_WORDS, updateProblems, updateText } from "./project-updates";

describe("project updates (WP-08 T3)", () => {
  it("updateProblems names the first problem in plain words", () => {
    expect(updateProblems("News", "We shipped.")).toBeNull();
    expect(updateProblems(" ", "x")).toBe("Give the update a subject.");
    expect(updateProblems("Two\nlines", "x")).toBe("Keep the subject to one line.");
    expect(updateProblems("x".repeat(201), "x")).toMatch(/under 200/);
    expect(updateProblems("News", "  ")).toBe("Write something for your followers to read.");
    expect(updateProblems("News", "x".repeat(PROJECT_UPDATE_BODY_MAX + 1))).toMatch(/under 10,000/);
  });

  it("the AI line (founder D2) shows only when the team drafted it, with the checker's first name", () => {
    expect(aiFooterLine({ draftedByAgent: false, checkerFirstName: "Maya" })).toBeNull();
    expect(aiFooterLine({ draftedByAgent: true, checkerFirstName: "Maya" })).toBe("Written with help from AI and checked by Maya.");
    expect(aiFooterLine({ draftedByAgent: true, checkerFirstName: null })).toBe("Written with help from AI and checked by the founders.");
    expect(updateText(" Hi all \n", "Written with help from AI and checked by Maya.")).toBe("Hi all\n\nWritten with help from AI and checked by Maya.");
    expect(updateText("Hi all", null)).toBe("Hi all");
  });

  it("the words count people in US English", () => {
    expect(PROJECT_UPDATE_WORDS.button(3)).toBe("Write to your followers (3)");
    expect(PROJECT_UPDATE_WORDS.confirm(1, "Candle Co")).toBe("This goes to 1 person who asked to hear from Candle Co. It cannot be unsent.");
    expect(PROJECT_UPDATE_WORDS.sentWithRest(50, 1200)).toBe("Sent to 50 people. 1,200 more go tomorrow: press Send the rest.");
    expect(PROJECT_UPDATE_WORDS.todayInvite(1, "Candle Co")).toBe("1 person follows Candle Co. Write to them.");
  });
});
