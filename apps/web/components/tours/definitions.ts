/**
 * The first-visit tours (docs/UX_AUDIT_AND_PLAN.md §6.2 Coachmark, §10 Phase 3): Home, the Inbox, the first
 * department tab a founder opens, and Today (WP-04 T7). Each is a list of Coachmark steps, one sentence each, anchored by a `data-coachmark`
 * attribute on the element it points at. A tour runs once per account (`account_preferences.tours_done`, read and
 * written through `useGuidance`'s `toursDone` and `markTourDone`), only while guidance is on, never while a dialog is
 * open or Continue is processing (the Coachmark itself waits), and "Replay the tour" in Settings › Preferences
 * (`resetGuidance`) brings all three back. A step whose target is not on the page (no department card on this
 * dashboard, no decision open in the Inbox) is skipped.
 *
 * Targets inside the design-system shell carry their attribute natively (Sidebar, ContinueButton, ProcessingStrip,
 * TabBar, DecisionBar). Targets inside widgets and module screens are stamped at run time by the tour (`stamps`:
 * `useCoachmarkStamps` in ./stamps.ts) until those packages carry the attribute themselves.
 */
import type { CoachmarkStep } from "@foundmill/dugout";

export type TourId = "home" | "inbox" | "department" | "today";

/** A target outside the shell: the tour stamps `data-coachmark="<targetId>"` on the first element the selector finds. */
export interface TourStamp {
  targetId: string;
  selector: string;
}

export interface TourDefinition {
  id: TourId;
  steps: readonly CoachmarkStep[];
  stamps: readonly TourStamp[];
  /** Other tours this one stands in for: when it ends they are marked done too, so the founder is not walked twice. */
  alsoDone?: readonly TourId[];
}

/**
 * Home (five steps): the sidebar, Continue, the processing strip, the status strip, a department card. The sidebar step
 * centers its card on the sidebar's height: aligned to its top, the card would sit over the top bar's Switch business
 * (the card is non-modal, so the controls around it stay usable).
 */
export const HOME_TOUR: TourDefinition = {
  id: "home",
  steps: [
    { targetId: "sidebar", title: "Your areas", body: "Your business, one place per question.", side: "right", align: "center" },
    { targetId: "continue", title: "Continue", body: "This runs the team; what they need from you lands in Needs you.", side: "bottom", align: "end" },
    { targetId: "processing-strip", title: "The working light", body: "A light here means the team is working.", side: "bottom" },
    { targetId: "status-strip", title: "The status strip", body: "Your numbers; anything marked Estimate is worked out, not measured.", side: "bottom" },
    { targetId: "department-card", title: "A department card", body: "Each department: who works there and what they are on now.", side: "bottom" },
  ],
  stamps: [
    { targetId: "status-strip", selector: '[data-widget="status_strip"]' },
    { targetId: "department-card", selector: '[data-widget="department_card"]' },
  ],
};

/** The Inbox (four steps): the list and its tags, the reading pane, the decision bar, "Ask <agent>". */
export const INBOX_TOUR: TourDefinition = {
  id: "inbox",
  steps: [
    // At the list's foot, not its head (first-time founder report, Nov 8, 2026): the card sat over the top of the note being read.
    { targetId: "inbox-pane", title: "Notes from the team", body: "Notes land in this list; the tag on each one says what kind of note it is.", side: "right", align: "end" },
    { targetId: "reading-pane", title: "The note", body: "A note says the fact, why it matters and what it asks.", side: "left" },
    { targetId: "decision-bar", title: "Your decision", body: "Every option says what it costs and whether you can undo it.", side: "top" },
    { targetId: "decision-ask", title: "Ask the agent", body: "Talk it through before you decide.", side: "top", align: "end" },
  ],
  stamps: [
    { targetId: "inbox-pane", selector: '[data-testid="inbox-pane"]' },
    { targetId: "reading-pane", selector: '[data-testid="reading-pane"]' },
  ],
};

/** A department tab (three steps): the tabs, the explainer, the table's Simple view and its "…" row actions. */
export const DEPARTMENT_TOUR: TourDefinition = {
  id: "department",
  steps: [
    { targetId: "tabs", title: "This area's screens", body: "Each tab is one screen; More detail holds the rest.", side: "bottom" },
    { targetId: "explainer", title: "What a screen is for", body: "Every screen starts with what it is for.", side: "bottom" },
    { targetId: "table-views", title: "Simple view and row actions", body: "Tables start in the Simple view, and the … at the end of a row holds what you can do with it.", side: "bottom" },
  ],
  stamps: [
    { targetId: "explainer", selector: "[data-explainer]" },
    { targetId: "table-views", selector: 'button[aria-label^="View: "]' },
  ],
};

/**
 * Today (WP-04 T7, three steps): Needs you, the first week, Continue. From the second visit, never on a phone (Today
 * mounts it). Today is the front door, so ending it marks the Home tour done too: Details does not walk the founder again.
 */
export const TODAY_TOUR: TourDefinition = {
  id: "today",
  steps: [
    { targetId: "needs-you", title: "What needs you", body: "Notes waiting for your answer land here, the most important first.", side: "bottom" },
    { targetId: "first-week-timeline", title: "Your first week", body: "What the team does each day this week, and what you will be asked.", side: "bottom" },
    { targetId: "continue", title: "Continue: one round of work", body: "Press it and the team works; what they need from you lands in Needs you.", side: "bottom", align: "end" },
  ],
  stamps: [
    { targetId: "needs-you", selector: '[data-testid="needs-you"]' },
    { targetId: "first-week-timeline", selector: '[data-testid="first-week-timeline"]' },
  ],
  alsoDone: ["home"],
};

export const TOURS: readonly TourDefinition[] = [HOME_TOUR, INBOX_TOUR, DEPARTMENT_TOUR, TODAY_TOUR];

/** A tour's card in the DOM: `[data-coachmark][data-tour="<id>"]` (the Coachmark stamps both on its popover). */
export function tourCardSelector(id: TourId): string {
  return `[data-coachmark][data-tour="${id}"]`;
}
