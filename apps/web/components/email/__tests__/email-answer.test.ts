import { usSpelling } from "@foundmill/shared";
import { describe, expect, it } from "vitest";
import { answerWords, type EmailActionState } from "../EmailAnswer";

describe("answerWords", () => {
  it("says what happened in each state, in US English", () => {
    const states: EmailActionState[] = ["ready", "answered", "used", "expired", "unavailable"];
    for (const s of states) {
      const w = answerWords(s);
      expect(usSpelling(`${w.title} ${w.description}`), s).toBe(`${w.title} ${w.description}`);
    }
    expect(answerWords("answered", { justAnswered: true }).title).toBe("Done");
    expect(answerWords("answered", { justAnswered: true, requiresConfirmation: true }).description).toMatch(/go-ahead/);
    expect(answerWords("answered").title).toBe("Already answered");
  });
});
