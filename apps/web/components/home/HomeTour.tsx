"use client";
/**
 * The Home tour (docs/UX_AUDIT_AND_PLAN.md §6.2 Coachmark, §10 Phase 3): five steps on the first visit of Home for this
 * account while guidance is on (the sidebar, Continue, the processing strip, the status strip, a department card). The
 * Coachmark waits while Continue is processing or any dialog is open, marks the tour done on Done, Skip tour or Esc, and
 * never replays until "Replay the tour" in Settings › Preferences clears the mark. HomeScreen mounts it once the
 * dashboard is on screen, so the grid's widgets are there to be pointed at; the status strip and the department card
 * are stamped with their target ids (they live in @foundmill/widgets).
 */
import { LazyTour } from "@/components/tours/LazyTour";

/** Renders nothing (and loads nothing) unless this account will see the tour: see LazyTour. */
export function HomeTour() {
  return <LazyTour id="home" />;
}
