/**
 * The three tours' definitions (docs/UX_AUDIT_AND_PLAN.md §6.2 Coachmark): the steps the plan names, one sentence each
 * in the product's voice (sentence case, no exclamation marks, US English), every target a `data-coachmark` id the
 * shell carries natively or the tour stamps, and no two tours sharing an id.
 */
import { describe, expect, it } from "vitest";
import { DEPARTMENT_TOUR, HOME_TOUR, INBOX_TOUR, TOURS, tourCardSelector } from "../definitions";

/** The ids the design-system shell carries itself (packages/dugout shell/*: Sidebar, KitBar, ContinueButton, ProcessingStrip, TabBar, DecisionBar). */
const SHELL_TARGETS = new Set(["sidebar", "top-bar", "continue", "processing-strip", "tabs", "decision-bar", "decision-ask"]);

/** One sentence: one terminal mark, at the end. A semicolon joins two halves of the same sentence. */
function sentenceCount(text: string): number {
  return (text.match(/[.?]/g) ?? []).length;
}

describe("tour definitions", () => {
  it("names the three tours with the steps the plan asks for", () => {
    expect(TOURS.map((t) => t.id)).toEqual(["home", "inbox", "department"]);
    expect(HOME_TOUR.steps.map((s) => s.targetId)).toEqual(["sidebar", "continue", "processing-strip", "status-strip", "department-card"]);
    expect(INBOX_TOUR.steps.map((s) => s.targetId)).toEqual(["inbox-pane", "reading-pane", "decision-bar", "decision-ask"]);
    expect(DEPARTMENT_TOUR.steps.map((s) => s.targetId)).toEqual(["tabs", "explainer", "table-views"]);
  });

  it("says the plan's sentences", () => {
    const bodies = (tour: typeof HOME_TOUR) => tour.steps.map((s) => s.body);
    expect(bodies(HOME_TOUR)).toEqual([
      "Your business, one place per question.",
      "This runs the team; what they need from you lands in the Inbox.",
      "A light here means the team is working.",
      "Your numbers; anything marked Estimate is worked out, not measured.",
      "Each department: who works there and what they are on now.",
    ]);
    expect(bodies(INBOX_TOUR).slice(1)).toEqual(["A note says the fact, why it matters and what it asks.", "Every option says what it costs and whether you can undo it.", "Talk it through before you decide."]);
    expect(bodies(DEPARTMENT_TOUR)[1]).toBe("Every screen starts with what it is for.");
  });

  it("writes one sentence per step in sentence case, with no exclamation marks and nothing empty", () => {
    for (const tour of TOURS) {
      for (const step of tour.steps) {
        expect(step.title.trim().length, `${tour.id}/${step.targetId} title`).toBeGreaterThan(0);
        expect(step.body.trim().length, `${tour.id}/${step.targetId} body`).toBeGreaterThan(0);
        expect(step.title, `${tour.id}/${step.targetId} title`).not.toMatch(/!/);
        expect(step.body, `${tour.id}/${step.targetId} body`).not.toMatch(/!/);
        // Sentence case: a capital first letter, and no Title Case run of capitalized words after it.
        expect(step.title[0], `${tour.id}/${step.targetId} title`).toMatch(/[A-Z]/);
        expect(step.body[0], `${tour.id}/${step.targetId} body`).toMatch(/[A-Z]/);
        expect(step.title, `${tour.id}/${step.targetId} title`).not.toMatch(/^(?:[A-Z][a-z]+ ){2,}[A-Z][a-z]+$/);
        // One sentence, ending in a full stop.
        expect(step.body, `${tour.id}/${step.targetId} body`).toMatch(/\.$/);
        expect(sentenceCount(step.body), `${tour.id}/${step.targetId} body`).toBe(1);
        // The headline is a phrase, not a sentence with its own full stop.
        expect(step.title, `${tour.id}/${step.targetId} title`).not.toMatch(/\.$/);
      }
    }
  });

  it("points every step at a target the shell carries or the tour stamps, each id used by one tour only", () => {
    const seen = new Map<string, string>();
    for (const tour of TOURS) {
      const stamped = new Set(tour.stamps.map((s) => s.targetId));
      for (const step of tour.steps) {
        expect(SHELL_TARGETS.has(step.targetId) || stamped.has(step.targetId), `${tour.id}/${step.targetId} has no anchor`).toBe(true);
        expect(seen.get(step.targetId), `${step.targetId} is also in ${seen.get(step.targetId)}`).toBeUndefined();
        seen.set(step.targetId, tour.id);
      }
      // A stamp never shadows a shell anchor, and every stamp is used by a step.
      for (const stamp of tour.stamps) {
        expect(SHELL_TARGETS.has(stamp.targetId), `${tour.id} stamps ${stamp.targetId}, which the shell carries`).toBe(false);
        expect(tour.steps.some((s) => s.targetId === stamp.targetId), `${tour.id} stamps ${stamp.targetId} without a step`).toBe(true);
        expect(() => document.querySelector(stamp.selector)).not.toThrow();
      }
    }
  });

  it("names a tour's card by its data-tour attribute", () => {
    expect(tourCardSelector("home")).toBe('[data-coachmark][data-tour="home"]');
  });
});
