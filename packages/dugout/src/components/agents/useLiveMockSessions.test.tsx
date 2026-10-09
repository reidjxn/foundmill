import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { prefillCount, useLiveMockSessions } from "./useLiveMockSessions";
import { DTC_CHANNEL_PROFILE, STOREFRONT_SESSION_SCRIPT, generateMockSessionEvents, mockChannels, mockSessions } from "./mock";

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

describe("mock session scripts and channel profiles", () => {
  const script = {
    ...STOREFRONT_SESSION_SCRIPT,
    names: ["Ada"],
    tasks: ["Mark homework from photos"],
    file: { path: "src/marking/photo.ts", diff: "+export const x = 1;", additions: 1, deletions: 0 },
    failingCheck: "partial credit",
    currency: "GBP",
  };

  it("replays a session about the script's own work", () => {
    const [first] = mockSessions(1, new Date("2026-10-07T09:30:00Z"), script);
    expect(first!.seed.agent.name).toBe("Ada");
    expect(first!.seed.task.title).toBe("Mark homework from photos");
    expect(first!.seed.cost?.currency).toBe("GBP");
    expect(first!.events.some((e) => e.kind === "file_changed" && e.path === "src/marking/photo.ts")).toBe(true);
    const events = generateMockSessionEvents("x", "2026-10-07T09:30:00Z", { script });
    expect(events.some((e) => e.kind === "test_result" && e.failures?.includes("partial credit"))).toBe(true);
  });

  it("keeps the storefront script by default", () => {
    const [first] = mockSessions(1);
    expect(first!.events.some((e) => e.kind === "file_changed" && e.path === "src/components/bundle-picker.tsx")).toBe(true);
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
