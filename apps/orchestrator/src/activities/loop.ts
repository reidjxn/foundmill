/**
 * Loop detection (BUILD §9.4 "same tool+args 3× → fail"). Pure and shared by the mock replay runner, the live Claude
 * Agent SDK runner and the tests. A loop is repetition without progress, not three identical calls anywhere in a
 * session (audit O-25: a read, edit, re-read session is normal work):
 *
 * - Tool calls: the same `tool|args` signature started `LOOP_THRESHOLD` times in a row. A different call in between, a
 *   file change or a test result that differs from the last one restarts the count.
 * - Acceptance tests: the same failing result (`run_tests|command|failures`) `LOOP_THRESHOLD` times in a row, whatever
 *   the agent changed in between: three different fixes that leave the same test failing are still no progress. A
 *   passing run or a different failure restarts the count.
 */
import type { SessionEventInput } from "@foundmill/events";

export const LOOP_THRESHOLD = 3;

export interface LoopVerdict {
  loop: boolean;
  signature: string;
  count: number;
}

export function stableArgs(args: unknown): string {
  if (args === null || args === undefined) return "";
  if (typeof args !== "object") return String(args);
  if (Array.isArray(args)) return `[${args.map(stableArgs).join(",")}]`;
  const o = args as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${k}:${stableArgs(o[k])}`)
    .join(",")}}`;
}

interface Streak {
  signature: string;
  count: number;
}

export class LoopDetector {
  /** The current run of identical tool calls (null after progress). */
  private calls: Streak | null = null;
  /** The current run of identical failing acceptance results (null after a pass or before any failure). */
  private failures: Streak | null = null;
  /** The last test result per command, to tell progress (a different result) from a repeat. */
  private readonly lastResult = new Map<string, string>();
  private tripped: LoopVerdict | null = null;

  constructor(private readonly threshold: number = LOOP_THRESHOLD) {}

  private bump(current: Streak | null, signature: string): Streak {
    return current && current.signature === signature ? { signature, count: current.count + 1 } : { signature, count: 1 };
  }

  private verdict(streak: Streak): LoopVerdict {
    const verdict = { loop: streak.count >= this.threshold, signature: streak.signature, count: streak.count };
    if (verdict.loop && !this.tripped) this.tripped = verdict;
    return verdict;
  }

  /** Record one started tool call by signature; returns the verdict (loop = true once it repeats `threshold` times in a row). */
  record(signature: string): LoopVerdict {
    this.calls = this.bump(this.calls, signature);
    return this.verdict(this.calls);
  }

  recordToolCall(tool: string, args: unknown): LoopVerdict {
    return this.record(`${tool}|${stableArgs(args)}`);
  }

  /** Something changed in the workspace: the next call starts a new run. */
  progressed(): void {
    this.calls = null;
  }

  /**
   * Feed a session event; started tool calls, file changes and test results count. `args` is the call's full input
   * when the runner has it (the live SDK runner): the event's `argsSummary` is cut at 480 characters, so two writes of
   * different files that share a long prefix would otherwise look identical.
   */
  observe(event: SessionEventInput, args?: unknown): LoopVerdict | null {
    if (event.kind === "tool_call" && event.status === "started") return this.record(`${event.connectorKey ?? "builtin"}:${event.tool}|${args === undefined ? (event.argsSummary ?? "") : stableArgs(args)}`);
    if (event.kind === "file_changed") {
      this.progressed();
      return null;
    }
    if (event.kind === "test_result") {
      const command = event.command ?? event.suite ?? "";
      const result = `${event.passed ?? 0}/${event.failed}|${(event.failures ?? []).join(",")}`;
      if (this.lastResult.get(command) !== result) this.progressed();
      this.lastResult.set(command, result);
      if (!event.acceptance) return null;
      if (event.failed > 0) {
        this.failures = this.bump(this.failures, `run_tests|${command}|${(event.failures ?? []).join(",")}`);
        return this.verdict(this.failures);
      }
      this.failures = null;
    }
    return null;
  }

  get loopDetected(): LoopVerdict | null {
    return this.tripped;
  }

  /** Signatures that are one repeat away from tripping (for the Nudge/coach notes). */
  nearLoops(): string[] {
    return [this.calls, this.failures].filter((s): s is Streak => s !== null && s.count === this.threshold - 1).map((s) => s.signature);
  }
}
