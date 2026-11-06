/**
 * agentSession activities (BUILD §9.3, §9.4, §11.6; ARCHITECTURE §10).
 *
 * `prepareSession` validates the launch (agent version, task, sandbox runner, model route, credential hygiene) and
 * returns only non-secret facts. `runAgentSession` is the long-running activity: in live mode it drives the Claude
 * Agent SDK (`query()`) with the house-rules system prompt, the version's MCP tools served by the gateway and a
 * short-lived session token; in mock mode it replays a recorded session through packages/sandbox. Both stream
 * `SessionEvent`s to `as:{sessionId}`, heartbeat on every event, persist progress, create approval rows when a tool
 * call waits for the founder, write the usage ledger and fail the session when the same tool call repeats three times.
 * On the platform's key a live session is capped at the business's credits and books as it runs (./session-credits).
 * `finishSession` settles the task, the agent and the events, and saves the session's recording to Postgres so its
 * stream can expire (./recording).
 *
 * Waiting for the founder never holds a worker slot for long (`runAgentSession` runs on the sessions task queue, see
 * ../session-contract): a gated call left undecided for APPROVAL_WAIT_MINUTES ends the session `blocked` (the approval
 * stays open), and a session paused for SESSION_PAUSE_HOLD_MINUTES "parks": it saves its work, returns, and the
 * workflow starts a new run on Resume. Control commands are polled without overlap, and a failed poll (Redis down) is
 * logged and retried, never left as an unhandled rejection.
 *
 * The team-wide stop (0023: Stop all agents, a revoked key, used-up credits) reaches a session even when no signal does:
 * a run does not start while the business is stopped, and a running one re-reads the flag every STOP_CHECK_MS and
 * stops itself as if the founder had pressed Stop.
 *
 * The live SDK process is confined by ./sdk-isolation (SECURITY_REVIEW SEC-3): from-scratch environment, private
 * per-session workspace deleted in `finally`, built-in tools by task kind and a path guard on every file-tool call.
 * A code task's acceptance tests run in a sandbox created for them on a copy of that workspace (./workspace-sync):
 * dependencies install while the npm registry is reachable, with every script off; then the network closes and the
 * agent's code runs offline. Pause interrupts the SDK's turn and holds every tool call until Resume; Stop interrupts the
 * turn and waits briefly for the SDK's final usage before aborting it, so every token spent is booked.
 */
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import type { Query } from "@anthropic-ai/claude-agent-sdk";
import { AgentInstructions, buildSystemPrompt, docText, getTemplate, getTemplateByAgentType, hasClubRulesPrefix, listTemplates, restoredWorkspaceNote, ToolGrant, type AgentSkillPrompt, type AgentTemplate } from "@foundmill/agents";
import { APP_NAME, CREDITS_CURRENCY, sandboxCostMicroMinor } from "@foundmill/config";
import { resolveGrants } from "@foundmill/connectors";
import { bookUsage, closeApprovalItem, loadByokApiKey, MICRO_PER_MINOR, repos, signoffDecisionBlock, type Agent, type AgentVersion, type Approval, type Business, type Task } from "@foundmill/db";
import { publishSessionEvent, type SessionEventInput } from "@foundmill/events";
import { meter, MODEL_PRICING, resolveModel, type ModelId, type RouteKey } from "@foundmill/models";
import { assertNoLongLivedCredentials, MockSandbox, MockSandboxProvider, RECORDINGS, redactCredentialValues, stableHash32, type Sandbox, type SandboxSpecInput } from "@foundmill/sandbox";
import { CHANNEL_META, isUuid, type AgentStatus, type ChannelKey, type ModelKey, type TaskStatus } from "@foundmill/shared";
import { currentTraceparent } from "@foundmill/shared/telemetry";
import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { z } from "zod";
import type { SessionCommand } from "../control-bus";
import type { OrchestratorDeps } from "../deps";
import { emitEvent, systemActor } from "../events";
import { applySessionEvent, initialProgress, type ProgressState } from "../progress";
import { AGENT_PAUSED_FAILURE, CANCELLED_REASON, type RunUsage } from "../session-contract";
import { failureStreak } from "../retry";
import { openApprovalNote } from "./approvals";
import { LoopDetector } from "./loop";
import { CREDITS_USED_UP_SUMMARY, SessionCredits, unbookedTokens } from "./session-credits";
import { budgetSummary, LIMIT_WORDS, sessionBudget, type SessionBudget } from "./session-budget";
import { archiveSessionRecording } from "./recording";
import { createSessionWorkspace, guardToolCall, hookOutputFor, removeSessionWorkspace, sdkEnvFor, sdkToolPolicyFor } from "./sdk-isolation";
import { commitShaOf, describePush, pushWorkspace, type PushContext } from "./workspace-push";
import { mergeRecipients, restoreWorkspace, saveWorkspace, toSeed, type LeftOut, type RestoredWorkspace, type SaveWorkspaceOptions } from "./workspace-store";
import { readWorkspaceChanges, syncCheckoutToSandbox, syncWorkspaceToSandbox } from "./workspace-sync";
import { checkoutMissingNote, checkoutNote, checkoutRepository, defaultBranchChanges, describeCheckout, disposeCheckout, extractArchive, testSetupChanges, testSetupReviewReason, updateConflicts, updateNote, type Checkout, type CheckoutBase, type CheckoutInput } from "./checkout";
import { fingerprintWorkspace, workspaceChanged } from "./workspace-fingerprint";
import type { AgentSessionInput, MergeInput, SessionFinish, SessionLaunch, SessionParked, SessionResult, SessionRunOptions } from "./types";

const ToolGrants = z.array(ToolGrant);
const CONTROL_POLL_MS = 250;
/** How often a running session re-reads its business's stop flag (one indexed read per session). */
export const STOP_CHECK_MS = 5_000;
/** The stop a running session gives itself when it finds the team stopped. */
export const AGENTS_STOPPED_REASON = "agents stopped";
const DEFAULT_MAX_TURNS = 60;
const SESSION_TOKEN_TTL_SECONDS = 4 * 60 * 60;
/** After a stop, a loop or a park, how long the SDK gets to end its turn and report its usage before it is aborted. */
export const SDK_STOP_GRACE_MS = 10_000;
/** Phase timeouts of the acceptance run: dependency install (online), then the tests (offline). */
const ACCEPTANCE_PREPARE_TIMEOUT_MS = 10 * 60 * 1000;
const ACCEPTANCE_RUN_TIMEOUT_MS = 15 * 60 * 1000;
/**
 * Lifetime a session asks of its sandbox. A live session creates one only for its acceptance run (copy, install, tests:
 * both phase timeouts plus the copy), which fits inside E2B Hobby's one-hour cap; Pro allows 24 hours (docs/DEPLOY.md
 * §5). A mock replay ignores it.
 */
export const SANDBOX_TTL_MINUTES = 30;

/** Heartbeat when running inside Temporal; a no-op in unit tests that call the activity directly. */
function heartbeat(details?: unknown): void {
  try {
    Context.current().heartbeat(details);
  } catch {
    /* not inside an activity */
  }
}

function cancellation(): AbortSignal | null {
  try {
    return Context.current().cancellationSignal;
  } catch {
    return null;
  }
}

/**
 * The activity was cancelled because this worker is shutting down (its grace ran out before the drain reached the
 * session), not by the workflow or a timeout: the run hands off instead of stopping (../drain.ts).
 */
export function cancelledForShutdown(signal: AbortSignal | null): boolean {
  try {
    if (Context.current().cancellationDetails?.workerShutdown) return true;
  } catch {
    /* not inside an activity */
  }
  const reason = signal?.reason as { message?: unknown } | string | undefined;
  return (typeof reason === "string" ? reason : String(reason?.message ?? "")) === "WORKER_SHUTDOWN";
}

/**
 * A retry after this run's worker died without handing it off (a crash, or the shutdown's force deadline): the run
 * carries on from the replay position and progress its last heartbeat recorded, like a resumed run. Null on a first
 * attempt or outside Temporal.
 */
export function retriedFrom(): { cursor: string | null; progress: ProgressState | null } | null {
  let info: { attempt: number; heartbeatDetails?: unknown };
  try {
    info = Context.current().info;
  } catch {
    return null;
  }
  if (info.attempt <= 1) return null;
  const d = (info.heartbeatDetails ?? {}) as { cursor?: unknown; ring?: unknown };
  const ring = d.ring && typeof d.ring === "object" && typeof (d.ring as { progress?: unknown }).progress === "number" ? (d.ring as ProgressState) : null;
  return { cursor: typeof d.cursor === "string" ? d.cursor : null, progress: ring };
}

const handoffNote = "This worker is shutting down for a deploy: the session saves its work and continues on the next worker.";

/** How a run that hands off ends: the agentSession workflow starts the next run at once, from `cursor`, with `carry`. */
function handoffOutcome(cursor: string | null, carry: readonly SessionCommand[]): Pick<RunOutcome, "outcome" | "reason" | "blockedReason" | "approvalId" | "summary" | "providerSessionId" | "parked"> {
  return { outcome: "stopped", reason: "worker shutting down", blockedReason: "stopped", approvalId: null, summary: "Moved to another worker; the session continues there.", providerSessionId: null, parked: { cursor, carry: carriedOver(carry), handoff: true } };
}

/** The environment a sandbox receives. Short-lived, non-secret identifiers only; asserted before every launch (AC-11.6.6). */
export function buildSandboxEnv(input: { businessId: string; agentId: string; taskId: string; sessionId: string; gatewayUrl: string; extra?: Record<string, string> }): Record<string, string> {
  const env: Record<string, string> = {
    FM_BUSINESS_ID: input.businessId,
    FM_AGENT_ID: input.agentId,
    FM_TASK_ID: input.taskId,
    FM_SESSION_ID: input.sessionId,
    FM_GATEWAY_URL: input.gatewayUrl,
    ...(input.extra ?? {}),
  };
  assertNoLongLivedCredentials(env);
  return env;
}

export function templateForAgent(agent: Pick<Agent, "agentType">): AgentTemplate {
  return getTemplateByAgentType(agent.agentType) ?? listTemplates({ family: "worker" })[0] ?? getTemplate("chief_of_staff");
}

/**
 * The session token's tools (`connector:tool`): every grant resolved to the real tools that serve it. Templates grant
 * capabilities (`repos.read`, `tasks.list`), the Tools tab saves tool names; packages/connectors `resolveGrants` maps
 * both onto connector tools (`github:read_tree`, `platform:list_tasks`) and drops what nothing serves yet.
 */
export function toolRefs(grants: readonly { connectorKey: string; tools: readonly string[] }[]): string[] {
  return resolveGrants(grants).toolRefs;
}

/** MCP tool names the SDK sees for the gateway servers: `mcp__<connector>__<tool>` (`mcp__<connector>` for a wildcard). */
export function mcpToolNames(grants: readonly { connectorKey: string; tools: readonly string[] }[]): string[] {
  return resolveGrants(grants).mcpTools;
}

/**
 * An agent's live version follows its template when it is the one the platform wrote at hiring (version 1, by the
 * system) and nobody has edited it since: the template is then the source of its tools and instructions, so a tool or a
 * rule added to the template reaches every such agent at its next session. Until Nov 2, 2026 the version's copy won:
 * the Foundmill business's agents, hired Oct 22, never received the Planner's `tasks.update` (added to the template
 * later), and its Planner ended two re-scoping sessions blocked, "no task-update tool". A version the founder, the coach
 * or an agent wrote (any later version, or one not by the system) keeps its own tools and instructions.
 */
export function followsTemplate(version: Pick<AgentVersion, "version" | "createdByKind"> | null): boolean {
  return version === null || (version.version === 1 && version.createdByKind === "system");
}

export function parseGrants(version: AgentVersion | null, template: Pick<AgentTemplate, "tools">): { connectorKey: string; tools: string[] }[] {
  const parsed = version && !followsTemplate(version) ? ToolGrants.safeParse(version.tools) : null;
  const grants = parsed?.success && parsed.data.length > 0 ? parsed.data : template.tools;
  return grants.map((g) => ({ connectorKey: g.connectorKey, tools: [...g.tools] }));
}

export function instructionsFor(version: AgentVersion | null, template: Pick<AgentTemplate, "instructions">) {
  const parsed = version && !followsTemplate(version) ? AgentInstructions.safeParse(version.instructions) : null;
  return parsed?.success ? parsed.data : template.instructions;
}

/**
 * Pick the recording for a task, deterministic by task id. A new business's first tasks replay sessions that end well:
 * the same task kind when one exists, else any kind that does (a legal or channel task never replays another kind's failed
 * session). The failed and blocked recordings are opt-in (`scenarios: "all"`, env MOCK_SESSION_SCENARIOS=all, for demos
 * and failure drills) or chosen by key; when a caller restricts the pool to such recordings they are used as they are
 * (audit IAE-22).
 */
export function recordingForTask(task: Pick<Task, "id" | "kind">, recordings: readonly { key: string; taskKind: string; outcome?: string }[] = RECORDINGS, options: { scenarios?: "done" | "all" } = {}): string {
  if (recordings.length === 0) throw new Error("no recordings available for the mock sandbox");
  const sameKind = recordings.filter((r) => r.taskKind === task.kind);
  const done = <T extends { outcome?: string }>(list: readonly T[]): T[] => list.filter((r) => r.outcome === undefined || r.outcome === "done");
  let pool: readonly { key: string }[];
  if (options.scenarios === "all") pool = sameKind.length > 0 ? sameKind : recordings;
  else pool = [done(sameKind), done(recordings), sameKind, recordings].find((p) => p.length > 0)!;
  return pool[stableHash32(task.id) % pool.length]!.key;
}

/** An approval id the gateway returned (a row id); a recording's own ids ("apr-3c88") are not. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const summariseArgs = (args: unknown): string => {
  const s = typeof args === "string" ? args : JSON.stringify(args ?? {});
  return s.length > 480 ? `${s.slice(0, 477)}...` : s;
};

interface UsageTotals {
  tokensIn: number;
  tokensOut: number;
  /** USD cents, unrounded (an Estimate). */
  costMinor: number;
}

/** The slice of an SDK `result.modelUsage` entry the session books. */
interface SdkModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
}

/** The slice of an SDK assistant message (`message.message`, a Messages API message) that carries usage. */
interface SdkAssistantUsage {
  id?: string;
  model?: string;
  usage?: { input_tokens?: number | null; output_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null } | null;
}

/**
 * A session's model usage, in USD cents (an Estimate, contract: credits are USD). The SDK's `result.modelUsage` is
 * cumulative across the turns of a streaming-input session, so each result replaces the settled totals (never summed;
 * a zeroed crash result never lowers them). Assistant messages since the last result are estimated from their own
 * `usage` at list price (the last usage seen per message id counts), so a turn cut short by a stop, a loop or a crash
 * is still booked.
 */
export class SessionUsage {
  private settled: UsageTotals = { tokensIn: 0, tokensOut: 0, costMinor: 0 };
  private readonly open = new Map<string, UsageTotals>();

  constructor(private fallbackModelId: string) {}

  /** The session moved to another model (a nudge's "Upgrade to Opus"): assistant messages that name none are priced on it. */
  useModel(modelId: string): void {
    this.fallbackModelId = modelId;
  }

  onResult(modelUsage: Record<string, SdkModelUsage> | null | undefined): void {
    const latest: UsageTotals = { tokensIn: 0, tokensOut: 0, costMinor: 0 };
    for (const u of Object.values(modelUsage ?? {})) {
      latest.tokensIn += u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens;
      latest.tokensOut += u.outputTokens;
      latest.costMinor += u.costUSD * 100;
    }
    this.settled = { tokensIn: Math.max(this.settled.tokensIn, latest.tokensIn), tokensOut: Math.max(this.settled.tokensOut, latest.tokensOut), costMinor: Math.max(this.settled.costMinor, latest.costMinor) };
    this.open.clear();
  }

  onAssistant(message: SdkAssistantUsage): void {
    const u = message.usage;
    if (!u || !message.id) return;
    const usage = { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0, cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0, cacheReadInputTokens: u.cache_read_input_tokens ?? 0 };
    const priced = (id: string | undefined): id is ModelId => !!id && id in MODEL_PRICING;
    const modelId = priced(message.model) ? message.model : priced(this.fallbackModelId) ? this.fallbackModelId : null;
    this.open.set(message.id, { tokensIn: usage.inputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens, tokensOut: usage.outputTokens, costMinor: modelId ? meter(usage, modelId).costMinor : 0 });
  }

  totals(): UsageTotals {
    const out = { ...this.settled };
    for (const u of this.open.values()) {
      out.tokensIn += u.tokensIn;
      out.tokensOut += u.tokensOut;
      out.costMinor += u.costMinor;
    }
    return out;
  }
}

/** How long a run waits for the founder before it frees its slot (env: APPROVAL_WAIT_MINUTES, SESSION_PAUSE_HOLD_MINUTES). */
function founderWaits(deps: OrchestratorDeps): { approvalMs: number; pauseHoldMs: number } {
  return { approvalMs: deps.env.APPROVAL_WAIT_MINUTES * 60_000, pauseHoldMs: deps.env.SESSION_PAUSE_HOLD_MINUTES * 60_000 };
}

const minutesText = (ms: number): string => {
  const m = Number((ms / 60_000).toFixed(1));
  return `${m} minute${m === 1 ? "" : "s"}`;
};

const approvalTimeoutNote = (ms: number) => `No decision on the pending approval after ${minutesText(ms)}. The session ends here and frees its place for other work; the request stays open, and approving it lets the task run again.`;
const parkNote = (ms: number) => `Paused for ${minutesText(ms)}: the session saves its work and frees its place for other work. Resume picks it up again.`;

/**
 * This run's control commands, oldest first (`pull`), and the number of the last one read (`lastSeq`). `pull` never
 * throws: a failed poll (Redis down) is logged and the next one retries.
 */
function commandFeed(deps: OrchestratorDeps, sessionId: string, fromSeq: number): { pull: () => Promise<SessionCommand[]>; lastSeq: () => number } {
  let last = fromSeq - 1;
  return {
    async pull() {
      let commands: SessionCommand[];
      try {
        commands = await deps.control.drain(sessionId);
      } catch (err) {
        deps.log.warn({ err: (err as Error).message, sessionId }, "session control poll failed; retrying on the next poll");
        return [];
      }
      const mine = commands.filter((c) => c.seq === undefined || c.seq >= fromSeq);
      for (const c of mine) if (c.seq !== undefined && c.seq > last) last = c.seq;
      return mine;
    },
    lastSeq: () => last,
  };
}

/** Commands read before the run starts are handed to the runner's first poll. */
function withPrefetched(first: SessionCommand[], pull: () => Promise<SessionCommand[]>): () => Promise<SessionCommand[]> {
  let head = first;
  return async () => {
    const before = head;
    head = [];
    return before.length > 0 ? [...before, ...(await pull())] : pull();
  };
}

/**
 * The business's stop flag as a control command: every STOP_CHECK_MS the feed re-reads it and, once the team is
 * stopped, adds one `stop`. A session opened while Stop all agents was being pulled, one its signal never reached
 * (Temporal slow or down) and one running when the credits ran out or the key was revoked (no signal at all) all stop
 * within seconds. A failed read is logged and retried on the next check.
 */
function withStopWatch(deps: OrchestratorDeps, businessId: string, pull: () => Promise<SessionCommand[]>): () => Promise<SessionCommand[]> {
  let nextCheckMs = deps.clock.nowMs() + STOP_CHECK_MS;
  let stopped = false;
  return async () => {
    const commands = await pull();
    if (stopped || deps.clock.nowMs() < nextCheckMs) return commands;
    nextCheckMs = deps.clock.nowMs() + STOP_CHECK_MS;
    try {
      stopped = await repos.businesses.agentsStopped(deps.db, businessId);
    } catch (err) {
      deps.log.warn({ err: (err as Error).message, businessId }, "stop flag read failed; retrying on the next check");
    }
    return stopped ? [...commands, { kind: "stop", reason: AGENTS_STOPPED_REASON, by: null }] : commands;
  };
}

/** Nudges and decisions that a parked run did not act on: the workflow hands them to the next run. */
const carriedOver = (commands: readonly SessionCommand[]): SessionCommand[] => commands.filter((c) => c.kind === "shout" || c.kind === "decision");

/**
 * Heartbeat and run `tick` every CONTROL_POLL_MS, one at a time. A tick that throws is logged: a rejection left
 * unhandled in a timer would take the whole worker down, and every session running on it. `stop()` ends the timer and
 * resolves once a tick still in flight has applied what it read, so nothing it read is left out of the run's result.
 */
function controlLoop(deps: OrchestratorDeps, sessionId: string, tick: () => Promise<void>, details: () => unknown): { flush(): Promise<void>; stop(): Promise<void> } {
  let chain: Promise<void> = Promise.resolve();
  let pending = 0;
  const step = (): Promise<void> => {
    pending += 1;
    chain = chain
      .then(tick)
      .catch((err: unknown) => deps.log.warn({ err: (err as Error)?.message ?? String(err), sessionId }, "session control step failed"))
      .then(() => {
        pending -= 1;
      });
    return chain;
  };
  const timer = setInterval(() => {
    heartbeat(details());
    if (pending === 0) void step();
  }, CONTROL_POLL_MS);
  return {
    flush: step,
    stop: () => {
      clearInterval(timer);
      return chain;
    },
  };
}

interface RunnerContext {
  input: AgentSessionInput;
  launch: SessionLaunch;
  task: Task;
  agent: Agent;
  startedAtMs: number;
  run: SessionRunOptions;
}

class SessionRecorder {
  progress: ProgressState;
  eventsEmitted = 0;
  toolCalls = 0;
  toolFailures = 0;
  readonly loop = new LoopDetector();
  /** recording/SDK approval id → approvals row id. */
  readonly approvalIds = new Map<string, string>();
  readonly approvalIdsReverse = new Map<string, string>();
  pendingApprovalId: string | null = null;
  /** When the pending approval opened (clock ms); the wait for the founder is capped at APPROVAL_WAIT_MINUTES. */
  pendingSince: number | null = null;
  /** Recorded holds whose call the founder had already approved (0030): the replay goes on without asking again. */
  readonly grantedHolds = new Set<string>();
  /** The approval the founder rejected in this run, if any (the session ends blocked on it). */
  rejectedApprovalId: string | null = null;
  prNumber: number | null = null;
  /** Milliseconds this run kept a sandbox running (the acceptance run of a live code task); priced at the session's end. */
  sandboxMs = 0;
  /**
   * The agent blocked this session's own task with the platform's `block_task` and the call went through: the gateway
   * set the task `blocked` and wrote its `task.blocked`. The session then ends `blocked` with this reason (decision 3).
   */
  agentBlock: { reason: string } | null = null;
  /** `block_task` calls in flight on this session's task: call id → the agent's reason. */
  private readonly blockCalls = new Map<string, string>();
  /**
   * What the agent pushed to its own branch (`agent/<taskId>`) with GitHub's `commit_files` during this session: the
   * count of pushes that went through and the last branch head one answered. The end-of-session push goes on top of
   * them (workspace-push.ts `PushContext.agentPushed`).
   */
  readonly agentPushed: { count: number; lastSha: string | null } = { count: 0, lastSha: null };
  /** `commit_files` calls in flight on this session's own branch. */
  private readonly pushCalls = new Set<string>();
  lastPersisted = -1;
  lastPhase: string | null = null;
  /** Where a replay would pick up (mock runs): carried on every heartbeat so a retried run continues from there. */
  cursorOf: (() => string | null) | null = null;
  /** Model usage so far; read by every exit path, a thrown error included. */
  readonly usage: SessionUsage;
  private seq = 0;

  constructor(
    private readonly deps: OrchestratorDeps,
    private readonly ctx: RunnerContext,
  ) {
    // A resumed run carries on from the progress the parked run reached instead of starting the ring at zero.
    this.progress = ctx.run.resume?.progress ?? initialProgress({ planSteps: ctx.launch.planSteps, acceptanceTests: ctx.launch.acceptanceTests });
    this.usage = new SessionUsage(ctx.launch.modelId);
  }

  nextCallId(): string {
    this.seq += 1;
    return `${this.ctx.input.sessionId.slice(0, 8)}-${this.seq}`;
  }

  /**
   * What every heartbeat of this run carries: enough for a retry to continue where this run stood (the progress ring and
   * the replay cursor), and the usage so far: when the run dies without returning (its worker lost, a heartbeat
   * timeout), the workflow books the spend from the last heartbeat (`usageFromHeartbeat`).
   */
  beatDetails(extra: Record<string, unknown> = {}): Record<string, unknown> {
    const u = this.usage.totals();
    const usage: RunUsage = { tokensIn: u.tokensIn, tokensOut: u.tokensOut, costMinor: Math.round(u.costMinor) };
    return { sessionId: this.ctx.input.sessionId, events: this.eventsEmitted, progress: this.progress.progress, ring: this.progress, cursor: this.cursorOf?.() ?? null, usage, ...extra };
  }

  /** Publish one event to the session stream and fold it into progress / loop detection / approvals. */
  async publish(event: SessionEventInput, opts: { args?: unknown } = {}): Promise<{ loop: boolean }> {
    const { deps, ctx } = this;
    const at = event.at ?? deps.clock.now().toISOString();
    const full = { ...event, at } as SessionEventInput;
    try {
      await publishSessionEvent(deps.redis, ctx.input.sessionId, full);
    } catch (err) {
      deps.log.warn({ err: (err as Error).message, sessionId: ctx.input.sessionId }, "session stream publish failed");
    }
    this.eventsEmitted += 1;
    heartbeat(this.beatDetails());

    if (full.kind === "tool_call") {
      if (full.status === "started") this.toolCalls += 1;
      if (full.status === "failed" || full.status === "denied") this.toolFailures += 1;
      this.trackBlockTask(full, opts.args);
      this.trackAgentPush(full, opts.args);
      if (full.status === "succeeded" && /merge_pr|merge_pull_request/i.test(full.tool)) {
        const m = /#?(\d{1,6})/.exec(full.resultSummary ?? "");
        if (m) this.prNumber = Number(m[1]);
      }
      if (full.status === "awaiting_approval") await this.openApproval(full);
      else if (full.status !== "started" && this.pendingApprovalId && this.approvalIds.get(full.approvalId ?? full.callId) === this.pendingApprovalId) {
        // The call that was waiting moved on without a decision from the founder: a recorded hold resolved by itself.
        // Its approval and Inbox item must not stay open (and block Continue) for a call that already ran or was refused.
        await this.markApprovalResolved(this.pendingApprovalId, full.status === "denied" ? "rejected" : "approved", null);
      }
    }

    const before = this.progress;
    this.progress = applySessionEvent(this.progress, full);
    await this.persistProgress(before);

    const verdict = this.loop.observe(full, opts.args);
    if (verdict?.loop) {
      await this.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), level: "error", source: "system", text: `Loop detected: ${verdict.signature.slice(0, 200)} repeated ${verdict.count} times in a row. Stopping the session and returning the task to its lead.` });
      return { loop: true };
    }
    return { loop: false };
  }

  /**
   * A `block_task` on this session's own task: its reason is kept from the call's arguments, and once the call has gone
   * through (not refused by the gateway, its policy or the platform) the agent has blocked the task.
   */
  private trackBlockTask(call: Extract<SessionEventInput, { kind: "tool_call" }>, args: unknown): void {
    if (call.tool !== "block_task" || (call.connectorKey !== null && call.connectorKey !== undefined && call.connectorKey !== "platform")) return;
    if (call.status === "started") {
      const a = (args ?? {}) as { taskId?: unknown; reason?: unknown };
      if (a.taskId !== undefined && a.taskId !== this.ctx.task.id) return;
      this.blockCalls.set(call.callId, typeof a.reason === "string" && a.reason.trim() ? a.reason.trim().slice(0, 2000) : "the agent blocked the task");
      return;
    }
    const reason = this.blockCalls.get(call.callId);
    if (reason === undefined) return;
    this.blockCalls.delete(call.callId);
    if (call.status === "succeeded" && call.policyOutcome !== "deny" && call.policyOutcome !== "ask") this.agentBlock = { reason };
  }

  /**
   * A `commit_files` by the agent on this session's own branch: once the call has gone through (not refused by the
   * gateway or its policy) the branch moved by the agent's own hand, and the head GitHub answered, when the answer names
   * it, is where the end-of-session push expects the branch.
   */
  private trackAgentPush(call: Extract<SessionEventInput, { kind: "tool_call" }>, args: unknown): void {
    if (call.tool !== "commit_files" || (call.connectorKey !== null && call.connectorKey !== undefined && call.connectorKey !== "github")) return;
    if (call.status === "started") {
      const a = (args ?? {}) as { branch?: unknown };
      if (a.branch === this.ctx.launch.branch) this.pushCalls.add(call.callId);
      return;
    }
    if (!this.pushCalls.delete(call.callId)) return;
    if (call.status !== "succeeded" || call.policyOutcome === "deny" || call.policyOutcome === "ask") return;
    // A refused tool call still answers (ok: false): only a commit counts.
    if (/"ok"\s*:\s*false/.test(call.resultSummary ?? "")) return;
    this.agentPushed.count += 1;
    const sha = commitShaOf(call.resultSummary);
    if (sha) this.agentPushed.lastSha = sha;
  }

  /** Publish without feeding the reducers (system notes). */
  async publishRaw(event: SessionEventInput): Promise<void> {
    try {
      await publishSessionEvent(this.deps.redis, this.ctx.input.sessionId, event);
      this.eventsEmitted += 1;
    } catch (err) {
      this.deps.log.warn({ err: (err as Error).message }, "session stream publish failed");
    }
  }

  private async persistProgress(before: ProgressState): Promise<void> {
    const { deps, ctx } = this;
    const p = this.progress;
    const phaseChanged = p.phase !== before.phase;
    const testsMoved = p.acceptanceTestsPassing !== before.acceptanceTestsPassing || p.acceptanceTests !== before.acceptanceTests;
    const bigStep = Math.abs(p.progress - this.lastPersisted) >= 0.05;
    if (!phaseChanged && !testsMoved && !bigStep) return;
    this.lastPersisted = p.progress;
    try {
      await repos.tasks.setProgress(deps.db, ctx.input.businessId, ctx.task.id, { progress: p.progress, phase: p.phase, eta: p.etaAt ? new Date(p.etaAt) : null });
      if (phaseChanged || testsMoved) {
        await emitEvent(deps.db, {
          businessId: ctx.input.businessId,
          type: "task.progressed",
          actor: { kind: "agent", id: ctx.agent.id },
          payload: { taskId: ctx.task.id, assigneeAgentId: ctx.agent.id, sessionId: ctx.input.sessionId, progress: p.progress, phase: p.phase ?? "implementing", planStepsDone: p.planStepsDone, planSteps: p.planSteps, acceptanceTestsPassing: p.acceptanceTestsPassing, acceptanceTests: p.acceptanceTests, reviewPassed: p.reviewPassed, merged: p.merged, etaAt: p.etaAt },
        });
      }
    } catch (err) {
      deps.log.warn({ err: (err as Error).message }, "progress persistence failed");
    }
  }

  /**
   * A tool call is waiting for the founder. One gated call has one approval (audit O-26): a live call's approval is the
   * one the gateway opened (with its Inbox item), tracked by the id the gateway returned; a replayed hold whose call the
   * founder already approved (an earlier session on the task ended before the answer) goes on under that approval; a
   * hold asked again while its approval is open waits on it. Otherwise the approvals row, `approval.requested` and the
   * decision Inbox item are written here (audit FR-01).
   */
  private async openApproval(call: Extract<SessionEventInput, { kind: "tool_call" }>): Promise<void> {
    const { deps, ctx } = this;
    const key = call.approvalId ?? call.callId;
    if (this.approvalIds.has(key)) return;
    const businessId = ctx.input.businessId;
    const connectorKey = call.connectorKey ?? "platform";
    try {
      const fromGateway = call.approvalId && UUID_RE.test(call.approvalId) ? await repos.approvals.find(deps.db, businessId, call.approvalId) : null;
      if (fromGateway && fromGateway.sessionId === ctx.input.sessionId) {
        this.track(key, fromGateway, true);
        // Opened by a gateway that predates the Inbox item: the founder still gets one.
        if (!fromGateway.inboxItemId) await openApprovalNote(deps.db, businessId, fromGateway, { agent: ctx.agent, taskTitle: ctx.task.title, argsSummary: call.argsSummary ?? null });
        return;
      }
      const gated = { sessionId: ctx.input.sessionId, agentId: ctx.agent.id, connectorKey, tool: call.tool, args: { summary: call.argsSummary ?? "" } };
      const granted = await repos.approvals.useGranted(deps.db, businessId, { ...gated, amountMinor: 0 });
      if (granted) {
        this.track(key, granted, false);
        this.grantedHolds.add(key);
        await this.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "info", text: `The founder already approved ${call.tool}; continuing without asking again.` });
        return;
      }
      const open = await repos.approvals.claimOpen(deps.db, businessId, gated);
      if (open) {
        this.track(key, open, true);
        return;
      }
      const approval = await deps.db.transaction(async (tx) => {
        const row = await repos.approvals.create(tx, businessId, { agentId: ctx.agent.id, sessionId: ctx.input.sessionId, taskId: ctx.task.id, connectorKey, tool: call.tool, args: gated.args, reasons: [call.resultSummary ?? "policy asked for the founder's approval"], ...(call.approvalId && isUuid(call.approvalId) ? { decisionType: null } : {}) });
        // Delegated to an agent in Team › Responsibilities (AC-11.9.2): it approved as the approval opened, so nothing is asked.
        if (row.outcome === "approved" && row.byKind === "agent" && row.byId) return row;
        const requested = await emitEvent(tx, {
          businessId,
          type: "approval.requested",
          actor: { kind: "agent", id: ctx.agent.id },
          payload: { approvalId: row.id, agentId: ctx.agent.id, sessionId: ctx.input.sessionId, connectorKey, tool: call.tool, amount: null, reasons: [call.resultSummary ?? "policy outcome: ask"], policyIds: [], hardGate: false, summary: `${ctx.agent.name} wants to call ${connectorKey}.${call.tool}: ${call.argsSummary || "no arguments"}`.slice(0, 1000) },
        });
        await openApprovalNote(tx, businessId, row, { agent: ctx.agent, taskTitle: ctx.task.title, argsSummary: call.argsSummary ?? null, sourceEventIds: [requested.id] });
        return row;
      });
      if (approval.outcome === "approved" && approval.byKind === "agent" && approval.byId) {
        this.track(key, approval, false);
        await emitEvent(deps.db, {
          businessId,
          type: "approval.resolved",
          actor: { kind: "agent", id: approval.byId },
          payload: { approvalId: approval.id, agentId: ctx.agent.id, outcome: "approved", resolvedBy: { kind: "agent", id: approval.byId }, note: "Delegated in Team › Responsibilities", latencyMs: 0 },
        });
        // Released through the session's own control list, as a founder's decision would be, and nobody is asked.
        await deps.control.post(ctx.input.sessionId, { kind: "decision", approvalId: approval.id, outcome: "approved", by: null });
        return;
      }
      this.track(key, approval, true);
    } catch (err) {
      deps.log.warn({ err: (err as Error).message }, "approval row creation failed");
    }
  }

  /** Map the recorded (or SDK) approval id to the row; a call that waits on it makes it the pending one. */
  private track(key: string, approval: Approval, waits: boolean): void {
    this.approvalIds.set(key, approval.id);
    this.approvalIdsReverse.set(approval.id, key);
    if (!waits) return;
    this.pendingApprovalId = approval.id;
    this.pendingSince = this.deps.clock.nowMs();
  }

  /**
   * Bookkeeping for a decision the run acted on. The founder's answer arrives already stored (`inbox.decide` resolves
   * the row before it signals); a recorded hold that resolved by itself is stored here, as the system's.
   */
  async markApprovalResolved(approvalId: string, outcome: "approved" | "rejected", by: string | null): Promise<void> {
    const { deps, ctx } = this;
    try {
      let approval = await repos.approvals.get(deps.db, ctx.input.businessId, approvalId);
      if (approval.outcome === null) {
        approval = await repos.approvals.resolve(deps.db, ctx.input.businessId, approvalId, { outcome, byKind: by ? "user" : "system", byId: by });
        await emitEvent(deps.db, {
          businessId: ctx.input.businessId,
          type: "approval.resolved",
          actor: by ? { kind: "user", id: by } : systemActor,
          payload: { approvalId, agentId: ctx.agent.id, outcome, resolvedBy: by ? { kind: "user", id: by } : systemActor, note: null, latencyMs: Math.max(0, deps.clock.nowMs() - new Date(approval.createdAt).getTime()) },
        });
      }
      await closeApprovalItem(deps.db, ctx.input.businessId, approval);
    } catch (err) {
      deps.log.warn({ err: (err as Error).message }, "approval resolution bookkeeping failed");
    }
    if (outcome === "rejected") this.rejectedApprovalId = approvalId;
    if (this.pendingApprovalId === approvalId) {
      this.pendingApprovalId = null;
      this.pendingSince = null;
    }
  }
}

export function createSessionActivities(deps: OrchestratorDeps) {
  async function loadContext(input: AgentSessionInput) {
    const { db } = deps;
    const [agent, task, business, session] = await Promise.all([
      repos.agents.get(db, input.businessId, input.agentId),
      repos.tasks.get(db, input.businessId, input.taskId),
      repos.businesses.get(db, input.businessId),
      repos.agents.getSession(db, input.businessId, input.sessionId),
    ]);
    const [version, added] = await Promise.all([agent.currentVersionId ? repos.agents.getVersion(db, input.businessId, agent.currentVersionId) : null, repos.skills.listAddedForAgent(db, input.businessId, agent.id, agent.agentType)]);
    // Skills the founder added from the library or files: their instructions follow the house rules and instructions.
    const skills: AgentSkillPrompt[] = added.filter((a) => a.instructionsMd.trim()).map((a) => ({ name: a.name, source: a.source, instructionsMd: a.instructionsMd }));
    return { agent, task, business, session, version, template: templateForAgent(agent), skills };
  }

  /**
   * The key a session runs on (BUILD §10.2 step 3: decrypted here, in memory, per session). A business on its own key
   * runs on that key or not at all: when it cannot be read (no vault, revoked, never set, undecryptable) the session is
   * blocked with reason `credential` instead of quietly spending the platform's credits, as the gateway refuses tool
   * calls with `key-revoked`. Everyone else runs on the platform key.
   */
  async function resolveApiKey(businessId: string, billing: "byok" | "credits"): Promise<{ apiKey: string | null; source: "byok" | "platform" | "none" }> {
    if (billing === "byok") {
      if (!deps.vault) {
        deps.log.warn({ businessId }, "business runs on its own key but this service has no vault; session blocked");
        return { apiKey: null, source: "none" };
      }
      try {
        const key = await loadByokApiKey(deps.db, deps.vault, businessId);
        if (key) return { apiKey: key.apiKey, source: "byok" };
        deps.log.warn({ businessId }, "business runs on its own key but none is stored; session blocked");
      } catch (err) {
        deps.log.warn({ err: (err as Error).message, businessId }, "business's own key could not be read; session blocked");
      }
      return { apiKey: null, source: "none" };
    }
    return deps.env.ANTHROPIC_API_KEY ? { apiKey: deps.env.ANTHROPIC_API_KEY, source: "platform" } : { apiKey: null, source: "none" };
  }

  /** Drop the session's leftover control commands; a Redis failure here never fails the session. */
  async function clearControl(sessionId: string): Promise<void> {
    try {
      await deps.control.clear(sessionId);
    } catch (err) {
      deps.log.warn({ err: (err as Error).message, sessionId }, "session control list could not be cleared");
    }
  }

  /**
   * An idle agent that starts a session is working: `healthy`, with the event the Team screen listens for. Never over a
   * pause (Stop all agents, the credits pause or a wage cap that landed after the run read its agent): false then, and
   * the run ends before anything starts. A failed write is logged and the run goes on.
   */
  async function markWorking(input: AgentSessionInput, agent: Agent, task: Task): Promise<boolean> {
    try {
      if (!(await repos.agents.setHealthStatus(deps.db, input.businessId, agent.id, "healthy"))) return false;
      await emitEvent(deps.db, {
        businessId: input.businessId,
        type: "agent.health_changed",
        actor: systemActor,
        payload: { agentId: agent.id, from: agent.status, to: "healthy", reason: `working on "${task.title}"`.slice(0, 500), signals: {}, sessionId: input.sessionId },
      });
    } catch (err) {
      deps.log.warn({ err: (err as Error).message, agentId: agent.id }, "agent status could not be set to working");
    }
    return true;
  }

  return {
    /** Validate everything a session needs; returns non-secret launch facts only (tokens are minted inside the run). */
    async prepareSession(input: AgentSessionInput): Promise<SessionLaunch> {
      const { agent, task, business, version, template } = await loadContext(input);
      // Not a failure: the founder (or the credits pause, or Stop all agents) paused the agent. The workflow ends the
      // session `stopped` and the agent stays paused; retrying would not change the answer.
      if (agent.status === "paused") throw ApplicationFailure.nonRetryable(`Agent ${agent.name} is paused`, AGENT_PAUSED_FAILURE);
      if (business.agentsStoppedAt) throw ApplicationFailure.nonRetryable("Agents are stopped for this business", AGENT_PAUSED_FAILURE);
      const grants = resolveGrants(parseGrants(version, template));
      const route: RouteKey = template.route;
      const model = resolveModel(route, agent.modelKey);
      const { provider, mode, fellBackFrom } = await deps.sandbox();
      // AC-11.6.6: the sandbox environment is asserted before anything is created.
      const env = buildSandboxEnv({ businessId: input.businessId, agentId: agent.id, taskId: task.id, sessionId: input.sessionId, gatewayUrl: deps.gateway.baseUrl });
      const pool = provider instanceof MockSandboxProvider ? provider.recordings : RECORDINGS;
      const recordingKey = mode === "mock" ? recordingForTask(task, pool, { scenarios: deps.env.MOCK_SESSION_SCENARIOS }) : null;
      const recording = recordingKey ? pool.find((r) => r.key === recordingKey) ?? null : null;
      const acceptance = Array.isArray(task.acceptance) ? task.acceptance.length : 0;
      return {
        sandboxMode: mode,
        fellBackFrom,
        modelKey: model.modelKey,
        modelId: model.modelId,
        recordingKey,
        allowedTools: grants.toolRefs,
        mcpConnectors: grants.servers,
        envNames: Object.keys(env),
        modelBilling: business.modelBilling,
        branch: `agent/${task.id}`,
        maxTurns: DEFAULT_MAX_TURNS,
        planSteps: recording?.planSteps ?? 0,
        acceptanceTests: recording?.acceptanceTests ?? acceptance,
      };
    },

    /**
     * One run of the session. Long-running (on the sessions task queue); heartbeats on every event; honours
     * pause/resume/shout/stop/decision commands. `run` says which commands are this run's and, after a park, where to
     * pick up; workflows started before runs existed pass nothing.
     */
    async runAgentSession(input: AgentSessionInput, launch: SessionLaunch, briefText: string | null = null, runOptions: SessionRunOptions | null = null): Promise<SessionResult> {
      let run: SessionRunOptions = runOptions ?? { fromSeq: 0, resume: null };
      const retried = retriedFrom();
      if (retried) run = { ...run, resume: { cursor: retried.cursor ?? run.resume?.cursor ?? null, progress: retried.progress ?? run.resume?.progress ?? initialProgress({ planSteps: launch.planSteps, acceptanceTests: launch.acceptanceTests }), reason: "retry" } };
      const { agent, task, business, version, template, skills } = await loadContext(input);
      const startedAtMs = deps.clock.nowMs();
      const recorder = new SessionRecorder(deps, { input, launch, task, agent, startedAtMs, run });
      const signal = cancellation();
      const env = buildSandboxEnv({ businessId: input.businessId, agentId: agent.id, taskId: task.id, sessionId: input.sessionId, gatewayUrl: deps.gateway.baseUrl });

      const base = (): Omit<SessionResult, "outcome" | "reason" | "blockedReason" | "approvalId" | "summary" | "providerSessionId"> => {
        const usage = recorder.usage.totals();
        return {
          progress: recorder.progress,
          eventsEmitted: recorder.eventsEmitted,
          toolCalls: recorder.toolCalls,
          toolFailures: recorder.toolFailures,
          tokensIn: usage.tokensIn,
          tokensOut: usage.tokensOut,
          costMinor: Math.round(usage.costMinor),
          costMicroMinor: Math.round(usage.costMinor * MICRO_PER_MINOR),
          durationMs: deps.clock.nowMs() - startedAtMs,
          sandboxMs: recorder.sandboxMs,
          prNumber: recorder.prNumber,
        };
      };
      const stoppedBeforeStart = (reason: string, summary: string): SessionResult => ({ ...base(), outcome: "stopped", reason, blockedReason: "stopped", approvalId: null, summary, providerSessionId: null });

      // Commands posted while the run waited for a slot (the list is never cleared at start, so none is lost). A stop
      // among them, a team stopped meanwhile (its signal may never come) or an agent paused meanwhile ends the run
      // before anything starts.
      const feed = commandFeed(deps, input.sessionId, run.fromSeq);
      const waiting = await feed.pull();
      const earlyStop = waiting.find((c): c is Extract<SessionCommand, { kind: "stop" }> => c.kind === "stop");
      if (earlyStop) {
        await clearControl(input.sessionId);
        return stoppedBeforeStart(earlyStop.reason, `Stopped before it started: ${earlyStop.reason}.`);
      }
      if (business.agentsStoppedAt) {
        await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "info", text: "Not started: agents are stopped for this business." });
        await clearControl(input.sessionId);
        return stoppedBeforeStart(AGENTS_STOPPED_REASON, "Not started: agents are stopped for this business.");
      }
      // An agent with an open session is working (as on api-started sessions); the Team screen shows it. A pause that
      // landed after the agent was read (Stop all agents committing now) wins: the run ends here too.
      if (agent.status === "paused" || (agent.status === "idle" && !(await markWorking(input, agent, task)))) {
        await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "info", text: `Not started: ${agent.name} is paused.` });
        await clearControl(input.sessionId);
        return stoppedBeforeStart("agent paused", `Not started: ${agent.name} is paused.`);
      }

      const { provider } = await deps.sandbox();
      const recording = run.resume?.cursor ?? launch.recordingKey;
      const spec: SandboxSpecInput = { businessId: input.businessId, taskId: task.id, sessionId: input.sessionId, agentId: agent.id, envShortLived: env, ttlMinutes: SANDBOX_TTL_MINUTES, egressAllowList: sandboxEgressFor(task) };
      let sandbox: Sandbox | null = null;
      try {
        // A replay is the session itself; a live session needs a sandbox only for its acceptance run, created then.
        if (provider.mode === "mock") {
          sandbox = await provider.create({ ...spec, ...(recording ? { recording } : {}) });
          await sandbox.start();
        }
        const where = launch.sandboxMode === "mock" ? "mock sandbox" : acceptanceCommandFor(task) ? `${launch.sandboxMode} sandbox for the acceptance tests` : "no sandbox needed";
        await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "info", text: `Session ${run.resume ? (run.resume.reason === "retry" ? "resumed after its worker stopped" : run.resume.reason === "handoff" ? "continued on a new worker" : "resumed") : "started"} for ${agent.name} on "${task.title}" (${where}${launch.fellBackFrom ? `, fell back from ${launch.fellBackFrom}` : ""}, ${launch.modelKey}).` });

        const pull = withStopWatch(deps, input.businessId, withPrefetched(waiting, feed.pull));
        // A parked run says which command it read last: the workflow also hands the next run the nudges and decisions
        // that reached the list after that (they are cleared below, unread).
        const settle = ({ parked, ...r }: RunOutcome): SessionResult => ({ ...base(), ...r, ...(parked ? { parked: { ...parked, lastSeq: feed.lastSeq() } } : {}) });
        if (sandbox instanceof MockSandbox) return settle(await runMockSession(deps, recorder, sandbox, input, signal, pull));
        const acquireSandbox = async (): Promise<Sandbox> => {
          const created = await provider.create(spec);
          await created.start();
          return created;
        };
        return settle(await runLiveSession(deps, recorder, { input, launch, task, agent, startedAtMs, run }, { business, version, template, skills, briefText, resolveApiKey, sandboxEnv: env, acquireSandbox, pull }));
      } catch (err) {
        // `base()` carries the usage recorded so far: tokens already spent are booked whatever went wrong.
        const message = (err as Error).message ?? String(err);
        if (deps.drain.requested || cancelledForShutdown(signal)) {
          // The error came from this worker shutting down (a step it cut short, the SDK's abort): not the session's
          // failure. It hands off like a drained run, so the next worker continues and the agent is not marked failing.
          deps.log.warn({ err: message.slice(0, 300), sessionId: input.sessionId }, "session interrupted by the worker shutdown; handing it off");
          await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "info", text: handoffNote });
          const handedOff = handoffOutcome(recorder.cursorOf?.() ?? run.resume?.cursor ?? null, []);
          return { ...base(), ...handedOff, parked: { ...handedOff.parked!, lastSeq: run.fromSeq - 1 } };
        }
        await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "error", text: `Session failed: ${message.slice(0, 500)}` });
        return { ...base(), outcome: "failed", reason: message.slice(0, 500), blockedReason: "error", approvalId: null, summary: `Failed: ${message.slice(0, 200)}`, providerSessionId: null };
      } finally {
        try {
          await sandbox?.stop();
        } catch {
          /* best effort */
        }
        await clearControl(input.sessionId);
      }
    },

    /** Settle the session: agent_sessions row, usage ledger, task status, task events and the agent's health. */
    async finishSession(input: AgentSessionInput, launch: SessionLaunch, ran: SessionResult): Promise<SessionFinish> {
      const { db } = deps;
      const task = await repos.tasks.get(db, input.businessId, input.taskId);
      // The agent blocked its own task during the session (the platform's `block_task`: the gateway set it `blocked` and
      // wrote its `task.blocked`). That is how the session ended, whatever the run reported (decision 3): a run that
      // otherwise ended done, or failed on something other than a loop, ends blocked with the agent's reason, and the
      // task stays blocked instead of being booked done.
      const agentBlocked = task.status === "blocked" ? await agentBlockedEvent(deps, input, task.id) : null;
      const overridden = agentBlocked !== null && (ran.outcome === "done" || (ran.outcome === "failed" && ran.blockedReason !== "loop_detected"));
      const result: SessionResult = overridden ? { ...ran, outcome: "blocked", reason: agentBlocked.detail, blockedReason: "dependency", approvalId: null, summary: `Blocked by the agent: ${agentBlocked.detail}`.slice(0, 1800) } : ran;
      const eventIds: string[] = [];
      const endedAt = deps.clock.now();
      // Sandbox time (Estimate, audit BILL-11). A replay runs nowhere: its row keeps the session's minutes at no cost. A live
      // session holds a sandbox only for a code task's acceptance run, so only that time is booked, at the sandbox's list
      // price; the platform pays E2B, so the row is billed to credits whatever pays for the model (a business on its own
      // key is never charged credits, `bookUsage`). A Docker sandbox runs on the platform's own host and costs nothing.
      if (launch.sandboxMode === "mock") {
        await bookUsage(db, input.businessId, { agentId: input.agentId, sessionId: input.sessionId, kind: "sandbox", idempotencyKey: `session:${input.sessionId}:sandbox`, quantity: Math.max(1, Math.round(result.durationMs / 60_000)), unit: "minutes", costMinor: 0, billedTo: launch.modelBilling, occurredAt: endedAt, details: { sandboxMode: launch.sandboxMode, label: "Estimate", recording: launch.recordingKey } });
      } else if ((result.sandboxMs ?? 0) > 0) {
        const sandboxMs = result.sandboxMs ?? 0;
        await bookUsage(db, input.businessId, { agentId: input.agentId, sessionId: input.sessionId, kind: "sandbox", idempotencyKey: `session:${input.sessionId}:sandbox`, quantity: Math.max(1, Math.ceil(sandboxMs / 60_000)), unit: "minutes", costMicroMinor: sandboxCostMicroMinor(launch.sandboxMode, sandboxMs), currency: CREDITS_CURRENCY, billedTo: "credits", occurredAt: endedAt, details: { sandboxMode: launch.sandboxMode, label: "Estimate", sandboxMs } });
      }
      if (result.tokensIn + result.tokensOut > 0 && launch.sandboxMode !== "mock") {
        // The SDK prices in USD (an Estimate). Settled against credits when the platform key ran the session
        // (`bookUsage` pauses the team on the last credit). The exact cost is booked (0039), not its rounding.
        // Booked as it ran on the platform key (./session-credits): only the rest is booked here, at its exact cost (0039).
        const rest = await unbookedTokens(deps, input.businessId, input.sessionId, { tokens: result.tokensIn + result.tokensOut, costMinor: result.costMinor });
        const restMicro = Math.max(0, (result.costMicroMinor ?? Math.round(result.costMinor) * MICRO_PER_MINOR) - (Math.round(result.costMinor) - rest.costMinor) * MICRO_PER_MINOR);
        if (rest.tokens > 0 || restMicro > 0) await bookUsage(db, input.businessId, { agentId: input.agentId, sessionId: input.sessionId, kind: "tokens", idempotencyKey: `session:${input.sessionId}:tokens`, modelKey: result.modelKey ?? launch.modelKey, quantity: rest.tokens, unit: "tokens", costMicroMinor: restMicro, currency: "USD", billedTo: launch.modelBilling, occurredAt: endedAt, details: { source: "claude-agent-sdk", label: "Estimate" } });
      }
      // Read the agent after booking: the last credit may just have paused the team, and the founder's pause or Stop
      // all agents may have landed while the session ran. Nothing a session does un-pauses an agent.
      const agent = await repos.agents.get(db, input.businessId, input.agentId);
      const agentPaused = agent.status === "paused";
      // A session cut short by a pause of its agent or a team-wide stop did not fail on its merits: the task waits
      // `paused` and the next cycle after the resume picks it up (0023). Its row says `stopped`, so the retry backoff
      // (`retry.ts`, which counts failed sessions in a row) does not count it.
      const teamStopped = agentPaused || (await repos.businesses.agentsStopped(db, input.businessId));
      const outcome = teamStopped && result.outcome === "failed" ? "stopped" : result.outcome;
      await repos.agents.endSession(db, input.businessId, input.sessionId, { endedAt, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costMinor: Math.round(result.costMinor), outcome, recordingRef: launch.recordingKey });
      // The session's stream is its recording until now: save it to Postgres and let the stream expire (#233).
      await archiveSessionRecording({ db, redis: deps.redis, log: deps.log }, input);

      let taskStatus: TaskStatus;
      const cost = { amountMinor: Math.round(result.costMinor), currency: CREDITS_CURRENCY }; // model cost: US cents (DECISIONS 2026-10-12)
      // How many sessions of this task in a row ended failed or blocked, this one included (it is ended above).
      const blockedStreak = Math.max(1, failureStreak(await repos.agents.recentOutcomes(db, input.businessId, { taskIds: [task.id], limit: 12 }), ["failed", "blocked"]).failures);
      // The task was handed on while the session ran (its agent released, the task reassigned): its state now belongs
      // to whoever has it, so the session settles only its own row, its usage and its agent.
      const handedOver = task.assigneeAgentId !== null ? task.assigneeAgentId !== agent.id : agent.archivedAt !== null;
      switch (handedOver ? "handed_over" : outcome) {
        case "handed_over":
          // Reassigned while this session ran: the task is the new assignee's, and with this session over nobody is
          // working on it, so a task still marked running goes back to ready for the next cycle to start it for them.
          // Left as running, it was never started again (Sam's hydration fix, reassigned to the Engineering Lead
          // mid-session, Nov 2, 2026).
          taskStatus = task.status === "running" ? "ready" : task.status;
          break;
        case "done": {
          // A session that changed how the tests run (`review`) leaves the task for the founder to look at, never done.
          // A code task's work is on its own branch until it is merged: it waits in review for the merge (activities/merge.ts),
          // whatever phase the agent reported. Marked done instead, the tasks that depend on it started against a default
          // branch without it (Oct 31, 2026: the deploy contract, done on its branch, and three deploy tasks that could not compile).
          const testsRun = result.progress.acceptanceTests;
          const onOwnBranch = task.kind === "code" && launch.branch === `agent/${task.id}` && (testsRun === 0 || result.progress.acceptanceTestsPassing >= testsRun);
          taskStatus = result.review ? "review" : result.progress.merged ? "done" : onOwnBranch || result.progress.reviewPassed || result.progress.phase === "review" || result.progress.phase === "merge" ? "review" : "done";
          const ev = await emitEvent(db, {
            businessId: input.businessId,
            type: "task.completed",
            actor: { kind: "agent", id: agent.id },
            payload: { taskId: task.id, kind: task.kind, title: task.title, assigneeAgentId: agent.id, sessionId: input.sessionId, outcome: result.progress.progress >= 0.999 ? "success" : "partial", durationMs: Math.max(0, Math.round(result.durationMs)), cost, acceptanceTestsPassing: result.progress.acceptanceTestsPassing, acceptanceTests: result.progress.acceptanceTests, prNumber: result.prNumber, branch: launch.branch, summary: result.summary.slice(0, 2000) },
          }, { idempotencyKey: `task.completed:${input.sessionId}` });
          eventIds.push(ev.id);
          break;
        }
        case "blocked": {
          taskStatus = "blocked";
          // The agent's own block already told the founder (the gateway's `task.blocked` for this session): one Inbox
          // item, not two.
          if (agentBlocked && result.blockedReason === "dependency") {
            eventIds.push(agentBlocked.id);
            break;
          }
          const ev = await emitEvent(db, {
            businessId: input.businessId,
            type: "task.blocked",
            actor: { kind: "agent", id: agent.id },
            payload: { taskId: task.id, kind: task.kind, title: task.title, assigneeAgentId: agent.id, sessionId: input.sessionId, reason: result.blockedReason ?? "error", detail: (result.reason ?? "blocked").slice(0, 2000), approvalId: result.approvalId, occurrence: blockedStreak },
          }, { idempotencyKey: `task.blocked:${input.sessionId}` });
          eventIds.push(ev.id);
          break;
        }
        case "failed": {
          taskStatus = "failed";
          const ev = await emitEvent(db, {
            businessId: input.businessId,
            type: "task.blocked",
            actor: { kind: "agent", id: agent.id },
            payload: { taskId: task.id, kind: task.kind, title: task.title, assigneeAgentId: agent.id, sessionId: input.sessionId, reason: result.blockedReason ?? "error", detail: (result.reason ?? "failed").slice(0, 2000), approvalId: null, occurrence: blockedStreak },
          }, { idempotencyKey: `task.blocked:${input.sessionId}` });
          eventIds.push(ev.id);
          break;
        }
        default:
          // Stopped with its agent paused or the team stopped (Stop all agents, the credits pause, a refused start):
          // the task waits instead of being dropped, and runs again once the team is resumed. Cancelled by the platform
          // (its worker shut down for a deploy), not by anyone's Stop: the task goes back to `ready` (or stays `paused`
          // when the founder paused it) and a later cycle runs it again.
          if (teamStopped) taskStatus = "paused";
          else if (result.reason === CANCELLED_REASON) taskStatus = task.status === "paused" ? "paused" : "ready";
          else taskStatus = task.status === "paused" ? "paused" : "stopped";
      }
      if (task.status !== taskStatus) await repos.tasks.setStatus(db, input.businessId, task.id, taskStatus, { force: true });
      if (taskStatus === "done") await repos.tasks.setProgress(db, input.businessId, task.id, { progress: Math.max(result.progress.progress, task.status === "done" ? 1 : result.progress.progress), phase: result.progress.phase ?? "done" });
      // The last task of a roadmap item done: the first "shipped" signal, so the Chief of Staff offers Ready to start
      // selling? once per business (founder, 2026-10-18) and the demo task is created.
      if (taskStatus === "done" && task.roadmapItemId) {
        const offered = await offerReadyToSellAfterTask(deps, input.businessId, task).catch((err: unknown) => {
          deps.log.warn({ businessId: input.businessId, taskId: task.id, err: (err as Error).message }, "ready-to-sell offer not written");
          return null;
        });
        if (offered) eventIds.push(offered.eventId);
      }

      // Health: loops and failures mark the agent; a clean finish returns it to idle when nothing else is open. A
      // paused agent stays paused whatever the outcome, including a pause that lands after the read above (the write is
      // guarded, so it never undoes one).
      let healthChanged = false;
      const from: AgentStatus = agent.status;
      let to: AgentStatus = from;
      if (agentPaused) to = from;
      else if ((result.blockedReason === "loop_detected" || result.outcome === "failed") && !teamStopped) to = "failing";
      else if (result.outcome === "stopped" || teamStopped) to = "idle";
      else if (result.outcome === "done" || result.outcome === "blocked") {
        const open = await repos.agents.listSessions(db, input.businessId, { agentId: agent.id, openOnly: true, limit: 1 });
        to = open.items.length > 0 ? "healthy" : "idle";
      }
      // Never over a pause (the founder's, a team-wide stop, a wage cap): `setHealthStatus` leaves a paused agent alone.
      if (to !== from && from !== "paused" && to !== "paused" && (await repos.agents.setHealthStatus(db, input.businessId, agent.id, to))) {
        const ev = await emitEvent(db, {
          businessId: input.businessId,
          type: "agent.health_changed",
          actor: systemActor,
          payload: { agentId: agent.id, from, to, reason: result.blockedReason === "loop_detected" ? "loop detected: the same call repeated three times in a row" : result.outcome === "failed" ? `session failed: ${(result.reason ?? "error").slice(0, 200)}` : `session ${result.outcome}`, signals: { loopDetected: result.blockedReason === "loop_detected", errorRate: result.toolCalls > 0 ? Math.min(1, result.toolFailures / result.toolCalls) : null }, sessionId: input.sessionId },
        });
        eventIds.push(ev.id);
        healthChanged = true;
      }
      await repos.audit.append(db, input.businessId, { actorKind: "agent", actorId: agent.id, action: "session.finish", target: { kind: "session", id: input.sessionId }, details: { outcome: result.outcome, reason: result.reason, taskStatus, progress: result.progress.progress, toolCalls: result.toolCalls, costMinor: Math.round(result.costMinor) } });
      // A code task that passed its acceptance tests on its own branch waits in review for its merge: the session workflow
      // starts `mergeReview` with this (activities/merge.ts). A session held for review because it changed how the tests
      // run (`result.review`) is the founder's to look at first, never merged on its own.
      const tests = result.progress.acceptanceTests;
      const passed = tests === 0 || result.progress.acceptanceTestsPassing >= tests;
      const merge: MergeInput | null = taskStatus === "review" && task.kind === "code" && result.outcome === "done" && !result.review && !handedOver && passed && launch.branch === `agent/${task.id}` ? { businessId: input.businessId, taskId: task.id, agentId: agent.id, sessionId: input.sessionId, branch: launch.branch, acceptance: tests > 0 ? { passing: result.progress.acceptanceTestsPassing, total: tests } : null, summary: result.summary.slice(0, 2000) } : null;
      return { taskStatus, eventIds, healthChanged, merge };
    },

    /** Deliver a signal to the running session (pause / resume / shout / stop / decision). */
    async postSessionCommand(input: { sessionId: string; command: SessionCommand }): Promise<void> {
      await deps.control.post(input.sessionId, input.command);
    },
  };
}

export type SessionActivities = ReturnType<typeof createSessionActivities>;

/**
 * The `task.blocked` the gateway wrote when this session's agent blocked its own task with `block_task` (an agent's
 * event naming this session and task), or null when it did not.
 */
async function agentBlockedEvent(deps: OrchestratorDeps, input: AgentSessionInput, taskId: string): Promise<{ id: string; detail: string } | null> {
  try {
    const session = await repos.agents.getSession(deps.db, input.businessId, input.sessionId);
    const page = await repos.events.list(deps.db, input.businessId, { type: "task.blocked", from: session.startedAt, actorKind: "agent", limit: 100 });
    for (const e of page.items) {
      const p = e.payload as { taskId?: unknown; sessionId?: unknown; detail?: unknown };
      if (p.taskId === taskId && p.sessionId === input.sessionId) return { id: e.id, detail: typeof p.detail === "string" && p.detail.trim() ? p.detail : "the agent blocked the task" };
    }
  } catch (err) {
    deps.log.warn({ err: (err as Error).message, sessionId: input.sessionId }, "the agent's block of its task could not be read");
  }
  return null;
}

/** The subject of the note the Chief of Staff posts when the first roadmap item ships. */
export const READY_TO_SELL_SUBJECT = "Ready to start selling?";

/**
 * When every task of a roadmap item is done (the one "shipped" signal there is), the Chief of Staff offers to start
 * distribution: a non-blocking decision note tied to a `ready_to_sell` round, once per business and never once
 * distribution has started (`repos.productSignoffs.offerReadyToSell`). With it, the demo task: a research task to walk
 * through what shipped as a first customer would, for the Product Researcher when hired, else the researcher.
 */
export async function offerReadyToSellAfterTask(deps: OrchestratorDeps, businessId: string, task: Pick<Task, "id" | "roadmapItemId">): Promise<{ inboxItemId: string; eventId: string; demoTaskId: string | null } | null> {
  const { db } = deps;
  if (!task.roadmapItemId) return null;
  const siblings = await repos.tasks.list(db, businessId, { roadmapItemId: task.roadmapItemId, limit: 500 });
  if (siblings.items.length === 0 || siblings.items.some((t) => t.status !== "done")) return null;
  const [item, chief, channels, agents] = await Promise.all([repos.product.getRoadmapItem(db, businessId, task.roadmapItemId), repos.agents.chiefOfStaff(db, businessId), repos.channels.list(db, businessId, { enabled: true }), repos.agents.list(db, businessId, { limit: 500 })]);
  if (!chief) return null;
  const labels = channels.map((c) => CHANNEL_META[c.channelKey as ChannelKey]?.label ?? c.channelKey);
  const n = siblings.items.length;
  const body = [
    `${item.title} shipped: its ${n} task${n === 1 ? " is" : "s are"} done.`,
    labels.length ? `The channels on the board (${labels.join(", ")}) are waiting for the product.` : "No channel is on the board yet.",
    "Start distribution now, or keep building first.",
  ].join(" ");
  const offered = await repos.productSignoffs.offerReadyToSell(db, businessId, {
    roadmapItemId: item.id,
    title: item.title,
    chiefId: chief.id,
    item: { type: "decision", from_agent_id: chief.id, subject: READY_TO_SELL_SUBJECT, body_md: body, status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: signoffDecisionBlock("ready_to_sell"), blocks_continue: false, source_event_ids: [], entity_ids: [] },
  });
  if (!offered) return null;
  const ev = await emitEvent(db, { businessId, type: "inbox.item_created", actor: { kind: "agent", id: chief.id }, payload: { inboxItemId: offered.item.id, type: "decision", fromAgentId: chief.id, subject: offered.item.subject, blocksContinue: false, sourceEventIds: [], cost: null } });
  // The demo: a research task for the Product Researcher (template key `product_researcher`), else the researcher.
  const assignee = agents.items.find((a) => a.agentType === "product_researcher" && !a.archivedAt) ?? agents.items.find((a) => a.agentType === "researcher" && !a.archivedAt) ?? null;
  const customers = (await repos.product.listBlocks(db, businessId, { section: "Customers" }))[0];
  const icp = customers ? docText(customers.content).split("\n").map((l) => l.trim()).filter(Boolean)[0]?.slice(0, 80) : undefined;
  const departments = await repos.departments.list(db, businessId);
  const product = departments.find((d) => (d.moduleKeys as string[]).includes("product")) ?? null;
  const demo = await repos.tasks.create(db, businessId, {
    kind: "research",
    title: `Record a demo of ${item.title} for ${icp ?? "the first customers"}`.slice(0, 200),
    goalMd: "Walk through what shipped as a first customer would, record the steps and what they see, and note what is missing before it is shown to anyone. Nothing is sent to anyone.",
    acceptance: ["The demo follows the steps a first customer takes", "What is missing before it is shown to anyone is listed", "Nothing was sent to anyone"],
    roadmapItemId: item.id,
    departmentId: product?.id ?? null,
    assigneeAgentId: assignee?.id ?? null,
    status: "ready",
  });
  return { inboxItemId: offered.item.id, eventId: ev.id, demoTaskId: demo.id };
}

// ---------------------------------------------------------------------------------------------------------------------
// Mock runner (packages/sandbox replay)
// ---------------------------------------------------------------------------------------------------------------------

/** A parked runner's half of `SessionParked`; runAgentSession adds the number of the last command its feed read. */
type RunnerParked = Omit<SessionParked, "lastSeq">;

type RunOutcome = Pick<SessionResult, "outcome" | "reason" | "blockedReason" | "approvalId" | "summary" | "providerSessionId"> & Partial<Pick<SessionResult, "tokensIn" | "tokensOut" | "costMinor" | "costMicroMinor" | "modelKey" | "review">> & { parked?: RunnerParked };

/** Why a replay frees its slot early: the founder left an approval undecided, or a pause outlasted the hold. */
type MockEnding = { kind: "approval_timeout" } | ({ kind: "park" } & RunnerParked);

async function runMockSession(deps: OrchestratorDeps, recorder: SessionRecorder, sandbox: MockSandbox, input: AgentSessionInput, signal: AbortSignal | null, pull: () => Promise<SessionCommand[]>): Promise<RunOutcome> {
  const replay = sandbox.replay;
  const waits = founderWaits(deps);
  let loopTripped = false;
  let stoppedBy: { reason: string; by: string | null } | null = null;
  let paused = false;
  let pausedAtMs = 0;
  /** When the replay started holding on a recorded approval (clock ms), as this run's polls saw it. */
  let holdingSince: number | null = null;
  /** Why the run frees its slot early: the founder left an approval undecided, or a pause outlasted the hold. */
  let ending: MockEnding | null = null;

  recorder.cursorOf = () => `${sandbox.recording.key}@${replay.position.index}`;
  const unsubscribe = replay.subscribe(async (event) => {
    const { loop } = await recorder.publish(event);
    if (loop && !loopTripped) {
      loopTripped = true;
      replay.stop("loop_detected");
    }
  });

  const apply = async (c: SessionCommand) => {
    const at = deps.clock.now().toISOString();
    const park = ending?.kind === "park" ? ending : null;
    // Once parked, nudges and decisions go to the next run; the workflow tracks pause and resume itself.
    if (park && (c.kind === "shout" || c.kind === "decision")) {
      park.carry.push(c);
      return;
    }
    switch (c.kind) {
      case "pause":
        if (park || paused) break;
        replay.pause();
        paused = true;
        pausedAtMs = deps.clock.nowMs();
        await recorder.publishRaw({ kind: "note", at, source: "system", level: "info", text: `Paused${c.by ? " by the founder" : ""}.` });
        break;
      case "resume":
        if (park || !paused) break;
        replay.resume();
        paused = false;
        await recorder.publishRaw({ kind: "note", at, source: "system", level: "info", text: "Resumed." });
        break;
      case "stop":
        stoppedBy = { reason: c.reason, by: c.by ?? null };
        replay.stop(c.reason);
        break;
      case "shout":
        if (c.modelKey) {
          // A replay runs no model: say so, rather than claim a switch that changes nothing.
          await recorder.publishRaw({ kind: "note", at, source: "system", level: "info", text: `Asked to switch to ${c.modelKey}. This is a recorded session, so no model runs and nothing changes.` });
          break;
        }
        await recorder.publishRaw({ kind: "note", at, source: "shout", level: "info", text: c.message.slice(0, 4000) });
        break;
      case "decision": {
        const recordedId = recorder.approvalIdsReverse.get(c.approvalId) ?? c.approvalId;
        const applied = replay.decide(recordedId, c.outcome);
        await recorder.markApprovalResolved(c.approvalId, c.outcome, c.by ?? null);
        await recorder.publishRaw({ kind: "note", at, source: "system", level: "info", text: applied ? `Approval ${c.outcome}; continuing.` : `Decision received (${c.outcome}) but no call was waiting on it.` });
        break;
      }
    }
  };

  const tick = async () => {
    for (const c of await pull()) await apply(c);
    if (ending || stoppedBy || loopTripped || replay.status === "finished" || replay.status === "stopped") return;
    // A hold whose call the founder approved before this run reached it (0030): released without asking again.
    const held = replay.pendingApproval;
    if (held && recorder.grantedHolds.delete(held.approvalId)) {
      replay.decide(held.approvalId, "approved");
      return;
    }
    const now = deps.clock.nowMs();
    holdingSince = replay.pendingApproval ? (holdingSince ?? now) : null;
    if (holdingSince !== null && now - holdingSince >= waits.approvalMs) {
      ending = { kind: "approval_timeout" };
      await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "warn", text: approvalTimeoutNote(waits.approvalMs) });
      replay.stop("awaiting_approval");
    } else if (paused && holdingSince === null && now - pausedAtMs >= waits.pauseHoldMs) {
      // The next run continues from the event this one was about to play.
      ending = { kind: "park", cursor: `${sandbox.recording.key}@${replay.position.index}`, carry: [] };
      replay.stop("parked");
      await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "info", text: parkNote(waits.pauseHoldMs) });
    }
  };

  // The worker is shutting down: save the place and return, so the next worker replays on from the same event.
  const handoff = () => {
    if (ending || stoppedBy || loopTripped || replay.status === "finished" || replay.status === "stopped") return;
    ending = { kind: "park", cursor: `${sandbox.recording.key}@${replay.position.index}`, carry: [], handoff: true };
    replay.stop("handoff");
    void recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "info", text: handoffNote });
  };
  const onCancel = () => {
    if (cancelledForShutdown(signal)) return handoff();
    stoppedBy = { reason: CANCELLED_REASON, by: null };
    replay.stop(CANCELLED_REASON);
  };
  signal?.addEventListener("abort", onCancel, { once: true });
  const offDrain = deps.drain.onBegin(handoff);
  const loop = controlLoop(deps, input.sessionId, tick, () => recorder.beatDetails({ status: replay.status, paused }));

  try {
    const summary = await replay.play();
    await loop.flush();
    const stop = stoppedBy as { reason: string; by: string | null } | null;
    const end = ending as MockEnding | null;
    if (loopTripped) return { outcome: "failed", reason: "loop detected: the same call repeated three times in a row", blockedReason: "loop_detected", approvalId: null, summary: `Stopped after a detected loop (${recorder.loop.loopDetected?.signature.slice(0, 120) ?? "repeated call"}).`, providerSessionId: summary.recordingKey };
    if (stop) return { outcome: "stopped", reason: stop.reason, blockedReason: "stopped", approvalId: null, summary: `Stopped: ${stop.reason}.`, providerSessionId: summary.recordingKey };
    if (end?.kind === "park" && end.handoff) return { ...handoffOutcome(end.cursor, end.carry), providerSessionId: summary.recordingKey };
    if (end?.kind === "park") return { outcome: "stopped", reason: "paused", blockedReason: "stopped", approvalId: null, summary: "Paused; the session continues on Resume.", providerSessionId: summary.recordingKey, parked: { cursor: end.cursor, carry: carriedOver(end.carry) } };
    if (end?.kind === "approval_timeout") return { outcome: "blocked", reason: `no decision on the approval within ${minutesText(waits.approvalMs)}`, blockedReason: "awaiting_approval", approvalId: recorder.pendingApprovalId, summary: `Blocked after ${summary.emitted} events: waiting for the founder's approval.`, providerSessionId: summary.recordingKey };
    if (summary.outcome === "blocked") return { outcome: "blocked", reason: recorder.pendingApprovalId ? "waiting for the founder's approval" : "blocked by a dependency or approval", blockedReason: recorder.pendingApprovalId ? "awaiting_approval" : "dependency", approvalId: recorder.pendingApprovalId, summary: `Blocked after ${summary.emitted} events.`, providerSessionId: summary.recordingKey };
    if (summary.outcome === "failed") return { outcome: "failed", reason: summary.stoppedReason ?? "the recorded session failed", blockedReason: "error", approvalId: null, summary: `Failed after ${summary.emitted} events.`, providerSessionId: summary.recordingKey };
    // The founder rejected the call the replay waited on: the task stays blocked on that answer until it is started again.
    if (summary.outcome === "stopped" && summary.stoppedReason === "approval_rejected") return { outcome: "blocked", reason: "the founder rejected the approval request", blockedReason: "approval_rejected", approvalId: recorder.rejectedApprovalId, summary: `Blocked after ${summary.emitted} events: the founder rejected the request.`, providerSessionId: summary.recordingKey };
    if (summary.outcome === "stopped") return { outcome: "stopped", reason: summary.stoppedReason ?? "stopped", blockedReason: "stopped", approvalId: null, summary: "Stopped.", providerSessionId: summary.recordingKey };
    return { outcome: "done", reason: null, blockedReason: null, approvalId: null, summary: `${sandbox.recording.title}: ${sandbox.recording.summary}`.slice(0, 1800), providerSessionId: summary.recordingKey };
  } finally {
    await loop.stop();
    offDrain();
    signal?.removeEventListener("abort", onCancel);
    unsubscribe();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Live runner (Claude Agent SDK)
// ---------------------------------------------------------------------------------------------------------------------

interface LiveContext {
  business: { id: string; name: string; glossary: Record<string, string>; modelBilling: "byok" | "credits"; planTier: Business["planTier"] };
  version: AgentVersion | null;
  template: AgentTemplate;
  /** The agent's skills from the library or files (`buildSystemPrompt` renders them after the instructions). */
  skills: AgentSkillPrompt[];
  briefText: string | null;
  resolveApiKey: (businessId: string, billing: "byok" | "credits") => Promise<{ apiKey: string | null; source: "byok" | "platform" | "none" }>;
  /** The sandbox's short-lived identifiers (`buildSandboxEnv`); the SDK process receives the same and nothing from the host. */
  sandboxEnv: Record<string, string>;
  /** Creates and starts a sandbox: a live session needs one only for its acceptance run, so it is created then. */
  acquireSandbox: () => Promise<Sandbox>;
  /** This run's control commands (`commandFeed`). */
  pull: () => Promise<SessionCommand[]>;
}

/** A prompt queue the SDK consumes as streaming input: the task first, then every Nudge, decision or Resume as a user turn. */
class PromptQueue {
  private readonly items: string[] = [];
  private waiter: (() => void) | null = null;
  private closed = false;
  constructor(private readonly sessionId: string) {}
  /** Turns pushed and not yet taken by the SDK. */
  get pending(): number {
    return this.items.length;
  }
  push(text: string): void {
    this.items.push(text);
    this.waiter?.();
  }
  /** No more input. `discard` also drops the turns the SDK has not taken yet (a stopped session sends nothing more). */
  close(discard = false): void {
    this.closed = true;
    if (discard) this.items.length = 0;
    this.waiter?.();
  }
  async *messages(): AsyncGenerator<{ type: "user"; message: { role: "user"; content: string }; parent_tool_use_id: null; session_id: string }> {
    for (;;) {
      const next = this.items.shift();
      if (next !== undefined) {
        yield { type: "user", message: { role: "user", content: next }, parent_tool_use_id: null, session_id: this.sessionId };
        continue;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => (this.waiter = resolve));
      this.waiter = null;
    }
  }
}

/** Why a live run ends before the agent is done: Stop or a cancel, a detected loop, a park, an undecided approval, used-up credits, or a hand-off to the next worker. */
type LiveEnding = "stop" | "loop" | "park" | "approval_timeout" | "budget" | "handoff";

const PAUSE_CUT_TURN = "The founder paused the session mid-step and has now resumed it. Continue the task from where you stopped.";

/** The user turn a nudge or a decision becomes. */
function turnFor(c: Extract<SessionCommand, { kind: "shout" | "decision" }>): string {
  if (c.kind === "shout") return `Founder nudge: ${c.message}`;
  if (c.outcome === "approved") return "The founder approved the pending action; continue.";
  return `The founder rejected the pending action${c.note?.trim() ? ` (their reason: ${c.note.trim().slice(0, 500)})` : ""}; do not retry it and continue with the rest of the task.`;
}

/** The slice of an SDK result message that says how its turn ended. */
export interface SdkTurnResult {
  subtype: string;
  is_error?: boolean;
  api_error_status?: number | null;
  errors?: string[];
  result?: string;
}

export interface TurnFailure {
  outcome: "blocked" | "failed";
  blockedReason: "budget" | "credential" | "rate_limit" | "error";
  reason: string;
  summary: string;
}

/**
 * How a turn that did not end normally ends the session, or null when it ended normally. The SDK reports a refused API
 * call as `subtype: "success"` with `is_error: true` (the assistant message before it names the kind, `billing_error`
 * for "Credit balance is too low"), so `subtype` alone would book a session where no model call succeeded as done.
 * Billing, key and rate-limit refusals block the task (it stays open and runs again once fixed); anything else fails it.
 */
export function classifyTurnEnd(result: SdkTurnResult, apiError: { kind: string | null; text: string } | null, keySource: "byok" | "platform" | "none", budget: Pick<SessionBudget, "limit" | "taskBudgetMinor" | "taskSpentMinor"> | null = null): TurnFailure | null {
  // The SDK stopped at the `maxBudgetUsd` the session was given: the budget is spent, which is not the agent failing. The
  // task is blocked (it keeps what was done) and says whose budget it was.
  if (result.subtype === "error_max_budget_usd") {
    const limit = budget?.limit ?? "task";
    return { outcome: "blocked", blockedReason: "budget", reason: `model budget exhausted: the session spent ${LIMIT_WORDS[limit].spent}`, summary: budgetSummary(limit, budget ?? { taskBudgetMinor: 0, taskSpentMinor: 0 }) };
  }
  if (result.subtype !== "success") {
    const errors = (result.errors?.length ? result.errors : [result.subtype]).join("; ");
    return { outcome: "failed", blockedReason: "error", reason: `${result.subtype}: ${errors}`.slice(0, 500), summary: "The agent run ended with an error." };
  }
  if (!result.is_error) return null;
  const status = result.api_error_status ?? null;
  const kind = apiError?.kind ?? null;
  const text = (apiError?.text || result.result || "the model call failed").trim().slice(0, 300);
  const byok = keySource === "byok";
  const whose = byok ? "the business's own Anthropic key" : "the platform's Anthropic account";
  if (kind === "billing_error" || status === 402 || /credit balance|billing|spend(ing)? limit|insufficient (credit|funds)/i.test(text)) {
    return {
      outcome: "blocked",
      blockedReason: "budget",
      reason: `model budget exhausted: ${whose} refused the call for billing (${text})`.slice(0, 500),
      summary: byok ? "Blocked: your Anthropic account refused the call for billing. Add credit or raise its spend limit in the Anthropic Console, then run the task again." : "Blocked: the model provider refused the call for billing, so no work was done.",
    };
  }
  if (kind === "authentication_failed" || kind === "oauth_org_not_allowed" || kind === "account_on_hold" || kind === "verification_required" || kind === "cloud_credential_error" || status === 401 || status === 403) {
    return {
      outcome: "blocked",
      blockedReason: "credential",
      reason: `the model key was refused: ${whose} (${text})`.slice(0, 500),
      summary: byok ? "Blocked: your Anthropic key was refused. Check it in Settings → Keys, then run the task again." : "Blocked: the model provider refused the platform key, so no work was done.",
    };
  }
  if (kind === "rate_limit" || kind === "overloaded" || status === 429 || status === 529) {
    return { outcome: "blocked", blockedReason: "rate_limit", reason: `rate limited by the model provider (${text})`.slice(0, 500), summary: "Blocked: the model provider is rate limiting or overloaded; the task runs again on a later cycle." };
  }
  return { outcome: "failed", blockedReason: "error", reason: `the model call failed${status ? ` (${status})` : ""}: ${text}`.slice(0, 500), summary: "The agent run ended with an error from the model provider." };
}

async function runLiveSession(deps: OrchestratorDeps, recorder: SessionRecorder, ctx: RunnerContext, live: LiveContext): Promise<RunOutcome> {
  const { input, launch, task, agent } = ctx;
  const key = await live.resolveApiKey(input.businessId, live.business.modelBilling);
  if (!key.apiKey) {
    const reason = live.business.modelBilling === "byok" ? "no live Anthropic key for this business: set one in Settings → Keys" : "no Anthropic key: connect one in Settings or set the platform key";
    return { outcome: "blocked", reason, blockedReason: "credential", approvalId: null, summary: "Blocked: no model credential.", providerSessionId: null };
  }
  // The platform key's ceiling (SEC2 S2, ./session-credits): a session on it starts only while the credits allow a live
  // call, is capped at what is spendable, books as it goes and ends when the credits are used up.
  let credits: SessionCredits | null = null;
  if (key.source === "platform") {
    const opened = await SessionCredits.open(deps, { businessId: input.businessId, agentId: agent.id, sessionId: input.sessionId, modelKey: launch.modelKey });
    if (!opened.ok) return { outcome: "blocked", reason: `model budget exhausted: ${opened.reason}`, blockedReason: "budget", approvalId: null, summary: CREDITS_USED_UP_SUMMARY, providerSessionId: null };
    credits = opened.credits;
  }

  const grants = resolveGrants(parseGrants(live.version, live.template));
  if (grants.unresolved.length > 0) deps.log.info({ sessionId: input.sessionId, unresolved: grants.unresolved.map((u) => `${u.connectorKey}.${u.capability}`).slice(0, 50) }, "granted capabilities no tool serves yet");
  // What the session may spend (./session-budget): the task's budget less its earlier sessions, the credits left when the
  // platform key pays, and what is left of the agent's wage cap and the business's monthly model budget (either key).
  // A task with nothing left does not start.
  const budget = await sessionBudget(deps, { business: live.business, task, agentId: agent.id, sessionId: input.sessionId });
  if (budget.remainingMinor <= 0) return { outcome: "blocked", reason: `model budget exhausted: ${LIMIT_WORDS[budget.limit].used}`, blockedReason: "budget", approvalId: null, summary: budgetSummary(budget.limit, budget), providerSessionId: null };
  // Everything that can fail without a workspace runs before one exists (no restored code left on disk, no token).
  const systemPrompt = buildSystemPrompt({ businessName: live.business.name, appName: APP_NAME, template: { instructions: instructionsFor(live.version, live.template), description: live.template.description }, brief: live.briefText ?? undefined, glossary: live.business.glossary, skills: live.skills });
  if (!hasClubRulesPrefix(systemPrompt)) throw new Error("house rules missing from the system prompt");
  const policy = sdkToolPolicyFor(task.kind, grants.mcpTools);
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  // SEC-3: the SDK process lives in a private per-session workspace (cwd, HOME, TMPDIR), with a from-scratch environment
  // (never `process.env`), built-in tools by task kind only, and a path guard on every file-tool call. Deleted in `finally`.
  const cwd = await createSessionWorkspace(deps.env.ORCHESTRATOR_WORKSPACE_DIR, input.sessionId);
  // Code tasks start from the repository (decision 2, ./checkout: the task's branch, else the default branch) and pick
  // up where the last session on the task left off (Development › Code keeps every session's changes, applied on top).
  // Both come before the token: what the files mention is untrusted for the gateway from the session's first call.
  let restored: RestoredWorkspace | null = null;
  let restoreFailed = false;
  let checkout: Checkout | null = null;
  /** The merge handed this task back to its agent (its latest block says `needs_update`): what the session must reconcile. */
  const handedBack = policy.fileTools ? await latestHandBack(deps, input.businessId, task.id) : null;
  let updateNoteText: string | null = null;
  /** The Code tab has a repository but this session has no checkout of it: why (the agent is told, not only the founder). */
  let checkoutMissing: string | null = null;
  /** That repository (`owner/name`): this session's save is kept but never pushed over it (no checkout, no push). */
  let checkoutMissingRepo: string | null = null;
  let token: Awaited<ReturnType<typeof deps.gateway.mintSessionToken>>;
  try {
    if (policy.fileTools) {
      // A branch handed back to be brought up to date (activities/merge.ts) starts from the default branch's newest files.
      const checkoutInput = { businessId: input.businessId, agentId: agent.id, sessionId: input.sessionId, taskId: task.id, fromDefaultBranch: handedBack !== null };
      if (handedBack) updateNoteText = updateNote(launch.branch, await updateConflicts(deps, checkoutInput, launch.branch));
      const checked = await checkoutRepository(deps, checkoutInput, cwd);
      if (checked.status === "checked_out") checkout = checked.checkout;
      else if (checked.status === "failed") {
        // Never a partial checkout: the session starts as it did before checkouts, and the note says why.
        deps.log.warn({ err: checked.reason, sessionId: input.sessionId }, "repository checkout failed");
        checkoutMissing = checked.reason;
        checkoutMissingRepo = checked.repo;
        await createSessionWorkspace(deps.env.ORCHESTRATOR_WORKSPACE_DIR, input.sessionId);
      }
      const checkedNote = describeCheckout(checked);
      await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: checkedNote.level, text: checkedNote.text });
      try {
        restored = await restoreWorkspace(deps.db, input.businessId, task.id, cwd, undefined, undefined, { checkout: checkout !== null });
        if (restored.files > 0 || restored.removed > 0) await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "info", text: checkout ? `Applied ${restored.files} file${restored.files === 1 ? "" : "s"} (${Math.ceil(restored.bytes / 1024)} KB)${restored.removed ? ` and ${restored.removed} removal${restored.removed === 1 ? "" : "s"}` : ""} saved by an earlier session on this task over the checkout.` : `Restored ${restored.files} file${restored.files === 1 ? "" : "s"} (${Math.ceil(restored.bytes / 1024)} KB) saved by an earlier session on this task.` });
      } catch (err) {
        // Start clean rather than from a partial copy; the save at the end keeps the files this session never had.
        restoreFailed = true;
        restored = null;
        await createSessionWorkspace(deps.env.ORCHESTRATOR_WORKSPACE_DIR, input.sessionId);
        deps.log.warn({ err: (err as Error).message, sessionId: input.sessionId }, "workspace restore failed");
        // The checkout itself is unpacked again from its archive (the same files, so the same base).
        if (checkout) {
          try {
            await extractArchive(checkout.archivePath, cwd);
          } catch (unpackErr) {
            await disposeCheckout(checkout);
            checkoutMissing = `its archive could not be unpacked again: ${String((unpackErr as Error).message ?? unpackErr).slice(0, 200)}`;
            checkoutMissingRepo = checkout.base.repo;
            checkout = null;
            await createSessionWorkspace(deps.env.ORCHESTRATOR_WORKSPACE_DIR, input.sessionId);
          }
        }
        await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "warn", text: checkout ? "The code saved for this task could not be restored; this session starts from the checkout alone, and the saved files are kept." : "The code saved for this task could not be restored; this session starts from an empty workspace, and the saved files are kept." });
      }
    }
    // The checkout's recipients and the restored files' are untrusted together (one seed; `all` past its limits).
    const seeded = checkout || (restored && restored.files > 0) ? mergeRecipients(checkout?.recipients, restored && restored.files > 0 ? restored.recipients : null) : undefined;
    const untrusted = seeded === undefined ? null : seeded === null ? { emails: [], urls: [], phones: [], all: true } : toSeed(seeded);
    token = await deps.gateway.mintSessionToken({ businessId: input.businessId, agentId: agent.id, sessionId: input.sessionId, allowedTools: grants.toolRefs, ttlSeconds: SESSION_TOKEN_TTL_SECONDS, ...(untrusted ? { untrusted } : {}) });
  } catch (err) {
    await disposeCheckout(checkout);
    await removeSessionWorkspace(cwd).catch(() => undefined);
    throw err;
  }
  // One server per connector the gateway serves for these grants; a connector of a later phase gets none (it would 404).
  // The run's trace span (../tracing.ts) is the parent of every tool call the gateway serves for this session.
  const traceparent = currentTraceparent();
  const mcpServers = Object.fromEntries(grants.servers.map((key) => [key, { type: "http" as const, url: deps.gateway.mcpUrl(key), headers: { ...deps.gateway.sessionHeaders(token.token), ...(traceparent ? { traceparent } : {}) } }]));

  const continuing = [handedBack ? `## Why this task is back\n${handedBack}` : "", checkout ? checkoutNote(checkout) : checkoutMissing ? checkoutMissingNote(checkoutMissing) : "", updateNoteText ?? "", restored && restored.files > 0 ? restoredWorkspaceNote(restored.files) : ""].filter(Boolean).join("\n\n");
  const resumed = !ctx.run.resume ? "" : ctx.run.resume.reason === "handoff" || ctx.run.resume.reason === "retry" ? "This session moved to another worker mid-task and has been resumed. Continue the task from where the work stands, and check what is already done before you repeat any external action." : "This session was paused for a while and has been resumed. Continue the task from where the work stands.";
  const taskPrompt = [`# Task: ${task.title}`, task.goalMd || "", Array.isArray(task.acceptance) && task.acceptance.length ? `## Acceptance criteria\n${task.acceptance.map((a) => `- ${typeof a === "string" ? a : JSON.stringify(a)}`).join("\n")}` : "", policy.fileTools ? codeTaskNote(launch.branch) : "Keep every action inside the tools you were given; this task has no file access.", continuing, resumed, "Report each phase change and keep every external action inside the tools you were given."].filter(Boolean).join("\n\n");

  const waits = founderWaits(deps);
  /**
   * Seconds the CLI waits on our PreToolUse hook before giving up on it: longer than any founder wait, so a call held by
   * a pause is refused when the run ends (park, approval wait, stop), never let through by a hook timeout.
   */
  const hookTimeoutSeconds = Math.ceil((Math.max(waits.approvalMs, waits.pauseHoldMs) + SDK_STOP_GRACE_MS) / 1000) + 60;
  const queue = new PromptQueue(input.sessionId);
  const abort = new AbortController();
  let q: Query | null = null;
  /** A user turn was sent and its result has not arrived yet. */
  let turnOpen = false;
  /** The turn in flight was interrupted (pause or an ending): its result is not a failure. */
  let interrupted = false;
  let paused = false;
  let pausedAtMs = 0;
  /** The pause cut a turn short: Resume asks the agent to carry on. */
  let pauseCut = false;
  /** Nudges and decisions that arrived while paused: sent on Resume, or handed to the next run when the session parks. */
  let held: Extract<SessionCommand, { kind: "shout" | "decision" }>[] = [];
  /** Closed while paused: the SDK answers tool hooks on its own, so every tool call waits here until Resume. */
  let gate: { promise: Promise<void>; open: () => void } | null = null;
  let ending: LiveEnding | null = null;
  let stoppedBy: { reason: string } | null = null;
  const carry: SessionCommand[] = [];
  /** A refused API call the CLI reported as an assistant message (`billing_error`, `rate_limit`...). */
  let apiError: { kind: string | null; text: string } | null = null;
  let abortTimer: ReturnType<typeof setTimeout> | null = null;
  /** Why this session's code is not pushed: stays set unless the session finishes (or waits on an approval). */
  let holdBack: string | null = "the session did not finish";
  let sdkSessionId: string | null = null;
  /** The agent is done and its input closed: the SDK is only winding down, so used-up credits no longer end the run. */
  let inputDone = false;
  const openCalls = new Map<string, { tool: string; connectorKey: string | null; startedAt: number }>();
  /** The model a nudge moved the session to, once it has (usage after that is booked on it). */
  let switchedTo: ModelKey | null = null;
  const usageNow = () => {
    const u = recorder.usage.totals();
    return { tokensIn: u.tokensIn, tokensOut: u.tokensOut, costMinor: Math.round(u.costMinor), costMicroMinor: Math.round(u.costMinor * MICRO_PER_MINOR), ...(switchedTo ? { modelKey: switchedTo } : {}) };
  };
  /**
   * "Upgrade to Opus" on a running task: the SDK query moves to that model for the rest of the session and later usage is
   * priced and booked on it (audit O-27). A route locked to one model refuses the change and says so.
   */
  const switchModel = async (modelKey: ModelKey, at: string) => {
    const model = resolveModel(live.template.route, modelKey);
    if (model.modelKey !== modelKey) {
      await recorder.publishRaw({ kind: "note", at, source: "system", level: "warn", text: model.warning ?? `This work stays on ${model.modelKey}.` });
      return;
    }
    try {
      await q?.setModel(model.modelId);
      switchedTo = model.modelKey;
      credits?.useModel(model.modelKey);
      recorder.usage.useModel(model.modelId);
      await recorder.publishRaw({ kind: "note", at, source: "system", level: "info", text: `Switched to ${model.modelKey[0]!.toUpperCase()}${model.modelKey.slice(1)} for the rest of this session.` });
    } catch (err) {
      deps.log.warn({ err: (err as Error).message, sessionId: input.sessionId }, "SDK model switch failed");
      await recorder.publishRaw({ kind: "note", at, source: "system", level: "warn", text: "The model could not be switched; the session carries on with its current model." });
    }
  };

  const send = (text: string) => {
    turnOpen = true;
    queue.push(text);
  };
  const openGate = () => {
    gate?.open();
    gate = null;
  };
  const interruptTurn = async () => {
    if (!q || !turnOpen) return;
    interrupted = true;
    try {
      await q.interrupt();
    } catch (err) {
      deps.log.warn({ err: (err as Error).message, sessionId: input.sessionId }, "SDK interrupt failed");
    }
  };
  /**
   * End the run before the agent is done: no more input, the turn in flight is interrupted so the SDK reports its usage
   * on a final result, and after SDK_STOP_GRACE_MS the process is aborted whatever it is doing.
   */
  const end = async (why: LiveEnding) => {
    if (ending) return;
    ending = why;
    openGate();
    queue.close(true);
    abortTimer = setTimeout(() => abort.abort(), SDK_STOP_GRACE_MS);
    await interruptTurn();
  };
  const endForCredits = async () => {
    if (ending) return;
    await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "warn", text: "This month's credits are used up, so the session stops here. What it spent is booked as an Estimate." });
    await end("budget");
  };

  const apply = async (c: SessionCommand) => {
    const at = deps.clock.now().toISOString();
    switch (c.kind) {
      case "shout":
      case "decision":
        // A model change is not a message to the agent: it switches the SDK query and nothing is sent.
        if (c.kind === "shout" && c.modelKey) {
          if (ending === "park") carry.push(c);
          else if (!ending) await switchModel(c.modelKey as ModelKey, at);
          break;
        }
        if (c.kind === "shout") await recorder.publishRaw({ kind: "note", at, source: "shout", text: c.message.slice(0, 4000) });
        else await recorder.markApprovalResolved(c.approvalId, c.outcome, c.by ?? null);
        if (ending === "park" || ending === "handoff") carry.push(c);
        else if (paused) held.push(c);
        else if (!ending) send(turnFor(c));
        break;
      case "pause":
        if (paused || ending) break;
        paused = true;
        pausedAtMs = deps.clock.nowMs();
        {
          let open!: () => void;
          const promise = new Promise<void>((resolve) => (open = resolve));
          gate = { promise, open };
        }
        await recorder.publishRaw({ kind: "note", at, source: "system", text: "Paused." });
        // The SDK runs its turn on its own, whatever this loop does: interrupt it so nothing more is generated or called.
        if (turnOpen) {
          pauseCut = true;
          await interruptTurn();
        }
        break;
      case "resume": {
        if (!paused || ending) break;
        paused = false;
        openGate();
        await recorder.publishRaw({ kind: "note", at, source: "system", text: "Resumed." });
        const turns = [...(pauseCut ? [PAUSE_CUT_TURN] : []), ...held.map(turnFor)];
        pauseCut = false;
        held = [];
        if (turns.length > 0) send(turns.join("\n\n"));
        else if (!turnOpen && !recorder.pendingApprovalId) {
          inputDone = true;
          queue.close();
        }
        break;
      }
      case "stop":
        stoppedBy = { reason: c.reason };
        await end("stop");
        break;
    }
  };

  const tick = async () => {
    for (const c of await live.pull()) await apply(c);
    if (ending) return;
    const now = deps.clock.nowMs();
    if (recorder.pendingApprovalId && recorder.pendingSince !== null) {
      // The agent waits on a gated call with nothing else to do (its turn has ended, or a pause holds it): wait for the
      // decision, but not in this slot forever.
      if ((!turnOpen || paused) && now - recorder.pendingSince >= waits.approvalMs) {
        await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "warn", text: approvalTimeoutNote(waits.approvalMs) });
        await end("approval_timeout");
      }
    } else if (paused && now - pausedAtMs >= waits.pauseHoldMs) {
      await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "info", text: parkNote(waits.pauseHoldMs) });
      carry.push(...held);
      held = [];
      await end("park");
    }
    // Mid-turn too, the session books what it spent and stops once the credits are used up (SEC2 S2).
    if (!ending && !inputDone && credits?.due() && (await credits.settle(recorder.usage.totals())) === "exhausted") await endForCredits();
  };

  const loop = controlLoop(deps, input.sessionId, tick, () => recorder.beatDetails({ paused }));
  /** Stops the acceptance run's sandbox at once when the run ends early (a hand-off or a cancel). */
  const acceptanceAbort = new AbortController();
  // The worker is shutting down: end the turn, save the work (not pushed: the session has not finished) and return,
  // so the next worker continues from the saved workspace.
  const handoff = async () => {
    if (ending) return;
    carry.push(...held);
    held = [];
    acceptanceAbort.abort();
    await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "info", text: handoffNote });
    await end("handoff");
  };
  const cancel = cancellation();
  const onCancel = () => {
    if (cancelledForShutdown(cancel)) return void handoff();
    stoppedBy = { reason: CANCELLED_REASON };
    acceptanceAbort.abort();
    void end("stop");
  };
  cancel?.addEventListener("abort", onCancel, { once: true });
  const offDrain = deps.drain.onBegin(() => void handoff());
  const handedOff = (): RunOutcome => {
    holdBack = "the session moved to another worker";
    return { ...handoffOutcome(null, carry), providerSessionId: sdkSessionId, ...usageNow() };
  };

  // What the workspace held before the agent started (decision 3: a code session that changed nothing is not done).
  const startPrint = policy.fileTools ? await fingerprintWorkspace(cwd) : null;
  try {
    send(taskPrompt);
    const env = sdkEnvFor({ cwd, apiKey: key.apiKey, sessionToken: token.token, sandboxEnv: live.sandboxEnv });
    q = sdk.query({
      prompt: queue.messages(),
      options: {
        systemPrompt,
        model: launch.modelId,
        mcpServers,
        tools: policy.tools,
        allowedTools: policy.allowedTools,
        disallowedTools: policy.disallowedTools,
        maxTurns: launch.maxTurns,
        cwd,
        // The SDK itself stops past this (its result is `error_max_budget_usd`, see classifyTurnEnd): the task's budget
        // and, on the platform key, what the credits allowed at launch (SEC2 S2), whichever is less; `budget` also holds what is
        // left of the agent's wage cap and the monthly model budget (audit #15).
        maxBudgetUsd: Math.min(budget.maxUsd, credits?.maxBudgetUsd ?? Number.POSITIVE_INFINITY),
        env,
        // No host settings, CLAUDE.md, hooks or permission rules from the orchestrator's file system, and no MCP server
        // but the gateway's (a `.mcp.json` in the workspace is ignored).
        settingSources: [],
        strictMcpConfig: true,
        permissionMode: "dontAsk",
        permissionPrompts: "none",
        hooks: {
          PreToolUse: [
            {
              timeout: hookTimeoutSeconds,
              hooks: [
                async (hook) => {
                  if (hook.hook_event_name !== "PreToolUse") return { continue: true };
                  // A paused session runs no tool: the call waits here until Resume, and is refused if the run ends first.
                  while (gate && !ending) await gate.promise;
                  if (ending) return hookOutputFor({ allow: false, reason: "the session is ending" });
                  const verdict = await guardToolCall(hook.tool_name, hook.tool_input, { cwd, policy });
                  if (!verdict.allow) await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "warn", text: `Blocked ${hook.tool_name}: ${verdict.reason}.` });
                  return hookOutputFor(verdict);
                },
              ],
            },
          ],
        },
        abortController: abort,
        persistSession: false,
      },
    });
    try {
      for await (const message of q) {
        if (message.type === "system" && message.subtype === "init") sdkSessionId = message.session_id;
        if (message.type === "assistant") {
          recorder.usage.onAssistant(message.message);
          if (message.error) {
            // A refused API call the CLI reports as an assistant message ("Credit balance is too low"): the provider's
            // words, never the agent's. The turn's result says how the session ends.
            const text = message.message.content.map((b) => (b.type === "text" ? b.text : "")).join(" ").trim();
            apiError = { kind: message.error, text: text || message.error };
            continue;
          }
          for (const block of message.message.content) {
            if (block.type === "text" && block.text.trim()) await recorder.publish({ kind: "note", at: deps.clock.now().toISOString(), source: "agent", text: block.text.slice(0, 4000) });
            if (block.type === "tool_use") {
              const parts = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(block.name);
              const connectorKey = parts ? parts[1]! : null;
              const tool = parts ? parts[2]! : block.name;
              openCalls.set(block.id, { tool, connectorKey, startedAt: deps.clock.nowMs() });
              const { loop: looped } = await recorder.publish({ kind: "tool_call", at: deps.clock.now().toISOString(), callId: block.id, connectorKey, tool, status: "started", argsSummary: summariseArgs(block.input) }, { args: block.input });
              if (looped) await end("loop");
            }
          }
        }
        if (message.type === "user" && Array.isArray(message.message.content)) {
          for (const block of message.message.content) {
            if (typeof block === "object" && block && block.type === "tool_result") {
              const open = openCalls.get(block.tool_use_id);
              if (!open) continue;
              openCalls.delete(block.tool_use_id);
              const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "");
              const asked = /"outcome"\s*:\s*"ask"/.test(text);
              const approvalMatch = /"approvalId"\s*:\s*"([0-9a-f-]{36})"/.exec(text);
              await recorder.publish({ kind: "tool_call", at: deps.clock.now().toISOString(), callId: block.tool_use_id, connectorKey: open.connectorKey, tool: open.tool, status: asked ? "awaiting_approval" : block.is_error ? "failed" : "succeeded", resultSummary: text.slice(0, 1000), durationMs: deps.clock.nowMs() - open.startedAt, policyOutcome: asked ? "ask" : /"outcome"\s*:\s*"deny"/.test(text) ? "deny" : null, approvalId: approvalMatch ? approvalMatch[1]! : null });
            }
          }
        }
        if (message.type === "result") {
          // Cumulative across turns: the latest result replaces the totals so far (SessionUsage).
          recorder.usage.onResult(message.modelUsage);
          // Every finished turn on the platform key is booked (SEC2 S2). Used-up credits end the session before it
          // starts another turn (below); a turn that finished the task stays done, so the task is not run again.
          const creditsOut = credits !== null && !ending && (await credits.settle(recorder.usage.totals())) === "exhausted";
          const cut = interrupted || paused || ending !== null;
          interrupted = false;
          turnOpen = queue.pending > 0 || ((message as { queued_turn_count?: number }).queued_turn_count ?? 0) > 0;
          if (!cut) {
            const failure = classifyTurnEnd(message, apiError, key.source, budget);
            if (failure) {
              queue.close(true);
              if (message.subtype === "success") holdBack = "the model call failed";
              await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "error", text: message.subtype === "success" ? failure.summary : `SDK ended with ${failure.reason}` });
              if (failure.blockedReason === "budget" && key.source === "platform") deps.log.error({ businessId: input.businessId, sessionId: input.sessionId, status: message.subtype === "success" ? message.api_error_status ?? null : null }, "the platform's Anthropic account refused a session's call for billing");
              return { outcome: failure.outcome, reason: failure.reason, blockedReason: failure.blockedReason, approvalId: null, summary: failure.summary, providerSessionId: sdkSessionId, ...usageNow() };
            }
          }
          apiError = null;
          // More input may come: Resume, the founder's decision, or a nudge already queued. Not once the credits are
          // used up: the session ends `budget` and the task runs again after a top-up.
          if (ending || paused || recorder.pendingApprovalId || turnOpen) {
            if (creditsOut) await endForCredits();
            continue;
          }
          inputDone = true;
          queue.close();
        }
      }
    } catch (err) {
      // An ending already chosen (stop, cancel, loop, park, undecided approval) aborts the SDK once its grace period runs
      // out, and the SDK then throws an AbortError: that is the ending, not a failure. Anything else fails the run, and
      // runAgentSession books the usage recorded so far.
      if (!ending) throw err;
    }
    const how = ending as LiveEnding | null;
    if (how === "loop") {
      holdBack = "the session stopped on a loop";
      return { outcome: "failed", reason: "loop detected: the same tool call repeated three times in a row", blockedReason: "loop_detected", approvalId: null, summary: "Stopped after a detected loop.", providerSessionId: sdkSessionId, ...usageNow() };
    }
    if (how === "budget") {
      holdBack = "this month's credits ran out";
      return { outcome: "blocked", reason: "model budget exhausted: this month's credits are used up", blockedReason: "budget", approvalId: null, summary: CREDITS_USED_UP_SUMMARY, providerSessionId: sdkSessionId, ...usageNow() };
    }
    const stop = stoppedBy as { reason: string } | null;
    if (stop) {
      holdBack = "the session was stopped";
      return { outcome: "stopped", reason: stop.reason, blockedReason: "stopped", approvalId: null, summary: `Stopped: ${stop.reason}.`, providerSessionId: sdkSessionId, ...usageNow() };
    }
    if (how === "handoff") return handedOff();
    if (how === "park") {
      holdBack = "the session is paused";
      // A poll still in flight applies what it read first: the carry and the last command number read must agree, or
      // the workflow would neither hand that nudge to the next run nor send it again.
      await loop.stop();
      return { outcome: "stopped", reason: "paused", blockedReason: "stopped", approvalId: null, summary: "Paused; the session continues on Resume.", providerSessionId: sdkSessionId, parked: { cursor: null, carry: carriedOver(carry) }, ...usageNow() };
    }
    holdBack = null;
    if (how === "approval_timeout") return { outcome: "blocked", reason: `no decision on the approval within ${minutesText(waits.approvalMs)}`, blockedReason: "awaiting_approval", approvalId: recorder.pendingApprovalId, summary: "Blocked on an approval.", providerSessionId: sdkSessionId, ...usageNow() };
    // Honest outcomes (decision 3, 2026-10-23): a task the agent blocked stays blocked, a code session that changed
    // nothing is not done, and a code task whose acceptance run failed is never done.
    const agentBlock = recorder.agentBlock;
    // An engineer that works through the GitHub connector (commit_files on agent/<taskId>, then open_pr) leaves the
    // local workspace as it was: the Oct 27, 2026 cycle of the Foundmill business judged such a session "changed no
    // files" while its pull request was already open. The branch it pushed is brought down in place of the checkout,
    // so the acceptance tests run on what was pushed and the save compares against it; the test-setup review below
    // still compares with the checkout the session started from.
    let endPrint = policy.fileTools ? await fingerprintWorkspace(cwd) : null;
    let baseBefore: CheckoutBase | null = null;
    if (task.kind === "code" && policy.fileTools && checkout && !agentBlock && recorder.agentPushed.count > 0 && !workspaceChanged(startPrint, endPrint)) {
      const adopted = await adoptPushedBranch(deps, recorder, { businessId: input.businessId, agentId: agent.id, sessionId: input.sessionId, taskId: task.id }, cwd, checkout, agent.name, launch.branch);
      if (adopted) {
        baseBefore = checkout.base;
        checkout = adopted;
        endPrint = await fingerprintWorkspace(cwd);
      }
    }
    // "Wrote nothing" is the task's work, not this run's alone: the changes earlier sessions saved on the task (restored
    // here, or kept back when the restore failed) count, so a session that only finishes them (an approved action, a
    // rerun after a flaky test) can still end done.
    // A checkout of the task's own branch is the task's work from earlier sessions (their commits are on it), like
    // restored saved files: a session that finishes it, or finds it finished, can end done when the tests pass. Every
    // session on a branch with the Oct 25 commits had ended "changed no files" (Foundmill business, Oct 27, 2026).
    const branchWork = checkout !== null && baseBefore === null && checkout.base.ref === launch.branch;
    const nothingWritten = task.kind === "code" && policy.fileTools && !restoreFailed && !(restored?.savedAt && restored.files > 0) && !branchWork && !workspaceChanged(startPrint, endPrint);
    // What the task changed against the checkout it started from: the acceptance tests run for those packages (the
    // root `pnpm test` runs every package at once and was killed for memory in the sandbox), and the test-setup review
    // below reads the same comparison. On the task's own branch with nothing changed here, the branch's changes are the
    // ones the sessions that pushed them saved.
    const reviewBase = baseBefore ?? checkout?.base ?? null;
    const changes = reviewBase && task.kind === "code" && policy.fileTools ? await readWorkspaceChanges(cwd, reviewBase.files) : null;
    let scopePaths = changes && !changes.refused ? [...changes.files.map((f) => f.rel), ...changes.removed] : [];
    if (scopePaths.length === 0 && branchWork) {
      const saved = await repos.workspaces.latest(deps.db, input.businessId, task.id);
      if (saved) scopePaths = [...saved.files.map((f) => f.path), ...saved.removedPaths];
    }
    // Still nothing on a branch that carries the work (its sessions wrote through GitHub and saved no files): the branch
    // is compared with the default branch, so the tests run for what the branch changed, never for every package.
    if (scopePaths.length === 0 && branchWork && checkout && !agentBlock) {
      const compared = await defaultBranchChanges(deps, { businessId: input.businessId, agentId: agent.id, sessionId: input.sessionId, taskId: task.id }, checkout);
      if (compared.status === "compared") {
        scopePaths = compared.changed;
        const count = compared.changed.length === 1 ? "1 file differs" : `${compared.changed.length} files differ`;
        const basis = compared.against === "merge_base" ? `with the commit it left the default branch at (${compared.commitSha.slice(0, 7)})` : compared.against === "fork_point" ? `with the commit it started from on ${compared.ref} (${compared.commitSha.slice(0, 7)})` : `with the default branch (commit ${compared.commitSha.slice(0, 7)})`;
        await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "info", text: `Compared ${checkout.base.ref} ${basis}: ${count}${compared.truncated ? " (GitHub listed only the first of them)" : ""}.` });
      } else {
        await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "warn", text: `Could not compare ${checkout.base.ref} with the default branch (${compared.reason}), so the acceptance tests run for every package.` });
      }
    }
    const [scoped, appTestPackages] = scopePaths.length > 0 || acceptanceCommandFor(task) === ACCEPTANCE_FALLBACK_COMMAND ? await Promise.all([changedScope(cwd, scopePaths), workspaceAppTestPackages(cwd)]) : [{ test: [], app: [], loose: [] }, []];
    const scope = scoped.test;
    // Nothing a sandbox can test, and the task names no command: documentation in no package, or packages whose tests need
    // the running app (Playwright; CI runs them). The fallback would run every package's tests for a Markdown edit.
    const named = acceptanceCommandFor(task) !== ACCEPTANCE_FALLBACK_COMMAND;
    const nothingToTest = !named && scopePaths.length > 0 && scope.length === 0 && (scoped.loose.length === 0 || documentationOnly(scoped.loose));
    // Acceptance tests run inside a sandbox, never on the orchestrator host, on a copy of the agent's workspace. Not
    // for a task the agent blocked or a session that wrote nothing: neither can end done, so the sandbox is not paid for.
    const acceptanceCommand = nothingToTest ? null : acceptanceCommandFor(task, scope, appTestPackages);
    let acceptance: AcceptanceVerdict | null = null;
    if (acceptanceCommand && (agentBlock || nothingWritten)) {
      await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "info", text: `Acceptance tests not run: ${agentBlock ? `${agent.name} blocked the task` : "the session changed no files"}.` });
    } else if (nothingToTest && !agentBlock && !nothingWritten) {
      await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "info", text: nothingToTestNote(scoped) });
    } else if (acceptanceCommand) {
      if (scope.length > 0 && !named) await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "info", text: `Acceptance tests run for ${scope.join(", ")}: what this task changed.${scoped.app.length > 0 ? ` The tests of ${scoped.app.join(", ")} need the running app and run in CI.` : ""}` });
      const ran = await runAcceptance(deps, recorder, live.acquireSandbox, cwd, acceptanceCommand, acceptanceAbort.signal, checkout);
      recorder.sandboxMs += ran.ms;
      acceptance = ran.verdict;
    }
    // A hand-off during the acceptance run: its sandbox is already stopped, and the next worker runs the tests again.
    if ((ending as LiveEnding | null) === "handoff") return handedOff();
    // A Stop (or a cancel) that landed while the acceptance tests ran: the session was stopped, whatever they showed.
    const stoppedLate = stoppedBy as { reason: string } | null;
    if (stoppedLate) {
      holdBack = "the session was stopped";
      return { outcome: "stopped", reason: stoppedLate.reason, blockedReason: "stopped", approvalId: null, summary: `Stopped: ${stoppedLate.reason}.`, providerSessionId: sdkSessionId, ...usageNow() };
    }
    if (recorder.pendingApprovalId) return { outcome: "blocked", reason: "waiting for the founder's approval", blockedReason: "awaiting_approval", approvalId: recorder.pendingApprovalId, summary: "Blocked on an approval.", providerSessionId: sdkSessionId, ...usageNow() };
    if (agentBlock) return { outcome: "blocked", reason: agentBlock.reason, blockedReason: "dependency", approvalId: null, summary: `Blocked by ${agent.name}: ${agentBlock.reason}`.slice(0, 1800), providerSessionId: sdkSessionId, ...usageNow() };
    if (nothingWritten) {
      await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "warn", text: `${agent.name} ended the session without changing any file, so the task is not done. It is blocked until it runs again.` });
      return { outcome: "blocked", reason: NO_CHANGES_REASON, blockedReason: "error", approvalId: null, summary: `Blocked: ${agent.name} changed no files on "${task.title}".`.slice(0, 1800), providerSessionId: sdkSessionId, ...usageNow() };
    }
    if (acceptance && !acceptance.passed) {
      const reason = acceptanceFailureReason(acceptance);
      return { outcome: "blocked", reason, blockedReason: "error", approvalId: null, summary: `Blocked: the acceptance tests failed on "${task.title}".`.slice(0, 1800), providerSessionId: sdkSessionId, ...usageNow() };
    }
    // A code task with an acceptance command is done only on a run that passed: one that never ran shows nothing.
    if (acceptanceCommand && !acceptance) {
      await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "warn", text: "The acceptance tests did not run, so the task is not done. It is blocked until it runs again." });
      return { outcome: "blocked", reason: ACCEPTANCE_NOT_RUN_REASON, blockedReason: "error", approvalId: null, summary: `Blocked: the acceptance tests did not run on "${task.title}".`.slice(0, 1800), providerSessionId: sdkSessionId, ...usageNow() };
    }
    // Passing tests prove nothing when the session changed what they are (package.json scripts, a runner config, a
    // deleted test): compared with the checkout, such a task waits in review for the founder instead of ending done.
    if (checkout && reviewBase && changes) {
      const found = changes.refused ? [`the changes could not be compared with the checkout: ${changes.refused}`] : testSetupChanges(changes, reviewBase);
      if (found.length > 0) {
        const why = testSetupReviewReason(found);
        const review = `needs review: ${why}`;
        await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "warn", text: `Held for your review, not done: ${why}.` });
        return { outcome: "done", reason: review, review, blockedReason: null, approvalId: null, summary: `${agent.name} finished "${task.title}"; it needs your review: ${why}.`.slice(0, 1800), providerSessionId: sdkSessionId, ...usageNow() };
      }
    }
    return { outcome: "done", reason: null, blockedReason: null, approvalId: null, summary: `${agent.name} finished "${task.title}" with ${recorder.toolCalls} tool calls.`, providerSessionId: sdkSessionId, ...usageNow() };
  } finally {
    await loop.stop();
    offDrain();
    if (abortTimer) clearTimeout(abortTimer);
    cancel?.removeEventListener("abort", onCancel);
    openGate();
    queue.close(true);
    // Keep the code whatever the outcome (done, stopped, failed, parked): the workspace itself is deleted next. Only a
    // session that finished (or waits on an approval) is pushed to GitHub.
    if (policy.fileTools) await keepWorkspace(deps, recorder, { businessId: input.businessId, taskId: task.id, sessionId: input.sessionId, agentId: agent.id, branch: launch.branch, agentName: agent.name, holdBack, checkout: checkout ? { commitSha: checkout.base.commitSha, at: checkout.base.checkedOutAt } : null, agentPushed: recorder.agentPushed }, cwd, { secrets: [key.apiKey, token.token], carryOver: restoreFailed, ...(checkout ? { base: checkout.base } : { withoutCheckoutOf: checkoutMissingRepo }) });
    await disposeCheckout(checkout);
    try {
      await removeSessionWorkspace(cwd);
    } catch (err) {
      deps.log.warn({ err: (err as Error).message, sessionId: input.sessionId }, "session workspace cleanup failed");
    }
  }
}

/**
 * What a code session is told about its place in the loop. Twenty-three of twenty-five sessions on Nov 2, 2026 ended
 * blocked, most of them for things the platform does after the session ("no shell, so I could not run the tests", "I
 * cannot rebase or run CI here", "no merge tool"): the agent writes the change; the platform saves and pushes it, runs
 * the acceptance command in a test copy, brings the branch up to date, runs CI, opens the pull request and asks the
 * founder. Said up front, so a session finishes instead of blocking on a step that was never its own.
 */
export function codeTaskNote(branch: string): string {
  return [
    `Work on branch ${branch} inside your working directory; it is the only place you can read or write files.`,
    "You have no shell, no node_modules and no way to run tests here, and that is expected. When your session ends the platform saves your changes and pushes them to your branch, runs the task's acceptance command in a test copy, brings the branch up to date with the live product, runs the repository's CI and opens the pull request; the founder decides what goes live.",
    "Never block or stop the task because you cannot run tests, CI, a rebase or a merge yourself, and never plan or ask for those steps: write the change and the tests it needs, then finish. Block only for something the task itself needs and you cannot get (a decision, a missing credential, a dependency that is not done).",
  ].join(" ");
}

/**
 * Save the session's code to the task, push it to the agent's branch on GitHub, and say so in the session stream; a
 * failure to save or push never fails the session.
 */
async function keepWorkspace(deps: OrchestratorDeps, recorder: SessionRecorder, owner: PushContext, cwd: string, options: SaveWorkspaceOptions): Promise<void> {
  const at = () => deps.clock.now().toISOString();
  try {
    const saved = await saveWorkspace(deps.db, owner, cwd, options);
    const leftOut = describeLeftOut(saved.leftOut, saved.masked);
    if (saved.status === "refused") {
      await recorder.publishRaw({ kind: "note", at: at(), source: "system", level: "warn", text: `This session's code was not saved: ${saved.reason}.` });
    } else if (saved.status === "saved") {
      const delta = [saved.added ? `${saved.added} added` : "", saved.changed ? `${saved.changed} changed` : "", saved.removed ? `${saved.removed} removed` : ""].filter(Boolean).join(", ");
      const base = saved.snapshot?.baseCommitSha ? saved.snapshot : null;
      // On a checkout only the changes are kept (decision 2): the note says against what.
      if (base) await recorder.publishRaw({ kind: "note", at: at(), source: "system", level: "info", text: `Saved this task's changes against ${base.baseRepo}@${base.baseRef}: ${delta || "none"} (${Math.ceil(saved.bytes / 1024)} KB). the Code tab shows them.` });
      else await recorder.publishRaw({ kind: "note", at: at(), source: "system", level: "info", text: `Saved this task's code: ${saved.files} file${saved.files === 1 ? "" : "s"} (${Math.ceil(saved.bytes / 1024)} KB)${delta ? `, ${delta}` : ""}. the Code tab shows it.` });
    }
    if (leftOut) await recorder.publishRaw({ kind: "note", at: at(), source: "system", level: "warn", text: leftOut });
    if (saved.status !== "refused" && saved.snapshot) {
      const pushed = describePush(await pushWorkspace(deps.db, deps.gateway, { ...owner, saveHeldBack: saved.pushHeldBack }, saved.snapshot));
      if (pushed) await recorder.publishRaw({ kind: "note", at: at(), source: "system", level: pushed.level, text: pushed.text });
    }
  } catch (err) {
    deps.log.error({ err: (err as Error).message, sessionId: owner.sessionId }, "workspace save failed");
    await recorder.publishRaw({ kind: "note", at: at(), source: "system", level: "error", text: "This session's code could not be saved." });
  }
}

/** One note line for what a save left out or masked (up to three names per kind), or null when nothing was. */
export function describeLeftOut(leftOut: readonly LeftOut[], masked: readonly string[]): string | null {
  const names = (paths: readonly string[]) => `${paths.slice(0, 3).join(", ")}${paths.length > 3 ? ` and ${paths.length - 3} more` : ""}`;
  const of = (reason: LeftOut["reason"]) => leftOut.filter((l) => l.reason === reason).map((l) => l.path);
  const parts = [
    of("secret").length ? `left out files that hold secrets (${names(of("secret"))})` : "",
    of("startup").length ? `left out start-up settings files (${names(of("startup"))})` : "",
    of("name").length ? `left out files whose names cannot be stored (${names(of("name"))})` : "",
    masked.length ? `masked credentials in ${names(masked)}` : "",
  ].filter(Boolean);
  return parts.length ? `Not kept with this task's code: ${parts.join("; ")}.` : null;
}

/**
 * Hosts a code task's sandbox may reach, and only until `closeEgress()`: the npm registry, for pnpm itself and the
 * project's dependencies, and Temporal's download host, for the test server the workflow tests start (see
 * `temporalTestServerPrepareLines`). Every other kind gets none. Gateway tools run on the host through MCP, not in
 * the sandbox.
 */
export const TEMPORAL_DOWNLOAD_HOST = "temporal.download";
export const ACCEPTANCE_EGRESS: readonly string[] = ["registry.npmjs.org", TEMPORAL_DOWNLOAD_HOST];

export function sandboxEgressFor(task: Pick<Task, "kind">): string[] {
  return task.kind === "code" ? [...ACCEPTANCE_EGRESS] : [];
}

/** pnpm for the acceptance run when the project does not pin one (`packageManager`); E2B's base template ships Node and npm but not pnpm. */
export const SANDBOX_PNPM = "pnpm@10";
/** Bytes of a phase's output that come back to the orchestrator; the rest stays in a log inside the sandbox. */
export const ACCEPTANCE_OUTPUT_TAIL_BYTES = 32 * 1024;
const PNPM_SAFE_FLAGS = "--config.manage-package-manager-versions=false --config.package-manager-strict=false";
/** The two scripts' logs inside the sandbox (their tails are printed at the end, and read back after a timeout). */
export const ACCEPTANCE_PREPARE_LOG = "/tmp/fm-acceptance-prepare.log";
export const ACCEPTANCE_RUN_LOG = "/tmp/fm-acceptance.log";
/**
 * The same two settings for every pnpm command the scripts run, the task's own included, through the environment pnpm
 * reads (`npm_config_<key>`). Not `pnpm config set --location=global`: pnpm 12 refuses these keys in its global
 * config.yaml ("ERR_PNPM_CONFIG_SET_UNSUPPORTED_YAML_CONFIG_KEY"), which ended every acceptance run of the Foundmill
 * business on Oct 27, 2026 before a single package was installed.
 */
const PNPM_SAFE_ENV = "export npm_config_manage_package_manager_versions=false npm_config_package_manager_strict=false";
/** pnpm's settings for the offline phase: no registry calls, no update check, and whatever still tries gives up in seconds. */
export const PNPM_OFFLINE_ENV = "export npm_config_offline=true npm_config_update_notifier=false npm_config_fetch_retries=0 npm_config_fetch_timeout=10000 CI=1";

/**
 * What the acceptance sandbox must run the project with (read from the workspace's package.json and the task's
 * acceptance command), so the tests run the way the project's own CI does rather than on whatever the sandbox image
 * ships (E2B's `base` has Node 20 and no pnpm; this repository asks for Node 22.23.3 and pnpm 12.9.1: Foundmill business,
 * Oct 25, 2026, "dependency install was killed … Node v20.9.0 while the project asks for 22.23.3").
 */
export interface AcceptanceToolchain {
  /** The lowest Node the project accepts (`engines.node`), or null when it says nothing. */
  node: string | null;
  /** The pnpm the project pins (`packageManager: pnpm@x.y.z`), or null. */
  pnpm: string | null;
  /** The workspace packages the acceptance command targets (`pnpm --filter <name> … test`); empty for the whole workspace. */
  filters: string[];
}

const EMPTY_TOOLCHAIN: AcceptanceToolchain = { node: null, pnpm: null, filters: [] };
const VERSION = /^\d+(?:\.\d+){0,2}$/;
/** A workspace package name or path as pnpm's `--filter` takes it; anything else is not put in a shell command. */
const FILTER_NAME = /^(?:@?[A-Za-z0-9]|\.\/)[A-Za-z0-9_./-]{0,120}$/;

/**
 * The toolchain the project asks for: the lowest Node of `engines.node` (`>=22.23.3`, `^22.23.3`, `22.x`, `22.23.3`),
 * the pnpm of `packageManager`, and the `--filter` of the acceptance command. Unreadable fields are null.
 */
export function acceptanceToolchainOf(packageJson: unknown, command: string): AcceptanceToolchain {
  const pkg = (packageJson && typeof packageJson === "object" ? packageJson : {}) as { engines?: { node?: unknown }; packageManager?: unknown };
  let node: string | null = null;
  if (typeof pkg.engines?.node === "string") {
    const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(pkg.engines.node.replace(/^\s*(?:>=|\^|~|=)?\s*v?/, ""));
    if (m) node = [m[1], m[2] ?? "0", m[3] ?? "0"].join(".");
  }
  let pnpm: string | null = null;
  if (typeof pkg.packageManager === "string") {
    const m = /^pnpm@(\d+\.\d+\.\d+)/.exec(pkg.packageManager.trim());
    if (m) pnpm = m[1]!;
  }
  const filters: string[] = [];
  for (const m of command.matchAll(/--filter(?:=|\s+)(\S+)/g)) {
    const name = m[1]!;
    if (FILTER_NAME.test(name) && !name.includes("...") && !filters.includes(name)) filters.push(name);
  }
  return { node: node && VERSION.test(node) ? node : null, pnpm: pnpm && VERSION.test(pnpm) ? pnpm : null, filters };
}

/** The toolchain from the workspace's own package.json; the empty toolchain when there is none or it is unreadable. */
export async function readAcceptanceToolchain(cwd: string, command: string): Promise<AcceptanceToolchain> {
  try {
    const raw = await fs.readFile(path.join(cwd, "package.json"), "utf8");
    return acceptanceToolchainOf(JSON.parse(raw), command);
  } catch {
    return { ...EMPTY_TOOLCHAIN, filters: acceptanceToolchainOf({}, command).filters };
  }
}

/**
 * The workspace packages the paths belong to (the `name` of the nearest package.json above each, never the workspace
 * root's own): what a task changed, so its acceptance tests run for those packages rather than the whole workspace.
 * A name that could not go into a shell command as it is (`FILTER_NAME`) is left out.
 */
export async function changedPackageNames(cwd: string, paths: readonly string[]): Promise<string[]> {
  const scope = await changedScope(cwd, paths);
  return [...scope.test, ...scope.app].sort();
}

/** A package's `test` script that needs the running app (Playwright drives a browser against a server): never run in the acceptance sandbox. */
const APP_TEST_SCRIPT = /\bplaywright\b/i;

interface PackageInfo {
  exists: boolean;
  /** The `name`, when it can go into a shell command as it is (`FILTER_NAME`). */
  name: string | null;
  /** The `test` script runs against the running app (CI starts the servers for it; the sandbox has none). */
  appTest: boolean;
}

async function readPackageInfo(dir: string): Promise<PackageInfo> {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8")) as { name?: unknown; scripts?: Record<string, unknown> };
    const name = typeof pkg.name === "string" && FILTER_NAME.test(pkg.name) && !pkg.name.includes("...") ? pkg.name : null;
    const test = pkg.scripts && typeof pkg.scripts.test === "string" ? pkg.scripts.test : "";
    return { exists: true, name, appTest: APP_TEST_SCRIPT.test(test) };
  } catch {
    return { exists: false, name: null, appTest: false }; // no package.json here, or not JSON: not a package
  }
}

export interface ChangedScope {
  /** Packages whose tests the sandbox runs (`--filter` names), sorted. */
  test: string[];
  /** Packages whose tests need the running app: named in the note, run in CI, never in the sandbox. Sorted. */
  app: string[];
  /** Paths in no package (the workspace root's own files). */
  loose: string[];
}

/**
 * What a change touches, by the nearest package.json above each path (never the workspace root's own): the packages to
 * test in the sandbox, the packages whose tests need the running app, and the paths in no package.
 */
export async function changedScope(cwd: string, paths: readonly string[]): Promise<ChangedScope> {
  const root = path.resolve(cwd);
  const packages = new Map<string, PackageInfo>();
  const packageAt = async (dir: string) => {
    const known = packages.get(dir);
    if (known) return known;
    const found = await readPackageInfo(dir);
    packages.set(dir, found);
    return found;
  };
  const test = new Set<string>();
  const app = new Set<string>();
  const loose: string[] = [];
  for (const rel of paths) {
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(root + path.sep)) continue;
    let owned = false;
    for (let dir = path.dirname(abs); dir !== root && dir.startsWith(root + path.sep); dir = path.dirname(dir)) {
      const pkg = await packageAt(dir);
      if (!pkg.exists) continue;
      owned = true;
      if (pkg.name) (pkg.appTest ? app : test).add(pkg.name);
      break;
    }
    if (!owned) loose.push(rel);
  }
  return { test: [...test].sort(), app: [...app].sort(), loose };
}

const SCAN_SKIP = new Set(["node_modules", ".git", "dist", ".next", ".turbo", "coverage", ".pnpm-store"]);

/**
 * The workspace packages whose `test` script needs the running app (up to three directories deep, as pnpm workspaces
 * are laid out): left out of the every-package fallback, which would otherwise run a browser suite against no server
 * (the Foundmill business's fifth cycle, Oct 28, 2026: eleven golden-path failures on a branch that changed an API file).
 */
export async function workspaceAppTestPackages(cwd: string, maxDepth = 3): Promise<string[]> {
  const root = path.resolve(cwd);
  const out = new Set<string>();
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 0) {
      const info = await readPackageInfo(dir);
      if (info.exists && info.name && info.appTest) out.add(info.name);
    }
    if (depth >= maxDepth) return;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || SCAN_SKIP.has(e.name) || e.name.startsWith(".")) continue;
      await walk(path.join(dir, e.name), depth + 1);
    }
  };
  await walk(root, 0);
  return [...out].sort();
}

/** The note when a change leaves the sandbox nothing to test. */
export function nothingToTestNote(scoped: ChangedScope): string {
  const parts: string[] = [];
  if (scoped.loose.length > 0) parts.push(`documentation only (${scoped.loose.slice(0, 5).join(", ")}${scoped.loose.length > 5 ? ` and ${scoped.loose.length - 5} more` : ""}), which has no tests`);
  if (scoped.app.length > 0) parts.push(`${scoped.app.join(", ")}, whose tests need the running app and run in CI`);
  return `Acceptance tests not run: the task changed ${parts.join("; and ")}.`;
}

const DOCUMENTATION_EXTENSIONS = new Set([".md", ".mdx", ".markdown", ".txt", ".rst", ".adoc"]);

/**
 * True when every path is a documentation file (by extension): a change with no tests to run. The fallback acceptance
 * command would run every package's tests for a Markdown edit (the agent-pack skills review and the documentation-fix
 * note on the Foundmill business, Oct 27, 2026); such a session skips the tests instead. Empty: false.
 */
export function documentationOnly(paths: readonly string[]): boolean {
  return paths.length > 0 && paths.every((rel) => DOCUMENTATION_EXTENSIONS.has(path.extname(rel).toLowerCase()));
}

/** Run `lines` under `set -e` with their output in a log inside the sandbox, print only its tail, keep the exit code. */
function withOutputTail(log: string, lines: string[]): string {
  return ["(", "set -e", ...lines, `) >${log} 2>&1`, "rc=$?", `tail -c ${ACCEPTANCE_OUTPUT_TAIL_BYTES} ${log}`, "exit $rc"].join("\n");
}

/** `npm install --global` into the sandbox user's tool prefix, scripts off: nothing a package ships runs online. */
const npmGlobal = (spec: string) => `(cd "$HOME" && npm install --global --prefix "$HOME/.fm-tools" --ignore-scripts --no-fund --no-audit --loglevel=error ${spec})`;

/**
 * Phase 1, online (the registry is reachable): put the project's Node and pnpm on PATH and install its dependencies
 * with every lifecycle script and pnpmfile off, so no code the agent controls runs while the sandbox can reach the
 * network. pnpm's own settings that could fetch or switch package managers are pinned on the command line, which
 * outranks a project `.npmrc`, and in the environment (`PNPM_SAFE_ENV`) for the task's own command in the offline phase.
 *
 * - Node: when the sandbox's Node is older than the project's `engines.node`, the matching Node binary comes from the
 *   npm registry (`node-linux-x64@<version>`, the only host the sandbox may reach) into `$HOME/.fm-tools/bin`, ahead of
 *   the image's Node on PATH. A template that already ships the right Node skips this (docs/DEPLOY.md §5).
 * - pnpm: the version `packageManager` pins, else `SANDBOX_PNPM`; an older pnpm on a newer lockfile re-resolves the
 *   whole graph, which is slow and memory-hungry.
 * - The install is narrowed to the package the acceptance command targets and its dependencies (`--filter <name>...`)
 *   when the command names one, so a test of one package does not install the whole workspace.
 */
export function acceptancePrepareScript(toolchain: AcceptanceToolchain = EMPTY_TOOLCHAIN): string {
  const pnpmSpec = toolchain.pnpm ? `pnpm@${toolchain.pnpm}` : SANDBOX_PNPM;
  const pnpmWanted = toolchain.pnpm ? `[ "$(pnpm --version 2>/dev/null)" = "${toolchain.pnpm}" ]` : "command -v pnpm >/dev/null 2>&1";
  const filter = toolchain.filters.map((name) => ` --filter ${JSON.stringify(`${name}...`)}`).join("");
  return withOutputTail(ACCEPTANCE_PREPARE_LOG, [
    'export PATH="$HOME/.fm-tools/bin:$PATH"',
    PNPM_SAFE_ENV,
    // "$1 is older than $2": the smaller of the two by version sort is $1 and they differ.
    'fm_older() { [ "$1" != "$2" ] && [ "$(printf %s\\\\n "$1" "$2" | sort -V | head -n1)" = "$1" ]; }',
    ...(toolchain.node
      ? [
          `if fm_older "$(node --version 2>/dev/null | sed s/^v//)" "${toolchain.node}"; then echo "Sandbox Node $(node --version 2>/dev/null) is older than the project's ${toolchain.node}: installing Node ${toolchain.node}"; ${npmGlobal(`node-linux-x64@${toolchain.node}`)}; hash -r; fi`,
          'echo "Node $(node --version)"',
        ]
      : []),
    `${pnpmWanted} || ${npmGlobal(pnpmSpec)}`,
    'hash -r; echo "pnpm $(pnpm --version)"',
    `if [ -f package.json ]; then pnpm install --no-frozen-lockfile --ignore-scripts --ignore-pnpmfile ${PNPM_SAFE_FLAGS} --reporter=append-only${filter}; fi`,
    // Still online: the test server the workflow tests start, which the offline phase could not fetch.
    ...temporalTestServerPrepareLines(),
  ]);
}

/**
 * Phase 2, offline (after `closeEgress()`): run the dependencies' allowed build scripts, then the task's command. This
 * is where the agent's code runs, with no network at all.
 */
export function acceptanceRunScript(command: string): string {
  return withOutputTail(ACCEPTANCE_RUN_LOG, [
    'export PATH="$HOME/.fm-tools/bin:$PATH"',
    PNPM_SAFE_ENV,
    // The sandbox has a few GB at most: a test runner that forks one worker per CPU was killed (exit 137) on the
    // first web test run of the Foundmill business (Oct 27, 2026). Vitest reads this; other runners ignore it.
    "export VITEST_MAX_WORKERS=2",
    // The template has 4096 MB shared by pnpm, a runner and two workers: bound each Node heap so a runaway process fails
    // as a named out-of-memory error instead of the kernel's silent kill (exit 137). A task command may set its own.
    `export NODE_OPTIONS="\${NODE_OPTIONS:-} --max-old-space-size=${ACCEPTANCE_NODE_HEAP_MB}"`,
    // The network is closed and its packets are dropped, not refused: anything pnpm would still ask the registry (an
    // update check, a metadata fetch) must give up at once rather than wait out retries.
    PNPM_OFFLINE_ENV,
    // The test server the online phase downloaded, by name: a suite that cannot find it fails at once, never waits.
    ...temporalTestServerRunLines(),
    // Offline, so pnpm never waits on a registry it cannot reach, and bounded: the task's command gets the run's time.
    `if [ -f package.json ]; then timeout ${ACCEPTANCE_REBUILD_TIMEOUT_SECONDS} pnpm rebuild --offline ${PNPM_SAFE_FLAGS} >/dev/null 2>&1 || echo "(some dependency build scripts failed offline)"; fi`,
    command,
  ]);
}

/** Heap ceiling (MB) for each Node process of an acceptance run; the sandbox template has 4096 MB in all. */
export const ACCEPTANCE_NODE_HEAP_MB = 1536;

/** The dependencies' build scripts get this long offline; what is not built by then is left to the tests to miss. */
export const ACCEPTANCE_REBUILD_TIMEOUT_SECONDS = 300;

/*
 * The Temporal test server. `@temporalio/testing` fetches its time-skipping test server from `TEMPORAL_DOWNLOAD_HOST`
 * the first time a test starts one (metadata, then the archive; no redirect elsewhere). The sandbox's `/tmp` is empty,
 * so with the network closed that fetch hangs until the suite's hook timeout, file after file: Hiba's orchestrator run
 * of Oct 29, 2026 lost 20 of 66 test files to it, and a run with more such files would show only the run timeout.
 */
/** Where the run finds the test server (set by the run script when `@temporalio/testing` is installed; read by the repository's own test rig). */
export const TEMPORAL_TEST_SERVER_ENV = "TEMPORAL_TEST_SERVER";
/** Core's cache name for the time-skipping test server of the TypeScript SDK; `<dir>/<this>-<sdk version>`. */
const TEMPORAL_TEST_SERVER_CACHE_PREFIX = "temporal-test-server-sdk-typescript";
/** Seconds the online phase gives the download (about 30 MB) before it gives up and the note says so. */
export const TEMPORAL_TEST_SERVER_DOWNLOAD_TIMEOUT_SECONDS = 300;

/**
 * `fm_temporal_testing_version`: prints the installed `@temporalio/testing` version (pnpm's store layout first, then a
 * plain node_modules), or fails when the package is not installed. Reads the package.json as data; runs no package code.
 */
const TEMPORAL_TESTING_VERSION_FN = [
  "fm_temporal_testing_version() {",
  "  for p in node_modules/.pnpm/@temporalio+testing@*/node_modules/@temporalio/testing/package.json node_modules/@temporalio/testing/package.json; do",
  `    if [ -f "$p" ]; then node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version)' "$p"; return 0; fi`,
  "  done",
  "  return 1",
  "}",
].join("\n");

/**
 * The online phase's download of the Temporal test server, when the install brought `@temporalio/testing`: the same
 * metadata call core makes (`https://temporal.download/temporal-test-server/default?...`), the archive it names (same
 * host; anything else is refused), the one file extracted to the path core would cache it at (`$TMPDIR` or /tmp, which
 * the run phase shares), so a suite that asks for the default cached download finds it. Nothing from the project runs:
 * curl, tar and Node's JSON parser only. A failure is a line in the prepare log, not a failed prepare; the run then
 * fails fast on the missing file (`TEMPORAL_TEST_SERVER`) instead of waiting out a download that cannot happen.
 */
export function temporalTestServerPrepareLines(): string[] {
  const metadata = `https://${TEMPORAL_DOWNLOAD_HOST}/temporal-test-server/default?arch=$arch&platform=linux&sdk-name=sdk-typescript&sdk-version=$ver`;
  const field = (name: string) => `node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => process.stdout.write(String(JSON.parse(s).${name} ?? "")))'`;
  return [
    TEMPORAL_TESTING_VERSION_FN,
    "fm_temporal_test_server() {",
    '  ver="$(fm_temporal_testing_version)" || return 0',
    `  dest="\${TMPDIR:-/tmp}/${TEMPORAL_TEST_SERVER_CACHE_PREFIX}-$ver"`,
    '  if [ -x "$dest" ]; then echo "Temporal test server for @temporalio/testing $ver already at $dest"; return 0; fi',
    '  case "$(uname -m)" in x86_64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) echo "(no Temporal test server build for $(uname -m))"; return 1 ;; esac',
    `  info="$(curl -fsSL --max-time 60 "${metadata}")"`,
    `  url="$(printf %s "$info" | ${field("archiveUrl")})"`,
    `  file="$(printf %s "$info" | ${field("fileToExtract")})"`,
    `  case "$url" in https://${TEMPORAL_DOWNLOAD_HOST}/*) ;; *) echo "(the Temporal test server archive is not on ${TEMPORAL_DOWNLOAD_HOST}: $url)"; return 1 ;; esac`,
    '  work="$(mktemp -d)"',
    `  curl -fsSL --max-time ${TEMPORAL_TEST_SERVER_DOWNLOAD_TIMEOUT_SECONDS} -o "$work/archive" "$url"`,
    '  tar -xzf "$work/archive" -C "$work" "$file"',
    '  mv "$work/$file" "$dest" && chmod +x "$dest"',
    '  rm -rf "$work"',
    '  echo "Downloaded the Temporal test server for @temporalio/testing $ver to $dest (the workflow tests start it offline)"',
    "}",
    'fm_temporal_test_server || echo "(the Temporal test server could not be downloaded; the workflow tests cannot start offline)"',
  ];
}

/** The offline phase's line naming the downloaded test server for the tests, when `@temporalio/testing` is installed. */
export function temporalTestServerRunLines(): string[] {
  return [TEMPORAL_TESTING_VERSION_FN, `if ver="$(fm_temporal_testing_version)"; then export ${TEMPORAL_TEST_SERVER_ENV}="\${TMPDIR:-/tmp}/${TEMPORAL_TEST_SERVER_CACHE_PREFIX}-$ver"; fi`];
}

/**
 * The tail of a sandbox script's log when the script timed out: the sandbox answers a timed-out command with no output
 * (the log's tail is printed by the script's last line, which never ran), so the log is read back for the note. The
 * two 15-minute timeouts of the Foundmill business's fifth cycle (Oct 28, 2026) left no trace of what had stalled.
 */
async function sandboxLogTail(sandbox: Pick<Sandbox, "readFile">, log: string): Promise<string> {
  try {
    const text = await sandbox.readFile(log);
    return text.slice(-ACCEPTANCE_OUTPUT_TAIL_BYTES);
  } catch {
    return "";
  }
}

/** Text from the sandbox for a session note: credential-shaped values masked, host paths gone, within the note limit. */
function sandboxOutputForNote(output: string, max = 1500): string {
  return redactCredentialValues(output.trim()).slice(-max) || "(no output)";
}

/** How a code task's acceptance run went: `passed` only when the command ran, exited 0 and reported no failed test. */
export interface AcceptanceVerdict {
  passed: boolean;
  /** The command's exit code; null when it never ran (no sandbox, workspace not copied, install failed, network open). */
  exitCode: number | null;
  testsPassed: number;
  testsFailed: number;
  /** Why it failed, or the tail of its output (credential-shaped values masked); empty when it passed. */
  output: string;
}

/** Why a session whose acceptance run failed is not done: the task's `task.blocked` detail (at most 2,000 characters). */
export function acceptanceFailureReason(v: AcceptanceVerdict): string {
  const counts = `${v.testsPassed} passed, ${v.testsFailed} failed`;
  const head = `acceptance tests failed (${v.exitCode === null ? "not run" : `exit ${v.exitCode}`}, ${counts})`;
  const tail = v.output.trim();
  return (tail ? `${head}. Last output:\n${tail.slice(-(2000 - head.length - 16))}` : head).slice(0, 2000);
}

/**
 * The branch the agent pushed to during the session, brought down over the workspace in place of the checkout: what
 * its `commit_files` calls wrote is this session's work even though no local file changed. Returns the new checkout,
 * or null when the branch could not be fetched: the workspace is then the original checkout again, a note says why,
 * and the run is judged as before (no local change).
 */
async function adoptPushedBranch(deps: OrchestratorDeps, recorder: SessionRecorder, input: CheckoutInput, cwd: string, current: Checkout, agentName: string, branch: string): Promise<Checkout | null> {
  const at = () => deps.clock.now().toISOString();
  const pushes = recorder.agentPushed.count;
  const commits = `${pushes} commit${pushes === 1 ? "" : "s"}`;
  // A clean workspace: the archive is written with exclusive creates, and a file the branch deleted must not linger.
  await createSessionWorkspace(deps.env.ORCHESTRATOR_WORKSPACE_DIR, input.sessionId);
  const again = await checkoutRepository(deps, input, cwd);
  if (again.status === "checked_out" && again.checkout.base.ref === branch) {
    await disposeCheckout(current);
    await recorder.publishRaw({ kind: "note", at: at(), source: "system", level: "info", text: `Brought down ${branch} (${again.checkout.files} file${again.checkout.files === 1 ? "" : "s"}, commit ${again.checkout.base.commitSha.slice(0, 7)}) with the ${commits} ${agentName} pushed during the session, for the acceptance tests.` });
    return again.checkout;
  }
  const why = again.status === "checked_out" ? `GitHub served ${again.checkout.base.ref}, not ${branch}` : again.reason;
  if (again.status === "checked_out") await disposeCheckout(again.checkout);
  // Back to the checkout the session started from; the push itself stands on GitHub.
  await createSessionWorkspace(deps.env.ORCHESTRATOR_WORKSPACE_DIR, input.sessionId);
  try {
    await extractArchive(current.archivePath, cwd);
  } catch (err) {
    deps.log.warn({ err: (err as Error).message, sessionId: input.sessionId }, "checkout could not be unpacked again after the branch fetch failed");
  }
  await recorder.publishRaw({ kind: "note", at: at(), source: "system", level: "warn", text: `${agentName} pushed ${commits} to ${branch}, but the branch could not be brought down for the acceptance tests (${why.slice(0, 200)}). The push stands on GitHub; this session is judged on its workspace, which did not change.` });
  return null;
}

/** Why a code session that changed no file is not done. */
export const NO_CHANGES_REASON = "no changes: the session ended without changing any file in the workspace";
/** Why a code task with an acceptance command whose run never happened is not done. */
export const ACCEPTANCE_NOT_RUN_REASON = "acceptance tests did not run";

/**
 * Copy the workspace into the sandbox, install dependencies online, close the network, run the acceptance command
 * offline and publish the `test_result`. Every failure ends as a failed acceptance result with its reason; none of them
 * fails the session. Returns the sandbox time to book and the verdict (null when the run was cut short before it began).
 */
async function runAcceptance(deps: OrchestratorDeps, recorder: SessionRecorder, acquireSandbox: () => Promise<Sandbox>, cwd: string, command: string, abort: AbortSignal | null = null, checkout: Checkout | null = null): Promise<{ ms: number; verdict: AcceptanceVerdict | null }> {
  const at = () => deps.clock.now().toISOString();
  if (abort?.aborted) return { ms: 0, verdict: null };
  const failed = async (reason: string, durationMs = 0, output = ""): Promise<AcceptanceVerdict> => {
    await recorder.publish({ kind: "test_result", at: at(), suite: "acceptance", command, passed: 0, failed: 1, skipped: 0, durationMs, acceptance: true, failures: [reason.slice(0, 300)] });
    return { passed: false, exitCode: null, testsPassed: 0, testsFailed: 1, output: output ? `${reason}:\n${output}` : reason };
  };

  // The sandbox exists for this run only (SANDBOX_TTL_MINUTES), so a long session never outlives its sandbox.
  let sandbox: Sandbox;
  // The sandbox is billed from the moment it exists until it is stopped (audit BILL-11): the session books this time.
  const startedAtMs = deps.clock.nowMs();
  try {
    sandbox = await acquireSandbox();
  } catch (err) {
    await recorder.publishRaw({ kind: "note", at: at(), source: "system", level: "warn", text: `Acceptance tests not run: the sandbox could not be started (${redactCredentialValues(String((err as Error).message ?? err)).slice(0, 300)}).` });
    return { ms: 0, verdict: await failed("Sandbox could not be started") };
  }
  // A run that ends early (a hand-off on a worker shutdown, a cancel) stops the sandbox at once: a worker that exits
  // with it running would leave it billed until its TTL.
  const stopNow = () => void sandbox.stop().catch(() => undefined);
  abort?.addEventListener("abort", stopNow, { once: true });
  let verdict: AcceptanceVerdict;
  try {
    verdict = await runAcceptanceIn(deps, recorder, sandbox, cwd, command, failed, checkout);
  } finally {
    abort?.removeEventListener("abort", stopNow);
    await sandbox.stop().catch(() => undefined);
  }
  return { ms: Math.max(0, deps.clock.nowMs() - startedAtMs), verdict };
}

async function runAcceptanceIn(deps: OrchestratorDeps, recorder: SessionRecorder, sandbox: Sandbox, cwd: string, command: string, failed: (reason: string, durationMs?: number, output?: string) => Promise<AcceptanceVerdict>, checkout: Checkout | null = null): Promise<AcceptanceVerdict> {
  const at = () => deps.clock.now().toISOString();
  let synced: Awaited<ReturnType<typeof syncWorkspaceToSandbox>> & { unpacked?: boolean; changed?: number; removed?: number };
  try {
    // A checkout goes in whole (its archive, unpacked in the sandbox) with the agent's changes on top.
    synced = checkout ? await syncCheckoutToSandbox(cwd, sandbox, { archive: checkout.archivePath, files: checkout.base.files }) : await syncWorkspaceToSandbox(cwd, sandbox);
  } catch (err) {
    const reason = String((err as Error).message ?? err).split(cwd).join("<workspace>");
    await recorder.publishRaw({ kind: "note", at: at(), source: "system", level: "warn", text: `Acceptance tests not run: the workspace could not be copied into the sandbox (${reason.slice(0, 300)}).` });
    return failed("Workspace not copied to the sandbox");
  }
  if (synced.refused) {
    await recorder.publishRaw({ kind: "note", at: at(), source: "system", level: "warn", text: `Acceptance tests not run: ${synced.refused}.` });
    return failed(`Workspace not copied to the sandbox: ${synced.refused}`);
  }
  await recorder.publishRaw({
    kind: "note",
    at: at(),
    source: "system",
    level: "info",
    text: synced.unpacked
      ? `Unpacked the checkout of ${checkout!.base.repo}@${checkout!.base.ref} in the sandbox with ${synced.changed} changed file${synced.changed === 1 ? "" : "s"}${synced.removed ? ` and ${synced.removed} removed` : ""} for the acceptance tests.`
      : `Copied ${synced.files} file${synced.files === 1 ? "" : "s"} (${Math.ceil(synced.bytes / 1024)} KB) into the sandbox for the acceptance tests.`,
  });

  // The project's own Node and pnpm, and only the package under test when the command names one (the image's Node 20
  // and a whole-workspace install killed the first live runs).
  const toolchain = await readAcceptanceToolchain(cwd, command);
  const asked = [toolchain.node ? `Node ${toolchain.node} or newer` : null, toolchain.pnpm ? `pnpm ${toolchain.pnpm}` : null].filter(Boolean).join(" and ");
  await recorder.publishRaw({ kind: "note", at: at(), source: "system", level: "info", text: `Installing dependencies in the sandbox${asked ? ` with ${asked} (the project's own)` : ""}${toolchain.filters.length > 0 ? `, for ${toolchain.filters.join(", ")} and what ${toolchain.filters.length === 1 ? "it depends" : "they depend"} on` : ""}.` });
  const prep = await sandbox.exec(acceptancePrepareScript(toolchain), { timeoutMs: ACCEPTANCE_PREPARE_TIMEOUT_MS });
  if (prep.code !== 0) {
    const prepOutput = sandboxOutputForNote(prep.timedOut ? `${await sandboxLogTail(sandbox, ACCEPTANCE_PREPARE_LOG)}\n${prep.stderr}` : prep.stdout + prep.stderr);
    await recorder.publishRaw({ kind: "note", at: at(), source: "agent", level: "warn", text: `Installing the project's dependencies failed (exit ${prep.code}${prep.timedOut ? ", timed out" : ""}):\n${prepOutput}` });
    return failed("Dependency install failed", prep.durationMs, prepOutput);
  }
  // The tile's status line moves on: without this, "Installing dependencies" stood for the whole test run (Nov 1, 2026).
  await recorder.publishRaw({ kind: "note", at: at(), source: "system", level: "info", text: `Dependencies installed in ${Math.max(1, Math.round(prep.durationMs / 1000))} s. Running the acceptance tests: ${command}` });
  try {
    await sandbox.closeEgress();
  } catch (err) {
    await recorder.publishRaw({ kind: "note", at: at(), source: "system", level: "error", text: `Acceptance tests not run: the sandbox's network could not be closed (${String((err as Error).message ?? err).slice(0, 200)}).` });
    return failed("Sandbox network could not be closed; tests not run");
  }

  const res = await sandbox.exec(acceptanceRunScript(command), { timeoutMs: ACCEPTANCE_RUN_TIMEOUT_MS });
  const output = res.timedOut ? `${await sandboxLogTail(sandbox, ACCEPTANCE_RUN_LOG)}\n${res.stderr}` : res.stdout + res.stderr;
  const counts = parseTestCounts(output);
  // The output comes from the task's own scripts, so it is shown as the agent's, never as a system message.
  if (res.code !== 0) await recorder.publishRaw({ kind: "note", at: at(), source: "agent", level: "warn", text: `Acceptance run exited with code ${res.code}${res.timedOut ? " (timed out)" : ""}. Last output:\n${sandboxOutputForNote(output)}` });
  const testsFailed = res.code === 0 ? counts.failed : Math.max(1, counts.failed);
  await recorder.publish({ kind: "test_result", at: at(), suite: "acceptance", command, passed: counts.passed, failed: testsFailed, skipped: 0, durationMs: prep.durationMs + res.durationMs, acceptance: true, failures: [] });
  const passed = res.code === 0 && testsFailed === 0;
  return { passed, exitCode: res.code, testsPassed: counts.passed, testsFailed, output: passed ? "" : sandboxOutputForNote(output) };
}

/**
 * The acceptance command when the task names none and nothing says which packages it changed: every package's tests,
 * one package at a time. Not `pnpm test` (`turbo run test` here): that runs every package at once and was killed for
 * memory in the sandbox (exit 137) on the Foundmill business's Oct 27, 2026 cycles.
 */
export const ACCEPTANCE_FALLBACK_COMMAND = "pnpm -r --workspace-concurrency=1 run --if-present test";

/**
 * The task's acceptance command: the one its acceptance criteria name; else the tests of the packages the task changed
 * (`scope`, from `changedScope`); else `ACCEPTANCE_FALLBACK_COMMAND`, less the packages whose tests need the running app
 * (`exclude`, from `workspaceAppTestPackages`). Null for a task that is not code.
 */
export function acceptanceCommandFor(task: Pick<Task, "acceptance" | "kind">, scope: readonly string[] = [], exclude: readonly string[] = []): string | null {
  if (task.kind !== "code") return null;
  for (const a of task.acceptance) {
    if (a && typeof a === "object" && typeof (a as { command?: unknown }).command === "string") return (a as { command: string }).command;
  }
  const safe = (names: readonly string[]) => [...new Set(names.filter((name) => FILTER_NAME.test(name) && !name.includes("...")))].sort();
  const packages = safe(scope);
  if (packages.length > 0) return `pnpm ${packages.map((name) => `--filter ${name}`).join(" ")} run --if-present test`;
  const excluded = safe(exclude);
  if (excluded.length === 0) return ACCEPTANCE_FALLBACK_COMMAND;
  return ACCEPTANCE_FALLBACK_COMMAND.replace(" run --if-present test", ` ${excluded.map((name) => `--filter=!${name}`).join(" ")} run --if-present test`);
}

/** Parse "N passed, M failed" style summaries (vitest / jest / pytest). */
export function parseTestCounts(output: string): { passed: number; failed: number } {
  const passed = /(\d+)\s+passed/i.exec(output);
  const failed = /(\d+)\s+failed/i.exec(output);
  return { passed: passed ? Number(passed[1]) : 0, failed: failed ? Number(failed[1]) : 0 };
}

export type { ModelKey };

/**
 * The instruction a handed-back task carries (activities/merge.ts `handBack`: its latest `task.blocked` says
 * `needs_update`), or null when the task's latest block is something else, or it completed since.
 */
export async function latestHandBack(deps: Pick<OrchestratorDeps, "db">, businessId: string, taskId: string): Promise<string | null> {
  const [blocked, completed] = await Promise.all([repos.events.list(deps.db, businessId, { type: "task.blocked", limit: 200 }), repos.events.list(deps.db, businessId, { type: "task.completed", limit: 200 })]);
  const block = blocked.items.find((e) => (e.payload as { taskId?: unknown }).taskId === taskId);
  if (!block) return null;
  const p = block.payload as { reason?: unknown; detail?: unknown };
  if (p.reason !== "needs_update" || typeof p.detail !== "string") return null;
  const done = completed.items.find((e) => (e.payload as { taskId?: unknown }).taskId === taskId);
  if (done && new Date(done.occurredAt).getTime() > new Date(block.occurredAt).getTime()) return null;
  return p.detail;
}

