import { describe, expect, it } from "vitest";
import { ValidationError } from "@founder-manager/shared";
import { sessionStreamKey } from "../keys";
import {
  computeProgress,
  parseSessionEvent,
  publishSessionEvent,
  readSessionEvents,
  SESSION_EVENT_KINDS,
  SessionEvent,
  sessionEventCount,
} from "../session-stream";
import { MemoryRedis } from "../testing/memory-redis";

const SESSION = "0f1e2d3c-0000-4000-8000-000000000001";

describe("session stream", () => {
  it("publishes every kind with fields kind/json and fills `at` when omitted", async () => {
    const redis = new MemoryRedis();
    const ids = [
      await publishSessionEvent(redis, SESSION, {
        kind: "phase_changed",
        from: null,
        to: "planning",
      }),
      await publishSessionEvent(redis, SESSION, {
        kind: "note",
        text: "Reading the spec",
        source: "agent",
      }),
      await publishSessionEvent(redis, SESSION, {
        kind: "tool_call",
        callId: "c1",
        tool: "read_file",
        status: "started",
        argsSummary: "src/checkout.ts",
      }),
      await publishSessionEvent(redis, SESSION, {
        kind: "stdout",
        text: "$ pnpm test\n",
        command: "pnpm test",
      }),
      await publishSessionEvent(redis, SESSION, {
        kind: "file_changed",
        path: "src/checkout.ts",
        change: "modified",
        additions: 12,
        deletions: 3,
      }),
      await publishSessionEvent(redis, SESSION, {
        kind: "test_result",
        suite: "checkout",
        passed: 5,
        failed: 1,
        acceptance: true,
        failures: ["adds travel size"],
      }),
      await publishSessionEvent(redis, SESSION, {
        kind: "progress",
        progress: 0.4,
        planStepsDone: 2,
        planSteps: 4,
        acceptanceTestsPassing: 5,
        acceptanceTests: 6,
        reviewPassed: false,
        merged: false,
      }),
    ];
    expect(new Set(ids).size).toBe(7);
    const raw = redis.dump(sessionStreamKey(SESSION));
    expect(raw.map((e) => e.fields.kind)).toEqual([
      "phase_changed",
      "note",
      "tool_call",
      "stdout",
      "file_changed",
      "test_result",
      "progress",
    ]);
    expect(Object.keys(raw[0]!.fields).sort()).toEqual(["json", "kind"]);
    for (const e of raw) {
      const json = JSON.parse(e.fields.json!);
      expect(json.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(SessionEvent.safeParse(json).success).toBe(true);
    }
    expect(await sessionEventCount(redis, SESSION)).toBe(7);
    expect([...SESSION_EVENT_KINDS].sort()).toEqual([
      "file_changed",
      "note",
      "phase_changed",
      "progress",
      "stdout",
      "test_result",
      "tool_call",
    ]);
  });

  it("rejects invalid events before touching Redis", async () => {
    const redis = new MemoryRedis();
    await expect(publishSessionEvent(redis, SESSION, { kind: "note", text: "" })).rejects.toThrow(
      ValidationError,
    );
    await expect(publishSessionEvent(redis, SESSION, { kind: "typing" } as never)).rejects.toThrow(
      ValidationError,
    );
    await expect(
      publishSessionEvent(redis, SESSION, {
        kind: "phase_changed",
        from: null,
        to: "shipping",
      } as never),
    ).rejects.toThrow(/to/);
    await expect(
      publishSessionEvent(redis, SESSION, {
        kind: "progress",
        progress: 0.5,
        planStepsDone: 5,
        planSteps: 4,
        acceptanceTestsPassing: 0,
        acceptanceTests: 0,
        reviewPassed: false,
        merged: false,
      }),
    ).rejects.toThrow(/planStepsDone cannot exceed planSteps/);
    await expect(
      publishSessionEvent(redis, SESSION, { kind: "note", text: "x", at: "soon" }),
    ).rejects.toThrow(/at/);
    await expect(publishSessionEvent(redis, "", { kind: "note", text: "x" })).rejects.toThrow(
      /sessionId/,
    );
    expect(await sessionEventCount(redis, SESSION)).toBe(0);
  });

  it("replays in publish order with cursors, limits, paging and kind filters", async () => {
    const redis = new MemoryRedis();
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      ids.push(
        await publishSessionEvent(
          redis,
          SESSION,
          i % 5 === 0
            ? { kind: "note", text: `note ${i}` }
            : { kind: "stdout", text: `line ${i}\n` },
        ),
      );
    }

    const all = await readSessionEvents(redis, SESSION, { pageSize: 7 });
    expect(all.map((r) => r.id)).toEqual(ids);
    expect(
      all.map((r) =>
        r.event.kind === "stdout" ? r.event.text : r.event.kind === "note" ? r.event.text : "",
      ),
    ).toEqual(Array.from({ length: 25 }, (_, i) => (i % 5 === 0 ? `note ${i}` : `line ${i}\n`)));

    const after10 = await readSessionEvents(redis, SESSION, { after: ids[9]!, pageSize: 4 });
    expect(after10.map((r) => r.id)).toEqual(ids.slice(10));

    const first3 = await readSessionEvents(redis, SESSION, { limit: 3 });
    expect(first3.map((r) => r.id)).toEqual(ids.slice(0, 3));

    const notes = await readSessionEvents(redis, SESSION, { kinds: ["note"], pageSize: 3 });
    expect(notes.map((r) => r.id)).toEqual([0, 5, 10, 15, 20].map((i) => ids[i]));

    const window = await readSessionEvents(redis, SESSION, { after: ids[3]!, until: ids[6]! });
    expect(window.map((r) => r.id)).toEqual(ids.slice(4, 7));

    expect(await readSessionEvents(redis, "unknown-session")).toEqual([]);
  });

  it("skips entries whose json no longer parses and reports them", async () => {
    const redis = new MemoryRedis();
    await publishSessionEvent(redis, SESSION, { kind: "note", text: "ok" });
    await redis.xadd(sessionStreamKey(SESSION), "*", "kind", "note", "json", '{"kind":"note"}');
    await publishSessionEvent(redis, SESSION, { kind: "note", text: "ok 2" });
    const invalid: string[] = [];
    const out = await readSessionEvents(redis, SESSION, {}, (id) => invalid.push(id));
    expect(out).toHaveLength(2);
    expect(invalid).toHaveLength(1);
  });

  it("MAXLEN keeps a session bounded", async () => {
    const redis = new MemoryRedis();
    for (let i = 0; i < 10; i++)
      await publishSessionEvent(redis, SESSION, { kind: "stdout", text: `${i}` }, { maxLen: 4 });
    expect(await sessionEventCount(redis, SESSION)).toBe(4);
    const tail = await readSessionEvents(redis, SESSION);
    expect(tail.map((r) => (r.event.kind === "stdout" ? r.event.text : ""))).toEqual([
      "6",
      "7",
      "8",
      "9",
    ]);
  });

  it("computeProgress follows the BUILD §11.6 formula and parseSessionEvent applies defaults", () => {
    expect(
      computeProgress({
        planStepsDone: 0,
        planSteps: 0,
        acceptanceTestsPassing: 0,
        acceptanceTests: 0,
        reviewPassed: false,
        merged: false,
      }),
    ).toBe(0);
    expect(
      computeProgress({
        planStepsDone: 4,
        planSteps: 4,
        acceptanceTestsPassing: 6,
        acceptanceTests: 6,
        reviewPassed: true,
        merged: true,
      }),
    ).toBe(1);
    expect(
      computeProgress({
        planStepsDone: 2,
        planSteps: 4,
        acceptanceTestsPassing: 3,
        acceptanceTests: 6,
        reviewPassed: true,
        merged: false,
      }),
    ).toBe(0.55);
    const e = parseSessionEvent({ kind: "stdout", at: "2026-10-05T09:00:00Z", text: "hi" });
    expect(e).toEqual({
      kind: "stdout",
      at: "2026-10-05T09:00:00Z",
      text: "hi",
      channel: "stdout",
      command: null,
    });
  });
});
