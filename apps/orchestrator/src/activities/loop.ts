/**
 * Loop detection (BUILD §9.4 "same tool+args 3× → fail"). Pure and shared by the mock replay runner, the live Claude
 * Agent SDK runner and the tests. A signature is `tool|args`; acceptance-test runs count too (`run_tests|command|
 * failures`), so an agent re-running the same failing test with the same result trips the detector as well.
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

export class LoopDetector {
  private readonly counts = new Map<string, number>();
  private tripped: LoopVerdict | null = null;

  constructor(private readonly threshold: number = LOOP_THRESHOLD) {}

  /** Record one signature; returns the verdict (loop = true once the threshold is reached). */
  record(signature: string): LoopVerdict {
    const count = (this.counts.get(signature) ?? 0) + 1;
    this.counts.set(signature, count);
    const verdict = { loop: count >= this.threshold, signature, count };
    if (verdict.loop && !this.tripped) this.tripped = verdict;
    return verdict;
  }

  recordToolCall(tool: string, args: unknown): LoopVerdict {
    return this.record(`${tool}|${stableArgs(args)}`);
  }

  /** Feed a session event; only started tool calls and acceptance test results count. */
  observe(event: SessionEventInput): LoopVerdict | null {
    if (event.kind === "tool_call" && event.status === "started") return this.record(`${event.connectorKey ?? "builtin"}:${event.tool}|${event.argsSummary ?? ""}`);
    if (event.kind === "tool_call" && event.status === "failed" && event.callId) return null;
    if (event.kind === "test_result" && event.acceptance && event.failed > 0) {
      return this.record(`run_tests|${event.command ?? event.suite ?? ""}|${(event.failures ?? []).join(",")}`);
    }
    return null;
  }

  get loopDetected(): LoopVerdict | null {
    return this.tripped;
  }

  /** Signatures that are one call away from tripping (for the Shout/coach notes). */
  nearLoops(): string[] {
    return [...this.counts.entries()].filter(([, c]) => c === this.threshold - 1).map(([s]) => s);
  }
}
