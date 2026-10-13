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
export const pauseSignal = defineSignal<[ByPayload]>("pause");
export const resumeSignal = defineSignal<[ByPayload]>("resume");
export const stopSignal = defineSignal<[StopPayload]>("stop");
export const founderSubmitSignal = defineSignal<[FounderSubmitPayload]>("founderSubmit");
export const wakeSignal = defineSignal<[WakePayload]>("wake");
/** Autopilot: look at the guard rails again now (its settings changed, or it was turned on again). */
export const autopilotRefreshSignal = defineSignal<[ByPayload]>("autopilotRefresh");

export const progressQuery = defineQuery<ProgressSnapshot>("progress");

export type { ApprovalDecision, ProgressSnapshot, WakePayload };
