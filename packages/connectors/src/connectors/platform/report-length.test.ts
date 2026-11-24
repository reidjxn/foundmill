import { describe, expect, it } from "vitest";
import { reportLengthRefusal } from "./report-length";

describe("reportLengthRefusal", () => {
  const task = { title: "Plan the mail test", goalMd: "Plan a 500-piece mail test. Under 30 words." };
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

  it("sends a report over the task's stated limit back once, to be saved again", () => {
    expect(reportLengthRefusal(task, words(40), false)).toMatch(/^Your reply has 40 words; the task allows at most 30\..*Save the rewritten report with save_report; nothing was saved this time\.$/);
  });

  it("keeps a report that fits, a task with no limit, and a session's second save", () => {
    expect(reportLengthRefusal(task, words(30), false)).toBeNull();
    expect(reportLengthRefusal({ title: "Compare suppliers", goalMd: "Compare two suppliers on price." }, words(500), false)).toBeNull();
    expect(reportLengthRefusal(task, words(40), true)).toBeNull();
  });
});
