import { SessionEvent, type SessionEventInput } from "@foundmill/events";
import { describe, expect, it } from "vitest";
import { findRecording, RECORDINGS } from "../mock/recordings";
import { MockSandboxProvider, parseRecordingRef, pickRecording, SessionReplay, type ReplayEventMeta, type Sleep } from "../mock/replay";

const START = new Date("2026-03-02T09:00:00.000Z");

function recordingSleep(): { sleep: Sleep; waits: number[] } {
  const waits: number[] = [];
  const sleep: Sleep = async (ms) => void waits.push(ms);
  return { sleep, waits };
}

describe("replay speed factor", () => {
  const rec = findRecording("ledgerly-webhook-retry")!;
  const gaps = rec.events.map((e, i) => e.tMs - (i === 0 ? 0 : rec.events[i - 1]!.tMs)).filter((g) => g > 0);

  it("waits the recorded gaps at speed 1", async () => {
    const { sleep, waits } = recordingSleep();
    await new SessionReplay(rec, "s", { speed: 1, startAt: START, sleep }).play();
    expect(waits).toEqual(gaps);
  });

  it("divides every wait by the speed factor and keeps timestamps on the scaled timeline", async () => {
    const { sleep, waits } = recordingSleep();
    const ats: string[] = [];
    const replay = new SessionReplay(rec, "s", { speed: 4, startAt: START, sleep });
    replay.subscribe((e) => void ats.push(e.at!));
    await replay.play();
    expect(waits).toEqual(gaps.map((g) => Math.round(g / 4)));
    expect(ats.at(-1)).toBe(new Date(START.getTime() + Math.round(rec.events.at(-1)!.tMs / 4)).toISOString());
    const total = waits.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(rec.events.at(-1)!.tMs / 3);
  });

  it("never waits at infinite speed but keeps the recording's own timestamps", async () => {
    const { sleep, waits } = recordingSleep();
    const replay = new SessionReplay(rec, "s", { speed: Infinity, startAt: START, sleep });
    const ats: string[] = [];
    replay.subscribe((e) => void ats.push(e.at!));
    await replay.play();
    expect(waits).toEqual([]);
    expect(ats).toEqual(rec.events.map((e) => new Date(START.getTime() + e.tMs).toISOString()));
  });

  it("scales an approval hold's auto-resolve timer too", async () => {
    const hold = findRecording("ledgerly-annual-plan-discount")!;
    const { sleep, waits } = recordingSleep();
    await new SessionReplay(hold, "s", { speed: 10, startAt: START, sleep }).play();
    expect(waits).toContain(150); // 1500 ms recorded auto-resolve / 10
  });
});

describe("continuing a replay part-way (a parked agent session)", () => {
  const rec = findRecording("ledgerly-webhook-retry")!;

  it("a `<key>@<index>` ref starts at that event, keeps the recorded gaps from there and stamps the timeline from now", async () => {
    const { sleep, waits } = recordingSleep();
    const now = new Date("2026-03-02T10:00:00.000Z");
    const provider = new MockSandboxProvider({ speed: 1, sleep, now: () => now, holds: { autoResolveAfterMs: 1 }, autoplay: false });
    const sb = await provider.create({ businessId: "b-1", taskId: "t-1", sessionId: "s-1", recording: `${rec.key}@5` });
    const metas: ReplayEventMeta[] = [];
    const ats: string[] = [];
    sb.replay.subscribe((e, meta) => {
      metas.push(meta);
      ats.push(e.at!);
    });
    await sb.start();
    const summary = await sb.replay.play();
    expect(metas.map((m) => m.index)).toEqual(rec.events.slice(5).map((_, i) => i + 5));
    expect(summary.emitted).toBe(rec.events.length - 5);
    const gaps = rec.events.slice(5).map((e, i) => e.tMs - rec.events[i + 4]!.tMs).filter((g) => g > 0);
    expect(waits).toEqual(gaps);
    // The next event is stamped one recorded gap after now, as if the replay had never stopped.
    expect(ats[0]).toBe(new Date(now.getTime() + rec.events[5]!.tMs - rec.events[4]!.tMs).toISOString());
  });

  it("parses recording refs and picks the recording by its key", () => {
    expect(parseRecordingRef(`${rec.key}@12`)).toEqual({ key: rec.key, startIndex: 12 });
    expect(parseRecordingRef(rec.key)).toEqual({ key: rec.key, startIndex: 0 });
    expect(pickRecording(RECORDINGS, { taskId: "t", recording: `${rec.key}@5` }).key).toBe(rec.key);
    // An index past the end replays nothing more.
    expect(new SessionReplay(rec, "s", { speed: Infinity, startAt: START, startIndex: 10_000 }).position.index).toBe(rec.events.length);
  });
});

describe("emit callback and ordering through the provider", () => {
  it("delivers every event of every recording in order, validated, to the provider-level emit", async () => {
    for (const rec of RECORDINGS) {
      const got: Array<{ event: SessionEventInput; meta: ReplayEventMeta }> = [];
      const provider = new MockSandboxProvider({ speed: Infinity, startAt: START, holds: { autoResolveAfterMs: 1 }, emit: (event, meta) => void got.push({ event, meta }) });
      const sb = await provider.create({ businessId: "b-1", taskId: `t-${rec.key}`, sessionId: `s-${rec.key}`, recording: rec.key });
      await sb.start();
      const summary = await sb.waitForReplay();
      expect(summary.emitted).toBe(rec.events.length);
      expect(got.map((g) => g.meta.index)).toEqual(rec.events.map((_, i) => i));
      expect(got.every((g) => g.meta.sessionId === `s-${rec.key}` && g.meta.recordingKey === rec.key && g.meta.total === rec.events.length)).toBe(true);
      for (const g of got) expect(SessionEvent.safeParse(g.event).success).toBe(true);
      const kinds = new Set(got.map((g) => g.event.kind));
      expect(kinds.has("phase_changed") && kinds.has("progress")).toBe(true);
      await sb.stop();
    }
  });

  it("is deterministic: two sandboxes for the same spec emit identical streams", async () => {
    const run = async () => {
      const out: SessionEventInput[] = [];
      const provider = new MockSandboxProvider({ speed: Infinity, startAt: START, holds: { autoResolveAfterMs: 1 }, emit: (e) => void out.push(e) });
      const sb = await provider.create({ businessId: "b-1", taskId: "task-7" });
      await sb.start();
      await sb.waitForReplay();
      return { id: sb.id, key: sb.recording.key, out };
    };
    const a = await run();
    const b = await run();
    expect(a).toEqual(b);
  });

  it("the schema-change recording holds until the founder decides (no auto-resolve)", async () => {
    const rec = findRecording("ledgerly-usage-index")!;
    const provider = new MockSandboxProvider({ speed: Infinity, startAt: START });
    const sb = await provider.create({ businessId: "b-1", taskId: "task-9", recording: rec.key });
    await sb.start();
    for (let i = 0; i < 100 && sb.replay.status !== "holding"; i++) await new Promise((r) => setTimeout(r, 1));
    expect(sb.replay.status).toBe("holding");
    expect(sb.replay.pendingApproval?.approvalId).toBe("apr-3c88");
    expect(sb.replay.decide("apr-3c88", "approved")).toBe(true);
    const summary = await sb.waitForReplay();
    expect(summary).toMatchObject({ outcome: "done", emitted: rec.events.length });
    await sb.stop();
  });

  it("the bundled set covers the scenarios the Live sessions needs", () => {
    const byKey = new Map(RECORDINGS.map((r) => [r.key, r]));
    type LooseEvent = { kind: string; failed?: number; suite?: string; source?: string; tool?: string };
    const kinds = (key: string) => byKey.get(key)!.events.map((e) => e.event as unknown as LooseEvent);
    // fails tests, then fixes them
    const retry = kinds("ledgerly-webhook-retry").filter((e) => e.kind === "test_result");
    expect(retry.map((t) => t.failed)).toEqual([2, 0]);
    // blocks on an approval (two flavours: auto-resolving and founder-decided)
    expect(byKey.get("ledgerly-annual-plan-discount")!.events.some((e) => e.hold?.autoResolveAfterMs !== null && e.hold !== undefined)).toBe(true);
    expect(byKey.get("ledgerly-usage-index")!.events.some((e) => e.hold?.autoResolveAfterMs === null)).toBe(true);
    // frontend with Playwright, a Shout and screenshots
    const fe = kinds("northwind-bundle-picker");
    expect(fe.some((e) => e.kind === "test_result" && e.suite?.startsWith("e2e/"))).toBe(true);
    expect(fe.some((e) => e.kind === "note" && e.source === "shout")).toBe(true);
    expect(fe.some((e) => e.kind === "tool_call" && e.tool === "screenshot")).toBe(true);
    // backend, research, failure
    expect(byKey.get("ledgerly-usage-index")!.agentTemplate).toBe("backend_engineer");
    expect(byKey.get("northwind-supplier-shortlist")!.taskKind).toBe("research");
    expect(byKey.get("ledgerly-flaky-import-test")!.outcome).toBe("failed");
    expect(RECORDINGS.length).toBeGreaterThanOrEqual(4);
    // Six work recordings and the finance one that lets the first runway forecast finish on the golden path.
    expect(RECORDINGS.length).toBeLessThanOrEqual(7);
  });
});
