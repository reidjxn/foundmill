/**
 * The one sentence a press of Continue earns (first-time founder report, Nov 8, 2026, P0 "Continue must always
 * answer"): what happened, in the founder's terms, decided here from facts the press already holds so the shell can show
 * it the moment the answer lands. Exactly one of: a cycle started and how much is ready to build; nothing is ready and
 * why (the sign-off, the drafting, a finished plan); the orchestrator is not reachable, so no agent worked; a paused
 * cycle resumed; a cycle is already running. Never "Cycle started" over a screen that still says "No cycle running".
 */
import { RUN_UNTIL_DONE, type ProductStage } from "@foundmill/shared";

export type ContinueSummaryKind = "started" | "nothing_ready" | "orchestrator_unreachable" | "resumed" | "already_running";

export interface ContinueSummary {
  kind: ContinueSummaryKind;
  /** The first line, Builder view's: "Cycle 2 started: 6 tasks ready to build" (cycle numbers are Builder view's, docs/DESIGN.md). */
  headline: string;
  /** The same line for everyone else, in the founder's words (a "round of work", no number): "The next round of work started: 6 tasks ready to build". */
  plainHeadline: string;
  /** What that means and what comes next, one or two sentences. */
  detail: string;
  /** Tasks the cycle can start now (planned or ready, nothing open before them). */
  readyTasks: number;
  stage: ProductStage;
  /** Whether the orchestrator ran this press: false means one in-process note stood in for a cycle. */
  orchestrator: boolean;
}

export interface ContinueSummaryFacts {
  cycleNumber: number;
  readyTasks: number;
  stage: ProductStage;
  /** A run started with this press: new cycles follow on their own. */
  run: boolean;
}

const tasks = (n: number) => `${n} task${n === 1 ? "" : "s"}`;

/** Why nothing is ready to build, by stage; the team still runs its round (planning, research, the channels). */
export function nothingReadyDetail(stage: ProductStage): string {
  switch (stage) {
    case "drafting":
      return "The specification and the roadmap are still being drafted. The team runs what it can meanwhile.";
    case "awaiting_signoff":
      return "The specification and the roadmap are waiting for your sign-off in the Inbox. Building starts when both are approved; meanwhile the team plans what it can.";
    case "building":
    case "selling":
      return "Every task is done, blocked or waiting on you. The team plans the next roadmap items and looks for what else it can do.";
  }
}

/** A cycle the orchestrator took: what it has to work with. */
export function startedSummary(f: ContinueSummaryFacts): ContinueSummary {
  const after = f.run ? ` ${RUN_UNTIL_DONE}` : "";
  if (f.readyTasks > 0) {
    return {
      kind: "started",
      headline: `Cycle ${f.cycleNumber} started: ${tasks(f.readyTasks)} ready to build`,
      plainHeadline: `The next round of work started: ${tasks(f.readyTasks)} ready to build`,
      detail: `The team is at work. What they finish and what they need from you come back as notes in the Inbox.${after}`,
      readyTasks: f.readyTasks,
      stage: f.stage,
      orchestrator: true,
    };
  }
  return {
    kind: "nothing_ready",
    headline: `Cycle ${f.cycleNumber} started: nothing is ready to build yet`,
    plainHeadline: "The next round of work started: nothing is ready to build yet",
    detail: `${nothingReadyDetail(f.stage)}${after}`,
    readyTasks: 0,
    stage: f.stage,
    orchestrator: true,
  };
}

/** No orchestrator took the press: one in-process note was written, and the founder is told so. */
export function orchestratorUnreachableSummary(f: Omit<ContinueSummaryFacts, "run"> & { noteSubject: string }): ContinueSummary {
  return {
    kind: "orchestrator_unreachable",
    headline: "The team cannot run right now: the orchestrator is not reachable",
    plainHeadline: "The team cannot run right now: the orchestrator is not reachable",
    detail: `No agent worked. One note was written from what the business already knows: “${f.noteSubject}”. Start the orchestrator (or ask whoever runs this server to), then press Continue again.`,
    readyTasks: f.readyTasks,
    stage: f.stage,
    orchestrator: false,
  };
}

export function resumedSummary(f: ContinueSummaryFacts & { resumedTasks: number }): ContinueSummary {
  const after = f.run ? ` ${RUN_UNTIL_DONE}` : "";
  return {
    kind: "resumed",
    headline: `Cycle ${f.cycleNumber} resumed`,
    plainHeadline: "The round of work resumed",
    detail: `${f.resumedTasks > 0 ? `${tasks(f.resumedTasks)} pick${f.resumedTasks === 1 ? "s" : ""} up where ${f.resumedTasks === 1 ? "it" : "they"} stopped.` : "Paused tasks pick up where they stopped."}${after}`,
    readyTasks: f.readyTasks,
    stage: f.stage,
    orchestrator: true,
  };
}

export function alreadyRunningSummary(f: ContinueSummaryFacts): ContinueSummary {
  return {
    kind: "already_running",
    headline: `Cycle ${f.cycleNumber} is already running`,
    plainHeadline: "A round of work is already running",
    detail: f.run ? `The team is still working. ${RUN_UNTIL_DONE}` : "The team is still working; the strip under the top bar shows where.",
    readyTasks: f.readyTasks,
    stage: f.stage,
    orchestrator: true,
  };
}
