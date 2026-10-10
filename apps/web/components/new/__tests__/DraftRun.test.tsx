// @vitest-environment happy-dom
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@foundmill/dugout";
import { DraftStatus, DraftingCard } from "../ideate/DraftStatus";
import { startRun, applyDraftEvent, type DraftEvent, type DraftedIdea } from "../ideate/draft-run";
import { useDraftRun, type DraftRunner } from "../ideate/use-draft-run";

const idea = (id: string, title = id): DraftedIdea => ({ id, title }) as unknown as DraftedIdea;

/** A stream the test pushes events into, like `idea.draft` over httpBatchStreamLink. */
function controlledStream() {
  const queue: DraftEvent[] = [];
  let wake: (() => void) | null = null;
  let ended = false;
  let failure: Error | null = null;
  const iterable: AsyncIterable<DraftEvent> = {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        while (queue.length) yield queue.shift()!;
        if (failure) throw failure;
        if (ended) return;
        await new Promise<void>((r) => (wake = r));
      }
    },
  };
  const poke = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  return {
    iterable,
    push: (e: DraftEvent) => (queue.push(e), poke()),
    end: () => ((ended = true), poke()),
    fail: (err: Error) => ((failure = err), poke()),
  };
}

describe("useDraftRun", () => {
  it("shows each card the moment it arrives, in arrival order, and ends with done", async () => {
    const s = controlledStream();
    const seen: string[] = [];
    let signal: AbortSignal | undefined;
    const runner: DraftRunner<{ prompt: string }> = async (_input, sig) => ((signal = sig), s.iterable);
    const { result } = renderHook(() => useDraftRun(runner, { onIdea: (i) => seen.push(i.id) }));
    let finished: Promise<void> = Promise.resolve();
    act(() => {
      finished = result.current.start({ prompt: "" });
    });
    expect(result.current.running).toBe(true);
    await act(async () => {
      s.push({ type: "started", agent: "Ideation agent", single: false, mode: "mock" });
      s.push({ type: "outline", index: 0, name: "Ledgerly", archetype: "b2b_saas" });
      s.push({ type: "outline", index: 1, name: "Quarloop", archetype: "services" });
    });
    await waitFor(() => expect(result.current.run?.slots).toHaveLength(2));
    await act(async () => s.push({ type: "idea", index: 1, idea: idea("b", "Quarloop") }));
    await waitFor(() => expect(seen).toEqual(["b"]));
    expect(result.current.run?.slots[1]?.status).toBe("done");
    await act(async () => {
      s.push({ type: "idea", index: 0, idea: idea("a", "Ledgerly") });
      s.push({ type: "done", ideas: [], total: 2, failed: 0, costMinor: 3, costLabel: "Estimate", mode: "mock", elapsedMs: 10 } as DraftEvent);
      s.end();
      await finished;
    });
    expect(seen).toEqual(["b", "a"]);
    expect(result.current.run?.status).toBe("done");
    expect(result.current.running).toBe(false);
    expect(signal?.aborted).toBe(false);
  });

  it("Stop aborts the request and keeps the cards already drafted", async () => {
    const s = controlledStream();
    let signal: AbortSignal | undefined;
    const onStop = vi.fn();
    const { result } = renderHook(() => useDraftRun<{ prompt: string }>(async (_i, sig) => ((signal = sig), s.iterable), { onStop }));
    act(() => void result.current.start({ prompt: "x" }));
    await act(async () => s.push({ type: "idea", index: 0, idea: idea("a") }));
    await waitFor(() => expect(result.current.run?.slots[0]?.status).toBe("done"));
    act(() => result.current.stop());
    expect(signal?.aborted).toBe(true);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(result.current.run?.status).toBe("stopped");
    expect(result.current.run?.slots[0]?.ideaId).toBe("a");
  });

  it("reports a failed draft once, with the API's message", async () => {
    const s = controlledStream();
    const onError = vi.fn();
    const { result } = renderHook(() => useDraftRun<{ prompt: string }>(async () => s.iterable, { onError }));
    let finished: Promise<void> = Promise.resolve();
    act(() => {
      finished = result.current.start({ prompt: "x" });
    });
    await act(async () => {
      s.fail(new Error("The Ideation agent ran out of room before finishing the concepts."));
      await finished;
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.current.run).toMatchObject({ status: "failed", error: "The Ideation agent ran out of room before finishing the concepts." });
  });

  it("ignores a second start while a draft runs", async () => {
    const s = controlledStream();
    const runner = vi.fn<DraftRunner<{ prompt: string }>>(async () => s.iterable);
    const { result } = renderHook(() => useDraftRun(runner));
    act(() => void result.current.start({ prompt: "a" }));
    await act(async () => void result.current.start({ prompt: "b" }));
    expect(runner).toHaveBeenCalledTimes(1);
  });
});

describe("DraftStatus (the live run under the brief)", () => {
  const midRun = () => {
    let run = startRun(0);
    for (const e of [
      { type: "started", agent: "Ideation agent", single: false, mode: "mock" },
      { type: "outline", index: 0, name: "Ledgerly", archetype: "b2b_saas" },
      { type: "outline", index: 1, name: "Quarloop", archetype: "services" },
      { type: "outlined", total: 2 },
      { type: "writing", index: 1, attempt: 1 },
      { type: "idea", index: 0, idea: idea("a", "Ledgerly") },
    ] as DraftEvent[])
      run = applyDraftEvent(run, e, 1);
    return run;
  };

  it("says who is drafting which concept, the steps, one bar segment per concept and the elapsed time", () => {
    render(
      <TooltipProvider>
        <DraftStatus run={midRun()} now={12_400} />
      </TooltipProvider>,
    );
    expect(screen.getByTestId("draft-progress").textContent).toBe("Ideation agent is drafting concept 2 of 2");
    expect(screen.getByTestId("draft-elapsed").textContent).toBe("0:12");
    const steps = screen.getAllByTestId("live-run-step");
    expect(steps.map((s) => s.getAttribute("data-state"))).toEqual(["done", "done", "current", "pending"]);
    expect(steps[1]!.textContent).toContain("Slate of 2 angles");
    expect(screen.getByTestId("live-run-bar").getAttribute("aria-label")).toBe("1 of 2 concepts landed, 1 drafting");
    // Time left is the pace so far (12.4 s for one card) times the card still to come, labelled an Estimate.
    expect(screen.getByTestId("live-run-meter").textContent).toMatch(/about 0:12 left/);
    expect(screen.getByTestId("live-run-meter").textContent).toMatch(/Estimate/);
    expect(screen.getByTestId("live-run-activity").textContent).toContain("Ideation agent is drafting Quarloop");
    expect(screen.queryByTestId("stop-button")).toBeNull();
  });

  it("freezes the timer once the draft is over and shows the cost as an Estimate", () => {
    const run = { ...startRun(0), status: "done" as const, finishedAt: 8_000, total: 0, costMinor: 4 };
    render(<DraftStatus run={run} now={60_000} />);
    expect(screen.getByTestId("draft-elapsed").textContent).toBe("0:08");
    expect(screen.getByTestId("draft-status").getAttribute("data-status")).toBe("done");
    expect(screen.getByTestId("live-run-meter").textContent).toMatch(/Estimate/);
    expect(screen.queryByTestId("live-run-activity")).toBeNull();
  });
});

describe("DraftingCard", () => {
  it("holds a named concept's place while its card is written, in the drafter's frame", () => {
    render(<DraftingCard slot={{ index: 3, name: "Fenwave", archetype: "marketplace", status: "writing", ideaId: null }} />);
    const card = screen.getByTestId("drafting-card");
    expect(card.getAttribute("data-slot")).toBe("3");
    expect(card.getAttribute("data-state")).toBe("drafting");
    expect(card.textContent).toContain("Fenwave");
    expect(card.textContent).toContain("Writing the card");
    expect(card.textContent).toContain("Ideation agent is drafting");
    expect(card.textContent).toContain("Actions unlock when it lands");
    expect(card.hasAttribute("data-concept")).toBe(false);
  });

  it("names its drafter while it waits in the queue", () => {
    render(<DraftingCard slot={{ index: 0, name: "Quarloop", archetype: null, status: "outlined", ideaId: null }} />);
    const card = screen.getByTestId("drafting-card");
    expect(card.getAttribute("data-state")).toBe("queued");
    expect(card.textContent).toContain("Queued for Ideation agent");
  });
});
