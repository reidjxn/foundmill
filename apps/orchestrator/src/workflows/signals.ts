/**
 * Signal and query definitions shared by every workflow (docs/ARCHITECTURE.md §10; names match apps/api's SIGNALS).
 * Pure workflow code: only @temporalio/workflow and types.
 */
import { defineQuery, defineSignal } from "@temporalio/workflow";
import type { ApprovalDecision, ProgressSnapshot, WakePayload } from "../activities/types";

export interface ByPayload {
  by?: string | null;
  at?: string;
}

/**
 * A cycle's pause and resume name the tasks the cycle paused: only their sessions are touched, so a task the founder
 * paused by hand stays paused through a cycle resume (audit OL-25). Absent: every session of the cycle.
 */
export interface CycleHoldPayload extends ByPayload {
  taskIds?: string[];
}

export interface StopPayload extends ByPayload {
  reason: string;
}

export interface ShoutPayload extends ByPayload {
  message: string;
  preset?: string | null;
  modelKey?: string | null;
}

export interface FounderSubmitPayload extends ByPayload {
  /** `submitted`: the founder completed the gated step; `takeover`: the founder took the browser session; `cancel`. */
  kind: "submitted" | "takeover" | "cancel";
  payload?: Record<string, unknown> | null;
}

export const decisionSignal = defineSignal<[ApprovalDecision]>("decision");
export const shoutSignal = defineSignal<[ShoutPayload]>("shout");
export const pauseSignal = defineSignal<[CycleHoldPayload]>("pause");
export const resumeSignal = defineSignal<[CycleHoldPayload]>("resume");
export const stopSignal = defineSignal<[StopPayload]>("stop");
export const founderSubmitSignal = defineSignal<[FounderSubmitPayload]>("founderSubmit");
export const wakeSignal = defineSignal<[WakePayload]>("wake");

export const progressQuery = defineQuery<ProgressSnapshot>("progress");

export type { ApprovalDecision, ProgressSnapshot, WakePayload };
