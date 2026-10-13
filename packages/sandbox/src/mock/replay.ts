/**
 * Mock sandbox: replays recorded agent sessions (BUILD §13.3, docs/DECISIONS.md "No Docker on the build
 * machine"). Deterministic: the same recording, session id, `startAt` and `speed` produce the same events
 * with the same `at` timestamps, in the same order. Timing is injectable (`sleep`) so tests never wait.
 *
 * - `speed` is a multiplier on the recorded timeline (1 = as recorded, 10 = ten times faster,
 *   `Infinity` = emit everything without waiting).
 * - `at` is `startAt + tMs / speed` (or `startAt + tMs` when speed is infinite): the recording's own
 *   clock, so a pause or an approval hold never reorders timestamps.
 * - A recorded `hold` pauses the replay after its event until `decide(approvalId, outcome)` (the
 *   orchestrator's `approval` signal) or the hold's own auto-resolve timer. `resume()` only ends a `pause()`: a call
 *   waiting for the founder stays waiting (audit FR-07). A rejection emits a `denied` tool_call plus a system note and
 *   ends the replay as `stopped`.
 * - A recording ref `<key>@<index>` (the cursor `snapshot()` returns) continues a replay an earlier sandbox stopped
 *   part-way: a paused agent session that handed its worker slot back resumes where it was.
 */
import { ValidationError } from "@foundmill/shared";
import { SandboxFileNotFoundError, SandboxStateError } from "../errors";
import {
  DEFAULT_EXEC_TIMEOUT_MS,
  parseSandboxSpec,
  type ExecOptions,
  type ExecResult,
  type FileEntry,
  type ProviderAvailability,
  type Sandbox,
  type SandboxProvider,
  type SandboxSnapshot,
  type SandboxSpec,
  type SandboxSpecInput,
  type SandboxState,
  type SessionEventInput,
} from "../types";
import {
  recordingDurationMs,
  stableHash32,
  type ApprovalDecision,
  type CannedExecResult,
  type Recording,
  type RecordedEvent,
  type RecordingOutcome,
} from "./recording";
import { RECORDINGS } from "./recordings";

export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

/** Default scheduler: real timers; resolves early when the signal aborts. */
export const realSleep: Sleep = (ms, signal) =>
  new Promise((resolve) => {
    if (signal.aborted || ms <= 0) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      signal.removeEventListener("abort", done);
      clearTimeout(t);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });

/** Scheduler that never waits (tests, `speed: Infinity`). */
export const immediateSleep: Sleep = () => Promise.resolve();

export interface ReplayEventMeta {
  /** 0-based index in the recording. */
  index: number;
  total: number;
  /** Recorded offset in ms. */
  tMs: number;
  recordingKey: string;
  sessionId: string;
}

export type ReplayListener = (event: SessionEventInput, meta: ReplayEventMeta) => void | Promise<void>;

export type ReplayStatus = "idle" | "playing" | "paused" | "holding" | "finished" | "stopped";

export interface ReplaySummary {
  recordingKey: string;
  sessionId: string;
  outcome: RecordingOutcome;
  /** Set when the replay ended early. */
  stoppedReason: string | null;
  emitted: number;
  total: number;
  startedAt: string;
  endedAt: string;
}

export interface PendingApproval {
  approvalId: string;
  /** Index of the recorded event that opened the hold. */
  index: number;
}

export interface ReplayOptions {
  /** Timeline multiplier; default 1. `Infinity` emits without waiting. */
  speed?: number;
  /** Base for emitted `at` timestamps and `startedAt`; default `now()`. */
  startAt?: Date;
  now?: () => Date;
  sleep?: Sleep;
  /** Override every recorded hold: wait for `decide()` or resolve after N replay-ms. Default: as recorded. */
  holds?: "as_recorded" | "wait" | { autoResolveAfterMs: number; outcome?: ApprovalDecision };
  /**
   * Continue a replay an earlier run stopped part-way: the first `startIndex` events were emitted by that run and are
   * skipped. Without `startAt` the timeline picks up from now (the next event is stamped after the last one emitted).
   */
  startIndex?: number;
}

export class SessionReplay {
  readonly recording: Recording;
  readonly sessionId: string;
  readonly speed: number;
  readonly startAt: Date;
  private readonly now: () => Date;
  private readonly sleep: Sleep;
  private readonly holds: ReplayOptions["holds"];
  private readonly listeners = new Set<ReplayListener>();
  private readonly abort = new AbortController();
  private status_: ReplayStatus = "idle";
  private index = 0;
  private emitted = 0;
  private paused = false;
  private wake: (() => void) | null = null;
  private pending: (PendingApproval & { resolve: (d: ApprovalDecision | "resume") => void }) | null = null;
  private stoppedReason: string | null = null;
  private running: Promise<ReplaySummary> | null = null;
  private readonly finishedResolvers: { resolve: (s: ReplaySummary) => void };
  readonly finished: Promise<ReplaySummary>;

  constructor(recording: Recording, sessionId: string, opts: ReplayOptions = {}) {
    if (!(opts.speed === undefined || opts.speed > 0)) throw new ValidationError("replay speed must be > 0");
    this.recording = recording;
    this.sessionId = sessionId;
    this.speed = opts.speed ?? 1;
    this.now = opts.now ?? (() => new Date());
    this.index = Math.max(0, Math.min(recording.events.length, Math.floor(opts.startIndex ?? 0)));
    const resumedAtMs = this.index > 0 ? recording.events[this.index - 1]!.tMs : 0;
    this.startAt = opts.startAt ?? new Date(this.now().getTime() - this.offsetMs(resumedAtMs));
    this.sleep = opts.sleep ?? (this.speed === Infinity ? immediateSleep : realSleep);
    this.holds = opts.holds ?? "as_recorded";
    let resolve!: (s: ReplaySummary) => void;
    this.finished = new Promise<ReplaySummary>((r) => (resolve = r));
    this.finishedResolvers = { resolve };
  }

  get status(): ReplayStatus {
    return this.status_;
  }

  /** Read through a method so TypeScript does not narrow `status_` across the awaits in run(). */
  private isStopped(): boolean {
    return this.status_ === "stopped";
  }

  /** Scrubber position: next event index, total, and the recorded offset reached so far. */
  get position(): { index: number; total: number; tMs: number; durationMs: number } {
    const prev = this.recording.events[Math.max(0, this.index - 1)];
    return {
      index: this.index,
      total: this.recording.events.length,
      tMs: this.index === 0 ? 0 : (prev?.tMs ?? 0),
      durationMs: recordingDurationMs(this.recording),
    };
  }

  get pendingApproval(): PendingApproval | null {
    return this.pending ? { approvalId: this.pending.approvalId, index: this.pending.index } : null;
  }

  subscribe(listener: ReplayListener): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Scale a recorded delay to replay time. */
  scaleMs(ms: number): number {
    return this.speed === Infinity ? 0 : Math.max(0, Math.round(ms / this.speed));
  }

  /** Deterministic timestamp for a recorded offset. */
  atFor(tMs: number): string {
    return new Date(this.startAt.getTime() + this.offsetMs(tMs)).toISOString();
  }

  /** Wall-clock offset of a recorded offset from `startAt`. */
  private offsetMs(tMs: number): number {
    return this.speed === Infinity ? tMs : Math.round(tMs / this.speed);
  }

  /** Start (or return the in-flight) replay. Resolves when the recording ends or the replay is stopped. */
  play(): Promise<ReplaySummary> {
    if (!this.running) this.running = this.run();
    return this.running;
  }

  pause(): void {
    if (this.status_ === "finished" || this.status_ === "stopped") return;
    this.paused = true;
    if (this.status_ === "playing") this.status_ = "paused";
  }

  /** Resume after `pause()`. A pending hold is not answered by it: only `decide()`, its own auto-resolve or `stop()` end a hold. */
  resume(): void {
    this.paused = false;
    if (this.status_ === "paused") this.status_ = "playing";
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  /** Answer a pending approval. Returns false when no hold with that id is waiting. */
  decide(approvalId: string, outcome: ApprovalDecision): boolean {
    if (!this.pending || this.pending.approvalId !== approvalId) return false;
    this.pending.resolve(outcome);
    return true;
  }

  stop(reason = "stopped"): void {
    if (this.status_ === "finished" || this.status_ === "stopped") return;
    this.stoppedReason = reason;
    this.status_ = "stopped";
    this.abort.abort();
    this.resume();
    this.pending?.resolve("resume");
    if (!this.running) this.finish();
  }

  private async emit(event: SessionEventInput, index: number, tMs: number): Promise<void> {
    const meta: ReplayEventMeta = { index, total: this.recording.events.length, tMs, recordingKey: this.recording.key, sessionId: this.sessionId };
    for (const l of this.listeners) await l(event, meta);
    this.emitted++;
  }

  private async waitWhilePaused(): Promise<void> {
    while (this.paused && this.status_ !== "stopped") {
      await new Promise<void>((resolve) => (this.wake = resolve));
    }
  }

  private effectiveHold(rec: RecordedEvent): { approvalId: string; autoResolveAfterMs: number | null; autoResolveOutcome: ApprovalDecision } | null {
    if (!rec.hold) return null;
    if (this.holds === "wait") return { ...rec.hold, autoResolveAfterMs: null };
    if (typeof this.holds === "object") return { approvalId: rec.hold.approvalId, autoResolveAfterMs: this.holds.autoResolveAfterMs, autoResolveOutcome: this.holds.outcome ?? "approved" };
    return rec.hold;
  }

  private async hold(rec: RecordedEvent, index: number): Promise<ApprovalDecision | "resume"> {
    const h = this.effectiveHold(rec);
    if (!h) return "resume";
    this.status_ = "holding";
    const decision = await new Promise<ApprovalDecision | "resume">((resolve) => {
      let settled = false;
      const settle = (d: ApprovalDecision | "resume") => {
        if (settled) return;
        settled = true;
        this.pending = null;
        resolve(d);
      };
      this.pending = { approvalId: h.approvalId, index, resolve: settle };
      if (h.autoResolveAfterMs !== null) {
        void this.sleep(this.scaleMs(h.autoResolveAfterMs), this.abort.signal).then(() => {
          if (!settled && this.status_ !== "stopped") settle(h.autoResolveOutcome);
        });
      }
      if (this.status_ === "stopped") settle("resume");
    });
    if (this.status_ === "holding") this.status_ = "playing";
    return decision;
  }

  private async run(): Promise<ReplaySummary> {
    const events = this.recording.events;
    if (this.status_ !== "stopped") this.status_ = "playing";
    let prevTMs = this.index > 0 ? events[this.index - 1]!.tMs : 0;
    while (this.index < events.length && !this.isStopped()) {
      const rec = events[this.index]!;
      const delay = this.scaleMs(rec.tMs - prevTMs);
      prevTMs = rec.tMs;
      await this.waitWhilePaused();
      if (delay > 0 && !this.isStopped()) await this.sleep(delay, this.abort.signal);
      await this.waitWhilePaused();
      if (this.isStopped()) break;
      const index = this.index;
      await this.emit({ ...(rec.event as SessionEventInput), at: this.atFor(rec.tMs) }, index, rec.tMs);
      this.index++;
      if (rec.hold) {
        const decision = await this.hold(rec, index);
        if (this.isStopped()) break;
        if (decision === "rejected") {
          const opened = rec.event as Record<string, unknown>;
          const callId = typeof opened.callId === "string" ? opened.callId : `call-${index}`;
          const tool = typeof opened.tool === "string" ? opened.tool : "approval";
          const connectorKey = typeof opened.connectorKey === "string" ? opened.connectorKey : null;
          await this.emit(
            { kind: "tool_call", at: this.atFor(rec.tMs), callId, connectorKey, tool, status: "denied", argsSummary: typeof opened.argsSummary === "string" ? opened.argsSummary : "", policyOutcome: "deny", approvalId: rec.hold.approvalId, resultSummary: "Founder rejected the request" },
            index,
            rec.tMs,
          );
          await this.emit({ kind: "note", at: this.atFor(rec.tMs), level: "warn", source: "system", text: `Approval ${rec.hold.approvalId} was rejected; the session stops here and the task returns to its lead.` }, index, rec.tMs);
          this.stop("approval_rejected");
          break;
        }
      }
    }
    return this.finish();
  }

  private finish(): ReplaySummary {
    const completed = this.status_ !== "stopped";
    if (completed) this.status_ = "finished";
    const summary: ReplaySummary = {
      recordingKey: this.recording.key,
      sessionId: this.sessionId,
      outcome: completed ? this.recording.outcome : "stopped",
      stoppedReason: completed ? null : this.stoppedReason,
      emitted: this.emitted,
      total: this.recording.events.length,
      startedAt: this.startAt.toISOString(),
      endedAt: this.atFor(completed ? recordingDurationMs(this.recording) : this.position.tMs),
    };
    this.finishedResolvers.resolve(summary);
    return summary;
  }
}

/**
 * A recording reference: a key, or a key and the next event to play (`<key>@<index>`, the cursor `snapshot()` returns),
 * so a replay stopped part-way can continue in a new sandbox.
 */
export function parseRecordingRef(ref: string): { key: string; startIndex: number } {
  const m = /^(.+)@(\d+)$/.exec(ref);
  return m ? { key: m[1]!, startIndex: Number(m[2]) } : { key: ref, startIndex: 0 };
}

/** Pick the recording for a spec: explicit key (or `<key>@<index>`), else a stable hash of the task id over the available recordings. */
export function pickRecording(recordings: readonly Recording[], spec: Pick<SandboxSpec, "taskId" | "recording">): Recording {
  if (recordings.length === 0) throw new ValidationError("No recordings available for the mock sandbox");
  if (spec.recording) {
    const { key } = parseRecordingRef(spec.recording);
    const found = recordings.find((r) => r.key === key);
    if (!found) throw new ValidationError(`Unknown recording "${key}". Known: ${recordings.map((r) => r.key).join(", ")}`);
    return found;
  }
  // Without a named recording only a session that ends well is picked; failed and blocked ones are chosen by key (audit IAE-22).
  const done = recordings.filter((r) => r.outcome === "done");
  const pool = done.length > 0 ? done : recordings;
  return pool[stableHash32(spec.taskId) % pool.length]!;
}

export interface MockSandboxOptions extends ReplayOptions {
  /** Default listener for every sandbox the provider creates (typically `publishSessionEvent`). */
  emit?: ReplayListener;
  /** Begin replaying when `start()` is called (default true). Set false to drive `replay.play()` yourself. */
  autoplay?: boolean;
  /** Recordings to choose from (default: the bundled set). */
  recordings?: readonly Recording[];
}

function normalisePath(workdir: string, p: string): string {
  const abs = p.startsWith("/") ? p : `${workdir.replace(/\/+$/, "")}/${p}`;
  const parts: string[] = [];
  for (const seg of abs.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return `/${parts.join("/")}`;
}

export interface MockExecRecord {
  cmd: string;
  cwd: string;
  envNames: string[];
  result: ExecResult;
}

export class MockSandbox implements Sandbox {
  readonly provider = "mock" as const;
  readonly id: string;
  readonly spec: SandboxSpec;
  readonly workdir: string;
  readonly recording: Recording;
  readonly replay: SessionReplay;
  /** Every `exec` call, for assertions and audit. */
  readonly execLog: MockExecRecord[] = [];
  private state_: SandboxState = "created";
  private readonly files = new Map<string, string>();
  private readonly commandUses = new Map<number, number>();
  private readonly autoplay: boolean;
  private readonly now: () => Date;

  constructor(spec: SandboxSpec, recording: Recording, opts: MockSandboxOptions = {}) {
    this.spec = spec;
    this.recording = recording;
    this.workdir = recording.workdir;
    const sessionId = spec.sessionId ?? spec.taskId;
    this.id = `mock-${recording.key}-${stableHash32(`${spec.businessId}:${spec.taskId}:${sessionId}`).toString(16).padStart(8, "0")}`;
    this.now = opts.now ?? (() => new Date());
    this.autoplay = opts.autoplay ?? true;
    this.replay = new SessionReplay(recording, sessionId, opts);
    if (opts.emit) this.replay.subscribe(opts.emit);
    for (const [p, content] of Object.entries(recording.files)) this.files.set(normalisePath(this.workdir, p), content);
  }

  get state(): SandboxState {
    return this.state_;
  }

  get sessionId(): string {
    return this.replay.sessionId;
  }

  async start(): Promise<void> {
    if (this.state_ === "stopped") throw new SandboxStateError(`Sandbox ${this.id} is stopped`);
    if (this.state_ === "running") return;
    this.state_ = "running";
    if (this.autoplay) void this.replay.play();
  }

  /** Resolves with the replay summary (after `start()`, or after `replay.play()` when autoplay is off). */
  waitForReplay(): Promise<ReplaySummary> {
    return this.replay.finished;
  }

  private assertRunning(): void {
    if (this.state_ !== "running") throw new SandboxStateError(`Sandbox ${this.id} is ${this.state_}; call start() first`);
  }

  private canned(cmd: string): CannedExecResult | null {
    for (let i = 0; i < this.recording.commands.length; i++) {
      const c = this.recording.commands[i]!;
      if (!new RegExp(c.match).test(cmd)) continue;
      const used = this.commandUses.get(i) ?? 0;
      this.commandUses.set(i, used + 1);
      return c.results[Math.min(used, c.results.length - 1)]!;
    }
    return null;
  }

  async exec(cmd: string, opts: ExecOptions = {}): Promise<ExecResult> {
    this.assertRunning();
    const canned = this.canned(cmd) ?? { code: 0, stdout: "", stderr: "", durationMs: 50 };
    const timeoutMs = opts.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    const timedOut = canned.durationMs > timeoutMs;
    if (canned.stdout) opts.onStdout?.(canned.stdout);
    if (canned.stderr) opts.onStderr?.(canned.stderr);
    const result: ExecResult = {
      code: timedOut ? 124 : canned.code,
      stdout: canned.stdout,
      stderr: canned.stderr,
      timedOut,
      durationMs: timedOut ? timeoutMs : canned.durationMs,
    };
    this.execLog.push({ cmd, cwd: opts.cwd ?? this.workdir, envNames: Object.keys(opts.env ?? {}), result });
    return result;
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    this.assertRunning();
    this.files.set(normalisePath(this.workdir, path), typeof content === "string" ? content : Buffer.from(content).toString("utf8"));
  }

  async readFile(path: string): Promise<string> {
    this.assertRunning();
    const abs = normalisePath(this.workdir, path);
    const content = this.files.get(abs);
    if (content === undefined) throw new SandboxFileNotFoundError(abs);
    return content;
  }

  async listFiles(path = this.workdir): Promise<FileEntry[]> {
    this.assertRunning();
    const dir = normalisePath(this.workdir, path);
    const prefix = dir === "/" ? "/" : `${dir}/`;
    const seen = new Map<string, FileEntry>();
    let exists = dir === "/" || dir === this.workdir;
    for (const [p, content] of this.files) {
      if (p === dir) {
        exists = true;
        continue;
      }
      if (!p.startsWith(prefix)) continue;
      exists = true;
      const rest = p.slice(prefix.length);
      const slash = rest.indexOf("/");
      const name = slash === -1 ? rest : rest.slice(0, slash);
      const entryPath = `${prefix}${name}`;
      if (seen.has(entryPath)) continue;
      seen.set(entryPath, {
        path: entryPath,
        name,
        type: slash === -1 ? "file" : "dir",
        size: slash === -1 ? Buffer.byteLength(content, "utf8") : null,
        modifiedAt: null,
      });
    }
    if (!exists) throw new SandboxFileNotFoundError(dir);
    return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  async snapshot(): Promise<SandboxSnapshot> {
    this.assertRunning();
    const pos = this.replay.position;
    return {
      id: `${this.id}@${pos.index}`,
      sandboxId: this.id,
      provider: "mock",
      ref: `${this.recording.key}@${pos.index}`,
      createdAt: this.now().toISOString(),
    };
  }

  /** A replay never touches the network. */
  async closeEgress(): Promise<void> {}

  async stop(): Promise<void> {
    if (this.state_ === "stopped") return;
    this.replay.stop("sandbox_stopped");
    this.state_ = "stopped";
  }
}

export class MockSandboxProvider implements SandboxProvider {
  readonly mode = "mock" as const;
  readonly recordings: readonly Recording[];
  private readonly opts: MockSandboxOptions;

  constructor(opts: MockSandboxOptions = {}) {
    this.opts = opts;
    this.recordings = opts.recordings ?? RECORDINGS;
  }

  async available(): Promise<ProviderAvailability> {
    return { available: true, details: { recordings: this.recordings.map((r) => r.key) } };
  }

  async create(input: SandboxSpecInput): Promise<MockSandbox> {
    const spec = parseSandboxSpec(input);
    // Imported lazily by name to keep this file's dependency graph obvious; same check every provider runs.
    const { assertNoLongLivedCredentials } = await import("../credentials");
    assertNoLongLivedCredentials(spec.envShortLived);
    const startIndex = spec.recording ? parseRecordingRef(spec.recording).startIndex : 0;
    return new MockSandbox(spec, pickRecording(this.recordings, spec), startIndex > 0 ? { ...this.opts, startIndex } : this.opts);
  }
}
