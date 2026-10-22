import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useLiveMockSessions } from "./useLiveMockSessions";
import { DTC_CHANNEL_PROFILE, STOREFRONT_SESSION_SCRIPT, generateMockSessionEvents, mockChannels, mockRecording, mockSessions, pullRequestIn, type MockSessionScript, type MockTaskScript } from "./mock";
import { etaLabel, phaseIndex, reduceSessionEvents } from "./progress";
import { initialLanes, laneSession, mockPreviewImage, startLane, advanceLane, type ReplayConfig } from "./replay";
import type { AgentTileSession } from "./types";

/** A task recording whose every line names the task, so tiles can be told apart by their terminals. */
function task(n: number, extra: Partial<MockTaskScript> = {}): MockTaskScript {
  const tag = `task ${n}`;
  return {
    title: `Task number ${n}`,
    goal: `Goal of task ${n}.`,
    plan: ["Read", "Write", "Check", "Fix", "Ship"],
    terminal: {
      setup: [`$ setup ${tag}`],
      unit: [`$ unit ${tag}`, ` ✓ unit ${tag}`],
      check: [`$ check ${tag}`, `  ✘  failing check of ${tag}`],
      fix: [`[agent/task-${n} abc] fix ${tag}`, `  passing check of ${tag}`],
      ship: [`$ ship ${tag}`, `https://example.test/pull/${100 + n}`],
    },
    file: { path: `src/task-${n}.ts`, diff: "@@ -0,0 +1 @@\n+export const x = 1;", additions: 1, deletions: 0 },
    notes: [`start ${tag}`, `change ${tag}`, `insight ${tag}`, `failing ${tag}`, `review ${tag}`],
    failingCheck: `failing check of ${tag}`,
    pullRequest: 100 + n,
    preview: { address: `example.test/${n}`, title: `Preview <${n}> & co`, rows: [{ label: "Rows", value: "1", tone: "good" }] },
    ...extra,
  };
}

const TASKS: MockTaskScript[] = [
  task(1),
  task(2, { gate: { connectorKey: "github", tool: "merge_pull_request", argsSummary: "#102 → main", note: "Waiting for your decision: merge #102.", at: "end" } }),
  task(3, { pullRequest: undefined, doneNote: "Done. Filed to Drive." }),
  task(4, { gate: { connectorKey: "github", tool: "request_app_permission", argsSummary: "pull requests: write", note: "Waiting for your decision: a permission." } }),
  task(5),
  task(6),
  task(7, { nudge: { text: "Nudge seven", reply: "On it.", file: { path: "src/style-7.css", diff: "@@ -1 +1 @@\n-a\n+b", additions: 1, deletions: 1 } } }),
  task(8),
];
const SCRIPT: MockSessionScript = { ...STOREFRONT_SESSION_SCRIPT, names: ["Ada", "Bo", "Cy", "Di"], tasks: TASKS.map((t) => t.title), taskScripts: TASKS, currency: "USD", previewNote: "Nothing to show yet." };
const LANDING = { intervalMs: 500, speed: 8, prefill: 0.45, settleMs: 5000, waitMs: 14_000 } as const;

const terminalText = (s: AgentTileSession) => s.stdout.map((c) => c.text).join("");
const over = (s: AgentTileSession) => s.status === "done" || s.status === "failed" || s.status === "stopped";

describe("mock session recordings", () => {
  it("plays each task's own recording: its terminal, plan, file, notes and pull request", () => {
    const events = generateMockSessionEvents("t", "2026-10-07T09:00:00Z", { script: SCRIPT, taskIndex: 4, outcome: "done" });
    const out = events.flatMap((e) => (e.kind === "stdout" ? [e.text.replace(/\r\n$/, "")] : []));
    expect(out).toEqual([...Object.values(TASKS[4]!.terminal).flat()]);
    expect(out.join(" ")).not.toContain("task 1");
    expect(events.some((e) => e.kind === "file_changed" && e.path === "src/task-5.ts")).toBe(true);
    expect(events.filter((e) => e.kind === "note").map((e) => (e.kind === "note" ? e.text : ""))).toEqual(["start task 5", "change task 5", "insight task 5", "failing task 5", "review task 5", "Done. Change #105 merged into the code."]);
    const phases = events.flatMap((e) => (e.kind === "phase_changed" ? [e.to] : []));
    expect(phases).toEqual(["planning", "implementing", "testing", "review", "merge", "done"]);
    const progress = events.filter((e) => e.kind === "progress");
    for (const p of progress) expect(p.kind === "progress" && p.planSteps).toBe(5);
  });

  it("derives the done note from the script's data, never a fixed pull request", () => {
    expect(mockRecording(STOREFRONT_SESSION_SCRIPT).doneNote).toBe("Done. Change #41 merged into the code.");
    const other = { ...STOREFRONT_SESSION_SCRIPT, stdout: STOREFRONT_SESSION_SCRIPT.stdout.map((l) => l.replace("/pull/41", "/pull/318")) };
    expect(mockRecording(other).doneNote).toBe("Done. Change #318 merged into the code.");
    const noPr = { ...STOREFRONT_SESSION_SCRIPT, stdout: STOREFRONT_SESSION_SCRIPT.stdout.filter((l) => !l.includes("/pull/")) };
    expect(mockRecording(noPr).doneNote).toBe("Done.");
    expect(pullRequestIn(["a", "x/pull/7", "y/pull/12"])).toBe(12);
  });

  it("files work without a pull request after review, with no merge phase", () => {
    const events = generateMockSessionEvents("f", "2026-10-07T09:00:00Z", { script: SCRIPT, taskIndex: 2 });
    expect(events.flatMap((e) => (e.kind === "phase_changed" ? [e.to] : []))).toEqual(["planning", "implementing", "testing", "review", "done"]);
    expect(events.some((e) => e.kind === "tool_call" && e.tool === "create_pull_request")).toBe(false);
    const s = reduceSessionEvents({ id: "s", agent: { id: "a", name: "Cy", seed: "c", dept: "dept-7", status: "healthy", model: "sonnet" }, task: { id: "t", title: "T" }, startedAt: "2026-10-07T09:00:00Z" }, events);
    expect(s.status).toBe("done");
    expect(s.progress).toBe(1);
    expect(s.lastNote?.text).toBe("Done. Filed to Drive.");
  });

  it("stops at the founder's decision where the task says: at the end, after the pull request, or after the failing check", () => {
    const atEnd = generateMockSessionEvents("g", "2026-10-07T09:00:00Z", { script: SCRIPT, taskIndex: 1, outcome: "blocked" });
    const kinds = atEnd.map((e) => (e.kind === "tool_call" ? `${e.tool}:${e.status}` : e.kind === "phase_changed" ? `phase:${e.to}` : e.kind));
    expect(kinds.indexOf("create_pull_request:succeeded")).toBeLessThan(kinds.indexOf("merge_pull_request:awaiting_approval"));
    expect(kinds).not.toContain("phase:done");
    expect(atEnd[atEnd.length - 1]).toMatchObject({ kind: "note", text: "Waiting for your decision: merge #102." });
    const atCheck = generateMockSessionEvents("g", "2026-10-07T09:00:00Z", { script: SCRIPT, taskIndex: 3, outcome: "blocked" });
    expect(atCheck.some((e) => e.kind === "phase_changed" && e.to === "review")).toBe(false);
    expect(atCheck.some((e) => e.kind === "tool_call" && e.status === "awaiting_approval" && e.tool === "request_app_permission")).toBe(true);
  });

  it("keeps the storefront script by default", () => {
    const [first] = mockSessions(1);
    expect(first!.events.some((e) => e.kind === "file_changed" && e.path === "src/components/bundle-picker.tsx")).toBe(true);
  });

  it("replays a session about a shared script's own work", () => {
    const script = { ...STOREFRONT_SESSION_SCRIPT, names: ["Ada"], tasks: ["Mark homework from photos"], file: { path: "src/marking/photo.ts", diff: "+export const x = 1;", additions: 1, deletions: 0 }, failingCheck: "partial credit", currency: "GBP" };
    const [first] = mockSessions(1, new Date("2026-10-07T09:30:00Z"), script);
    expect(first!.seed.agent.name).toBe("Ada");
    expect(first!.seed.task.title).toBe("Mark homework from photos");
    expect(first!.seed.cost?.currency).toBe("GBP");
    expect(first!.events.some((e) => e.kind === "file_changed" && e.path === "src/marking/photo.ts")).toBe(true);
    const events = generateMockSessionEvents("x", "2026-10-07T09:30:00Z", { script });
    expect(events.some((e) => e.kind === "test_result" && e.failures?.includes("partial credit"))).toBe(true);
  });

  it("scores and recommends channels from a profile", () => {
    const profile = { ...DTC_CHANNEL_PROFILE, fits: { ...DTC_CHANNEL_PROFILE.fits, seo: 18, paid_ads: 5 }, recommended: ["seo", "content", "email_automation", "affiliate"] as const, why: () => "Fits tutors.", currency: "GBP" };
    const channels = mockChannels("t", { profile });
    const seo = channels.find((c) => c.key === "seo")!;
    expect(seo).toMatchObject({ fit: 18, recommended: true, enabled: true, why: "Fits tutors." });
    expect(seo.cpaRange?.low.currency).toBe("GBP");
    expect(channels.find((c) => c.key === "paid_ads")!.enabled).toBe(false);
  });
});

describe("the replay engine", () => {
  const cfg: ReplayConfig = { n: 4, script: SCRIPT, startMs: Date.parse("2026-10-07T09:30:00Z"), prefill: 0.45, settleMs: 40_000, waitMs: 112_000, loop: true, seed: "t" };

  it("opens every tile mid-session, each in its own task and phase, with an ETA still ahead", () => {
    const lanes = initialLanes(cfg);
    const sessions = lanes.map((l) => laneSession(l, cfg.startMs));
    expect(sessions.map((s) => s.task.title)).toEqual(["Task number 1", "Task number 2", "Task number 3", "Task number 4"]);
    expect(new Set(sessions.map((s) => s.id)).size).toBe(4);
    for (const s of sessions) {
      expect(s.stdout.length).toBeGreaterThan(0);
      expect(etaLabel(s.etaAt, cfg.startMs)).not.toBe("overdue");
    }
    expect(new Set(sessions.map((s) => s.phase)).size).toBeGreaterThan(1);
  });

  it("moves a lane to its agent's next task after the done state settles, keeping the tile's id and agent", () => {
    let lane = startLane(cfg, 0, 0, cfg.startMs);
    const doneAt = lane.times[lane.times.length - 1]!;
    lane = advanceLane(cfg, lane, doneAt);
    expect(laneSession(lane, doneAt).status).toBe("done");
    lane = advanceLane(cfg, lane, doneAt + cfg.settleMs - 1);
    expect(laneSession(lane, doneAt + cfg.settleMs - 1).status).toBe("done");
    lane = advanceLane(cfg, lane, doneAt + cfg.settleMs);
    const next = laneSession(lane, doneAt + cfg.settleMs);
    expect(next.id).toBe("session-1");
    expect(next.agent.name).toBe("Ada");
    expect(next.task.title).toBe("Task number 5");
    expect(next.task.branch).toBe("agent/task-5");
    expect(next.status).toBe("running");
  });

  it("parks a session waiting for the founder, with no ETA while it waits", () => {
    let lane = startLane(cfg, 1, 0, cfg.startMs);
    const parkAt = lane.times[lane.times.length - 1]!;
    const gateAt = lane.times[lane.times.length - 2]!;
    lane = advanceLane(cfg, lane, gateAt);
    const waiting = laneSession(lane, gateAt);
    expect(waiting.status).toBe("blocked");
    expect(waiting.etaAt).toBeNull();
    expect(parkAt - gateAt).toBe(cfg.waitMs);
    lane = advanceLane(cfg, lane, parkAt);
    expect(laneSession(lane, parkAt).lastNote?.text).toBe("Parked until you decide. Bo picks up the next task.");
    lane = advanceLane(cfg, lane, parkAt + cfg.settleMs);
    expect(laneSession(lane, parkAt + cfg.settleMs).task.title).toBe("Task number 6");
  });

  it("shows the work's picture once the acceptance checks pass, and the script's note before", () => {
    let lane = startLane(cfg, 0, 0, cfg.startMs);
    expect(laneSession(lane, cfg.startMs).preview).toEqual({ emptyNote: "Nothing to show yet." });
    lane = advanceLane(cfg, lane, lane.times[lane.times.length - 1]!);
    const shot = laneSession(lane, lane.times[lane.times.length - 1]!).preview.screenshotUrl ?? "";
    expect(shot.startsWith("data:image/svg+xml")).toBe(true);
    expect(decodeURIComponent(shot)).toContain("Preview &lt;1&gt; &amp; co");
    expect(mockPreviewImage({ address: "a", title: "b", rows: [] })).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
  });
});

describe("useLiveMockSessions", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps every tile alive for minutes: phases keep moving, nothing is overdue, tasks change and each terminal is its own", () => {
    const { result } = renderHook(() => useLiveMockSessions(4, { ...LANDING, script: SCRIPT }));
    const opening = result.current.sessions.map(terminalText);
    expect(new Set(opening).size).toBe(4);
    const phases = result.current.sessions.map(() => new Set<string>());
    const tasks = result.current.sessions.map(() => new Set<string>());
    const doneRuns: number[] = [];
    const doneSince: Array<number | null> = [null, null, null, null];
    const overdue: string[] = [];
    const steps = (6 * 60_000) / LANDING.intervalMs;
    for (let i = 0; i < steps; i++) {
      act(() => {
        vi.advanceTimersByTime(LANDING.intervalMs);
      });
      const { sessions, now } = result.current;
      sessions.forEach((s, k) => {
        phases[k]!.add(s.status === "blocked" ? "waiting" : s.phase);
        tasks[k]!.add(s.task.title);
        if (!over(s) && etaLabel(s.etaAt, now) === "overdue") overdue.push(`${s.agent.name} at ${i}`);
        if (s.status === "done") doneSince[k] ??= i;
        else if (doneSince[k] !== null) {
          doneRuns.push((i - doneSince[k]!) * LANDING.intervalMs);
          doneSince[k] = null;
        }
      });
      // Each tile plays its own task's terminal: no two tiles show the same output.
      const texts = sessions.map(terminalText).filter((t) => t.length > 0);
      expect(new Set(texts).size).toBe(texts.length);
    }
    expect(overdue).toEqual([]);
    for (const seen of phases) expect(seen.size).toBeGreaterThanOrEqual(4);
    for (const seen of tasks) expect(seen.size).toBeGreaterThanOrEqual(2);
    // A finished session settles on its done state for a few seconds, then the agent picks up its next task.
    expect(doneRuns.length).toBeGreaterThanOrEqual(4);
    for (const ms of doneRuns) {
      expect(ms).toBeGreaterThanOrEqual(4000);
      expect(ms).toBeLessThanOrEqual(6000);
    }
    // Still moving at the end: another minute changes every tile.
    const before = result.current.sessions.map((s) => `${s.task.title}|${s.phase}|${s.status}|${s.stdout.length}`);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    const after = result.current.sessions.map((s) => `${s.task.title}|${s.phase}|${s.status}|${s.stdout.length}`);
    after.forEach((a, k) => expect(a).not.toBe(before[k]));
  });

  it("holds one legible static frame when not running", () => {
    const { result } = renderHook(() => useLiveMockSessions(4, { ...LANDING, script: SCRIPT, running: false }));
    const frame = result.current.sessions;
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(result.current.sessions).toBe(frame);
    for (const s of frame) {
      expect(s.stdout.length).toBeGreaterThan(0);
      expect(s.plan.some((p) => p.state === "done")).toBe(true);
      expect(etaLabel(s.etaAt, result.current.now)).not.toBe("overdue");
    }
  });

  it("starts empty by default and mid-session with prefill", () => {
    const empty = renderHook(() => useLiveMockSessions(2, { running: false }));
    const warm = renderHook(() => useLiveMockSessions(2, { running: false, prefill: 0.5 }));
    for (const s of empty.result.current.sessions) expect(s.stdout).toHaveLength(0);
    for (const s of warm.result.current.sessions) expect(s.stdout.length).toBeGreaterThan(0);
  });

  it("keeps the shared storefront grid mixed and never overdue (the stories' sixteen tiles)", () => {
    const { result } = renderHook(() => useLiveMockSessions(16, { intervalMs: 400 }));
    const statuses = new Set<string>();
    for (let i = 0; i < 600; i++) {
      act(() => {
        vi.advanceTimersByTime(400);
      });
      for (const s of result.current.sessions) {
        statuses.add(s.status);
        if (!over(s)) expect(etaLabel(s.etaAt, result.current.now)).not.toBe("overdue");
      }
    }
    for (const st of ["running", "blocked", "failed", "done"]) expect(statuses.has(st)).toBe(true);
    expect(result.current.sessions.every((s) => phaseIndex(s.phase) >= 0)).toBe(true);
  });
});
