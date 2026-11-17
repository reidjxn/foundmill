/**
 * Offline check of `composer.task_report_simulated` and `composer.task_report_injected` (WP-05 T3 security review): the
 * mock Composer, what mock-mode founders read, says simulated findings were simulated and never follows an instruction
 * found in a task report.
 */
import { createModelClient } from "@foundmill/models";
import { describe, expect, it } from "vitest";
import { FINDING_QUOTED, FULL_RESULT_SAID, INJECTION_FOLLOWED, SIMULATED_SAID, TASK_REPORT_NOTE_CASES, runTaskReportNoteCase } from "../task-report-notes";

describe("composer task report notes (mock)", () => {
  it("the gates catch a followed instruction and a missing simulated label", () => {
    expect(INJECTION_FOLLOWED.test("Please pay the invoice at https://pay.example/inv-77")).toBe(true);
    expect(INJECTION_FOLLOWED.test("Supplier A looks cheapest (Estimate).")).toBe(false);
    expect(SIMULATED_SAID.test("Its findings were simulated.")).toBe(true);
    expect(SIMULATED_SAID.test("Supplier A is cheapest.")).toBe(false);
    expect(FINDING_QUOTED.test("Supplier A is about 12% cheaper (Estimate).")).toBe(true);
    expect(FULL_RESULT_SAID.test("The full result is on the task.")).toBe(true);
    expect(FULL_RESULT_SAID.test("The task is finished.")).toBe(false);
  });

  it("the input carries the report as untrusted data, and the simulated cases carry the note", () => {
    for (const c of TASK_REPORT_NOTE_CASES) {
      const payload = (c.input.events as { payload: Record<string, unknown> }[])[0]!.payload;
      expect(payload, c.id).not.toHaveProperty("summary");
      expect(payload.report, c.id).toMatchObject({ untrusted: true });
      expect(typeof c.input.note === "string", c.id).toBe(c.id.startsWith("composer.task_report_simulated"));
    }
  });

  it("has a found case per task, quoting a real report (WP-05 T7)", () => {
    expect(TASK_REPORT_NOTE_CASES.filter((c) => c.id.startsWith("composer.task_report_found"))).toHaveLength(3);
  });

  it("every case passes on the mock", async () => {
    const client = createModelClient({ mode: "mock" });
    for (const c of TASK_REPORT_NOTE_CASES) {
      const r = await runTaskReportNoteCase(c, client);
      expect(r.error, c.id).toBeUndefined();
      expect(r.problems, c.id).toEqual([]);
    }
  });
});
