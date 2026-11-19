import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { BuilderViewProvider } from "../guidance/BuilderView";
import { useState } from "react";
import { generateMockSessionEvents } from "./mock";
import { SessionScrubber, formatClock, nextMarkerPosition, prevMarkerPosition, scrubberMarkers, sessionLengthMs } from "./SessionScrubber";

/** Builder view on for every render here (the engine these tests read); BuilderView.test.tsx covers it off. */
const render = (ui: ReactElement, opts?: Parameters<typeof rtlRender>[1]) => rtlRender(ui, { wrapper: ({ children }) => <BuilderViewProvider on>{children}</BuilderViewProvider>, ...opts });

const START = "2026-10-07T09:00:00Z";
const events = generateMockSessionEvents("scrub", START, { outcome: "done", shout: true, durationSec: 600 });

describe("scrubber helpers", () => {
  it("marks phases, tests, nudges, files and errors but not stdout", () => {
    const markers = scrubberMarkers(events, START);
    const kinds = new Set(markers.map((m) => m.kind));
    expect(kinds.has("phase")).toBe(true);
    expect(kinds.has("tests_fail")).toBe(true);
    expect(kinds.has("tests_pass")).toBe(true);
    expect(kinds.has("shout")).toBe(true);
    expect(kinds.has("file")).toBe(true);
    expect(markers.every((m) => m.at >= 0 && m.at <= 600_000)).toBe(true);
    expect(markers.length).toBeLessThan(events.length);
  });

  it("steps to the next and previous marker and clamps at the ends", () => {
    const markers = scrubberMarkers(events, START);
    const first = markers[0]!.at;
    expect(prevMarkerPosition(markers, first)).toBeNull();
    const second = nextMarkerPosition(markers, first);
    expect(second).not.toBeNull();
    expect(second!).toBeGreaterThan(first);
    expect(prevMarkerPosition(markers, second!)).toBeLessThan(second!);
    expect(nextMarkerPosition(markers, 10_000_000)).toBeNull();
  });

  it("session length uses endedAt, else the last event or now", () => {
    expect(sessionLengthMs(events, START, "2026-10-07T09:08:00Z")).toBe(480_000);
    const last = Date.parse(events[events.length - 1]!.at) - Date.parse(START);
    expect(sessionLengthMs(events, START, null, Date.parse(START))).toBe(last);
    expect(sessionLengthMs(events, START, null, Date.parse(START) + 900_000)).toBe(900_000);
  });

  it("formats clocks", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(65_000)).toBe("01:05");
    expect(formatClock(3_725_000)).toBe("1:02:05");
  });
});

describe("SessionScrubber", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("plays forward at the chosen speed and stops at the end", () => {
    const onPositionChange = vi.fn();
    const onPlayingChange = vi.fn();
    function Harness() {
      const [position, setPosition] = useState(598_000);
      const [playing, setPlaying] = useState(true);
      return (
        <SessionScrubber
          events={events}
          startedAt={START}
          endedAt="2026-10-07T09:10:00Z"
          position={position}
          onPositionChange={(p) => {
            onPositionChange(p);
            setPosition(p);
          }}
          playing={playing}
          speed={4}
          onPlayingChange={(p) => {
            onPlayingChange(p);
            setPlaying(p);
          }}
          tickMs={250}
        />
      );
    }
    render(<Harness />);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(onPositionChange).toHaveBeenLastCalledWith(599_000);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(onPositionChange).toHaveBeenLastCalledWith(600_000);
    expect(onPlayingChange).toHaveBeenCalledWith(false);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onPositionChange).toHaveBeenCalledTimes(2);
  });

  it("the replay position's thumb says the time to a screen reader (aria-valuetext on the thumb, WP-10 T7)", () => {
    render(<SessionScrubber events={events} startedAt={START} endedAt="2026-10-07T09:10:00Z" position={84_000} onPositionChange={() => undefined} playing={false} speed={1} onPlayingChange={() => undefined} />);
    expect(screen.getByRole("slider", { name: "Replay position" }).getAttribute("aria-valuetext")).toBe(formatClock(84_000));
  });

  it("step buttons and , . keys jump between markers", () => {
    const onPositionChange = vi.fn();
    const markers = scrubberMarkers(events, START);
    render(<SessionScrubber events={events} startedAt={START} endedAt="2026-10-07T09:10:00Z" position={0} onPositionChange={onPositionChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Next event" }));
    expect(onPositionChange).toHaveBeenLastCalledWith(nextMarkerPosition(markers, 0));
    fireEvent.click(screen.getByRole("button", { name: "Previous event" }));
    expect(onPositionChange).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(screen.getByRole("group", { name: "Session replay" }), { key: "." });
    expect(onPositionChange).toHaveBeenLastCalledWith(nextMarkerPosition(markers, 0));
    expect(screen.getByRole("slider", { name: "Replay position" })).toBeTruthy();
    expect(screen.getByText(/00:00 \/ 10:00/)).toBeTruthy();
  });

  it("the event list says each marker's word once ('Phase: Planning', never 'Phase: Phase: planning')", () => {
    render(<SessionScrubber events={events} startedAt={START} endedAt="2026-10-07T09:10:00Z" position={0} onPositionChange={vi.fn()} />);
    const items = [...screen.getByRole("list", { name: "Event markers" }).querySelectorAll("li")].map((li) => li.textContent ?? "");
    expect(items.some((t) => /^\d\d:\d\d Phase: [A-Z][a-z]/.test(t))).toBe(true);
    expect(items.some((t) => /Nudge: /.test(t))).toBe(true);
    for (const t of items) expect(t, t).not.toMatch(/(Phase|Nudge|Approval|File|Tests(?: passed| failed)?): (?:Phase|Nudge|Awaiting approval|Tests)\b/);
  });
});
