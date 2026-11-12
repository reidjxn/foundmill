// @vitest-environment happy-dom
/**
 * The call's speaker: turns are fetched as they arrive (the next while one plays), spoken in order, one at a time, with
 * the browser's own speech when the speech is simulated; a stop (barge-in) silences the voice and drops the rest.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamCallSpeechView, TeamCallTurnView } from "@foundmill/shared/team-call";
import { useCallPlayback } from "../use-call-playback";

const turn = (seq: number, agentId = `a${seq}`): TeamCallTurnView => ({ id: `t${seq}`, seq, speaker: "agent", agentId, userId: null, text: `Line ${seq}.`, to: "founder", via: null, createdAt: "2026-11-12T15:00:00Z" });
const speechFor = (id: string, accent = "talia"): TeamCallSpeechView => ({ turnId: id, speechAccent: accent, mime: "audio/wav", base64: "UklGRg==", simulated: true, spokenText: `Spoken ${id}` });

let spoken: SpeechSynthesisUtterance[] = [];
let cancel = vi.fn();

beforeEach(() => {
  spoken = [];
  cancel = vi.fn();
  class Utter {
    text: string;
    pitch = 1;
    rate = 1;
    voice: unknown = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }
  vi.stubGlobal("SpeechSynthesisUtterance", Utter);
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { speak: (u: SpeechSynthesisUtterance) => spoken.push(u), cancel, getVoices: () => [{ name: "Samantha", lang: "en-US" }] } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
});

describe("useCallPlayback", () => {
  it("fetches each turn's speech on arrival and speaks them in order, the second only after the first has ended", async () => {
    const fetchSpeech = vi.fn(async (id: string) => speechFor(id));
    const { result } = renderHook(() => useCallPlayback(fetchSpeech));
    act(() => result.current.enqueue([turn(1), turn(2), turn(3)]));
    // The first two are fetched ahead; the third waits for a place in the window.
    await waitFor(() => expect(spoken).toHaveLength(1));
    expect(fetchSpeech.mock.calls.map((c) => c[0])).toEqual(["t1", "t2"]);
    expect((spoken[0] as unknown as { text: string }).text).toBe("Spoken t1");
    expect(result.current.playing).toEqual({ turnId: "t1", agentId: "a1" });
    expect(result.current.idle).toBe(false);
    // Tuned to the accent.
    expect(spoken[0]!.pitch).toBeCloseTo(1.1);

    act(() => spoken[0]!.onend?.(new Event("end") as SpeechSynthesisEvent));
    await waitFor(() => expect(spoken).toHaveLength(2));
    expect((spoken[1] as unknown as { text: string }).text).toBe("Spoken t2");
    expect(result.current.playing?.turnId).toBe("t2");
    await waitFor(() => expect(fetchSpeech.mock.calls.map((c) => c[0])).toContain("t3"));

    act(() => spoken[1]!.onend?.(new Event("end") as SpeechSynthesisEvent));
    await waitFor(() => expect(spoken).toHaveLength(3));
    act(() => spoken[2]!.onend?.(new Event("end") as SpeechSynthesisEvent));
    await waitFor(() => expect(result.current.idle).toBe(true));
    expect(result.current.playing).toBeNull();
  });

  it("queues a turn once however often it is added", async () => {
    const fetchSpeech = vi.fn(async (id: string) => speechFor(id));
    const { result } = renderHook(() => useCallPlayback(fetchSpeech));
    act(() => result.current.enqueue([turn(1)]));
    act(() => result.current.enqueue([turn(1)]));
    await waitFor(() => expect(spoken).toHaveLength(1));
    expect(fetchSpeech).toHaveBeenCalledTimes(1);
  });

  it("stop silences the voice and drops what had not been said", async () => {
    const fetchSpeech = vi.fn(async (id: string) => speechFor(id));
    const { result } = renderHook(() => useCallPlayback(fetchSpeech));
    act(() => result.current.enqueue([turn(1), turn(2)]));
    await waitFor(() => expect(spoken).toHaveLength(1));
    act(() => result.current.stop());
    expect(cancel).toHaveBeenCalled();
    expect(result.current.playing).toBeNull();
    expect(result.current.idle).toBe(true);
    // The stopped utterance's late end event does nothing, and the dropped turn is never spoken.
    act(() => spoken[0]!.onend?.(new Event("end") as SpeechSynthesisEvent));
    await new Promise((r) => setTimeout(r, 30));
    expect(spoken).toHaveLength(1);
  });

  it("a turn whose speech cannot be fetched still takes its place (it waits out its reading time) and the next one is spoken", async () => {
    const fetchSpeech = vi.fn(async (id: string) => {
      if (id === "t1") throw new Error("speech failed");
      return speechFor(id);
    });
    const { result } = renderHook(() => useCallPlayback(fetchSpeech));
    act(() => result.current.enqueue([turn(1), turn(2)]));
    // t1 plays silently for at least 600 ms; then t2 is spoken.
    await waitFor(() => expect(result.current.playing?.turnId).toBe("t1"));
    await waitFor(() => expect(spoken).toHaveLength(1), { timeout: 3_000 });
    expect((spoken[0] as unknown as { text: string }).text).toBe("Spoken t2");
  });
});
