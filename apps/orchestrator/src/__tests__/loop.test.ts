import { RECORDINGS, type SessionEventInput } from "@foundmill/sandbox";
import { describe, expect, it } from "vitest";
import { LoopDetector, LOOP_THRESHOLD, stableArgs } from "../activities/loop";

const at = "2026-10-05T08:00:00.000Z";
const call = (tool: string, argsSummary: string, callId = "c"): SessionEventInput => ({ kind: "tool_call", at, callId, connectorKey: null, tool, status: "started", argsSummary });

describe("LoopDetector (same tool+args 3× in a row → fail)", () => {
  it("trips on the third identical tool call in a row and not before", () => {
    const d = new LoopDetector();
    expect(d.recordToolCall("github.read_file", { path: "a.ts" }).loop).toBe(false);
    expect(d.recordToolCall("github.read_file", { path: "a.ts" }).loop).toBe(false);
    expect(d.nearLoops()).toEqual(["github.read_file|{path:a.ts}"]);
    const v = d.recordToolCall("github.read_file", { path: "a.ts" });
    expect(v.loop).toBe(true);
    expect(v.count).toBe(LOOP_THRESHOLD);
    expect(d.loopDetected?.signature).toBe("github.read_file|{path:a.ts}");
  });

  it("a different call in between restarts the count: read, edit, re-read is work, not a loop (audit O-25)", () => {
    const d = new LoopDetector();
    // The verifier's sequence: Read cart.ts → Edit → Read cart.test.ts → Read cart.ts → Write tax.ts → Edit cart.ts → Read cart.ts.
    const session = [call("Read", '{"file_path":"cart.ts"}'), call("Edit", '{"file_path":"cart.ts","old":"a","new":"b"}'), call("Read", '{"file_path":"cart.test.ts"}'), call("Read", '{"file_path":"cart.ts"}'), call("Write", '{"file_path":"tax.ts"}'), call("Edit", '{"file_path":"cart.ts","old":"b","new":"c"}'), call("Read", '{"file_path":"cart.ts"}'), call("Glob", "{}"), call("Read", '{"file_path":"cart.ts"}')];
    for (const e of session) expect(d.observe(e)?.loop).toBe(false);
    expect(d.loopDetected).toBeNull();
  });

  it("a file change between identical calls is progress", () => {
    const d = new LoopDetector();
    d.observe(call("run", "pnpm build"));
    d.observe(call("run", "pnpm build"));
    d.observe({ kind: "file_changed", at, path: "src/a.ts", change: "modified" } as SessionEventInput);
    expect(d.observe(call("run", "pnpm build"))?.loop).toBe(false);
    expect(d.observe(call("run", "pnpm build"))?.loop).toBe(false);
    expect(d.observe(call("run", "pnpm build"))?.loop).toBe(true);
  });

  it("uses the full arguments when the runner passes them: writes that share a long prefix are different calls", () => {
    const d = new LoopDetector();
    const prefix = "x".repeat(600);
    const summary = `{"file_path":"a.ts","content":"${prefix.slice(0, 450)}...`;
    for (let i = 0; i < 3; i++) expect(d.observe(call("Write", summary), { file_path: "a.ts", content: `${prefix}${i}` })?.loop).toBe(false);
    // The same full input three times in a row is a loop.
    const same = new LoopDetector();
    for (let i = 0; i < 2; i++) same.observe(call("Write", summary), { file_path: "a.ts", content: prefix });
    expect(same.observe(call("Write", summary), { content: prefix, file_path: "a.ts" })?.loop).toBe(true);
  });

  it("compares arguments structurally, not by key order", () => {
    expect(stableArgs({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(stableArgs({ a: [2, { c: 2, d: 1 }], b: 1 }));
    const d = new LoopDetector();
    d.recordToolCall("t", { b: 1, a: 2 });
    d.recordToolCall("t", { a: 2, b: 1 });
    expect(d.recordToolCall("t", { a: 2, b: 1 }).loop).toBe(true);
  });

  it("counts the same failing acceptance result three times in a row, whatever changed in between", () => {
    const d = new LoopDetector();
    const ev = (): SessionEventInput => ({ kind: "test_result", at, suite: "csv", command: "pnpm test src/import", passed: 0, failed: 1, acceptance: true, failures: ["imports rows in file order"] });
    const edit = { kind: "file_changed", at, path: "src/import/csv.ts", change: "modified" } as SessionEventInput;
    expect(d.observe(ev())?.loop).toBe(false);
    d.observe(edit);
    expect(d.observe(ev())?.loop).toBe(false);
    d.observe(edit);
    expect(d.observe(ev())?.loop).toBe(true);
    // Passing runs and non-acceptance runs never count.
    expect(new LoopDetector().observe({ kind: "test_result", at, passed: 1, failed: 0, acceptance: true })).toBeNull();
  });

  it("a passing acceptance run or a different failure restarts the acceptance count", () => {
    const d = new LoopDetector();
    const fail = (failures: string[]): SessionEventInput => ({ kind: "test_result", at, command: "pnpm test", passed: 0, failed: failures.length, acceptance: true, failures });
    d.observe(fail(["a"]));
    d.observe(fail(["a"]));
    d.observe({ kind: "test_result", at, command: "pnpm test", passed: 1, failed: 0, acceptance: true });
    expect(d.observe(fail(["a"]))?.loop).toBe(false);
    expect(d.observe(fail(["b"]))?.loop).toBe(false);
    expect(d.observe(fail(["a"]))?.loop).toBe(false);
    expect(d.loopDetected).toBeNull();
  });

  it("only started tool calls count (results do not double-count or break the run)", () => {
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
