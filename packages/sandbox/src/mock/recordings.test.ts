import { SESSION_EVENT_KINDS, SessionEvent, type SessionEventInput } from "@founder-manager/events";
import { ValidationError } from "@founder-manager/shared";
import { describe, expect, it } from "vitest";
import { parseRecording, REPLAYABLE_EVENT_KINDS, type Recording } from "./recording";
import { RECORDINGS, findRecording } from "./recordings";
import { MockSandboxProvider, pickRecording, SessionReplay, type ReplayEventMeta } from "./replay";

const START = new Date("2026-03-02T09:00:00.000Z");
const CASES: Array<[string, Recording]> = RECORDINGS.map((r) => [r.key, r]);

async function collect(replay: SessionReplay): Promise<Array<{ event: SessionEventInput; meta: ReplayEventMeta }>> {
  const out: Array<{ event: SessionEventInput; meta: ReplayEventMeta }> = [];
  replay.subscribe((event, meta) => void out.push({ event, meta }));
  await replay.play();
  return out;
}

describe("bundled recordings", () => {
  it("mirror the events package's session event kinds", () => {
    expect([...REPLAYABLE_EVENT_KINDS]).toEqual([...SESSION_EVENT_KINDS]);
  });

  it("have unique kebab-case keys and parse", () => {
    const keys = RECORDINGS.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const rec of RECORDINGS) expect(() => parseRecording(rec)).not.toThrow();
    expect(findRecording("ledgerly-webhook-retry")?.outcome).toBe("done");
    expect(findRecording("nope")).toBeUndefined();
  });

  it.each(CASES)("%s: every event validates against @founder-manager/events", (_key, rec) => {
    for (const [i, e] of rec.events.entries()) {
      const parsed = SessionEvent.safeParse({ ...e.event, at: START.toISOString() });
      expect(parsed.success, `event ${i} (${String(e.event.kind)}): ${parsed.success ? "" : parsed.error.message}`).toBe(true);
    }
  });

  it("cover every outcome the UI has to render", () => {
    expect(new Set(RECORDINGS.map((r) => r.outcome))).toEqual(new Set(["done", "blocked", "failed"]));
  });
});

describe("SessionReplay", () => {
  it.each(CASES)("%s: replays every event in order, deterministically, at infinite speed", async (_key, rec) => {
    const run = () => collect(new SessionReplay(rec, "session-1", { speed: Infinity, startAt: START, holds: { autoResolveAfterMs: 1, outcome: "approved" } }));
    const a = await run();
    const b = await run();
    expect(a).toHaveLength(rec.events.length);
    expect(a.map((x) => x.meta.index)).toEqual(rec.events.map((_, i) => i));
    expect(a.map((x) => x.event.at)).toEqual(b.map((x) => x.event.at));
    expect(a[0]!.event.at).toBe(START.toISOString());
    expect(a.at(-1)!.event.at).toBe(new Date(START.getTime() + rec.events.at(-1)!.tMs).toISOString());
    for (const x of a) expect(SessionEvent.safeParse(x.event).success).toBe(true);
  });

  it("reports the recording's outcome when it plays to the end", async () => {
    const rec = findRecording("ledgerly-webhook-retry")!;
    const replay = new SessionReplay(rec, "session-2", { speed: Infinity, startAt: START });
    const summary = await replay.play();
    expect(summary).toMatchObject({ recordingKey: rec.key, sessionId: "session-2", outcome: "done", stoppedReason: null, emitted: rec.events.length, total: rec.events.length });
    expect(replay.status).toBe("finished");
  });

  it("scales recorded offsets by speed", () => {
    const rec = findRecording("ledgerly-webhook-retry")!;
    const replay = new SessionReplay(rec, "session-3", { speed: 10, startAt: START });
    expect(replay.scaleMs(1000)).toBe(100);
    expect(replay.atFor(1000)).toBe(new Date(START.getTime() + 100).toISOString());
    expect(() => new SessionReplay(rec, "bad", { speed: 0 })).toThrow(ValidationError);
  });

  it("holds at an approval and stops when the founder rejects it", async () => {
    const rec = findRecording("ledgerly-annual-plan-discount")!;
    const holdIndex = rec.events.findIndex((e) => e.hold);
    expect(holdIndex).toBeGreaterThan(0);
    const replay = new SessionReplay(rec, "session-4", { speed: Infinity, startAt: START, holds: "wait" });
    const emitted: SessionEventInput[] = [];
    replay.subscribe((e) => void emitted.push(e));
    const playing = replay.play();
    for (let i = 0; i < 100 && replay.status !== "holding"; i++) await new Promise((r) => setTimeout(r, 1));
    expect(replay.status).toBe("holding");
    expect(replay.pendingApproval).toEqual({ approvalId: "apr-7f21", index: holdIndex });
    expect(replay.decide("someone-else", "approved")).toBe(false);
    expect(replay.decide("apr-7f21", "rejected")).toBe(true);
    const summary = await playing;
    expect(summary.outcome).toBe("stopped");
    expect(summary.stoppedReason).toBe("approval_rejected");
    expect(replay.status).toBe("stopped");
    const denied = emitted.at(-2);
    const closing = emitted.at(-1);
    expect(denied).toMatchObject({ kind: "tool_call", status: "denied", policyOutcome: "deny", approvalId: "apr-7f21", tool: "create_coupon" });
    expect(closing).toMatchObject({ kind: "note", source: "system", level: "warn" });
    expect(emitted).toHaveLength(holdIndex + 1 + 2);
  });

  it("continues past an approval the founder grants", async () => {
    const rec = findRecording("ledgerly-annual-plan-discount")!;
    const replay = new SessionReplay(rec, "session-5", { speed: Infinity, startAt: START, holds: "wait" });
    const playing = replay.play();
    for (let i = 0; i < 100 && replay.status !== "holding"; i++) await new Promise((r) => setTimeout(r, 1));
    expect(replay.decide("apr-7f21", "approved")).toBe(true);
    const summary = await playing;
    expect(summary.outcome).toBe("blocked");
    expect(summary.emitted).toBe(rec.events.length);
  });

  it("pauses and resumes", async () => {
    const rec = findRecording("northwind-supplier-shortlist")!;
    const replay = new SessionReplay(rec, "session-6", { speed: Infinity, startAt: START });
    let seen = 0;
    replay.subscribe(() => {
      seen++;
      if (seen === 3) replay.pause();
    });
    const playing = replay.play();
    for (let i = 0; i < 100 && replay.status !== "paused"; i++) await new Promise((r) => setTimeout(r, 1));
    expect(replay.status).toBe("paused");
    expect(seen).toBe(3);
    replay.resume();
    const summary = await playing;
    expect(summary.emitted).toBe(rec.events.length);
  });
});

describe("MockSandboxProvider", () => {
  const provider = new MockSandboxProvider({ speed: Infinity, startAt: START, now: () => START });
  const spec = { businessId: "b-1", taskId: "task-42", recording: "ledgerly-webhook-retry" };

  it("is always available and lists its recordings", async () => {
    expect(await provider.available()).toEqual({ available: true, details: { recordings: RECORDINGS.map((r) => r.key) } });
  });

  it("picks a recording by key, or deterministically from the task id", () => {
    expect(pickRecording(RECORDINGS, { taskId: "t", recording: "northwind-supplier-shortlist" }).key).toBe("northwind-supplier-shortlist");
    expect(pickRecording(RECORDINGS, { taskId: "task-42" })).toBe(pickRecording(RECORDINGS, { taskId: "task-42" }));
    expect(() => pickRecording(RECORDINGS, { taskId: "t", recording: "missing" })).toThrow(ValidationError);
    expect(() => pickRecording([], { taskId: "t" })).toThrow(ValidationError);
  });

  it("replays canned commands in order, then repeats the last result", async () => {
    const sb = await provider.create(spec);
    expect(sb.state).toBe("created");
    await expect(sb.exec("pnpm test")).rejects.toThrow(/call start\(\) first/);
    await sb.start();
    expect(sb.state).toBe("running");
    const first = await sb.exec("pnpm test");
    const second = await sb.exec("pnpm test --reporter dot");
    const third = await sb.exec("pnpm test");
    expect([first.code, second.code, third.code]).toEqual([1, 0, 0]);
    expect(first.stdout).toContain("2 failed");
    expect(first.durationMs).toBe(4200);
    const unknown = await sb.exec("echo hi");
    expect(unknown).toMatchObject({ code: 0, stdout: "", timedOut: false });
    const slow = await sb.exec("pnpm test", { timeoutMs: 10 });
    expect(slow).toMatchObject({ code: 124, timedOut: true, durationMs: 10 });
    expect(sb.execLog.map((e) => e.cmd)).toEqual(["pnpm test", "pnpm test --reporter dot", "pnpm test", "echo hi", "pnpm test"]);
    await sb.waitForReplay();
    await sb.stop();
    expect(sb.state).toBe("stopped");
    await expect(sb.start()).rejects.toThrow(/stopped/);
  });

  it("exposes the recording's virtual filesystem", async () => {
    const sb = await provider.create(spec);
    await sb.start();
    expect(await sb.readFile("src/webhooks/stripe.ts")).toContain("handleStripeWebhook");
    expect(await sb.readFile("/home/user/work/package.json")).toContain('"ledgerly"');
    await sb.writeFile("notes/todo.md", "- retry\n");
    expect(await sb.readFile("notes/todo.md")).toBe("- retry\n");
    const top = await sb.listFiles();
    expect(top.map((f) => `${f.type}:${f.name}`)).toEqual(["dir:notes", "file:package.json", "dir:src"]);
    const webhooks = await sb.listFiles("src/webhooks");
    expect(webhooks.map((f) => f.name)).toEqual(["stripe.test.ts", "stripe.ts"]);
    expect(webhooks[0]!.size).toBeGreaterThan(0);
    await expect(sb.readFile("missing.ts")).rejects.toThrow(/No such file/);
    await expect(sb.listFiles("nowhere")).rejects.toThrow(/No such file/);
    const snap = await sb.snapshot();
    expect(snap).toMatchObject({ sandboxId: sb.id, provider: "mock", createdAt: START.toISOString() });
    await sb.stop();
  });

  it("refuses long-lived credentials in the sandbox environment", async () => {
    await expect(provider.create({ ...spec, envShortLived: { STRIPE_SECRET_KEY: "sk_live_1234567890abcdef" } })).rejects.toThrow();
  });
});
