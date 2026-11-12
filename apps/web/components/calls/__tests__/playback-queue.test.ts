import { describe, expect, it } from "vitest";
import { EMPTY_QUEUE, playingItem, queueIdle, queueReducer, toFetch, toPlay, type QueueAction, type QueueState } from "../playback-queue";

const turn = (n: number) => ({ id: `t${n}`, seq: n, agentId: `a${n}` });
const run = (actions: QueueAction[], from: QueueState = EMPTY_QUEUE) => actions.reduce(queueReducer, from);
const statuses = (s: QueueState) => s.items.map((i) => `${i.id}:${i.status}`);

describe("playback queue", () => {
  it("queues turns in seq order, each once", () => {
    const s = run([{ type: "enqueue", turns: [turn(3), turn(1)] }, { type: "enqueue", turns: [turn(1), turn(2)] }]);
    expect(s.items.map((i) => i.id)).toEqual(["t1", "t2", "t3"]);
  });

  it("fetches the first two unfinished turns ahead: the one to play and the next", () => {
    let s = run([{ type: "enqueue", turns: [turn(1), turn(2), turn(3)] }]);
    expect(toFetch(s)).toEqual(["t1", "t2"]);
    s = run([{ type: "fetching", id: "t1" }, { type: "fetching", id: "t2" }], s);
    expect(toFetch(s)).toEqual([]);
    // t1 plays and ends: t3 enters the window while t2 is already fetched.
    s = run([{ type: "ready", id: "t1" }, { type: "playing", id: "t1" }, { type: "ended", id: "t1" }], s);
    expect(toFetch(s)).toEqual(["t3"]);
  });

  it("plays strictly in order, one at a time, waiting for the first turn even when a later one is ready", () => {
    let s = run([{ type: "enqueue", turns: [turn(1), turn(2)] }, { type: "fetching", id: "t1" }, { type: "fetching", id: "t2" }, { type: "ready", id: "t2" }]);
    expect(toPlay(s)).toBeNull();
    s = run([{ type: "ready", id: "t1" }], s);
    expect(toPlay(s)?.id).toBe("t1");
    s = run([{ type: "playing", id: "t1" }], s);
    expect(playingItem(s)?.agentId).toBe("a1");
    expect(toPlay(s)).toBeNull();
    s = run([{ type: "ended", id: "t1" }], s);
    expect(toPlay(s)?.id).toBe("t2");
  });

  it("a turn whose speech failed still takes its turn (it plays silently), so the call keeps its order", () => {
    const s = run([{ type: "enqueue", turns: [turn(1), turn(2)] }, { type: "fetching", id: "t1" }, { type: "failed", id: "t1" }]);
    expect(toPlay(s)?.id).toBe("t1");
    expect(statuses(run([{ type: "playing", id: "t1" }, { type: "ended", id: "t1" }], s))).toEqual(["t1:done", "t2:queued"]);
  });

  it("stop (barge-in) drops everything unfinished and keeps what was said", () => {
    let s = run([{ type: "enqueue", turns: [turn(1), turn(2), turn(3)] }, { type: "ready", id: "t1" }, { type: "playing", id: "t1" }, { type: "ended", id: "t1" }, { type: "ready", id: "t2" }, { type: "playing", id: "t2" }]);
    s = run([{ type: "stop" }], s);
    expect(statuses(s)).toEqual(["t1:done", "t2:skipped", "t3:skipped"]);
    expect(queueIdle(s)).toBe(true);
    expect(toPlay(s)).toBeNull();
    expect(toFetch(s)).toEqual([]);
    // A late answer for a dropped turn changes nothing.
    expect(run([{ type: "ready", id: "t3" }], s)).toBe(s);
  });

  it("is idle only when every turn has been said or dropped", () => {
    expect(queueIdle(EMPTY_QUEUE)).toBe(true);
    expect(queueIdle(run([{ type: "enqueue", turns: [turn(1)] }]))).toBe(false);
  });

  it("ignores transitions that do not apply", () => {
    const s = run([{ type: "enqueue", turns: [turn(1)] }]);
    expect(run([{ type: "ended", id: "t1" }], s)).toBe(s);
    expect(run([{ type: "playing", id: "t1" }], s)).toBe(s);
    expect(run([{ type: "ready", id: "missing" }], s)).toBe(s);
  });
});
