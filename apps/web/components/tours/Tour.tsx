"use client";
/**
 * One first-visit tour, mounted whole (docs/UX_AUDIT_AND_PLAN.md §6.2 Coachmark, §10 Phase 3, §11): it stamps the
 * targets outside the shell (`useCoachmarkStamps`), runs the Coachmark, and reports how it ended (`useTourDone`: the
 * guidance.tour_completed / guidance.tour_skipped signal). HomeTour, InboxTour and DepartmentTour mount it through
 * `LazyTour` (./LazyTour.tsx), which loads this module, the definitions included, only for someone who will see the
 * tour: `TourById` is its entry point.
 */
import { useCallback } from "react";
import { Coachmark, useGuidance, type CoachmarkOutcome } from "@foundmill/dugout";
import { TOURS, type TourDefinition, type TourId } from "./definitions";
import { useTourDone } from "./signal";
import { useCoachmarkStamps } from "./stamps";

export interface TourProps {
  tour: TourDefinition;
  /** Called after the tour is marked done and its signal sent. */
  onDone?: (outcome: CoachmarkOutcome) => void;
}

export function Tour({ tour, onDone }: TourProps) {
  const stamped = useCoachmarkStamps(tour.stamps);
  const { markTourDone } = useGuidance();
  // A tour that stands in for others (Today for Home, WP-04 T7) marks them done when it ends, whichever way it ends.
  const alsoDone = tour.alsoDone;
  const then = useCallback(
    (outcome: CoachmarkOutcome) => {
      for (const id of alsoDone ?? []) markTourDone(id);
      onDone?.(outcome);
    },
    [alsoDone, markTourDone, onDone],
  );
  const done = useTourDone(tour, then);
  return stamped ? <Coachmark tourId={tour.id} steps={tour.steps} onDone={done} /> : null;
}

/** A defined tour by its id (LazyTour's entry point, so the definitions load with the tour). */
export function TourById({ id }: { id: TourId }) {
  const tour = TOURS.find((t) => t.id === id);
  return tour ? <Tour tour={tour} /> : null;
}
