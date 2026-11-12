import { describe, expect, it } from "vitest";
import { VAD_DEFAULTS, VAD_IDLE, levelFromTimeDomain, vadStep, type VadEvent, type VadState } from "../vad";

/** Feeds (level, time) readings and returns the events in order. */
function feed(readings: [level: number, at: number][], agentSpeaking = false): { events: (VadEvent & { at: number })[]; state: VadState } {
  let state = VAD_IDLE;
  const events: (VadEvent & { at: number })[] = [];
  for (const [level, at] of readings) {
    const step = vadStep(state, level, at, agentSpeaking);
    state = step.state;
    if (step.event) events.push({ ...step.event, at });
  }
  return { events, state };
}

describe("voice activity", () => {
  it("starts above the threshold and not below it", () => {
    expect(feed([[0.05, 0], [0.11, 50]]).events).toEqual([]);
    expect(feed([[0.05, 0], [0.12, 50]]).events).toEqual([{ type: "start", at: 50 }]);
  });

  it("ends after 1.2 s of silence, not before", () => {
    const { events } = feed([[0.5, 0], [0.4, 500], [0.01, 600], [0.01, 1_699], [0.01, 1_700]]);
    // The last voiced reading was at 500 ms; 1.2 s later, at 1700 ms, the utterance ends.
    expect(events.map((e) => [e.type, e.at])).toEqual([["start", 0], ["end", 1_700]]);
    expect(events[1]).toMatchObject({ reason: "silence", discard: false });
  });

  it("a pause shorter than 1.2 s keeps the utterance going (the hold level is lower than the start)", () => {
    const { events, state } = feed([[0.5, 0], [0.01, 600], [0.08, 1_000], [0.01, 2_000], [0.01, 2_100]]);
    expect(events.map((e) => e.type)).toEqual(["start"]);
    expect(state.speaking).toBe(true);
  });

  it("caps an utterance at 60 s however loud it stays", () => {
    const readings: [number, number][] = [];
    for (let t = 0; t <= 60_000; t += 1_000) readings.push([0.5, t]);
    const { events } = feed(readings);
    expect(events.at(-1)).toMatchObject({ type: "end", reason: "cap", durationMs: 60_000, at: 60_000 });
  });

  it("discards a click: less voiced time than the minimum", () => {
    const { events } = feed([[0.9, 0], [0.01, 100], [0.01, 1_300]]);
    expect(events.at(-1)).toMatchObject({ type: "end", discard: true });
  });

  it("needs a clearly louder voice to speak over an agent (barge-in)", () => {
    expect(feed([[0.15, 0]], true).events).toEqual([]);
    expect(feed([[0.22, 0]], true).events).toEqual([{ type: "start", at: 0 }]);
    expect(VAD_DEFAULTS.bargeInLevel).toBeGreaterThan(VAD_DEFAULTS.startLevel);
  });

  it("starts a second utterance after the first ended", () => {
    const { events } = feed([[0.5, 0], [0.5, 300], [0.01, 400], [0.01, 1_700], [0.5, 2_000]]);
    expect(events.map((e) => e.type)).toEqual(["start", "end", "start"]);
  });
});

describe("levelFromTimeDomain", () => {
  it("is 0 for silence (128) and for no data, rises with the swing and stops at 1", () => {
    expect(levelFromTimeDomain(new Uint8Array(0))).toBe(0);
    expect(levelFromTimeDomain(new Uint8Array(64).fill(128))).toBe(0);
    const quiet = levelFromTimeDomain(Uint8Array.from({ length: 64 }, (_, i) => (i % 2 ? 132 : 124)));
    const loud = levelFromTimeDomain(Uint8Array.from({ length: 64 }, (_, i) => (i % 2 ? 188 : 68)));
    expect(quiet).toBeGreaterThan(0);
    expect(loud).toBeGreaterThan(quiet);
    expect(levelFromTimeDomain(Uint8Array.from({ length: 64 }, (_, i) => (i % 2 ? 255 : 0)))).toBe(1);
  });
});
