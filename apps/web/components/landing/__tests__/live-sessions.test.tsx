// @vitest-environment happy-dom
import { act, render, renderHook, screen } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider, etaLabel, useLiveMockSessions, type AgentTileSession, type MockTaskScript } from "@foundmill/dugout";
import { EXAMPLE_IDS, loadExample, type ExampleBusiness, type ExampleId } from "../examples";
import { ExampleProvider } from "../examples/context";
import { LIVE_REPLAY } from "../examples/sessions/shared";
import { LiveSessions } from "../LiveSessions";

MotionGlobalConfig.skipAnimations = true;
Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });

const businesses = new Map<ExampleId, ExampleBusiness>();
beforeAll(async () => {
  for (const id of EXAMPLE_IDS) businesses.set(id, await loadExample(id));
});
const business = (id: ExampleId) => businesses.get(id)!;

const lines = (t: MockTaskScript) => Object.values(t.terminal).flat() as string[];
const terminalText = (s: AgentTileSession) => s.stdout.map((c) => c.text).join("");
const finished = (s: AgentTileSession) => s.status === "done" || s.status === "failed" || s.status === "stopped";

describe.each(EXAMPLE_IDS)("%s: the Live sessions recordings", (id) => {
  it("give every task its own recording, two per tile, that agrees with the rest of the page", () => {
    const script = business(id).sessions;
    const tasks = script.taskScripts ?? [];
    expect(script.agents).toHaveLength(4);
    expect(tasks.length).toBeGreaterThanOrEqual(8);
    expect(script.tasks).toEqual(tasks.map((t) => t.title));
    const prs: number[] = [];
    tasks.forEach((t, i) => {
      expect(t.goal, t.title).toBeTruthy();
      expect(t.plan?.length ?? 0, t.title).toBeGreaterThanOrEqual(5);
      expect(t.notes, t.title).toHaveLength(5);
      // Each act plays something, and the acceptance run fails once before the fix.
      for (const act of Object.values(t.terminal)) expect(act.length, t.title).toBeGreaterThan(0);
      expect(t.terminal.check.filter((l) => l.includes("✘")), t.title).toHaveLength(1);
      // The session opens on the task's own branch, and its commit names it (task 1 is agent/task-1).
      expect(t.terminal.setup[0]).toBe(`$ git switch -c agent/task-${i + 1}`);
      for (const l of lines(t)) {
        const branch = /\[agent\/task-(\d+) /.exec(l);
        if (branch) expect(Number(branch[1]), `${t.title}: ${l}`).toBe(i + 1);
      }
      // The pull request the session opens is the one its terminal links, and only that one.
      const linked = lines(t).flatMap((l) => [...l.matchAll(/\/pull\/(\d+)/g)].map((m) => Number(m[1])));
      expect(linked, t.title).toEqual(t.pullRequest ? [t.pullRequest] : []);
      if (t.pullRequest) prs.push(t.pullRequest);
      else if (!t.gate) expect(t.doneNote, `${t.title} is filed, so it says where`).toBeTruthy();
      // A session that can reach its green run has a picture of the work; one that stops at its check does not need one.
      if (!t.gate || t.gate.at === "end") expect(t.preview, t.title).toBeTruthy();
      if (t.gate) expect(t.gate.note).toMatch(/^Waiting for your decision: /);
      // The file the nudge changes is not the session's main file (the Diff view keeps both).
      if (t.nudge) expect(t.nudge.file.path).not.toBe(t.file.path);
    });
    expect(new Set(prs).size, "pull request numbers are unique").toBe(prs.length);
    // No other business's pull request (the design system's storefront #41) leaks into the example.
    expect(JSON.stringify(tasks)).not.toMatch(/#41\b|\/pull\/41\b/);
    // No two tasks play the same terminal.
    expect(new Set(tasks.map((t) => lines(t).join("\n"))).size).toBe(tasks.length);
    // Every tile has something to do: two tasks each, at most one founder decision among them.
    for (let k = 0; k < 4; k++) expect(tasks.filter((_, i) => i % 4 === k && tasks[i]!.gate).length).toBeLessThanOrEqual(1);
  });

  describe("replayed with fake timers", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("keeps all four tiles alive for six minutes: phases move, nothing is overdue, outputs differ, tasks turn over", () => {
      const script = business(id).sessions;
      const prs = new Set((script.taskScripts ?? []).flatMap((t) => (t.pullRequest ? [t.pullRequest] : [])));
      const { result } = renderHook(() => useLiveMockSessions(4, { ...LIVE_REPLAY, script }));
      const names = result.current.sessions.map((s) => s.agent.name);
      expect(names).toEqual(script.agents!.map((a) => a.name));
      const phases = names.map(() => new Set<string>());
      const tasks = names.map(() => new Set<string>());
      const overdue: string[] = [];
      const doneRuns: number[] = [];
      const doneSince: Array<number | null> = names.map(() => null);
      const doneNotes = new Set<string>();
      let parked = 0;
      const steps = (6 * 60_000) / LIVE_REPLAY.intervalMs;
      for (let i = 0; i < steps; i++) {
        act(() => {
          vi.advanceTimersByTime(LIVE_REPLAY.intervalMs);
        });
        const { sessions, now } = result.current;
        sessions.forEach((s, k) => {
          expect(s.agent.name).toBe(names[k]);
          phases[k]!.add(s.status === "blocked" ? "waiting" : s.phase);
          tasks[k]!.add(s.task.title);
          if (!finished(s) && etaLabel(s.etaAt, now) === "overdue") overdue.push(`${s.agent.name}, tick ${i}`);
          if (s.lastNote?.text.startsWith("Done.")) doneNotes.add(s.lastNote.text);
          if (s.lastNote?.text.startsWith("Parked until you decide.")) parked++;
          if (s.status === "done") doneSince[k] ??= i;
          else if (doneSince[k] !== null) {
            doneRuns.push((i - doneSince[k]!) * LIVE_REPLAY.intervalMs);
            doneSince[k] = null;
          }
        });
        const texts = sessions.map(terminalText).filter((t) => t.length > 0);
        expect(new Set(texts).size, `tick ${i}: two tiles show the same terminal`).toBe(texts.length);
      }
      expect(overdue).toEqual([]);
      for (const seen of phases) expect(seen.size).toBeGreaterThanOrEqual(4);
      for (const seen of tasks) expect(seen.size).toBeGreaterThanOrEqual(2);
      expect(doneRuns.length).toBeGreaterThanOrEqual(4);
      for (const ms of doneRuns) expect(ms).toBe(LIVE_REPLAY.settleMs);
      expect(parked, "a session waiting for the founder is parked and the agent moves on").toBeGreaterThan(0);
      // Done notes name this business's own pull requests (or where the work was filed).
      for (const note of doneNotes) {
        const pr = /Pull request #(\d+)/.exec(note);
        if (pr) expect(prs.has(Number(pr[1])), note).toBe(true);
      }
    });
  });
});

describe("the Live sessions section", () => {
  // happy-dom's IntersectionObserver never reports; this one reports every observed element as on screen.
  class OnScreenObserver {
    constructor(private readonly cb: IntersectionObserverCallback) {}
    observe(target: Element) {
      this.cb([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  const realObserver = globalThis.IntersectionObserver;
  const realMatchMedia = window.matchMedia;
  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.IntersectionObserver = OnScreenObserver as unknown as typeof IntersectionObserver;
  });
  afterEach(() => {
    vi.useRealTimers();
    globalThis.IntersectionObserver = realObserver;
    window.matchMedia = realMatchMedia;
  });

  function renderSection(id: ExampleId) {
    render(
      <ExampleProvider initial={business(id)}>
        <TooltipProvider>
          <LiveSessions terminalRenderer="plain" />
        </TooltipProvider>
      </ExampleProvider>,
    );
    act(() => {
      vi.advanceTimersByTime(LIVE_REPLAY.intervalMs);
    });
    return screen.getByRole("region", { name: "Example agent sessions" });
  }

  it.each(EXAMPLE_IDS)("%s: streams on screen, each tile its own agent and task, and never shows an overdue ETA", (id) => {
    const grid = renderSection(id);
    const tiles = () => [...grid.querySelectorAll("[data-session-id]")];
    expect(tiles()).toHaveLength(4);
    const first = grid.textContent;
    const seenTasks = new Set<string>();
    for (let i = 0; i < 240; i++) {
      act(() => {
        vi.advanceTimersByTime(LIVE_REPLAY.intervalMs);
      });
      expect(grid.textContent).not.toMatch(/overdue/i);
      for (const t of tiles()) seenTasks.add(t.querySelector("[data-tile-task]")?.textContent ?? "");
    }
    expect(grid.textContent).not.toBe(first);
    expect(seenTasks.size).toBeGreaterThan(4);
  });

  it("holds one legible static frame under reduced motion", () => {
    window.matchMedia = ((query: string) =>
      ({ matches: query.includes("prefers-reduced-motion"), media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }) as unknown as MediaQueryList) as typeof window.matchMedia;
    const grid = renderSection("tutorlane");
    const frame = grid.textContent;
    act(() => {
      vi.advanceTimersByTime(2 * 60_000);
    });
    expect(grid.textContent).toBe(frame);
    // Legible: every tile shows its agent, its task, a phase, terminal output and an ETA still ahead.
    for (const tile of grid.querySelectorAll("[data-session-id]")) {
      expect(tile.querySelector("[data-tile-name]")?.textContent).toBeTruthy();
      expect(tile.querySelector("[data-tile-task]")?.textContent).toBeTruthy();
      expect(tile.querySelector("[role=log]")?.textContent?.length ?? 0).toBeGreaterThan(20);
      expect(tile.querySelector("[data-testid=tile-footer]")?.textContent).toMatch(/ETA \d/);
    }
    expect(frame).not.toMatch(/overdue/i);
  });
});
