/**
 * agentSession activities (BUILD §9.3, §9.4, §11.6; ARCHITECTURE §10).
 *
 * `prepareSession` validates the launch (agent version, task, sandbox runner, model route, credential hygiene) and
 * returns only non-secret facts. `runAgentSession` is the long-running activity: in live mode it drives the Claude
 * Agent SDK (`query()`) with the club-rules system prompt, the version's MCP tools served by the gateway and a
 * short-lived session token; in mock mode it replays a recorded session through packages/sandbox. Both stream
 * `SessionEvent`s to `as:{sessionId}`, heartbeat on every event, persist progress, create approval rows when a tool
 * call waits for the founder, write the usage ledger and fail the session when the same tool call repeats three times.
 * `finishSession` settles the task, the agent and the events.
 *
 * The live SDK process is confined by ./sdk-isolation (SECURITY_REVIEW SEC-3): from-scratch environment, private
 * per-session workspace deleted in `finally`, built-in tools by task kind and a path guard on every file-tool call.
 * A code task's acceptance tests run in the sandbox on a copy of that workspace (./workspace-sync): dependencies install
 * while the npm registry is reachable, with every script off; then the network closes and the agent's code runs offline.
 */
import { AgentInstructions, buildSystemPrompt, getTemplate, getTemplateByAgentType, hasClubRulesPrefix, listTemplates, restoredWorkspaceNote, ToolGrant, type AgentTemplate } from "@foundmill/agents";
import { APP_NAME } from "@foundmill/config";
import { repos, type Agent, type AgentVersion, type Task } from "@foundmill/db";
import { publishSessionEvent, type SessionEventInput } from "@foundmill/events";
import { resolveModel, type RouteKey } from "@foundmill/models";
import { assertNoLongLivedCredentials, MockSandbox, MockSandboxProvider, RECORDINGS, redactCredentialValues, stableHash32, type Sandbox } from "@foundmill/sandbox";
import { buildAad, decryptText, type AgentStatus, type ModelKey, type TaskStatus } from "@foundmill/shared";
import { Context } from "@temporalio/activity";
import { z } from "zod";
import type { SessionCommand } from "../control-bus";
import type { OrchestratorDeps } from "../deps";
import { emitEvent, systemActor } from "../events";
import { applySessionEvent, initialProgress, type ProgressState } from "../progress";
import { LoopDetector } from "./loop";
import { createSessionWorkspace, guardToolCall, hookOutputFor, removeSessionWorkspace, sdkEnvFor, sdkToolPolicyFor } from "./sdk-isolation";
import { restoreWorkspace, saveWorkspace, type LeftOut, type RestoredWorkspace, type SaveWorkspaceOptions } from "./workspace-store";
import { syncWorkspaceToSandbox } from "./workspace-sync";
import type { AgentSessionInput, SessionFinish, SessionLaunch, SessionResult } from "./types";

const ToolGrants = z.array(ToolGrant);
const CONTROL_POLL_MS = 250;
const DEFAULT_MAX_TURNS = 60;
const SESSION_TOKEN_TTL_SECONDS = 4 * 60 * 60;

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
 * Tool names as the gateway accepts them in a session token (`connector:tool`, `[a-zA-Z][a-zA-Z0-9_]*`). The agent
 * templates spell some tools with dots (`tasks.list`, `git.commit`); those become underscores here so the token mints.
 * The vocabulary gap between packages/agents tool names and packages/connectors tool names is an open issue.
 */
export const gatewayToolName = (tool: string): string => (tool === "*" ? "*" : tool.replace(/[^A-Za-z0-9_]/g, "_"));

export function toolRefs(grants: readonly { connectorKey: string; tools: readonly string[] }[]): string[] {
  const out = new Set<string>();
  for (const g of grants) for (const t of g.tools) out.add(`${g.connectorKey}:${gatewayToolName(t)}`);
  return [...out];
}

/** MCP tool names the SDK sees for the gateway servers: `mcp__<connector>__<tool>`. */
export function mcpToolNames(grants: readonly { connectorKey: string; tools: readonly string[] }[]): string[] {
  const out = new Set<string>();
  for (const g of grants) for (const t of g.tools) out.add(t === "*" ? `mcp__${g.connectorKey}` : `mcp__${g.connectorKey}__${gatewayToolName(t)}`);
  return [...out];
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

const summariseArgs = (args: unknown): string => {
  const s = typeof args === "string" ? args : JSON.stringify(args ?? {});
  return s.length > 480 ? `${s.slice(0, 477)}...` : s;
};

interface RunnerContext {
  input: AgentSessionInput;
  launch: SessionLaunch;
  task: Task;
  agent: Agent;
  startedAtMs: number;
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
  prNumber: number | null = null;
  lastPersisted = -1;
  lastPhase: string | null = null;
  private seq = 0;

  constructor(
    private readonly deps: OrchestratorDeps,
    private readonly ctx: RunnerContext,
  ) {
    this.progress = initialProgress({ planSteps: ctx.launch.planSteps, acceptanceTests: ctx.launch.acceptanceTests });
  }

  nextCallId(): string {
    this.seq += 1;
    return `${this.ctx.input.sessionId.slice(0, 8)}-${this.seq}`;
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
    heartbeat({ sessionId: ctx.input.sessionId, events: this.eventsEmitted, progress: this.progress.progress });

    if (full.kind === "tool_call") {
      if (full.status === "started") this.toolCalls += 1;
      if (full.status === "failed" || full.status === "denied") this.toolFailures += 1;
      if (full.status === "succeeded" && /merge_pr|merge_pull_request/i.test(full.tool)) {
        const m = /#?(\d{1,6})/.exec(full.resultSummary ?? "");
        if (m) this.prNumber = Number(m[1]);
      }
      if (full.status === "awaiting_approval") await this.openApproval(full);
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

  /** A tool call is waiting for the founder: create the approvals row and the `approval.requested` event. */
  private async openApproval(call: Extract<SessionEventInput, { kind: "tool_call" }>): Promise<void> {
    const { deps, ctx } = this;
    const key = call.approvalId ?? call.callId;
    if (this.approvalIds.has(key)) return;
    try {
      const approval = await repos.approvals.create(deps.db, ctx.input.businessId, {
        agentId: ctx.agent.id,
        sessionId: ctx.input.sessionId,
        connectorKey: call.connectorKey ?? "platform",
        tool: call.tool,
        args: { summary: call.argsSummary ?? "" },
        reasons: [call.resultSummary ?? "policy asked for the founder's approval"],
      });
      this.approvalIds.set(key, approval.id);
      this.approvalIdsReverse.set(approval.id, key);
      this.pendingApprovalId = approval.id;
      await emitEvent(deps.db, {
        businessId: ctx.input.businessId,
        type: "approval.requested",
        actor: { kind: "agent", id: ctx.agent.id },
        payload: { approvalId: approval.id, agentId: ctx.agent.id, sessionId: ctx.input.sessionId, connectorKey: call.connectorKey ?? "platform", tool: call.tool, amount: null, reasons: [call.resultSummary ?? "policy outcome: ask"], policyIds: [], hardGate: false, summary: `${ctx.agent.name} wants to call ${call.connectorKey ?? "platform"}.${call.tool}: ${call.argsSummary || "no arguments"}`.slice(0, 1000) },
      });
    } catch (err) {
      deps.log.warn({ err: (err as Error).message }, "approval row creation failed");
    }
  }

  async markApprovalResolved(approvalId: string, outcome: "approved" | "rejected", by: string | null): Promise<void> {
    const { deps, ctx } = this;
    try {
      const approval = await repos.approvals.get(deps.db, ctx.input.businessId, approvalId);
      if (approval.outcome === null) {
        await repos.approvals.resolve(deps.db, ctx.input.businessId, approvalId, { outcome, byKind: by ? "user" : "system", byId: by });
        await emitEvent(deps.db, {
          businessId: ctx.input.businessId,
          type: "approval.resolved",
          actor: by ? { kind: "user", id: by } : systemActor,
          payload: { approvalId, agentId: ctx.agent.id, outcome, resolvedBy: by ? { kind: "user", id: by } : systemActor, note: null, latencyMs: Math.max(0, deps.clock.nowMs() - new Date(approval.createdAt).getTime()) },
        });
      }
    } catch (err) {
      deps.log.warn({ err: (err as Error).message }, "approval resolution bookkeeping failed");
    }
    if (this.pendingApprovalId === approvalId) this.pendingApprovalId = null;
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

  async function resolveApiKey(businessId: string, billing: "byok" | "credits"): Promise<{ apiKey: string | null; source: "byok" | "platform" | "none" }> {
    if (billing === "byok" && deps.vault) {
      try {
        const integration = await repos.integrations.getByKey(deps.db, businessId, "anthropic");
        if (integration) {
          const loaded = await repos.credentials.latest(deps.db, businessId, integration.id);
          if (loaded) {
            const text = await decryptText(deps.vault, loaded.record, buildAad(businessId, "credentials", loaded.meta.id));
            return { apiKey: text, source: "byok" };
          }
        }
      } catch (err) {
        deps.log.warn({ err: (err as Error).message }, "BYOK key unavailable; falling back to the platform key");
      }
    }
    return deps.env.ANTHROPIC_API_KEY ? { apiKey: deps.env.ANTHROPIC_API_KEY, source: "platform" } : { apiKey: null, source: "none" };
  }

  return {
    /** Validate everything a session needs; returns non-secret launch facts only (tokens are minted inside the run). */
    async prepareSession(input: AgentSessionInput): Promise<SessionLaunch> {
      const { agent, task, business, version, template } = await loadContext(input);
      if (agent.status === "paused") throw new Error(`Agent ${agent.name} is paused`);
      const grants = parseGrants(version, template);
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
        allowedTools: toolRefs(grants),
        mcpConnectors: [...new Set(grants.map((g) => g.connectorKey))],
        envNames: Object.keys(env),
        modelBilling: business.modelBilling,
        branch: `agent/${task.id}`,
        maxTurns: DEFAULT_MAX_TURNS,
        planSteps: recording?.planSteps ?? 0,
        acceptanceTests: recording?.acceptanceTests ?? acceptance,
      };
    },

    /** The session itself. Long-running; heartbeats on every event; honours pause/resume/shout/stop/decision commands. */
    async runAgentSession(input: AgentSessionInput, launch: SessionLaunch, briefText: string | null = null): Promise<SessionResult> {
      const { agent, task, business, version, template } = await loadContext(input);
      const startedAtMs = deps.clock.nowMs();
      const recorder = new SessionRecorder(deps, { input, launch, task, agent, startedAtMs });
      const signal = cancellation();
      await deps.control.clear(input.sessionId);
      const env = buildSandboxEnv({ businessId: input.businessId, agentId: agent.id, taskId: task.id, sessionId: input.sessionId, gatewayUrl: deps.gateway.baseUrl });

      const base = (): Omit<SessionResult, "outcome" | "reason" | "blockedReason" | "approvalId" | "summary" | "providerSessionId"> => ({
        progress: recorder.progress,
        eventsEmitted: recorder.eventsEmitted,
        toolCalls: recorder.toolCalls,
        toolFailures: recorder.toolFailures,
        tokensIn: 0,
        tokensOut: 0,
        costMinor: 0,
        durationMs: deps.clock.nowMs() - startedAtMs,
        prNumber: recorder.prNumber,
      });

      const { provider } = await deps.sandbox();
      let sandbox: Sandbox | null = null;
      try {
        sandbox = await provider.create({ businessId: input.businessId, taskId: task.id, sessionId: input.sessionId, agentId: agent.id, envShortLived: env, ttlMinutes: 240, egressAllowList: sandboxEgressFor(task), ...(launch.recordingKey ? { recording: launch.recordingKey } : {}) });
        await sandbox.start();
        await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "info", text: `Session started for ${agent.name} on "${task.title}" (${launch.sandboxMode} sandbox${launch.fellBackFrom ? `, fell back from ${launch.fellBackFrom}` : ""}, ${launch.modelKey}).` });

        if (sandbox instanceof MockSandbox) {
          const r = await runMockSession(deps, recorder, sandbox, input, signal);
          return { ...base(), ...r };
        }
        const r = await runLiveSession(deps, recorder, sandbox, { input, launch, task, agent, startedAtMs }, { business, version, template, briefText, resolveApiKey, sandboxEnv: env });
        return { ...base(), ...r };
      } catch (err) {
        const message = (err as Error).message ?? String(err);
        await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "error", text: `Session failed: ${message.slice(0, 500)}` });
        return { ...base(), outcome: "failed", reason: message.slice(0, 500), blockedReason: "error", approvalId: null, summary: `Failed: ${message.slice(0, 200)}`, providerSessionId: null };
      } finally {
        try {
          await sandbox?.stop();
        } catch {
          /* best effort */
        }
        await deps.control.clear(input.sessionId);
      }
    },

    /** Settle the session: agent_sessions row, usage ledger, task status, task events and the agent's health. */
    async finishSession(input: AgentSessionInput, launch: SessionLaunch, result: SessionResult): Promise<SessionFinish> {
      const { db } = deps;
      const [agent, task] = await Promise.all([repos.agents.get(db, input.businessId, input.agentId), repos.tasks.get(db, input.businessId, input.taskId)]);
      const eventIds: string[] = [];
      const endedAt = deps.clock.now();
      await repos.agents.endSession(db, input.businessId, input.sessionId, { endedAt, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costMinor: Math.round(result.costMinor), outcome: result.outcome, recordingRef: launch.recordingKey });
      const minutes = Math.max(1, Math.round(result.durationMs / 60_000));
      await repos.usage.record(db, input.businessId, { agentId: agent.id, sessionId: input.sessionId, kind: "sandbox", quantity: minutes, unit: "minutes", costMinor: 0, billedTo: launch.modelBilling, occurredAt: endedAt, details: { sandboxMode: launch.sandboxMode, label: "Estimate", recording: launch.recordingKey } });
      if (result.tokensIn + result.tokensOut > 0 && launch.sandboxMode !== "mock") {
        await repos.usage.record(db, input.businessId, { agentId: agent.id, sessionId: input.sessionId, kind: "tokens", modelKey: launch.modelKey, quantity: result.tokensIn + result.tokensOut, unit: "tokens", costMinor: Math.round(result.costMinor), billedTo: launch.modelBilling, occurredAt: endedAt, details: { source: "claude-agent-sdk", label: "Estimate" } });
      }

      let taskStatus: TaskStatus;
      const cost = { amountMinor: Math.round(result.costMinor), currency: task.currency ?? "EUR" };
      switch (result.outcome) {
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
          taskStatus = "stopped";
      }
      if (task.status !== taskStatus) await repos.tasks.setStatus(db, input.businessId, task.id, taskStatus, { force: true });
      if (taskStatus === "done") await repos.tasks.setProgress(db, input.businessId, task.id, { progress: Math.max(result.progress.progress, task.status === "done" ? 1 : result.progress.progress), phase: result.progress.phase ?? "done" });

      // Health: loops and failures mark the agent; a clean finish returns it to idle when nothing else is open.
      let healthChanged = false;
      const from: AgentStatus = agent.status;
      let to: AgentStatus = from;
      if (result.blockedReason === "loop_detected" || result.outcome === "failed") to = "failing";
      else if (result.outcome === "stopped" && from !== "paused") to = "idle";
      else if (result.outcome === "done" || result.outcome === "blocked") {
        const open = await repos.agents.listSessions(db, input.businessId, { agentId: agent.id, openOnly: true, limit: 1 });
        to = open.items.length > 0 ? "healthy" : "idle";
      }
      if (to !== from) {
        await repos.agents.setStatus(db, input.businessId, agent.id, to);
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

type RunOutcome = Pick<SessionResult, "outcome" | "reason" | "blockedReason" | "approvalId" | "summary" | "providerSessionId"> & Partial<Pick<SessionResult, "tokensIn" | "tokensOut" | "costMinor">>;

async function runMockSession(deps: OrchestratorDeps, recorder: SessionRecorder, sandbox: MockSandbox, input: AgentSessionInput, signal: AbortSignal | null): Promise<RunOutcome> {
  const replay = sandbox.replay;
  let loopTripped = false;
  let stoppedBy: { reason: string; by: string | null } | null = null;
  let paused = false;

  const unsubscribe = replay.subscribe(async (event) => {
    const { loop } = await recorder.publish(event);
    if (loop && !loopTripped) {
      loopTripped = true;
      replay.stop("loop_detected");
    }
  });

  const applyCommands = async () => {
    const commands = await deps.control.drain(input.sessionId);
    for (const c of commands) {
      const at = deps.clock.now().toISOString();
      switch (c.kind) {
        case "pause":
          replay.pause();
          paused = true;
          await recorder.publishRaw({ kind: "note", at, source: "system", level: "info", text: `Paused${c.by ? " by the founder" : ""}.` });
          break;
        case "resume":
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
    }
  };

  const onCancel = () => {
    stoppedBy = { reason: "cancelled", by: null };
    replay.stop("cancelled");
  };
  signal?.addEventListener("abort", onCancel, { once: true });
  const timer = setInterval(() => {
    heartbeat({ sessionId: input.sessionId, status: replay.status, paused });
    void applyCommands();
  }, CONTROL_POLL_MS);

  try {
    const summary = await replay.play();
    await applyCommands();
    const stop = stoppedBy as { reason: string; by: string | null } | null;
    if (loopTripped) return { outcome: "failed", reason: "loop detected: the same call repeated three times", blockedReason: "loop_detected", approvalId: null, summary: `Stopped after a detected loop (${recorder.loop.loopDetected?.signature.slice(0, 120) ?? "repeated call"}).`, providerSessionId: summary.recordingKey };
    if (stop) return { outcome: "stopped", reason: stop.reason, blockedReason: "stopped", approvalId: null, summary: `Stopped: ${stop.reason}.`, providerSessionId: summary.recordingKey };
    if (summary.outcome === "blocked") return { outcome: "blocked", reason: recorder.pendingApprovalId ? "waiting for the founder's approval" : "blocked by a dependency or approval", blockedReason: recorder.pendingApprovalId ? "awaiting_approval" : "dependency", approvalId: recorder.pendingApprovalId, summary: `Blocked after ${summary.emitted} events.`, providerSessionId: summary.recordingKey };
    if (summary.outcome === "failed") return { outcome: "failed", reason: summary.stoppedReason ?? "the recorded session failed", blockedReason: "error", approvalId: null, summary: `Failed after ${summary.emitted} events.`, providerSessionId: summary.recordingKey };
    if (summary.outcome === "stopped") return { outcome: "stopped", reason: summary.stoppedReason ?? "stopped", blockedReason: "stopped", approvalId: null, summary: "Stopped.", providerSessionId: summary.recordingKey };
    return { outcome: "done", reason: null, blockedReason: null, approvalId: null, summary: `${sandbox.recording.title}: ${sandbox.recording.summary}`.slice(0, 1800), providerSessionId: summary.recordingKey };
  } finally {
    clearInterval(timer);
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
}

/** A prompt queue the SDK consumes as streaming input: the task first, then every Shout as a user turn. */
class PromptQueue {
  private readonly items: string[] = [];
  private waiter: (() => void) | null = null;
  private closed = false;
  constructor(private readonly sessionId: string) {}
  push(text: string): void {
    this.items.push(text);
    this.waiter?.();
  }
  close(): void {
    this.closed = true;
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

async function runLiveSession(deps: OrchestratorDeps, recorder: SessionRecorder, sandbox: Sandbox, ctx: RunnerContext, live: LiveContext): Promise<RunOutcome> {
  const { input, launch, task, agent } = ctx;
  const key = await live.resolveApiKey(input.businessId, live.business.modelBilling);
  if (!key.apiKey) return { outcome: "blocked", reason: "no Anthropic key: connect one in Settings or set the platform key", blockedReason: "credential", approvalId: null, summary: "Blocked: no model credential.", providerSessionId: null };

  const grants = parseGrants(live.version, live.template);
  // Everything that can fail without a workspace runs before one exists (no restored code left on disk, no token).
  const systemPrompt = buildSystemPrompt({ businessName: live.business.name, appName: APP_NAME, template: { instructions: instructionsFor(live.version, live.template), description: live.template.description }, brief: live.briefText ?? undefined, glossary: live.business.glossary });
  if (!hasClubRulesPrefix(systemPrompt)) throw new Error("house rules missing from the system prompt");
  const policy = sdkToolPolicyFor(task.kind, mcpToolNames(grants));
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
    token = await deps.gateway.mintSessionToken({ businessId: input.businessId, agentId: agent.id, sessionId: input.sessionId, allowedTools: toolRefs(grants), ttlSeconds: SESSION_TOKEN_TTL_SECONDS, ...(restored && restored.files > 0 ? { untrusted: restored.recipients } : {}) });
  } catch (err) {
    await removeSessionWorkspace(cwd).catch(() => undefined);
    throw err;
  }
  const mcpServers = Object.fromEntries(grants.map((g) => [g.connectorKey, { type: "http" as const, url: deps.gateway.mcpUrl(g.connectorKey), headers: deps.gateway.sessionHeaders(token.token) }]));

  const continuing = restored && restored.files > 0 ? restoredWorkspaceNote(restored.files) : "";
  const taskPrompt = [`# Task: ${task.title}`, task.goalMd || "", Array.isArray(task.acceptance) && task.acceptance.length ? `## Acceptance criteria\n${task.acceptance.map((a) => `- ${typeof a === "string" ? a : JSON.stringify(a)}`).join("\n")}` : "", policy.fileTools ? `Work on branch ${launch.branch} inside your working directory; it is the only place you can read or write files.` : "Keep every action inside the tools you were given; this task has no file access.", continuing, "Report each phase change and keep every external action inside the tools you were given."].filter(Boolean).join("\n\n");

  const queue = new PromptQueue(input.sessionId);
  queue.push(taskPrompt);
  const abort = new AbortController();
  let paused = false;
  let stoppedBy: { reason: string } | null = null;
  let loopTripped = false;
  let sdkSessionId: string | null = null;
  let tokensIn = 0;
  let tokensOut = 0;
  let costUsdCents = 0;
  const openCalls = new Map<string, { tool: string; connectorKey: string | null; startedAt: number }>();

  const applyCommands = async () => {
    for (const c of await deps.control.drain(input.sessionId)) {
      const at = deps.clock.now().toISOString();
      if (c.kind === "shout") {
        queue.push(`Founder nudge: ${c.message}`);
        await recorder.publishRaw({ kind: "note", at, source: "shout", text: c.message.slice(0, 4000) });
      } else if (c.kind === "pause") {
        paused = true;
        await recorder.publishRaw({ kind: "note", at, source: "system", text: "Paused." });
      } else if (c.kind === "resume") {
        paused = false;
        await recorder.publishRaw({ kind: "note", at, source: "system", text: "Resumed." });
      } else if (c.kind === "stop") {
        stoppedBy = { reason: c.reason };
        queue.close();
        abort.abort();
      } else if (c.kind === "decision") {
        await recorder.markApprovalResolved(c.approvalId, c.outcome, c.by ?? null);
        queue.push(c.outcome === "approved" ? "The founder approved the pending action; continue." : "The founder rejected the pending action; do not retry it and continue with the rest of the task.");
      }
    }
  };
  const timer = setInterval(() => {
    heartbeat({ sessionId: input.sessionId, paused });
    void applyCommands();
  }, CONTROL_POLL_MS);
  const cancel = cancellation();
  const onCancel = () => {
    stoppedBy = { reason: "cancelled" };
    queue.close();
    abort.abort();
  };
  cancel?.addEventListener("abort", onCancel, { once: true });

  try {
    const env = sdkEnvFor({ cwd, apiKey: key.apiKey, sessionToken: token.token, sandboxEnv: live.sandboxEnv });
    const q = sdk.query({
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
              hooks: [
                async (hook) => {
                  if (hook.hook_event_name !== "PreToolUse") return { continue: true };
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
    for await (const message of q) {
      while (paused && !abort.signal.aborted) await deps.clock.sleep(CONTROL_POLL_MS);
      if (message.type === "system" && message.subtype === "init") sdkSessionId = message.session_id;
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "text" && block.text.trim()) await recorder.publish({ kind: "note", at: deps.clock.now().toISOString(), source: "agent", text: block.text.slice(0, 4000) });
          if (block.type === "tool_use") {
            const parts = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(block.name);
            const connectorKey = parts ? parts[1]! : null;
            const tool = parts ? parts[2]! : block.name;
            openCalls.set(block.id, { tool, connectorKey, startedAt: deps.clock.nowMs() });
            const { loop } = await recorder.publish({ kind: "tool_call", at: deps.clock.now().toISOString(), callId: block.id, connectorKey, tool, status: "started", argsSummary: summariseArgs(block.input) });
            if (loop) {
              loopTripped = true;
              queue.close();
              abort.abort();
            }
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
        for (const u of Object.values(message.modelUsage ?? {})) {
          tokensIn += u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens;
          tokensOut += u.outputTokens;
          costUsdCents += u.costUSD * 100;
        }
        const subtype: string = message.subtype;
        if (subtype !== "success" && !stoppedBy && !loopTripped) {
          const errors = ("errors" in message ? message.errors : [subtype]).join("; ");
          queue.close();
          await recorder.publishRaw({ kind: "note", at: deps.clock.now().toISOString(), source: "system", level: "error", text: `SDK ended with ${subtype}: ${errors.slice(0, 500)}` });
          return { outcome: "failed", reason: `${subtype}: ${errors}`.slice(0, 500), blockedReason: "error", approvalId: null, summary: "The agent run ended with an error.", providerSessionId: sdkSessionId, tokensIn, tokensOut, costMinor: Math.round(costUsdCents) };
        }
        if (!recorder.pendingApprovalId) queue.close();
      }
    }
    // Acceptance tests run inside the sandbox, never on the orchestrator host, on a copy of the agent's workspace.
    const acceptanceCommand = acceptanceCommandFor(task);
    if (acceptanceCommand) await runAcceptance(deps, recorder, sandbox, cwd, acceptanceCommand);
    const usage = { tokensIn, tokensOut, costMinor: Math.round(costUsdCents) };
    if (loopTripped) return { outcome: "failed", reason: "loop detected: the same tool call repeated three times", blockedReason: "loop_detected", approvalId: null, summary: "Stopped after a detected loop.", providerSessionId: sdkSessionId, ...usage };
    const stop = stoppedBy as { reason: string } | null;
    if (stop) return { outcome: "stopped", reason: stop.reason, blockedReason: "stopped", approvalId: null, summary: `Stopped: ${stop.reason}.`, providerSessionId: sdkSessionId, ...usage };
    if (recorder.pendingApprovalId) return { outcome: "blocked", reason: "waiting for the founder's approval", blockedReason: "awaiting_approval", approvalId: recorder.pendingApprovalId, summary: "Blocked on an approval.", providerSessionId: sdkSessionId, ...usage };
    return { outcome: "done", reason: null, blockedReason: null, approvalId: null, summary: `${agent.name} finished "${task.title}" with ${recorder.toolCalls} tool calls.`, providerSessionId: sdkSessionId, ...usage };
  } finally {
    clearInterval(timer);
    cancel?.removeEventListener("abort", onCancel);
    queue.close();
    // Keep the code whatever the outcome (done, stopped, failed): the workspace itself is deleted next.
    if (policy.fileTools) await keepWorkspace(deps, recorder, { businessId: input.businessId, taskId: task.id, sessionId: input.sessionId, agentId: agent.id, branch: launch.branch }, cwd, { secrets: [key.apiKey, token.token], carryOver: restoreFailed });
    try {
      await removeSessionWorkspace(cwd);
    } catch (err) {
      deps.log.warn({ err: (err as Error).message, sessionId: input.sessionId }, "session workspace cleanup failed");
    }
  }
}

/** Save the session's code to the task and say so in the session stream; a failure to save never fails the session. */
async function keepWorkspace(deps: OrchestratorDeps, recorder: SessionRecorder, owner: Parameters<typeof saveWorkspace>[1], cwd: string, options: SaveWorkspaceOptions): Promise<void> {
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
async function runAcceptance(deps: OrchestratorDeps, recorder: SessionRecorder, sandbox: Sandbox, cwd: string, command: string): Promise<void> {
  const at = () => deps.clock.now().toISOString();
  const failed = async (reason: string, durationMs = 0) => {
    await recorder.publish({ kind: "test_result", at: at(), suite: "acceptance", command, passed: 0, failed: 1, skipped: 0, durationMs, acceptance: true, failures: [reason.slice(0, 300)] });
  };

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

  const prep = await sandbox.exec(acceptancePrepareScript(), { timeoutMs: 10 * 60 * 1000 });
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

  const res = await sandbox.exec(acceptanceRunScript(command), { timeoutMs: 15 * 60 * 1000 });
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
