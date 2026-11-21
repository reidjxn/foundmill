import { describe, expect, it } from "vitest";
import { cycleRunningLine, nextStepsFor, type NextStepFacts, type NextStepRoutes } from "./nextSteps";

const routes: NextStepRoutes = { vision: "/b/1/product/vision", inboxRespond: "/b/1/inbox/respond", board: "/b/1/distribution/board" };

const dayOne: NextStepFacts = {
  foundationsStatus: "ready",
  blockingNotes: 2,
  unreadNotes: 2,
  cycleRunning: false,
  cycleNumber: 1,
  agentsWorking: 0,
  distributionStarted: false,
  firstCycleDone: false,
};

const later: NextStepFacts = { ...dayOne, blockingNotes: 0, unreadNotes: 0, cycleNumber: 3, agentsWorking: 4, distributionStarted: true, firstCycleDone: true };

describe("nextStepsFor: day one", () => {
  it("is three numbered rows: read the draft, answer the notes, press Continue", () => {
    const steps = nextStepsFor(dayOne, routes);
    expect(steps.map((s) => s.label)).toEqual(["Read what the team drafted", "Answer the 2 notes in the Inbox", "Press Continue"]);
    expect(steps[0]?.href).toBe(routes.vision);
    expect(steps[1]?.href).toBe(routes.inboxRespond);
    expect(steps[2]?.href).toBeUndefined();
    expect(steps.every((s) => !s.done)).toBe(true);
  });

  it("says 'the note' for one blocking note", () => {
    expect(nextStepsFor({ ...dayOne, blockingNotes: 1 }, routes)[1]?.label).toBe("Answer the 1 note in the Inbox");
  });

  it("asks the founder to wait while the team is still drafting, and before a draft was asked for", () => {
    for (const status of ["drafting", null] as const) {
      const steps = nextStepsFor({ ...dayOne, foundationsStatus: status, blockingNotes: 0 }, routes);
      expect(steps[0]?.label).toBe("Wait for the team's first draft of what to build and in what order");
      expect(steps[0]?.href).toBeUndefined();
      expect(steps[0]?.done).toBeFalsy();
      // Nothing to answer yet: the second row is not done either.
      expect(steps[1]?.done).toBeFalsy();
    }
  });

  it("ticks off the first two rows once the sign-off notes are answered, keeping the numbering", () => {
    const steps = nextStepsFor({ ...dayOne, blockingNotes: 0 }, routes);
    expect(steps).toHaveLength(3);
    expect(steps[0]?.done).toBe(true);
    expect(steps[1]?.done).toBe(true);
    expect(steps[1]?.label).toBe("Answer the notes in the Inbox");
    expect(steps[2]?.done).toBeFalsy();
  });

  it("marks the last row done with the running line once round of work 1 is under way", () => {
    const steps = nextStepsFor({ ...dayOne, blockingNotes: 0, cycleRunning: true, agentsWorking: 4 }, routes);
    expect(steps[2]).toMatchObject({ label: "Round of work 1 is running · 4 agents at work", done: true });
  });

  it("skips the draft rows for a business that has no first draft (imported or seeded): the notes, then Continue", () => {
    const steps = nextStepsFor({ ...dayOne, foundationsStatus: "none", blockingNotes: 1 }, routes);
    expect(steps.map((s) => s.id)).toEqual(["answer-notes", "press-continue"]);
    expect(steps[0]).toMatchObject({ label: "Answer the 1 note in the Inbox", href: routes.inboxRespond });
    expect(nextStepsFor({ ...dayOne, foundationsStatus: "none", blockingNotes: 0 }, routes)).toEqual([{ id: "press-continue", label: "Press Continue" }]);
    expect(nextStepsFor({ ...dayOne, foundationsStatus: "none", blockingNotes: 0, cycleRunning: true, agentsWorking: 2 }, routes)).toEqual([{ id: "press-continue", label: "Round of work 1 is running · 2 agents at work", done: true }]);
  });

  it("takes the routes from a callback too", () => {
    const steps = nextStepsFor(dayOne, (key) => `#${key}`);
    expect(steps[0]?.href).toBe("#vision");
    expect(steps[1]?.href).toBe("#inboxRespond");
  });
});

describe("nextStepsFor: after the first round of work", () => {
  it("is one row: the notes that need an answer first", () => {
    expect(nextStepsFor({ ...later, blockingNotes: 2, cycleRunning: true }, routes)).toEqual([{ id: "answer-notes", label: "2 notes need your answer", href: routes.inboxRespond }]);
    expect(nextStepsFor({ ...later, blockingNotes: 1 }, routes)[0]?.label).toBe("1 note needs your answer");
  });

  it("then the running round of work, with the agents at work when known", () => {
    expect(nextStepsFor({ ...later, cycleRunning: true, unreadNotes: 3 }, routes)).toEqual([{ id: "cycle-running", label: "Round of work 3 is running · 4 agents at work" }]);
    expect(nextStepsFor({ ...later, cycleRunning: true, agentsWorking: 1 }, routes)[0]?.label).toBe("Round of work 3 is running · 1 agent at work");
    expect(nextStepsFor({ ...later, cycleRunning: true, agentsWorking: 0 }, routes)[0]?.label).toBe("Round of work 3 is running");
  });

  it("then unread notes from the team", () => {
    expect(nextStepsFor({ ...later, unreadNotes: 3, distributionStarted: false }, routes)).toEqual([{ id: "read-notes", label: "3 new notes from the team", href: routes.inboxRespond }]);
    expect(nextStepsFor({ ...later, unreadNotes: 1 }, routes)[0]?.label).toBe("1 new note from the team");
  });

  it("then starting distribution", () => {
    expect(nextStepsFor({ ...later, distributionStarted: false }, routes)).toEqual([{ id: "start-distribution", label: "Start distribution so customers can find you", href: routes.board }]);
  });

  it("and otherwise says nothing is waiting", () => {
    expect(nextStepsFor(later, routes)).toEqual([{ id: "nothing-waiting", label: "Nothing waiting · press Continue when ready" }]);
  });
});

describe("nextStepsFor: a failed first draft", () => {
  it("outranks everything on day one and after", () => {
    for (const facts of [dayOne, later]) {
      const steps = nextStepsFor({ ...facts, foundationsStatus: "failed", blockingNotes: 2 }, routes);
      expect(steps).toEqual([{ id: "foundations-failed", label: "The team's first draft failed. Open Product to try again", href: routes.vision }]);
    }
  });
});

describe("cycleRunningLine", () => {
  it("never says round of work 0", () => {
    expect(cycleRunningLine(0, 2)).toBe("Round of work 1 is running · 2 agents at work");
  });
});
