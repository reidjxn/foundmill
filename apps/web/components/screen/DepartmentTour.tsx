"use client";
/**
 * The department tour (docs/UX_AUDIT_AND_PLAN.md §6.2 Coachmark, §10 Phase 3): three steps on the first department tab
 * this account opens while guidance is on (the tabs, the screen's explainer, the table's Simple view with its "…" row
 * actions). One tour for every department: it marks itself done on Done, Skip tour or Esc and never replays until
 * "Replay the tour" in Settings › Preferences. A tab without an explainer or a table skips those steps. The explainer
 * and the table's view selector are stamped with their target ids (they live in @foundmill/modules and the data
 * table); the tabs carry theirs in the shell's TabBar.
 */
import { LazyTour } from "@/components/tours/LazyTour";

/** Renders nothing (and loads nothing) unless this account will see the tour: see LazyTour. */
export function DepartmentTour() {
  return <LazyTour id="department" />;
}
