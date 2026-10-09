import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import {
  StreamingText,
  atomDelayMs,
  plainMentions,
  streamAtoms,
  streamStep,
} from "./StreamingText";

const ID = "8b0f4c2e-6d1a-4f3b-9c27-1e5d7a90b311";
const TEXT = `If [[ent:${ID}|Boots UK]] agrees, December holds.`;

function mockReducedMotion(reduce: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: reduce && query.includes("reduce"),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

/** Advance in small steps, each in its own act, so every tick's effect schedules the next timer. */
function flush(ms: number, step = 40) {
  for (let t = 0; t < ms; t += step) act(() => vi.advanceTimersByTime(step));
}

const visible = () => screen.getByTestId("streaming-text").firstElementChild!.textContent;

describe("streamAtoms", () => {
  it("keeps a mention whole and splits the rest by character", () => {
    const atoms = streamAtoms(TEXT);
    expect(atoms).toContain(`[[ent:${ID}|Boots UK]]`);
    expect(atoms.join("")).toBe(TEXT);
    expect(atoms[0]).toBe("I");
  });
  it("speaks mentions as names, catches up when far behind, pauses after commas", () => {
    expect(plainMentions(TEXT)).toBe("If Boots UK agrees, December holds.");
    expect(streamStep(10)).toBe(1);
    expect(streamStep(800)).toBe(10);
    expect(atomDelayMs(",")).toBeGreaterThanOrEqual(22 + 120);
    expect(atomDelayMs("a")).toBeGreaterThanOrEqual(22);
    expect(atomDelayMs("a")).toBeLessThanOrEqual(34);
  });
});

describe("StreamingText", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reveals at the streaming cadence with a caret, then settles and drops the caret", () => {
    mockReducedMotion(false);
    const onSettled = vi.fn();
    render(<StreamingText text="Still positive, mostly." onSettled={onSettled} />);
    expect(visible()).toBe("");
    expect(screen.getByTestId("streaming-text")!.hasAttribute("data-streaming")).toBe(true);
    // The screen reader copy carries the whole text while the stream runs.
    expect(screen.getByText("Still positive, mostly.").classList.contains("sr-only")).toBe(true);
    flush(120);
    const partial = visible()!;
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan("Still positive, mostly.".length);
    flush(5000);
    expect(visible()).toBe("Still positive, mostly.");
    expect(screen.getByTestId("streaming-text")!.hasAttribute("data-streaming")).toBe(false);
    expect(screen.getByTestId("streaming-text").querySelector("[data-caret]")).toBeNull();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("never shows half a mention", () => {
    mockReducedMotion(false);
    render(<StreamingText text={TEXT} />);
    for (let i = 0; i < 40; i++) {
      act(() => vi.advanceTimersByTime(30));
      expect(visible()).not.toMatch(/\[\[ent:(?![^\]]*\]\])/);
    }
  });

  it("keeps the caret while the source is open and continues when more text arrives", () => {
    mockReducedMotion(false);
    const { rerender } = render(<StreamingText text="Capital intensity: " open />);
    flush(3000);
    expect(visible()).toBe("Capital intensity: ");
    expect(screen.getByTestId("streaming-text").querySelector("[data-caret]")).not.toBeNull();
    rerender(<StreamingText text="Capital intensity: one study" open />);
    expect(visible()).toBe("Capital intensity: ");
    flush(3000);
    expect(visible()).toBe("Capital intensity: one study");
  });

  it("renders the text whole under reduced motion", () => {
    mockReducedMotion(true);
    const onSettled = vi.fn();
    render(<StreamingText text="Still positive, mostly." onSettled={onSettled} />);
    expect(visible()).toBe("Still positive, mostly.");
    expect(screen.getByTestId("streaming-text").querySelector("[data-caret]")).toBeNull();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("shows settled history whole when animate is off, through the renderer", () => {
    mockReducedMotion(false);
    render(
      <StreamingText
        text={TEXT}
        animate={false}
        render={(t) => <b data-testid="rendered">{plainMentions(t)}</b>}
      />,
    );
    expect(screen.getByTestId("rendered").textContent).toBe("If Boots UK agrees, December holds.");
  });
});
