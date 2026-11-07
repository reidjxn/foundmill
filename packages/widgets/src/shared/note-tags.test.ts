/** The Inbox tag vocabulary and its legend (DIRECTION #8; UX plan B7, B21). */
import { describe, expect, it } from "vitest";
import { NOTE_TAG_ICONS, NOTE_TAG_LEGEND, NOTE_TYPE_TAGS, RESPOND_TAG, humanSender, needsAnswerWords, noteRowTag, noteTagLegend } from "./note-tags";

describe("note tags", () => {
  it("tags a row with one word: Customer for a win, Needs you while the founder is needed, the kind otherwise", () => {
    expect(noteRowTag({ type: "customer_won", state: "unread", blocksContinue: true })).toBe(NOTE_TYPE_TAGS.customer_won);
    expect(noteRowTag({ type: "decision", state: "unread", blocksContinue: true })).toBe(RESPOND_TAG);
    expect(noteRowTag({ type: "warning", state: "read", blocksContinue: true })).toBe(RESPOND_TAG);
    expect(noteRowTag({ type: "decision", state: "answered", blocksContinue: true }).word).toBe("Decided");
    expect(noteRowTag({ type: "decision", state: "answered", blocksContinue: false, awaitingConfirmation: true })).toBe(RESPOND_TAG);
    expect(noteRowTag({ type: "decision", state: "archived", blocksContinue: false, awaitingConfirmation: true }).word).toBe("Decided");
    expect(noteRowTag({ type: "update", state: "unread", blocksContinue: false }).word).toBe("Update");
  });

  it("gives every tag kind an icon and one legend sentence, in the tag words the founder reads (B21)", () => {
    for (const icon of Object.keys(NOTE_TAG_ICONS) as (keyof typeof NOTE_TAG_ICONS)[]) {
      expect(NOTE_TAG_LEGEND[icon]).toMatch(/^[A-Z].+[^.]$/);
      expect(NOTE_TAG_LEGEND[icon]).not.toMatch(/!|club|squad|crest|match/i);
    }
    expect(noteTagLegend(NOTE_TYPE_TAGS.customer_won)).toBe("Customer: A new paying customer, with its Customer Update");
    expect(noteTagLegend(RESPOND_TAG)).toBe("Needs you: Waiting for your answer; the rest of the work carries on");
    expect(noteTagLegend(NOTE_TYPE_TAGS.warning)).toBe("Warning: Something to watch; it holds Continue only if cash is under 3 months");
    expect(noteTagLegend(NOTE_TYPE_TAGS.update)).toBe("Update: Progress from an agent, nothing to do");
    expect(noteTagLegend(NOTE_TYPE_TAGS.milestone)).toBe("Milestone: A first your business reached");
    expect(noteTagLegend(NOTE_TYPE_TAGS.report)).toBe("Report: A regular summary");
    expect(noteTagLegend(NOTE_TYPE_TAGS.human_message)).toBe("Message: A person wrote to you");
    expect(noteTagLegend(NOTE_TYPE_TAGS.decision)).toBe("Decided: You answered this");
    // The reading pane's fuller word shares the kind's sentence.
    expect(noteTagLegend({ word: "Needs your answer", icon: "respond" })).toBe("Needs your answer: Waiting for your answer; the rest of the work carries on");
  });

  it("says 'needs your answer' for notes waiting on the founder, one family of words (B7)", () => {
    expect(needsAnswerWords(1)).toBe("1 note needs your answer");
    expect(needsAnswerWords(3)).toBe("3 notes need your answer");
  });

  it("names whose words a person's note carries", () => {
    expect(humanSender("u-me", "u-me")).toBe("self");
    expect(humanSender("u-ana", "u-me")).toBe("other");
    expect(humanSender(null, "u-me")).toBeNull();
  });
});
