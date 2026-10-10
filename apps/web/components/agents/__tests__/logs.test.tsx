import { describe, expect, it } from "vitest";
import { mergeSessionEvents, readSessionEvent } from "../LogsTab";
import { historyEvents } from "../HistoryTab";

describe("readSessionEvent", () => {
  it("accepts session events as objects or wrapped `{ json }` strings and rejects other frames", () => {
    expect(readSessionEvent({ kind: "stdout", at: "2026-10-07T10:00:00Z", text: "hi" })).toMatchObject({ kind: "stdout" });
    expect(readSessionEvent({ json: JSON.stringify({ kind: "note", at: "2026-10-07T10:00:00Z", text: "n" }) })).toMatchObject({ kind: "note", text: "n" });
    expect(readSessionEvent({ type: "inbox.item_created" })).toBeNull();
    expect(readSessionEvent({ json: "{not json" })).toBeNull();
    expect(readSessionEvent("x")).toBeNull();
  });
});

describe("mergeSessionEvents", () => {
  it("seeds from the recording, appends live events once and keeps time order", () => {
    const recorded = [
      { kind: "note", at: "2026-10-07T10:00:02.000Z", level: "info", source: "agent", text: "second" },
      { kind: "note", at: "2026-10-07T10:00:01.000Z", level: "info", source: "agent", text: "first" },
    ] as never[];
    const merged = mergeSessionEvents([], recorded);
    expect(merged.map((e) => (e as { text: string }).text)).toEqual(["first", "second"]);
    const again = mergeSessionEvents(merged, [recorded[0]!, { kind: "note", at: "2026-10-07T10:00:03.000Z", level: "info", source: "agent", text: "live" } as never]);
    expect(again.map((e) => (e as { text: string }).text)).toEqual(["first", "second", "live"]);
    expect(mergeSessionEvents(merged, [])).toHaveLength(2);
  });
});

describe("historyEvents", () => {
  it("merges versions, training runs and sessions newest first with status words", () => {
    const profile = {
      versions: [{ id: "v1", version: 1, state: "live", createdByKind: "system", modelKey: "sonnet", tools: [], createdAt: new Date("2026-09-01") }],
      trainingRuns: [{ id: "r1", status: "done", decision: "promoted", fromVersionId: "v0", toVersionId: "v1", results: { testing: { old: 1, new: 2 } }, costMinor: 150, currency: "EUR", startedAt: new Date("2026-09-02"), endedAt: new Date("2026-09-02T00:05:00Z"), createdAt: new Date("2026-09-02") }],
      sessions: [{ id: "s1", modelKey: "sonnet", startedAt: new Date("2026-09-03"), endedAt: new Date("2026-09-03T01:00:00Z"), tokensIn: 1, tokensOut: 1, costMinor: 1, currency: "EUR", outcome: "success", taskId: null, recordingRef: null }],
    } as never;
    const events = historyEvents(profile, "EUR");
    expect(events.map((e) => e.id)).toEqual(["session-s1", "run-r1", "version-v1"]);
    expect(events[1]).toMatchObject({ title: "Training promoted", statusWord: "Promoted", tone: "good" });
    expect(events[2]).toMatchObject({ title: "Version 1 is live", statusWord: "Live" });
  });
});
