/**
 * Small typed builders shared by the bundled recordings. Events are `SessionEventDraft`s from
 * `@foundmill/events` (no `at`; replay fills it in), so a recording that drifts from the session
 * event schema fails `tsc`. Progress follows BUILD §11.6 and is computed, never typed by hand.
 */
import type { SessionEventDraft } from "@foundmill/events";
import type { z } from "zod";
import type { RecordedEvent, RecordedHold } from "../recording";

export type Draft<K extends SessionEventDraft["kind"]> = Extract<SessionEventDraft, { kind: K }>;
export type RecordedEventInput = z.input<typeof RecordedEvent>;
export type RecordedHoldInput = z.input<typeof RecordedHold>;

export const ev = (tMs: number, event: SessionEventDraft, hold?: RecordedHoldInput): RecordedEventInput => (hold ? { tMs, event, hold } : { tMs, event });

export const phase = (from: Draft<"phase_changed">["from"], to: Draft<"phase_changed">["to"], reason?: string): SessionEventDraft => ({ kind: "phase_changed", from, to, ...(reason ? { reason } : {}) });

export const note = (text: string, source: Draft<"note">["source"] = "agent", level: Draft<"note">["level"] = "info"): SessionEventDraft => ({ kind: "note", text, source, level });

export const call = (
  callId: string,
  connectorKey: string | null,
  tool: string,
  status: Draft<"tool_call">["status"],
  extra: Omit<Draft<"tool_call">, "kind" | "callId" | "connectorKey" | "tool" | "status"> = {},
): SessionEventDraft => ({ kind: "tool_call", callId, connectorKey, tool, status, ...extra });

/** BUILD §11.6: progress = 0.2·plan + 0.5·acceptance + 0.2·review + 0.1·merged (rounded to 2 dp). */
export const progress = (planStepsDone: number, planSteps: number, acceptanceTestsPassing: number, acceptanceTests: number, reviewPassed = false, merged = false): SessionEventDraft => ({
  kind: "progress",
  progress:
    Math.round(
      (0.2 * (planSteps > 0 ? planStepsDone / planSteps : 0) + 0.5 * (acceptanceTests > 0 ? acceptanceTestsPassing / acceptanceTests : 0) + (reviewPassed ? 0.2 : 0) + (merged ? 0.1 : 0)) * 100,
    ) / 100,
  planStepsDone,
  planSteps,
  acceptanceTestsPassing,
  acceptanceTests,
  reviewPassed,
  merged,
});
