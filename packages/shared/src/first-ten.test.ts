import { describe, expect, it } from "vitest";
import { FIRST_TEN_QUESTIONS, FIRST_TEN_STAGES, FIRST_TEN_STAGE_LABELS, firstTenMessage, stageAfterHeard } from "./first-ten";

describe("first ten", () => {
  it("writes the message from the name and the one line, with one fixed question", () => {
    expect(firstTenMessage({ name: " Sam  Lee ", oneLine: "Bike repairs at your door." })).toBe(`Hi Sam Lee, I'm working on Bike repairs at your door. Can I ask you one question about it? ${FIRST_TEN_QUESTIONS[0]}`);
    expect(firstTenMessage({ name: "", oneLine: "" })).toMatch(/^Hi there, I'm working on a project\./);
  });
  it("says nothing about jobs, employers or a partner, in the message or the labels", () => {
    const text = [...FIRST_TEN_QUESTIONS, ...Object.values(FIRST_TEN_STAGE_LABELS), firstTenMessage({ name: "Sam", oneLine: "Bike repairs" })].join(" ");
    expect(text).not.toMatch(/\b(job|employ|career|cofounder|partner)\b/i);
  });
  it("has a label for every stage, and a heard answer moves only the two early ones", () => {
    expect(Object.keys(FIRST_TEN_STAGE_LABELS)).toEqual([...FIRST_TEN_STAGES]);
    expect(stageAfterHeard("to_ask")).toBe("talked");
    expect(stageAfterHeard("asked")).toBe("talked");
    expect(stageAfterHeard("wants_it")).toBe("wants_it");
  });
});
