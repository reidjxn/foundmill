import { describe, expect, it } from "vitest";
import { PARKED_TASKS_MAX, parkedTasksSentence } from "./parked-tasks";

describe("parkedTasksSentence (WP-05 T18, founder D1: one sentence, in plain words)", () => {
  it("one task: one sentence that names it, says what is missing and why it matters, and asks nothing", () => {
    const s = parkedTasksSentence(["Import agent skills as business skills"]);
    expect(s).toBe(
      "One thing the team cannot do yet is “Import agent skills as business skills”: none of the agents has a tool for it, so that piece waits, parked, while the rest of the work goes on, and nothing is needed from you.",
    );
    expect(s.match(/[.!?](\s|$)/g)).toHaveLength(1);
  });

  it("several tasks: still one sentence, at most three named, with their own quotes and trailing stops removed", () => {
    expect(parkedTasksSentence(["Post the demo video", "Book a \"spring\" fair stand."])).toBe(
      "Two things the team cannot do yet are “Post the demo video” and “Book a 'spring' fair stand”: none of the agents has a tool for them, so those pieces wait, parked, while the rest of the work goes on, and nothing is needed from you.",
    );
    const four = parkedTasksSentence(["A one", "B two", "C three", "D four"]);
    expect(four).toMatch(/^Three things the team cannot do yet are “A one”, “B two” and “C three”:/);
    expect(four).not.toContain("D four");
    expect(PARKED_TASKS_MAX).toBe(3);
  });

  it("nothing parked says nothing", () => {
    expect(parkedTasksSentence([])).toBe("");
    expect(parkedTasksSentence(["  "])).toBe("");
  });
});
