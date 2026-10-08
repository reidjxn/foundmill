import { describe, expect, it, vi } from "vitest";
import { computeProgress, type AgentSessionEvent } from "@foundmill/dugout";
import { SessionThrottle, baseSession, concurrencyHint, latestSessionsByTask, openSessionsByTask, placeholderSessionId, readSessionEvent, seedFromRows } from "../session-store";
import { toTileAgent } from "../shared";
import { AGENT_JUNO, SESSION_BUNDLE, TASK_BUNDLE, agents, bundleEvents, rawFrame, sessions, tasks } from "./fixtures";

const bundle = tasks[0]!;
const bundleSession = sessions[0]!;

describe("readSessionEvent", () => {
  const event = bundleEvents()[1]!;
  it("accepts the event object, the relay's { kind, json } pair and the { ch, e } frame", () => {
    expect(readSessionEvent(event)).toEqual(event);
    expect(readSessionEvent(rawFrame(event))).toEqual(event);
    expect(readSessionEvent({ ch: `as:${SESSION_BUNDLE}`, e: rawFrame(event) })).toEqual(event);
  });
  it("rejects platform events, pongs and malformed frames", () => {
    expect(readSessionEvent({ type: "task.started", payload: {} })).toBeNull();
    expect(readSessionEvent({ t: "pong" })).toBeNull();
    expect(readSessionEvent({ kind: "stdout", json: "{not json" })).toBeNull();
    expect(readSessionEvent({ kind: "stdout", text: "no timestamp" })).toBeNull();
    expect(readSessionEvent({ kind: "teleport", at: "2026-10-07T09:00:00Z" })).toBeNull();
    expect(readSessionEvent(null)).toBeNull();
  });
  it("normalises a Date `at` to ISO", () => {
    const e = readSessionEvent({ kind: "stdout", at: new Date("2026-10-07T09:42:00Z"), text: "x" });
    expect(e?.at).toBe("2026-10-07T09:42:00.000Z");
  });
});

describe("seedFromRows / baseSession", () => {
  const agent = toTileAgent(agents[0], AGENT_JUNO);
  it("builds the tile seed from the task, session and agent rows", () => {
    const seed = seedFromRows({ task: bundle, session: bundleSession, agent, taskHref: "/b/x/d/development/plan?task=1" });
    expect(seed.id).toBe(SESSION_BUNDLE);
    expect(seed.task).toMatchObject({ id: TASK_BUNDLE, kind: "code", branch: `agent/${TASK_BUNDLE}` });
    expect(seed.tokens).toBe(42_000);
    expect(seed.cost).toEqual({ amountMinor: 240, currency: "EUR" });
    expect(seed.startedAt).toBe("2026-10-07T09:40:00.000Z");
    expect(seed.agent.name).toBe("Juno");
  });
  it("uses a placeholder id and the task's start when there is no session yet", () => {
    const seed = seedFromRows({ task: bundle, session: null, agent });
    expect(seed.id).toBe(placeholderSessionId(TASK_BUNDLE));
    expect(seed.tokens).toBe(0);
  });
  it("prefers the session's model over the agent's default", () => {
    const seed = seedFromRows({ task: bundle, session: { ...bundleSession, modelKey: "opus" }, agent });
    expect(seed.agent.model).toBe("opus");
  });
  it("overlays the task row's stored state so a tile is never blank before the stream", () => {
    const s = baseSession(seedFromRows({ task: bundle, session: bundleSession, agent }), bundle, bundleSession);
    expect(s.status).toBe("running");
    expect(s.phase).toBe("implementing");
    expect(s.progress).toBeCloseTo(0.35);
    expect(s.endedAt).toBeNull();
    const done = tasks[5]!;
    const d = baseSession(seedFromRows({ task: done, session: null, agent }), done);
    expect(d.status).toBe("done");
    expect(d.phase).toBe("done");
    expect(d.progress).toBe(1);
    expect(d.endedAt).toBe("2026-10-06T15:00:00.000Z");
  });
  it("placeholder for an unassigned task reads Unassigned", () => {
    expect(toTileAgent(undefined, null).name).toBe("Unassigned");
    expect(toTileAgent(undefined, AGENT_JUNO).name).toBe("Agent");
  });
});

describe("sessions by task", () => {
  it("keeps the newest open session per task and ignores ended ones", () => {
    const ended = { ...bundleSession, id: "old", startedAt: "2026-10-07T08:00:00Z", endedAt: "2026-10-07T08:30:00Z" };
    const open = openSessionsByTask([ended, ...sessions]);
    expect(open.get(TASK_BUNDLE)?.id).toBe(SESSION_BUNDLE);
    expect(open.size).toBe(3);
    const latest = latestSessionsByTask([ended, { ...bundleSession, id: "newer", startedAt: "2026-10-07T09:50:00Z", endedAt: "2026-10-07T09:55:00Z" }]);
    expect(latest.get(TASK_BUNDLE)?.id).toBe("newer");
  });
});

describe("SessionThrottle", () => {
  function harness() {
    const timers: Array<() => void> = [];
    const delivered: Array<[string, AgentSessionEvent[]]> = [];
    const t = new SessionThrottle((id, events) => delivered.push([id, events]), {
      flushMs: 250,
      setTimer: (fn) => {
        timers.push(fn);
        return timers.length;
      },
      clearTimer: () => {},
    });
    return { t, timers, delivered, tick: () => timers.splice(0).forEach((fn) => fn()) };
  }
  const events = bundleEvents();

  it("delivers the focused session's events at once and batches the others into one burst per flush", () => {
    const h = harness();
    h.t.focus("a");
    h.t.push("a", events[0]!);
    expect(h.delivered).toEqual([["a", [events[0]]]]);
    h.t.push("b", events[1]!);
    h.t.push("b", events[2]!);
    h.t.push("c", events[3]!);
    expect(h.delivered).toHaveLength(1);
    expect(h.t.pending("b")).toBe(2);
    expect(h.timers).toHaveLength(1);
    h.tick();
    expect(h.delivered.slice(1)).toEqual([
      ["b", [events[1], events[2]]],
      ["c", [events[3]]],
    ]);
    expect(h.t.pending("b")).toBe(0);
  });

  it("flushes a session's queue the moment it gains focus", () => {
    const h = harness();
    h.t.push("b", events[0]!);
    h.t.push("b", events[1]!);
    h.t.focus("b");
    expect(h.delivered).toEqual([["b", [events[0], events[1]]]]);
    h.t.push("b", events[2]!);
    expect(h.delivered).toHaveLength(2);
  });

  it("arms at most one timer per flush window (four bursts a second by default)", () => {
    const h = harness();
    for (let i = 0; i < 20; i++) h.t.push("b", events[1]!);
    expect(h.timers).toHaveLength(1);
    h.tick();
    expect(h.delivered[0]?.[1]).toHaveLength(20);
    h.t.push("b", events[1]!);
    expect(h.timers).toHaveLength(1);
  });

  it("uses real timers by default", () => {
    vi.useFakeTimers();
    const delivered: string[] = [];
    const t = new SessionThrottle((id) => delivered.push(id));
    t.push("x", events[0]!);
    vi.advanceTimersByTime(249);
    expect(delivered).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(delivered).toEqual(["x"]);
    t.dispose();
    vi.useRealTimers();
  });
});

describe("concurrencyHint", () => {
  it("names the largest team the key supports and clamps to 1–64", () => {
    expect(concurrencyHint(16, 3)).toBe("3 of 16 running · 16 is the largest team your key supports");
    expect(concurrencyHint(400, 0)).toMatch(/of 64 running/);
    expect(concurrencyHint(0, 0)).toMatch(/of 1 running/);
  });
});

describe("progress formula (AC-11.6.3)", () => {
  it("matches BUILD §11.6 for the fixture progress event", () => {
    const p = bundleEvents()[2] as Extract<AgentSessionEvent, { kind: "progress" }>;
    expect(computeProgress(p)).toBeCloseTo(0.2 * (4 / 6) + 0.5 * (2 / 2), 3);
  });
});
