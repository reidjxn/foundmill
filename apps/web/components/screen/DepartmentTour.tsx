"use client";
/**
 * The department tour (docs/UX_AUDIT_AND_PLAN.md §6.2 Coachmark, §10 Phase 3): three steps on the first department tab
 * this account opens while guidance is on (the tabs, the screen's explainer, the table's Simple view with its "…" row
 * actions). One tour for every department: it marks itself done on Done, Skip tour or Esc and never replays until
 * "Replay the tour" in Settings › Preferences. A tab without an explainer or a table skips those steps. The explainer
 * and the table's view selector are stamped with their target ids (they live in @foundmill/modules and the data
 * table); the tabs carry theirs in the shell's TabBar.
 */
import { Coachmark } from "@foundmill/dugout";
import { DEPARTMENT_TOUR } from "@/components/tours/definitions";
import { useCoachmarkStamps } from "@/components/tours/stamps";

export function DepartmentTour() {
  useCoachmarkStamps(DEPARTMENT_TOUR.stamps);
  return <Coachmark tourId={DEPARTMENT_TOUR.id} steps={DEPARTMENT_TOUR.steps} />;
}
