import { RECORDINGS, type SessionEventInput } from "@foundmill/sandbox";
import { describe, expect, it } from "vitest";
import { LoopDetector, LOOP_THRESHOLD, stableArgs } from "../activities/loop";

const at = "2026-10-05T08:00:00.000Z";

describe("LoopDetector (same tool+args 3× → fail)", () => {
  it("trips on the third identical tool call and not before", () => {
    const d = new LoopDetector();
    expect(d.recordToolCall("github.read_file", { path: "a.ts" }).loop).toBe(false);
    expect(d.recordToolCall("github.read_file", { path: "b.ts" }).loop).toBe(false);
    expect(d.recordToolCall("github.read_file", { path: "a.ts" }).loop).toBe(false);
    expect(d.nearLoops()).toEqual(["github.read_file|{path:a.ts}"]);
    const v = d.recordToolCall("github.read_file", { path: "a.ts" });
    expect(v.loop).toBe(true);
    expect(v.count).toBe(LOOP_THRESHOLD);
    expect(d.loopDetected?.signature).toBe("github.read_file|{path:a.ts}");
  });

  it("compares arguments structurally, not by key order", () => {
    expect(stableArgs({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(stableArgs({ a: [2, { c: 2, d: 1 }], b: 1 }));
    const d = new LoopDetector();
    d.recordToolCall("t", { b: 1, a: 2 });
    d.recordToolCall("t", { a: 2, b: 1 });
    expect(d.recordToolCall("t", { a: 2, b: 1 }).loop).toBe(true);
  });

  it("counts repeated failing acceptance runs with the same command and failures", () => {
    const d = new LoopDetector();
    const ev = (): SessionEventInput => ({ kind: "test_result", at, suite: "csv", command: "pnpm test src/import", passed: 0, failed: 1, acceptance: true, failures: ["imports rows in file order"] });
    expect(d.observe(ev())?.loop).toBe(false);
    expect(d.observe(ev())?.loop).toBe(false);
    expect(d.observe(ev())?.loop).toBe(true);
    // Passing runs and non-acceptance runs never count.
    expect(new LoopDetector().observe({ kind: "test_result", at, passed: 1, failed: 0, acceptance: true })).toBeNull();
  });

  it("only started tool calls count (results do not double-count)", () => {
    const d = new LoopDetector();
    const started: SessionEventInput = { kind: "tool_call", at, callId: "1", connectorKey: "gmail", tool: "send", status: "started", argsSummary: "to=a" };
    const done: SessionEventInput = { kind: "tool_call", at, callId: "1", connectorKey: "gmail", tool: "send", status: "succeeded", argsSummary: "to=a" };
    d.observe(started);
    d.observe(done);
    d.observe(started);
    d.observe(done);
    expect(d.loopDetected).toBeNull();
    expect(d.observe(started)?.loop).toBe(true);
  });

  it("trips on the recorded loop session and on no other recording", () => {
    for (const rec of RECORDINGS) {
      const d = new LoopDetector();
      for (const e of rec.events) d.observe(e.event as SessionEventInput);
      if (rec.key === "ledgerly-flaky-import-test") expect(d.loopDetected).not.toBeNull();
      else expect(d.loopDetected).toBeNull();
    }
  });
});
