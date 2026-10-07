/**
 * Recorded agent sessions for the mock sandbox (BUILD §13.3 "a mock sandbox that replays recorded agent
 * sessions"). A recording is a typed TypeScript module in ./recordings (docs/DECISIONS.md "Mock sandbox
 * recordings are TypeScript, not JSON"): metadata, a small virtual filesystem, canned command results and a
 * timed list of `SessionEvent`s (without `at`, which replay fills in).
 *
 * Event payloads are typed as `SessionEventDraft` from `@foundmill/events` (so drift fails `tsc`) and
 * validated in full against the events package's Zod schemas by `recordings.test.ts`; at runtime this
 * module checks the envelope and ordering.
 */
import { ModelKey, TaskKind } from "@foundmill/shared";
import { z } from "zod";
import { SandboxRepo } from "../types";

/** Mirrors `SESSION_EVENT_KINDS` in @foundmill/events (asserted equal by recordings.test.ts). */
export const REPLAYABLE_EVENT_KINDS = ["tool_call", "stdout", "file_changed", "test_result", "phase_changed", "progress", "note"] as const;
export type ReplayableEventKind = (typeof REPLAYABLE_EVENT_KINDS)[number];

export const RECORDING_OUTCOMES = ["done", "blocked", "failed", "stopped"] as const;
export const RecordingOutcome = z.enum(RECORDING_OUTCOMES);
export type RecordingOutcome = (typeof RECORDING_OUTCOMES)[number];

export const ApprovalDecision = z.enum(["approved", "rejected"]);
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

/** After emitting the event, the replay waits for an approval decision (the Temporal `approval` signal in the real runtime). */
export const RecordedHold = z.object({
  kind: z.literal("approval"),
  approvalId: z.string().min(1),
  /** Replay-time ms after which the hold resolves itself with `autoResolveOutcome`; null = wait for `decide()`. */
  autoResolveAfterMs: z.number().int().positive().nullable().default(null),
  autoResolveOutcome: ApprovalDecision.default("approved"),
});
export type RecordedHold = z.infer<typeof RecordedHold>;

export const RecordedEvent = z.object({
  /** Milliseconds since session start in the recording's own timeline (non-decreasing across the file). */
  tMs: z.number().int().nonnegative(),
  /** A `SessionEventInput` without `at`. Fully validated against the events package in tests. */
  event: z.looseObject({ kind: z.enum(REPLAYABLE_EVENT_KINDS) }),
  hold: RecordedHold.optional(),
});
export type RecordedEvent = z.infer<typeof RecordedEvent>;

export const CannedExecResult = z.object({
  code: z.number().int().default(0),
  stdout: z.string().default(""),
  stderr: z.string().default(""),
  /** Simulated duration reported in `ExecResult.durationMs`. */
  durationMs: z.number().int().nonnegative().default(120),
});
export type CannedExecResult = z.infer<typeof CannedExecResult>;

export const CannedCommand = z.object({
  /** Regular expression tested against the command line. First matching command wins. */
  match: z.string().min(1),
  /** Results returned in order for successive calls; the last one repeats. */
  results: z.array(CannedExecResult).min(1),
});
export type CannedCommand = z.infer<typeof CannedCommand>;

export const Recording = z
  .object({
    key: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case key"),
    title: z.string().min(1).max(200),
    summary: z.string().min(1).max(1000),
    taskKind: TaskKind,
    /** Agent template key the session was recorded from (packages/agents). Informational. */
    agentTemplate: z.string().min(1),
    modelKey: ModelKey,
    /** Business the fixture belongs to (seed names, BUILD §17.2). Informational. */
    business: z.string().min(1),
    repo: SandboxRepo.optional(),
    workdir: z.string().min(1).default("/home/user/work"),
    /** Initial virtual filesystem (relative to workdir unless absolute). */
    files: z.record(z.string(), z.string()).default({}),
    commands: z.array(CannedCommand).default([]),
    planSteps: z.number().int().nonnegative(),
    acceptanceTests: z.number().int().nonnegative(),
    outcome: RecordingOutcome,
    events: z.array(RecordedEvent).min(1),
  })
  .refine((r) => r.events.every((e, i) => i === 0 || e.tMs >= r.events[i - 1]!.tMs), {
    message: "events must be ordered by non-decreasing tMs",
    path: ["events"],
  });
export type RecordingInput = z.input<typeof Recording>;
export type Recording = z.output<typeof Recording>;

export function parseRecording(raw: unknown): Recording {
  return Recording.parse(raw);
}

/** Recorded duration = offset of the last event. */
export function recordingDurationMs(rec: Recording): number {
  return rec.events[rec.events.length - 1]?.tMs ?? 0;
}

/** FNV-1a 32-bit; stable across runs and platforms so the same task id always replays the same recording. */
export function stableHash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
