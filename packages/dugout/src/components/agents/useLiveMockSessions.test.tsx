import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { prefillCount, useLiveMockSessions } from "./useLiveMockSessions";

describe("prefillCount", () => {
  it("applies a fraction of the script, never more than all of it", () => {
    expect(prefillCount(40, undefined)).toBe(0);
    expect(prefillCount(40, 0)).toBe(0);
    expect(prefillCount(40, -1)).toBe(0);
    expect(prefillCount(40, Number.NaN)).toBe(0);
    expect(prefillCount(40, 0.5)).toBe(20);
    expect(prefillCount(41, 0.5)).toBe(20);
    expect(prefillCount(40, 3)).toBe(40);
  });
});

describe("useLiveMockSessions prefill", () => {
  it("starts empty by default and mid-session with prefill", () => {
    const empty = renderHook(() => useLiveMockSessions(2, { running: false }));
    const warm = renderHook(() => useLiveMockSessions(2, { running: false, prefill: 0.5 }));
    for (const s of empty.result.current.sessions) expect(s.stdout).toHaveLength(0);
    for (const s of warm.result.current.sessions) expect(s.stdout.length).toBeGreaterThan(0);
  });
});
