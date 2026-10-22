"use client";
/**
 * A tour's product signal (docs/UX_AUDIT_AND_PLAN.md §11; the guidance.tour_completed / guidance.tour_skipped events):
 * the Coachmark marks the tour done itself (`markTourDone`) and then hands its outcome to `onDone`; `useTourDone`
 * builds that `onDone` so the tour also tells the API how it ended, fire and forget through GuidanceHost's
 * `useGuidanceSignal` (a no-op outside the host, and outside a business route).
 *
 * The Coachmark hands over only "done" or "skipped", so the step the founder left on is read from its card, which is
 * still on the page when `onDone` runs (`data-step`, the 1-based step of the tour as defined). "How many steps the tour
 * showed" counts the steps whose target is on the page as it ends (a step without one was skipped), never fewer than
 * the step the founder reached.
 */
import { useCallback } from "react";
import { findCoachmarkTarget, type CoachmarkOutcome, type CoachmarkStep } from "@foundmill/dugout";
import { useGuidanceSignal, type GuidanceSignalPayload } from "@/components/providers/GuidanceHost";
import { tourCardSelector, type TourId } from "./definitions";

/** The API's bound on a tour's step numbers (packages/events guidance.tour_*). */
const MAX_STEPS = 20;

/** What a tour needs to report itself: its id (a defined tour, or a one-step callout's own id) and its steps. */
export interface SignalTour {
  id: TourId | (string & {});
  steps: readonly Pick<CoachmarkStep, "targetId">[];
}

/** The step the tour's card shows (1-based, as defined), or null when no card is on the page. Exported for tests. */
export function readTourStep(tourId: string, root: ParentNode = document): number | null {
  const card = root.querySelector<HTMLElement>(tourCardSelector(tourId as TourId));
  const n = Number(card?.getAttribute("data-step"));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** How many of the tour's steps have their target on the page (the ones it could show). Exported for tests. */
export function shownSteps(tour: SignalTour): number {
  if (typeof document === "undefined") return tour.steps.length;
  return tour.steps.filter((s) => findCoachmarkTarget(s.targetId) !== null).length;
}

const clamp = (n: number) => Math.min(MAX_STEPS, Math.max(1, Math.round(n)));

export type TourSignal =
  | { kind: "guidance.tour_completed"; payload: GuidanceSignalPayload<"guidance.tour_completed"> }
  | { kind: "guidance.tour_skipped"; payload: GuidanceSignalPayload<"guidance.tour_skipped"> };

/**
 * The signal for a tour that ended: completed with the steps it showed, or skipped with the step the founder left on.
 * `atStep` null (no card read) counts as the first step. Pure; exported for tests.
 */
export function tourSignal(tourId: string, outcome: CoachmarkOutcome, atStep: number | null, shown: number): TourSignal {
  const reached = clamp(atStep ?? 1);
  const steps = clamp(Math.max(shown, reached));
  if (outcome === "done") return { kind: "guidance.tour_completed", payload: { tourId, steps } };
  return { kind: "guidance.tour_skipped", payload: { tourId, atStep: reached, steps } };
}

/**
 * The Coachmark's `onDone` for a tour: sends `guidance.tour_completed` or `guidance.tour_skipped`, then calls `then`
 * (an `onDone` of the caller's own) if given. Never blocks: the signal is fire and forget.
 */
export function useTourDone(tour: SignalTour, then?: (outcome: CoachmarkOutcome) => void): (outcome: CoachmarkOutcome) => void {
  const signal = useGuidanceSignal();
  return useCallback(
    (outcome: CoachmarkOutcome) => {
      try {
        const s = tourSignal(tour.id, outcome, typeof document === "undefined" ? null : readTourStep(tour.id), shownSteps(tour));
        if (s.kind === "guidance.tour_completed") signal(s.kind, s.payload);
        else signal(s.kind, s.payload);
      } catch {
        // A metric never gets in the way of the tour closing.
      }
      then?.(outcome);
    },
    [signal, tour, then],
  );
}
