/**
 * The next-step facts → rows (docs/UX_AUDIT_AND_PLAN.md §6.2 NextStep, §7.8). Pure and server-safe: the shell already
 * holds every fact (foundations status, the blocking and unread counts, the cycle, the Board), and the routes come from
 * the caller, so this module knows nothing about the router.
 *
 * Day one (no cycle finished yet) is three numbered rows: read what the team drafted, answer the notes in the Inbox,
 * press Continue. After that, the single most relevant line. A step that no longer applies is marked done rather than
 * dropped, so the strip's numbering never moves (DESIGN §2: structure never moves).
 */

/**
 * The specification and roadmap drafts: "drafting" while the team writes them (or before the draft was asked for, which
 * null also means), "ready" once there is something to read, "failed" when the draft broke, "none" for a business that
 * has no first draft at all (committed before foundations existed, imported, or seeded): then there is nothing to read
 * or sign off, and day one is the notes and Continue alone.
 */
export type NextStepFoundationsStatus = "drafting" | "ready" | "failed" | "none" | null;

export interface NextStepFacts {
  /** The specification and roadmap drafts: null before the first draft was asked for. */
  foundationsStatus: NextStepFoundationsStatus;
  /** Notes in Respond that hold Continue. */
  blockingNotes: number;
  /** Notes from the team the founder has not opened. */
  unreadNotes: number;
  cycleRunning: boolean;
  /** The current (running or next) cycle's number; 1 on day one. */
  cycleNumber: number;
  /** Agents with an active task right now. */
  agentsWorking: number;
  /** Distribution has at least one channel on the Board. */
  distributionStarted: boolean;
  /** At least one cycle has completed: day one is over. */
  firstCycleDone: boolean;
}

export type NextStepRouteKey = "vision" | "inboxRespond" | "board";

/** Where each step's "Go" leads; the app supplies them (`/b/<id>/product/vision`, `/b/<id>/inbox/respond`, …). */
export type NextStepRoutes = Record<NextStepRouteKey, string>;

/** The routes as an object or as a callback (`(key) => href`). */
export type NextStepRouter = NextStepRoutes | ((key: NextStepRouteKey) => string);

/** One row of the strip: the data `NextStep` renders. */
export interface NextStepItem {
  id: string;
  label: string;
  /** A route: rendered as a ghost "Go" link through the shell link renderer. */
  href?: string;
  /** An action instead of a route (the app passes "press Continue" through to the top bar's button, for example). */
  onGo?: () => void;
  done?: boolean;
}

function resolve(router: NextStepRouter): (key: NextStepRouteKey) => string {
  return typeof router === "function" ? router : (key) => router[key];
}

function notes(n: number): string {
  return n === 1 ? "1 note" : `${n} notes`;
}

function agents(n: number): string {
  return n === 1 ? "1 agent" : `${n} agents`;
}

/** The line that says a cycle is under way: "Cycle 3 is running · 4 agents at work" (the agents part only when known). */
export function cycleRunningLine(cycleNumber: number, agentsWorking: number): string {
  // plain-allow: the strip that shows this line (NextStep.tsx StepLabel) renders "Cycle" as a Term.
  const base = `Cycle ${Math.max(1, cycleNumber)} is running`;
  return agentsWorking > 0 ? `${base} · ${agents(agentsWorking)} at work` : base;
}

/**
 * The strip's rows for the facts. Day one: three rows that tick off as the facts change (the sign-off notes answered,
 * the first cycle started). Later: one row, the most relevant of "N notes need your answer", "Cycle N is running",
 * "N new notes from the team", "Start distribution" and "Nothing waiting · press Continue when ready". A failed first
 * draft outranks everything: the team cannot work without it.
 */
export function nextStepsFor(facts: NextStepFacts, router: NextStepRouter): NextStepItem[] {
  const href = resolve(router);

  if (facts.foundationsStatus === "failed") {
    return [{ id: "foundations-failed", label: "The team's first draft failed. Open Product to try again", href: href("vision") }];
  }

  if (!facts.firstCycleDone) {
    const go: NextStepItem = facts.cycleRunning
      ? { id: "press-continue", label: cycleRunningLine(facts.cycleNumber, facts.agentsWorking), done: true }
      : { id: "press-continue", label: "Press Continue" };
    // No first draft to wait for or read (an imported or seeded business): the notes, if any, then Continue.
    if (facts.foundationsStatus === "none") {
      const answerNow: NextStepItem = { id: "answer-notes", label: `Answer the ${notes(facts.blockingNotes)} in the Inbox`, href: href("inboxRespond") };
      return facts.blockingNotes > 0 ? [answerNow, go] : [go];
    }
    const drafting = facts.foundationsStatus !== "ready";
    const signedOff = !drafting && facts.blockingNotes === 0;
    const read: NextStepItem = drafting
      ? { id: "read-draft", label: "Wait for the team's first draft of what to build and in what order" }
      : { id: "read-draft", label: "Read what the team drafted", href: href("vision"), done: signedOff };
    const answer: NextStepItem =
      facts.blockingNotes > 0
        ? { id: "answer-notes", label: `Answer the ${notes(facts.blockingNotes)} in the Inbox`, href: href("inboxRespond") }
        : { id: "answer-notes", label: "Answer the notes in the Inbox", href: href("inboxRespond"), done: !drafting };
    return [read, answer, go];
  }

  if (facts.blockingNotes > 0) {
    const n = facts.blockingNotes;
    return [{ id: "answer-notes", label: n === 1 ? "1 note needs your answer" : `${n} notes need your answer`, href: href("inboxRespond") }];
  }
  if (facts.cycleRunning) {
    return [{ id: "cycle-running", label: cycleRunningLine(facts.cycleNumber, facts.agentsWorking) }];
  }
  if (facts.unreadNotes > 0) {
    const n = facts.unreadNotes;
    return [{ id: "read-notes", label: n === 1 ? "1 new note from the team" : `${n} new notes from the team`, href: href("inboxRespond") }];
  }
  if (!facts.distributionStarted) {
    return [{ id: "start-distribution", label: "Start distribution so customers can find you", href: href("board") }];
  }
  return [{ id: "nothing-waiting", label: "Nothing waiting · press Continue when ready" }];
}
