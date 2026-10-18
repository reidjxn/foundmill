import { describe, expect, it } from "vitest";
import { mergeSessionEvents, readSessionEvent, replaySourceLabel } from "../LogsTab";
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

describe("replaySourceLabel", () => {
  it("names a finished session's saved recording, the live stream and a demo recording (#233)", () => {
    expect(replaySourceLabel({ source: "saved", reason: null })).toBe("Saved recording");
    expect(replaySourceLabel({ source: "saved", reason: "long terminal output and diffs were cut when the session was saved" })).toBe("Saved recording · long output shortened");
    expect(replaySourceLabel({ source: "stream", reason: null })).toBe("From the stream");
    expect(replaySourceLabel({ source: "recording", recording: { title: "Retry failed webhooks" } })).toBe("Recording · Retry failed webhooks");
    expect(replaySourceLabel({ source: "none", reason: "no stream" })).toBeNull();
    expect(replaySourceLabel(undefined)).toBeNull();
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
      trainingRuns: [{ id: "r1", status: "done", decision: "promoted", fromVersionId: "v0", toVersionId: "v1", results: { testing: { old: 1, new: 2, tests: 12 }, debugging: { old: 3, new: 4 }, library_release_notes: { old: 1, new: 1, tests: 0 } }, costMinor: 150, currency: "EUR", startedAt: new Date("2026-09-02"), endedAt: new Date("2026-09-02T00:05:00Z"), createdAt: new Date("2026-09-02") }],
      sessions: [{ id: "s1", modelKey: "sonnet", startedAt: new Date("2026-09-03"), endedAt: new Date("2026-09-03T01:00:00Z"), tokensIn: 1, tokensOut: 1, costMinor: 1, currency: "EUR", outcome: "success", taskId: null, recordingRef: null }],
    } as never;
    const events = historyEvents(profile, "EUR");
    expect(events.map((e) => e.id)).toEqual(["session-s1", "run-r1", "version-v1"]);
    expect(events[1]).toMatchObject({ title: "Training promoted", statusWord: "Promoted", tone: "good" });
    // The skill the run found no tests for was not graded; a result from before the count was stored was.
    expect(events[1]!.description).toMatch(/^2 skills graded · /);
    expect(events[2]).toMatchObject({ title: "Version 1 is live", statusWord: "Live" });
  });

  it("names a model change's retest and a canceled run in US English", () => {
    const profile = {
      versions: [
        { id: "v1", version: 1, state: "live", createdByKind: "system", modelKey: "sonnet", tools: [], createdAt: new Date("2026-09-01") },
        { id: "v2", version: 2, state: "draft", createdByKind: "system", modelKey: "haiku", tools: [], createdAt: new Date("2026-10-01") },
      ],
      trainingRuns: [{ id: "r1", status: "cancelled", decision: null, fromVersionId: "v1", toVersionId: "v2", results: {}, costMinor: 0, currency: "USD", startedAt: null, endedAt: new Date("2026-10-01T00:05:00Z"), createdAt: new Date("2026-10-01") }],
      sessions: [],
    } as never;
    const events = historyEvents(profile, "USD");
    expect(events.find((e) => e.id === "run-r1")).toMatchObject({ title: "Retest canceled", statusWord: "Canceled" });
    expect(events.find((e) => e.id === "version-v2")?.description).toMatch(/^Retest after a model change · Haiku/);
    expect(events.find((e) => e.id === "version-v1")?.description).toMatch(/^Set up with the business/);
  });
});
