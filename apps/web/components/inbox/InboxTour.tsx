"use client";
/**
 * The Inbox tour (docs/UX_AUDIT_AND_PLAN.md §6.2 Coachmark, §10 Phase 3): four steps on the first visit of the Inbox for
 * this account while guidance is on (the list and its tags, the reading pane, the decision bar, "Ask <agent>"). The
 * last two point at a decision's bar, so they show once a decision is open and are skipped otherwise; a note the
 * founder opens mid-tour brings them in. The Coachmark waits while any dialog is open (the first-decision callout
 * included: two coach marks never show at once), marks the tour done on Done, Skip tour or Esc, and replays only after
 * "Replay the tour" in Settings › Preferences. The two panes are stamped with their target ids.
 */
import { LazyTour } from "@/components/tours/LazyTour";

/** Renders nothing (and loads nothing) unless this account will see the tour: see LazyTour. */
export function InboxTour() {
  return <LazyTour id="inbox" />;
}
