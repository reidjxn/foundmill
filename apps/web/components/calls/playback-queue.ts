/**
 * The call's playback queue as a pure reducer (docs/TEAM_CALL.md §6): every new agent turn joins the queue in `seq`
 * order; its speech is fetched as soon as it arrives, the next one while one plays; turns play one at a time in order.
 * The queue holds no audio, only where each turn stands: the hook keeps the audio and drives the browser.
 */

export type QueueStatus = "queued" | "fetching" | "ready" | "failed" | "playing" | "done" | "skipped";

export interface QueueItem {
  id: string;
  seq: number;
  agentId: string;
  status: QueueStatus;
}

export interface QueueState {
  items: QueueItem[];
  /**
   * The founder has started to speak and what they said is not yet known: nothing new starts, and the turn playing is
   * paused (the hook pauses the audio). A sound that never becomes a line (a cough, a click, an empty transcript)
   * releases the hold and the team carries on; a line that is sent stops the team instead.
   */
  held?: boolean;
}

export type QueueAction =
  | { type: "enqueue"; turns: readonly { id: string; seq: number; agentId: string }[] }
  | { type: "fetching"; id: string }
  | { type: "ready"; id: string }
  | { type: "failed"; id: string }
  | { type: "playing"; id: string }
  | { type: "ended"; id: string }
  /** The founder said something (spoken or typed), or the call ended: everything unfinished is dropped. */
  | { type: "stop" }
  /** The founder began to speak: hold the team until it is known whether they said anything. */
  | { type: "hold" }
  /** What the founder said came to nothing (or the mic went off mid-word): the team carries on where it was. */
  | { type: "release" };

export const EMPTY_QUEUE: QueueState = { items: [] };

/** How many unfinished turns have their speech fetched ahead: the one playing and the next. */
export const FETCH_AHEAD = 2;

const FINISHED: readonly QueueStatus[] = ["done", "skipped"];
const isOpen = (i: QueueItem) => !FINISHED.includes(i.status);

const withStatus = (state: QueueState, id: string, from: readonly QueueStatus[], to: QueueStatus): QueueState => {
  const hit = state.items.find((i) => i.id === id);
  if (!hit || !from.includes(hit.status)) return state;
  return { ...state, items: state.items.map((i) => (i.id === id ? { ...i, status: to } : i)) };
};

export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case "enqueue": {
      const known = new Set(state.items.map((i) => i.id));
      const fresh = action.turns.filter((t) => !known.has(t.id)).map((t): QueueItem => ({ id: t.id, seq: t.seq, agentId: t.agentId, status: "queued" }));
      if (fresh.length === 0) return state;
      return { ...state, items: [...state.items, ...fresh].sort((a, b) => a.seq - b.seq) };
    }
    case "fetching":
      return withStatus(state, action.id, ["queued"], "fetching");
    case "ready":
      return withStatus(state, action.id, ["fetching", "queued"], "ready");
    case "failed":
      return withStatus(state, action.id, ["fetching", "queued"], "failed");
    case "playing":
      return withStatus(state, action.id, ["ready", "failed"], "playing");
    case "ended":
      return withStatus(state, action.id, ["playing"], "done");
    case "stop": {
      if (!state.items.some(isOpen)) return state;
      return { ...state, items: state.items.map((i) => (isOpen(i) ? { ...i, status: "skipped" as const } : i)) };
    }
    case "hold":
      return state.held ? state : { ...state, held: true };
    case "release":
      return state.held ? { ...state, held: false } : state;
  }
}

/** Turn ids whose speech should be fetched now: the first `ahead` unfinished turns that are still waiting. */
export function toFetch(state: QueueState, ahead = FETCH_AHEAD): string[] {
  return state.items.filter(isOpen).slice(0, ahead).filter((i) => i.status === "queued").map((i) => i.id);
}

/**
 * The turn to start playing now, or null: nothing plays while another does, and turns play strictly in order, so the
 * first unfinished turn must be ready (or failed, which plays silently for its reading time). Nothing starts while held.
 */
export function toPlay(state: QueueState): QueueItem | null {
  if (state.held) return null;
  const first = state.items.find(isOpen);
  return first && (first.status === "ready" || first.status === "failed") ? first : null;
}

export const playingItem = (state: QueueState): QueueItem | null => state.items.find((i) => i.status === "playing") ?? null;

/** True when every turn has played (or was dropped): the team is quiet. */
export const queueIdle = (state: QueueState): boolean => !state.items.some(isOpen);
