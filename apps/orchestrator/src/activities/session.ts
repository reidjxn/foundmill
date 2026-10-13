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
 * `finishSession` settles the task, the agent and the events.
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
import type { Query } from "@anthropic-ai/claude-agent-sdk";
import { AgentInstructions, buildSystemPrompt, getTemplate, getTemplateByAgentType, hasClubRulesPrefix, listTemplates, restoredWorkspaceNote, ToolGrant, type AgentTemplate } from "@foundmill/agents";
import { APP_NAME, CREDITS_CURRENCY } from "@foundmill/config";
import { resolveGrants } from "@foundmill/connectors";
import { bookUsage, closeApprovalItem, loadByokApiKey, repos, type Agent, type AgentVersion, type Approval, type Task } from "@foundmill/db";
import { publishSessionEvent, type SessionEventInput } from "@foundmill/events";
import { meter, MODEL_PRICING, resolveModel, type ModelId, type RouteKey } from "@foundmill/models";
import { assertNoLongLivedCredentials, MockSandbox, MockSandboxProvider, RECORDINGS, redactCredentialValues, stableHash32, type Sandbox, type SandboxSpecInput } from "@foundmill/sandbox";
import { type AgentStatus, type ModelKey, type TaskStatus } from "@foundmill/shared";
import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { z } from "zod";
import type { SessionCommand } from "../control-bus";
import type { OrchestratorDeps } from "../deps";
import { emitEvent, systemActor } from "../events";
import { applySessionEvent, initialProgress, type ProgressState } from "../progress";
import { AGENT_PAUSED_FAILURE, CANCELLED_REASON, type RunUsage } from "../session-contract";
import { openApprovalNote } from "./approvals";
import { LoopDetector } from "./loop";
import { CREDITS_USED_UP_SUMMARY, SessionCredits, unbookedTokens } from "./session-credits";
import { createSessionWorkspace, guardToolCall, hookOutputFor, removeSessionWorkspace, sdkEnvFor, sdkToolPolicyFor } from "./sdk-isolation";
import { describePush, pushWorkspace, type PushContext } from "./workspace-push";
import { restoreWorkspace, saveWorkspace, type LeftOut, type RestoredWorkspace, type SaveWorkspaceOptions } from "./workspace-store";
import { syncWorkspaceToSandbox } from "./workspace-sync";
import type { AgentSessionInput, SessionFinish, SessionLaunch, SessionParked, SessionResult, SessionRunOptions } from "./types";

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

function parseGrants(version: AgentVersion | null, template: AgentTemplate): { connectorKey: string; tools: string[] }[] {
  const parsed = version ? ToolGrants.safeParse(version.tools) : null;
  const grants = parsed?.success && parsed.data.length > 0 ? parsed.data : template.tools;
  return grants.map((g) => ({ connectorKey: g.connectorKey, tools: [...g.tools] }));
}

function instructionsFor(version: AgentVersion | null, template: AgentTemplate) {
  const parsed = version ? AgentInstructions.safeParse(version.instructions) : null;
  return parsed?.success ? parsed.data : template.instructions;
}

/** Pick the recording for a task: same task kind when available, deterministic by task id. */
export function recordingForTask(task: Pick<Task, "id" | "kind">, recordings: readonly { key: string; taskKind: string }[] = RECORDINGS): string {
  const sameKind = recordings.filter((r) => r.taskKind === task.kind);
  const pool = sameKind.length > 0 ? sameKind : recordings;
  if (pool.length === 0) throw new Error("no recordings available for the mock sandbox");
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

  constructor(private readonly fallbackModelId: string) {}

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
  lastPersisted = -1;
  lastPhase: string | null = null;
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
   * What every heartbeat carries. The usage so far is among it: when the run dies without returning (its worker lost,
   * a heartbeat timeout), the workflow books the spend from the last heartbeat (`usageFromHeartbeat`).
   */
  heartbeatDetails(extra: Record<string, unknown> = {}): Record<string, unknown> {
    const u = this.usage.totals();
    const usage: RunUsage = { tokensIn: u.tokensIn, tokensOut: u.tokensOut, costMinor: Math.round(u.costMinor) };
    return { sessionId: this.ctx.input.sessionId, events: this.eventsEmitted, progress: this.progress.progress, usage, ...extra };
  }

  /** Publish one event to the session stream and fold it into progress / loop detection / approvals. */
  async publish(event: SessionEventInput): Promise<{ loop: boolean }> {
    const { deps, ctx } = this;
    const at = event.at ?? deps.clock.now().toISOString();
    const full = { ...event, at } as SessionEventInput;
    try {
      await publishSessionEvent(deps.redis, ctx.input.sessionId, full);
    } catch (err) {
      deps.log.warn({ err: (err as Error).message, sessionId: ctx.input.sessionId }, "session stream publish failed");
    }
    this.eventsEmitted += 1;
    heartbeat(this.heartbeatDetails());

    if (full.kind === "tool_call") {
      if (full.status === "started") this.toolCalls += 1;
      if (full.status === "failed" || full.status === "denied") this.toolFailures += 1;
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

    const verdict = this.loop.observe(full);
    if (verdict?.loop) {
      await this.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), level: "error", source: "system", text: `Loop detected: ${verdict.signature.slice(0, 200)} repeated ${verdict.count} times. Stopping the session and returning the task to its lead.` });
      return { loop: true };
    }
    return { loop: false };
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
        const row = await repos.approvals.create(tx, businessId, { agentId: ctx.agent.id, sessionId: ctx.input.sessionId, taskId: ctx.task.id, connectorKey, tool: call.tool, args: gated.args, reasons: [call.resultSummary ?? "policy asked for the founder's approval"] });
        const requested = await emitEvent(tx, {
          businessId,
          type: "approval.requested",
          actor: { kind: "agent", id: ctx.agent.id },
          payload: { approvalId: row.id, agentId: ctx.agent.id, sessionId: ctx.input.sessionId, connectorKey, tool: call.tool, amount: null, reasons: [call.resultSummary ?? "policy outcome: ask"], policyIds: [], hardGate: false, summary: `${ctx.agent.name} wants to call ${connectorKey}.${call.tool}: ${call.argsSummary || "no arguments"}`.slice(0, 1000) },
        });
        await openApprovalNote(tx, businessId, row, { agent: ctx.agent, taskTitle: ctx.task.title, argsSummary: call.argsSummary ?? null, sourceEventIds: [requested.id] });
        return row;
      });
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
    const version = agent.currentVersionId ? await repos.agents.getVersion(db, input.businessId, agent.currentVersionId) : null;
    return { agent, task, business, session, version, template: templateForAgent(agent) };
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
      const recordingKey = mode === "mock" ? recordingForTask(task, pool) : null;
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
      const run: SessionRunOptions = runOptions ?? { fromSeq: 0, resume: null };
      const { agent, task, business, version, template } = await loadContext(input);
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
          durationMs: deps.clock.nowMs() - startedAtMs,
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
        await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "info", text: `Session ${run.resume ? "resumed" : "started"} for ${agent.name} on "${task.title}" (${where}${launch.fellBackFrom ? `, fell back from ${launch.fellBackFrom}` : ""}, ${launch.modelKey}).` });

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
        return settle(await runLiveSession(deps, recorder, { input, launch, task, agent, startedAtMs, run }, { business, version, template, briefText, resolveApiKey, sandboxEnv: env, acquireSandbox, pull }));
      } catch (err) {
        // `base()` carries the usage recorded so far: tokens already spent are booked whatever went wrong.
        const message = (err as Error).message ?? String(err);
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
    async finishSession(input: AgentSessionInput, launch: SessionLaunch, result: SessionResult): Promise<SessionFinish> {
      const { db } = deps;
      const task = await repos.tasks.get(db, input.businessId, input.taskId);
      const eventIds: string[] = [];
      const endedAt = deps.clock.now();
      const minutes = Math.max(1, Math.round(result.durationMs / 60_000));
      await bookUsage(db, input.businessId, { agentId: input.agentId, sessionId: input.sessionId, kind: "sandbox", quantity: minutes, unit: "minutes", costMinor: 0, billedTo: launch.modelBilling, occurredAt: endedAt, details: { sandboxMode: launch.sandboxMode, label: "Estimate", recording: launch.recordingKey } });
      if (result.tokensIn + result.tokensOut > 0 && launch.sandboxMode !== "mock") {
        // The SDK prices in USD (an Estimate). Settled against credits when the platform key ran the session
        // (`bookUsage` pauses the team on the last credit). A session on the platform key booked as it ran
        // (./session-credits): only the rest is booked here.
        const rest = await unbookedTokens(deps, input.businessId, input.sessionId, { tokens: result.tokensIn + result.tokensOut, costMinor: result.costMinor });
        if (rest.tokens > 0 || rest.costMinor > 0) await bookUsage(db, input.businessId, { agentId: input.agentId, sessionId: input.sessionId, kind: "tokens", modelKey: launch.modelKey, quantity: rest.tokens, unit: "tokens", costMinor: rest.costMinor, currency: "USD", billedTo: launch.modelBilling, occurredAt: endedAt, details: { source: "claude-agent-sdk", label: "Estimate" } });
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

      let taskStatus: TaskStatus;
      const cost = { amountMinor: Math.round(result.costMinor), currency: CREDITS_CURRENCY }; // model cost: US cents (DECISIONS 2026-10-12)
      switch (outcome) {
        case "done": {
          taskStatus = result.progress.merged ? "done" : result.progress.reviewPassed || result.progress.phase === "review" || result.progress.phase === "merge" ? "review" : "done";
          const ev = await emitEvent(db, {
            businessId: input.businessId,
            type: "task.completed",
            actor: { kind: "agent", id: agent.id },
            payload: { taskId: task.id, kind: task.kind, title: task.title, assigneeAgentId: agent.id, sessionId: input.sessionId, outcome: result.progress.progress >= 0.999 ? "success" : "partial", durationMs: Math.max(0, Math.round(result.durationMs)), cost, acceptanceTestsPassing: result.progress.acceptanceTestsPassing, acceptanceTests: result.progress.acceptanceTests, prNumber: result.prNumber, branch: launch.branch, summary: result.summary.slice(0, 2000) },
          });
          eventIds.push(ev.id);
          break;
        }
        case "blocked": {
          taskStatus = "blocked";
          const ev = await emitEvent(db, {
            businessId: input.businessId,
            type: "task.blocked",
            actor: { kind: "agent", id: agent.id },
            payload: { taskId: task.id, kind: task.kind, title: task.title, assigneeAgentId: agent.id, sessionId: input.sessionId, reason: result.blockedReason ?? "error", detail: (result.reason ?? "blocked").slice(0, 2000), approvalId: result.approvalId, occurrence: 1 },
          });
          eventIds.push(ev.id);
          break;
        }
        case "failed": {
          taskStatus = "failed";
          const ev = await emitEvent(db, {
            businessId: input.businessId,
            type: "task.blocked",
            actor: { kind: "agent", id: agent.id },
            payload: { taskId: task.id, kind: task.kind, title: task.title, assigneeAgentId: agent.id, sessionId: input.sessionId, reason: result.blockedReason ?? "error", detail: (result.reason ?? "failed").slice(0, 2000), approvalId: null, occurrence: 1 },
          });
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
          payload: { agentId: agent.id, from, to, reason: result.blockedReason === "loop_detected" ? "loop detected: the same call repeated three times" : result.outcome === "failed" ? `session failed: ${(result.reason ?? "error").slice(0, 200)}` : `session ${result.outcome}`, signals: { loopDetected: result.blockedReason === "loop_detected", errorRate: result.toolCalls > 0 ? Math.min(1, result.toolFailures / result.toolCalls) : null }, sessionId: input.sessionId },
        });
        eventIds.push(ev.id);
        healthChanged = true;
      }
      await repos.audit.append(db, input.businessId, { actorKind: "agent", actorId: agent.id, action: "session.finish", target: { kind: "session", id: input.sessionId }, details: { outcome: result.outcome, reason: result.reason, taskStatus, progress: result.progress.progress, toolCalls: result.toolCalls, costMinor: Math.round(result.costMinor) } });
      return { taskStatus, eventIds, healthChanged };
    },

    /** Deliver a signal to the running session (pause / resume / shout / stop / decision). */
    async postSessionCommand(input: { sessionId: string; command: SessionCommand }): Promise<void> {
      await deps.control.post(input.sessionId, input.command);
    },
  };
}

export type SessionActivities = ReturnType<typeof createSessionActivities>;

// ---------------------------------------------------------------------------------------------------------------------
// Mock runner (packages/sandbox replay)
// ---------------------------------------------------------------------------------------------------------------------

/** A parked runner's half of `SessionParked`; runAgentSession adds the number of the last command its feed read. */
type RunnerParked = Omit<SessionParked, "lastSeq">;

type RunOutcome = Pick<SessionResult, "outcome" | "reason" | "blockedReason" | "approvalId" | "summary" | "providerSessionId"> & Partial<Pick<SessionResult, "tokensIn" | "tokensOut" | "costMinor">> & { parked?: RunnerParked };

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

  const onCancel = () => {
    stoppedBy = { reason: CANCELLED_REASON, by: null };
    replay.stop(CANCELLED_REASON);
  };
  signal?.addEventListener("abort", onCancel, { once: true });
  const loop = controlLoop(deps, input.sessionId, tick, () => recorder.heartbeatDetails({ status: replay.status, paused }));

  try {
    const summary = await replay.play();
    await loop.flush();
    const stop = stoppedBy as { reason: string; by: string | null } | null;
    const end = ending as MockEnding | null;
    if (loopTripped) return { outcome: "failed", reason: "loop detected: the same call repeated three times", blockedReason: "loop_detected", approvalId: null, summary: `Stopped after a detected loop (${recorder.loop.loopDetected?.signature.slice(0, 120) ?? "repeated call"}).`, providerSessionId: summary.recordingKey };
    if (stop) return { outcome: "stopped", reason: stop.reason, blockedReason: "stopped", approvalId: null, summary: `Stopped: ${stop.reason}.`, providerSessionId: summary.recordingKey };
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
    signal?.removeEventListener("abort", onCancel);
    unsubscribe();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Live runner (Claude Agent SDK)
// ---------------------------------------------------------------------------------------------------------------------

interface LiveContext {
  business: { id: string; name: string; glossary: Record<string, string>; modelBilling: "byok" | "credits" };
  version: AgentVersion | null;
  template: AgentTemplate;
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

/** Why a live run ends before the agent is done: Stop or a cancel, a detected loop, a park, an undecided approval, or used-up credits. */
type LiveEnding = "stop" | "loop" | "park" | "approval_timeout" | "budget";

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
export function classifyTurnEnd(result: SdkTurnResult, apiError: { kind: string | null; text: string } | null, keySource: "byok" | "platform" | "none"): TurnFailure | null {
  // The SDK stopped at the `maxBudgetUsd` a session on the platform key is given (./session-credits): used-up credits.
  if (result.subtype === "error_max_budget_usd") return { outcome: "blocked", blockedReason: "budget", reason: "model budget exhausted: the session spent the credits it was given", summary: CREDITS_USED_UP_SUMMARY };
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
  // Everything that can fail without a workspace runs before one exists (no restored code left on disk, no token).
  const systemPrompt = buildSystemPrompt({ businessName: live.business.name, appName: APP_NAME, template: { instructions: instructionsFor(live.version, live.template), description: live.template.description }, brief: live.briefText ?? undefined, glossary: live.business.glossary });
  if (!hasClubRulesPrefix(systemPrompt)) throw new Error("house rules missing from the system prompt");
  const policy = sdkToolPolicyFor(task.kind, grants.mcpTools);
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  // SEC-3: the SDK process lives in a private per-session workspace (cwd, HOME, TMPDIR), with a from-scratch environment
  // (never `process.env`), built-in tools by task kind only, and a path guard on every file-tool call. Deleted in `finally`.
  const cwd = await createSessionWorkspace(deps.env.ORCHESTRATOR_WORKSPACE_DIR, input.sessionId);
  // Code tasks pick up where the last session on the task left off (Development › Code keeps every session's files).
  // Restore comes before the token: what the files mention is untrusted for the gateway from the session's first call.
  let restored: RestoredWorkspace | null = null;
  let restoreFailed = false;
  let token: Awaited<ReturnType<typeof deps.gateway.mintSessionToken>>;
  try {
    if (policy.fileTools) {
      try {
        restored = await restoreWorkspace(deps.db, input.businessId, task.id, cwd);
        if (restored.files > 0) await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "info", text: `Restored ${restored.files} file${restored.files === 1 ? "" : "s"} (${Math.ceil(restored.bytes / 1024)} KB) saved by an earlier session on this task.` });
      } catch (err) {
        // Start clean rather than from a partial copy; the save at the end keeps the files this session never had.
        restoreFailed = true;
        restored = null;
        await createSessionWorkspace(deps.env.ORCHESTRATOR_WORKSPACE_DIR, input.sessionId);
        deps.log.warn({ err: (err as Error).message, sessionId: input.sessionId }, "workspace restore failed");
        await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "warn", text: "The code saved for this task could not be restored; this session starts from an empty workspace, and the saved files are kept." });
      }
    }
    token = await deps.gateway.mintSessionToken({ businessId: input.businessId, agentId: agent.id, sessionId: input.sessionId, allowedTools: grants.toolRefs, ttlSeconds: SESSION_TOKEN_TTL_SECONDS, ...(restored && restored.files > 0 ? { untrusted: restored.recipients } : {}) });
  } catch (err) {
    await removeSessionWorkspace(cwd).catch(() => undefined);
    throw err;
  }
  // One server per connector the gateway serves for these grants; a connector of a later phase gets none (it would 404).
  const mcpServers = Object.fromEntries(grants.servers.map((key) => [key, { type: "http" as const, url: deps.gateway.mcpUrl(key), headers: deps.gateway.sessionHeaders(token.token) }]));

  const continuing = restored && restored.files > 0 ? restoredWorkspaceNote(restored.files) : "";
  const resumed = ctx.run.resume ? "This session was paused for a while and has been resumed. Continue the task from where the work stands." : "";
  const taskPrompt = [`# Task: ${task.title}`, task.goalMd || "", Array.isArray(task.acceptance) && task.acceptance.length ? `## Acceptance criteria\n${task.acceptance.map((a) => `- ${typeof a === "string" ? a : JSON.stringify(a)}`).join("\n")}` : "", policy.fileTools ? `Work on branch ${launch.branch} inside your working directory; it is the only place you can read or write files.` : "Keep every action inside the tools you were given; this task has no file access.", continuing, resumed, "Report each phase change and keep every external action inside the tools you were given."].filter(Boolean).join("\n\n");

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
  const usageNow = () => {
    const u = recorder.usage.totals();
    return { tokensIn: u.tokensIn, tokensOut: u.tokensOut, costMinor: Math.round(u.costMinor) };
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
        if (c.kind === "shout") await recorder.publishRaw({ kind: "note", at, source: "shout", text: c.message.slice(0, 4000) });
        else await recorder.markApprovalResolved(c.approvalId, c.outcome, c.by ?? null);
        if (ending === "park") carry.push(c);
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

  const loop = controlLoop(deps, input.sessionId, tick, () => recorder.heartbeatDetails({ paused }));
  const cancel = cancellation();
  const onCancel = () => {
    stoppedBy = { reason: CANCELLED_REASON };
    void end("stop");
  };
  cancel?.addEventListener("abort", onCancel, { once: true });

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
        // On the platform key the SDK itself stops past what the credits allowed at launch (SEC2 S2).
        ...(credits ? { maxBudgetUsd: credits.maxBudgetUsd } : {}),
        cwd,
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
              const { loop: looped } = await recorder.publish({ kind: "tool_call", at: deps.clock.now().toISOString(), callId: block.id, connectorKey, tool, status: "started", argsSummary: summariseArgs(block.input) });
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
            const failure = classifyTurnEnd(message, apiError, key.source);
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
      return { outcome: "failed", reason: "loop detected: the same tool call repeated three times", blockedReason: "loop_detected", approvalId: null, summary: "Stopped after a detected loop.", providerSessionId: sdkSessionId, ...usageNow() };
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
    if (how === "park") {
      holdBack = "the session is paused";
      // A poll still in flight applies what it read first: the carry and the last command number read must agree, or
      // the workflow would neither hand that nudge to the next run nor send it again.
      await loop.stop();
      return { outcome: "stopped", reason: "paused", blockedReason: "stopped", approvalId: null, summary: "Paused; the session continues on Resume.", providerSessionId: sdkSessionId, parked: { cursor: null, carry: carriedOver(carry) }, ...usageNow() };
    }
    holdBack = null;
    if (how === "approval_timeout") return { outcome: "blocked", reason: `no decision on the approval within ${minutesText(waits.approvalMs)}`, blockedReason: "awaiting_approval", approvalId: recorder.pendingApprovalId, summary: "Blocked on an approval.", providerSessionId: sdkSessionId, ...usageNow() };
    // Acceptance tests run inside a sandbox, never on the orchestrator host, on a copy of the agent's workspace.
    const acceptanceCommand = acceptanceCommandFor(task);
    if (acceptanceCommand) await runAcceptance(deps, recorder, live.acquireSandbox, cwd, acceptanceCommand);
    if (recorder.pendingApprovalId) return { outcome: "blocked", reason: "waiting for the founder's approval", blockedReason: "awaiting_approval", approvalId: recorder.pendingApprovalId, summary: "Blocked on an approval.", providerSessionId: sdkSessionId, ...usageNow() };
    return { outcome: "done", reason: null, blockedReason: null, approvalId: null, summary: `${agent.name} finished "${task.title}" with ${recorder.toolCalls} tool calls.`, providerSessionId: sdkSessionId, ...usageNow() };
  } finally {
    await loop.stop();
    if (abortTimer) clearTimeout(abortTimer);
    cancel?.removeEventListener("abort", onCancel);
    openGate();
    queue.close(true);
    // Keep the code whatever the outcome (done, stopped, failed, parked): the workspace itself is deleted next. Only a
    // session that finished (or waits on an approval) is pushed to GitHub.
    if (policy.fileTools) await keepWorkspace(deps, recorder, { businessId: input.businessId, taskId: task.id, sessionId: input.sessionId, agentId: agent.id, branch: launch.branch, agentName: agent.name, holdBack }, cwd, { secrets: [key.apiKey, token.token], carryOver: restoreFailed });
    try {
      await removeSessionWorkspace(cwd);
    } catch (err) {
      deps.log.warn({ err: (err as Error).message, sessionId: input.sessionId }, "session workspace cleanup failed");
    }
  }
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
      await recorder.publishRaw({ kind: "note", at: at(), source: "system", level: "info", text: `Saved this task's code: ${saved.files} file${saved.files === 1 ? "" : "s"} (${Math.ceil(saved.bytes / 1024)} KB)${delta ? `, ${delta}` : ""}. Development › Code shows it.` });
    }
    if (leftOut) await recorder.publishRaw({ kind: "note", at: at(), source: "system", level: "warn", text: leftOut });
    if (saved.status !== "refused" && saved.snapshot) {
      const pushed = describePush(await pushWorkspace(deps.db, deps.gateway, owner, saved.snapshot));
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
 * project's dependencies. Every other kind gets none. Gateway tools run on the host through MCP, not in the sandbox.
 */
export const ACCEPTANCE_EGRESS: readonly string[] = ["registry.npmjs.org"];

export function sandboxEgressFor(task: Pick<Task, "kind">): string[] {
  return task.kind === "code" ? [...ACCEPTANCE_EGRESS] : [];
}

/** pnpm for the acceptance run; E2B's base template ships Node and npm but not pnpm. */
export const SANDBOX_PNPM = "pnpm@10";
/** Bytes of a phase's output that come back to the orchestrator; the rest stays in a log inside the sandbox. */
export const ACCEPTANCE_OUTPUT_TAIL_BYTES = 32 * 1024;
const PNPM_SAFE_FLAGS = "--config.manage-package-manager-versions=false --config.package-manager-strict=false";

/** Run `lines` under `set -e` with their output in a log inside the sandbox, print only its tail, keep the exit code. */
function withOutputTail(log: string, lines: string[]): string {
  return ["(", "set -e", ...lines, `) >${log} 2>&1`, "rc=$?", `tail -c ${ACCEPTANCE_OUTPUT_TAIL_BYTES} ${log}`, "exit $rc"].join("\n");
}

/**
 * Phase 1, online (the registry is reachable): put pnpm on PATH and install the project's dependencies with every
 * lifecycle script and pnpmfile off, so no code the agent controls runs while the sandbox can reach the network.
 * pnpm's own settings that could fetch or switch package managers are pinned on the command line, which outranks
 * a project `.npmrc`, and in the sandbox user's global config for the offline phase.
 */
export function acceptancePrepareScript(): string {
  return withOutputTail("/tmp/fm-acceptance-prepare.log", [
    'export PATH="$HOME/.fm-tools/bin:$PATH"',
    `command -v pnpm >/dev/null 2>&1 || (cd "$HOME" && npm install --global --prefix "$HOME/.fm-tools" --ignore-scripts --no-fund --no-audit --loglevel=error ${SANDBOX_PNPM})`,
    '(cd "$HOME" && pnpm config set --location=global manage-package-manager-versions false && pnpm config set --location=global package-manager-strict false) >/dev/null',
    `if [ -f package.json ]; then pnpm install --no-frozen-lockfile --ignore-scripts --ignore-pnpmfile ${PNPM_SAFE_FLAGS} --reporter=append-only; fi`,
  ]);
}

/**
 * Phase 2, offline (after `closeEgress()`): run the dependencies' allowed build scripts, then the task's command. This
 * is where the agent's code runs, with no network at all.
 */
export function acceptanceRunScript(command: string): string {
  return withOutputTail("/tmp/fm-acceptance.log", [
    'export PATH="$HOME/.fm-tools/bin:$PATH"',
    `if [ -f package.json ]; then pnpm rebuild ${PNPM_SAFE_FLAGS} >/dev/null 2>&1 || echo "(some dependency build scripts failed offline)"; fi`,
    command,
  ]);
}

/** Text from the sandbox for a session note: credential-shaped values masked, host paths gone, within the note limit. */
function sandboxOutputForNote(output: string, max = 1500): string {
  return redactCredentialValues(output.trim()).slice(-max) || "(no output)";
}

/**
 * Copy the workspace into the sandbox, install dependencies online, close the network, run the acceptance command
 * offline and publish the `test_result`. Every failure ends as a failed acceptance result with its reason; none of them
 * fails the session.
 */
async function runAcceptance(deps: OrchestratorDeps, recorder: SessionRecorder, acquireSandbox: () => Promise<Sandbox>, cwd: string, command: string): Promise<void> {
  const at = () => deps.clock.now().toISOString();
  const failed = async (reason: string, durationMs = 0) => {
    await recorder.publish({ kind: "test_result", at: at(), suite: "acceptance", command, passed: 0, failed: 1, skipped: 0, durationMs, acceptance: true, failures: [reason.slice(0, 300)] });
  };

  // The sandbox exists for this run only (SANDBOX_TTL_MINUTES), so a long session never outlives its sandbox.
  let sandbox: Sandbox;
  try {
    sandbox = await acquireSandbox();
  } catch (err) {
    await recorder.publishRaw({ kind: "note", at: at(), source: "system", level: "warn", text: `Acceptance tests not run: the sandbox could not be started (${redactCredentialValues(String((err as Error).message ?? err)).slice(0, 300)}).` });
    return failed("Sandbox could not be started");
  }
  try {
    await runAcceptanceIn(deps, recorder, sandbox, cwd, command, failed);
  } finally {
    await sandbox.stop().catch(() => undefined);
  }
}

async function runAcceptanceIn(deps: OrchestratorDeps, recorder: SessionRecorder, sandbox: Sandbox, cwd: string, command: string, failed: (reason: string, durationMs?: number) => Promise<void>): Promise<void> {
  const at = () => deps.clock.now().toISOString();
  let synced: Awaited<ReturnType<typeof syncWorkspaceToSandbox>>;
  try {
    synced = await syncWorkspaceToSandbox(cwd, sandbox);
  } catch (err) {
    const reason = String((err as Error).message ?? err).split(cwd).join("<workspace>");
    await recorder.publishRaw({ kind: "note", at: at(), source: "system", level: "warn", text: `Acceptance tests not run: the workspace could not be copied into the sandbox (${reason.slice(0, 300)}).` });
    return failed("Workspace not copied to the sandbox");
  }
  if (synced.refused) {
    await recorder.publishRaw({ kind: "note", at: at(), source: "system", level: "warn", text: `Acceptance tests not run: ${synced.refused}.` });
    return failed(`Workspace not copied to the sandbox: ${synced.refused}`);
  }
  await recorder.publishRaw({ kind: "note", at: at(), source: "system", level: "info", text: `Copied ${synced.files} file${synced.files === 1 ? "" : "s"} (${Math.ceil(synced.bytes / 1024)} KB) into the sandbox for the acceptance tests.` });

  const prep = await sandbox.exec(acceptancePrepareScript(), { timeoutMs: ACCEPTANCE_PREPARE_TIMEOUT_MS });
  if (prep.code !== 0) {
    await recorder.publishRaw({ kind: "note", at: at(), source: "agent", level: "warn", text: `Installing the project's dependencies failed (exit ${prep.code}${prep.timedOut ? ", timed out" : ""}):\n${sandboxOutputForNote(prep.stdout + prep.stderr)}` });
    return failed("Dependency install failed", prep.durationMs);
  }
  try {
    await sandbox.closeEgress();
  } catch (err) {
    await recorder.publishRaw({ kind: "note", at: at(), source: "system", level: "error", text: `Acceptance tests not run: the sandbox's network could not be closed (${String((err as Error).message ?? err).slice(0, 200)}).` });
    return failed("Sandbox network could not be closed; tests not run");
  }

  const res = await sandbox.exec(acceptanceRunScript(command), { timeoutMs: ACCEPTANCE_RUN_TIMEOUT_MS });
  const output = res.stdout + res.stderr;
  const counts = parseTestCounts(output);
  // The output comes from the task's own scripts, so it is shown as the agent's, never as a system message.
  if (res.code !== 0) await recorder.publishRaw({ kind: "note", at: at(), source: "agent", level: "warn", text: `Acceptance run exited with code ${res.code}${res.timedOut ? " (timed out)" : ""}. Last output:\n${sandboxOutputForNote(output)}` });
  await recorder.publish({ kind: "test_result", at: at(), suite: "acceptance", command, passed: counts.passed, failed: res.code === 0 ? counts.failed : Math.max(1, counts.failed), skipped: 0, durationMs: prep.durationMs + res.durationMs, acceptance: true, failures: [] });
}

export function acceptanceCommandFor(task: Pick<Task, "acceptance" | "kind">): string | null {
  if (task.kind !== "code") return null;
  for (const a of task.acceptance) {
    if (a && typeof a === "object" && typeof (a as { command?: unknown }).command === "string") return (a as { command: string }).command;
  }
  return "pnpm test";
}

/** Parse "N passed, M failed" style summaries (vitest / jest / pytest). */
export function parseTestCounts(output: string): { passed: number; failed: number } {
  const passed = /(\d+)\s+passed/i.exec(output);
  const failed = /(\d+)\s+failed/i.exec(output);
  return { passed: passed ? Number(passed[1]) : 0, failed: failed ? Number(failed[1]) : 0 };
}

export type { ModelKey };
