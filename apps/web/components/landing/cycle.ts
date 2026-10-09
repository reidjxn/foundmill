/**
 * The cycle the landing hero runs on example data: the same loop as the product (Continue → the team works →
 * a decision or a customer comes back → you respond), reduced to a pure reducer so it is testable without a clock.
 */
import type { ContinueState } from "@foundmill/dugout";
import type { DeptColourToken } from "@foundmill/shared";
import { CYCLE_OUTCOMES, EXAMPLE_START_CYCLE, type CycleOutcome } from "./example";

export type CyclePhase = "idle" | "processing" | "decision" | "win";

export interface InboxItem {
  id: string;
  title: string;
  detail: string;
  from: { name: string; seed: string; dept: DeptColourToken };
  tone: "note" | "decided" | "won";
}

export interface CycleState {
  /** The cycle running now, or the last one that finished. */
  cycle: number;
  phase: CyclePhase;
  /** Index into the outcomes of the next cycle's result. */
  next: number;
  /** The decision or win waiting for the founder. */
  current: CycleOutcome | null;
  /** Earlier Inbox items, newest first (at most five). */
  inbox: InboxItem[];
  /** The visitor pressed Continue themselves at least once. */
  pressed: boolean;
}

export type CycleAction =
  | { type: "continue"; byVisitor?: boolean }
  | { type: "finish" }
  | { type: "decide"; optionId: string }
  | { type: "openWin" }
  | { type: "stopAll" };

const CHIEF = { name: "Orla", seed: "orla", dept: "dept-1" } as const;
const INBOX_MAX = 5;

/** Tasks the Chief of Staff reports for a cycle: deterministic, so the server and the browser agree. */
export function cycleTasks(cycle: number): { tasks: number; prs: number; departments: number } {
  return { tasks: 7 + ((cycle * 5) % 6), prs: 1 + (cycle % 3), departments: 4 + (cycle % 3) };
}

export function initialCycleState(): CycleState {
  const t = cycleTasks(EXAMPLE_START_CYCLE);
  return {
    cycle: EXAMPLE_START_CYCLE,
    phase: "idle",
    next: 0,
    current: null,
    pressed: false,
    inbox: [
      { id: `note-${EXAMPLE_START_CYCLE}`, title: `Cycle ${EXAMPLE_START_CYCLE} note`, detail: `${t.tasks} tasks done across ${t.departments} departments, ${t.prs} pull requests merged.`, from: CHIEF, tone: "note" },
      { id: "decided-domain", title: "You approved the domain renewal", detail: "Development renewed it for two years.", from: { name: "Forge", seed: "forge", dept: "dept-2" }, tone: "decided" },
    ],
  };
}

const push = (inbox: InboxItem[], item: InboxItem) => [item, ...inbox.filter((i) => i.id !== item.id)].slice(0, INBOX_MAX);

export function cycleReducer(state: CycleState, action: CycleAction): CycleState {
  switch (action.type) {
    case "continue":
      if (state.phase !== "idle") return state;
      return { ...state, phase: "processing", cycle: state.cycle + 1, pressed: state.pressed || !!action.byVisitor };
    case "finish": {
      if (state.phase !== "processing") return state;
      const outcome = CYCLE_OUTCOMES[state.next % CYCLE_OUTCOMES.length]!;
      const t = cycleTasks(state.cycle);
      const result = outcome.kind === "win" ? `A customer was won: ${outcome.customer}.` : "1 decision for you.";
      const note: InboxItem = { id: `note-${state.cycle}`, title: `Cycle ${state.cycle} note`, detail: `${t.tasks} tasks done across ${t.departments} departments. ${result}`, from: CHIEF, tone: "note" };
      return { ...state, phase: outcome.kind, current: outcome, next: state.next + 1, inbox: push(state.inbox, note) };
    }
    case "decide": {
      if (state.phase !== "decision" || state.current?.kind !== "decision") return state;
      const d = state.current;
      const option = d.options.find((o) => o.id === action.optionId) ?? d.options[0]!;
      const item: InboxItem = { id: `decided-${d.id}-${state.cycle}`, title: option.done, detail: option.outcome, from: { name: d.from.name, seed: d.from.seed, dept: d.from.dept }, tone: "decided" };
      return { ...state, phase: "idle", current: null, inbox: push(state.inbox, item) };
    }
    case "openWin": {
      if (state.phase !== "win" || state.current?.kind !== "win") return state;
      const w = state.current;
      const item: InboxItem = { id: `won-${w.id}-${state.cycle}`, title: `${w.customer} is a paying customer`, detail: w.plan, from: { name: w.standout.name, seed: w.standout.seed, dept: w.standout.dept }, tone: "won" };
      return { ...state, phase: "idle", current: null, inbox: push(state.inbox, item) };
    }
    case "stopAll": {
      if (state.phase !== "processing") return state;
      const item: InboxItem = { id: `stopped-${state.cycle}`, title: `You stopped cycle ${state.cycle}`, detail: "Every agent paused where it was. Continue picks up from there.", from: CHIEF, tone: "note" };
      return { ...state, phase: "idle", cycle: state.cycle - 1, inbox: push(state.inbox, item) };
    }
  }
}

/** The Continue button's state for a phase (the product's own states). */
export function continueStateFor(state: CycleState): ContinueState {
  switch (state.phase) {
    case "idle":
      return { kind: "idle" };
    case "processing":
      return { kind: "processing" };
    case "decision":
      return { kind: "blocked", count: 1 };
    case "win":
      return { kind: "matchday" };
  }
}

/** One line under the orbit saying where the cycle is. */
export function cycleStatusText(state: CycleState): string {
  switch (state.phase) {
    case "idle":
      return `Ready for cycle ${state.cycle + 1}`;
    case "processing":
      return `Cycle ${state.cycle} running · ${cycleTasks(state.cycle).tasks} tasks across ${cycleTasks(state.cycle).departments} departments`;
    case "decision":
      return "One decision is waiting for you";
    case "win":
      return "A customer was won this cycle";
  }
}
