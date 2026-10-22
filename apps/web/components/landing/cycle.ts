/**
 * The cycle the landing hero runs on example data: the same loop as the product (Continue → the team works →
 * a decision or a customer comes back → you respond), reduced to a pure reducer over the example business so it is
 * testable without a clock.
 */
import type { ContinueState } from "@foundmill/dugout";
import type { DeptColourToken } from "@foundmill/shared/constants";
import type { CycleOutcome, ExampleBusiness } from "./examples/types";

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

const INBOX_MAX = 5;

/** Tasks the Chief of Staff reports for a cycle: deterministic, so the server and the browser agree. */
export function cycleTasks(cycle: number): { tasks: number; prs: number; departments: number } {
  return { tasks: 7 + ((cycle * 5) % 6), prs: 1 + (cycle % 3), departments: 4 + (cycle % 3) };
}

/** The deck when the page opens: idle after the business's last cycle, with that cycle's note and an earlier decision. */
export function initialCycleState(business: ExampleBusiness): CycleState {
  const start = business.deck.startCycle;
  const t = cycleTasks(start);
  const earlier = business.deck.earlierDecision;
  return {
    cycle: start,
    phase: "idle",
    next: 0,
    current: null,
    pressed: false,
    inbox: [
      // plain-allow: "cycle" is defined where these lines show (CycleDeck's <Term id="cycle">).
      { id: `note-${start}`, title: `Cycle ${start} note`, detail: `${t.tasks} tasks done across ${t.departments} departments, ${t.prs} code changes checked in.`, from: business.chief, tone: "note" },
      { id: "decided-earlier", title: earlier.title, detail: earlier.detail, from: earlier.from, tone: "decided" },
    ],
  };
}

const push = (inbox: InboxItem[], item: InboxItem) => [item, ...inbox.filter((i) => i.id !== item.id)].slice(0, INBOX_MAX);

export function cycleReducer(business: ExampleBusiness, state: CycleState, action: CycleAction): CycleState {
  const outcomes = business.deck.outcomes;
  switch (action.type) {
    case "continue":
      if (state.phase !== "idle") return state;
      return { ...state, phase: "processing", cycle: state.cycle + 1, pressed: state.pressed || !!action.byVisitor };
    case "finish": {
      if (state.phase !== "processing") return state;
      const outcome = outcomes[state.next % outcomes.length]!;
      const t = cycleTasks(state.cycle);
      // Two lines in the deck's Inbox column, so the customer's name is never cut off.
      const result = outcome.kind === "win" ? `New customer: ${outcome.customer}.` : "1 decision for you.";
      // plain-allow: "cycle" is defined where these lines show (CycleDeck's <Term id="cycle">).
      const note: InboxItem = { id: `note-${state.cycle}`, title: `Cycle ${state.cycle} note`, detail: `${t.tasks} tasks done across ${t.departments} departments. ${result}`, from: business.chief, tone: "note" };
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
      const item: InboxItem = { id: `won-${w.id}-${state.cycle}`, title: `Won: ${w.customer}`, detail: w.plan, from: { name: w.standout.name, seed: w.standout.seed, dept: w.standout.dept }, tone: "won" };
      return { ...state, phase: "idle", current: null, inbox: push(state.inbox, item) };
    }
    case "stopAll": {
      if (state.phase !== "processing") return state;
      // plain-allow: "cycle" is defined where these lines show (CycleDeck's <Term id="cycle">).
      const item: InboxItem = { id: `stopped-${state.cycle}`, title: `You stopped cycle ${state.cycle}`, detail: "Every agent paused where it was. Continue picks up from there.", from: business.chief, tone: "note" };
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
      // plain-allow: "cycle" is defined where these lines show (CycleDeck's <Term id="cycle">).
      return `Ready for cycle ${state.cycle + 1}`;
    case "processing":
      // plain-allow: "cycle" is defined where these lines show (CycleDeck's <Term id="cycle">).
      return `Cycle ${state.cycle} running · ${cycleTasks(state.cycle).tasks} tasks across ${cycleTasks(state.cycle).departments} departments`;
    case "decision":
      return "One decision is waiting for you";
    case "win":
      // plain-allow: "cycle" is defined where these lines show (CycleDeck's <Term id="cycle">).
      return "A customer was won this cycle";
  }
}
