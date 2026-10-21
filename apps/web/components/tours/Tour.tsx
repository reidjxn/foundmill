"use client";
/**
 * One first-visit tour, mounted whole (docs/UX_AUDIT_AND_PLAN.md §6.2 Coachmark, §10 Phase 3, §11): it stamps the
 * targets outside the shell (`useCoachmarkStamps`), runs the Coachmark, and reports how it ended (`useTourDone`: the
 * guidance.tour_completed / guidance.tour_skipped signal). HomeTour, InboxTour and DepartmentTour are this with their
 * definition: `<Tour tour={HOME_TOUR} />`.
 */
import { Coachmark, type CoachmarkOutcome } from "@foundmill/dugout";
import type { TourDefinition } from "./definitions";
import { useTourDone } from "./signal";
import { useCoachmarkStamps } from "./stamps";

export interface TourProps {
  tour: TourDefinition;
  /** Called after the tour is marked done and its signal sent. */
  onDone?: (outcome: CoachmarkOutcome) => void;
}

export function Tour({ tour, onDone }: TourProps) {
  useCoachmarkStamps(tour.stamps);
  const done = useTourDone(tour, onDone);
  return <Coachmark tourId={tour.id} steps={tour.steps} onDone={done} />;
}
