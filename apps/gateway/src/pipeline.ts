/**
 * The tool-call pipeline (BUILD §9.5, docs/ARCHITECTURE.md §9):
 *
 *   authenticate (done by the route) → scope check against the session token → load connector →
 *   rate limit → load business + agent and re-check their state (archived club, released or paused agent,
 *   revoked BYOK key: deny before Cedar, SEC-1) → build the Cedar request (agent attrs from repos.agents,
 *   tool hints from the connector, business mode + holiday, suppression + untrusted-recipient context) → evaluate →
 *     deny  → audit, 403 (a hard gate also queues an approval so the founder sees the task)
 *     ask   → the founder's approval of this very call runs it once (allow below); else the open approval of the same
 *             call, or a new approvals row + `approval.requested` + its Inbox decision item through the outbox; audit,
 *             return approvalId
 *     allow → decrypt credential in memory → connector.callTool → wrap untrusted content and remember
 *             its recipients for the session → meter into usage_ledger → audit → return
 *
 * `/v1/call` and `/mcp/:connector` both run this function; nothing reaches a vendor any other way.
 */
import { createHash } from "node:crypto";
import { effectiveApprovalThresholdMinor } from "@foundmill/config";
import { AppError, BUSINESS_MODES, NotFoundError, type BusinessMode } from "@foundmill/shared";
import type { Vault } from "@foundmill/shared/crypto";
import { bookUsage, codeRepositoryOf, openApprovalItem, repos, type Db, type Agent, type AppInstallation, type Business, type Integration } from "@foundmill/db";
import { evaluate, getPolicyEngine, type AgentAutonomy, type AgentCtxInput, type EvaluateInputInput, type EvaluateResult, type PolicyEngine, type ToolCtxInput } from "@foundmill/policy";
import {
  canonicalJson,
  isConfigError,
  isUntrusted,
  mockIntegrationRecord,
  readForQuarantine,
  toAgentEnvelope,
  type Connector,
  type ConnectorMode,
  type ConnectorRegistry,
  type HumanActionDescriptor,
  type IntegrationRecord,
  type McpToolDefinition,
  type ToolContext,
  type ToolLogger,
  type ToolResult,
} from "@foundmill/connectors";
import { loadCredential, toIntegrationRecord, type LoadedCredential } from "./credentials";
import { writeGatewayEvent } from "./events";
import { checkRateLimit, type RateLimitStore } from "./rate-limit";
import { candidatesFromArgs, candidatesFromContent, hashRecipient, type RecipientCandidate, type UntrustedRecipientRegistry } from "./recipients";
import { checkByokKey, SessionStateCache, stateDenial, type StateDenial } from "./state";
import { toolAllowed, toolRef, type SessionToken } from "./tokens";
import type { AllowResponse, AskResponse, CallRequestParsed, CallResponse, DenyResponse, RateLimitedResponse } from "./types";

export interface GatewayLogger extends ToolLogger {
  child?(bindings: Record<string, unknown>): GatewayLogger;
}

export interface GatewayDeps {
  db: Db;
  registry: ConnectorRegistry;
  /** `null` when no vault is configured: credentials cannot be decrypted and live connectors needing one fail with 503. */
  vault: Vault | null;
  mode: ConnectorMode;
  /** Connectors that run live while `mode` is mock (LIVE_CONNECTORS, e.g. GitHub before every other vendor). */
  liveConnectors?: readonly string[];
  rateLimits: RateLimitStore;
  recipients: UntrustedRecipientRegistry;
  log: GatewayLogger;
  now?: () => Date;
  policyEngine?: PolicyEngine;
  /** Per-session memo of the BYOK credential check (≤ 5 s). One is created per `deps` when omitted. */
  stateCache?: SessionStateCache;
}

const defaultStateCaches = new WeakMap<GatewayDeps, SessionStateCache>();
function stateCacheFor(deps: GatewayDeps): SessionStateCache {
  if (deps.stateCache) return deps.stateCache;
  let cache = defaultStateCaches.get(deps);
  if (!cache) {
    cache = new SessionStateCache();
    defaultStateCaches.set(deps, cache);
  }
  return cache;
}

export interface ToolCallResult {
  status: 200 | 403 | 429;
  body: CallResponse;
}

/** The mode one connector runs in for this gateway. */
export function modeFor(deps: Pick<GatewayDeps, "mode" | "liveConnectors">, connectorKey: string): ConnectorMode {
  return deps.mode === "live" || deps.liveConnectors?.includes(connectorKey) ? "live" : deps.mode;
}

/** Thrown for request errors that are not policy outcomes (unknown connector/tool, missing integration...). */
/**
 * A live App installation the gateway may mint tokens for: an integration that is connected (or degraded), not archived,
 * and names exactly the installation the gateway itself verified when the business connected it (`app_installations`,
 * which no app role can write). A row from mock mode, a disconnected or expired one, or one whose installation id was
 * written anywhere but through that check does not count, so a business can never reach another account's
 * repositories by editing its own integration.
 */
export function appInstallationVerified(row: Pick<Integration, "status" | "archivedAt" | "settings">, verified: Pick<AppInstallation, "installationId"> | null): boolean {
  if (!verified || row.archivedAt !== null || (row.status !== "connected" && row.status !== "degraded")) return false;
  const externalAccountId = ((row.settings ?? {}) as { externalAccountId?: unknown }).externalAccountId;
  return typeof externalAccountId === "string" && externalAccountId === verified.installationId;
}

/** Policy id on a call refused by the founder's GitHub push settings (audited like any deny). */
export const GITHUB_PUSH_SETTINGS_POLICY_ID = "github-push-settings";
/** GitHub tools that change a repository: held to the founder's push settings. */
const GITHUB_WRITE_TOOLS = new Set(["create_branch", "commit_files", "open_pr", "merge_pr"]);

/**
 * The founder's push settings, enforced here rather than trusted from the caller: a GitHub tool that changes a
 * repository works only on the repository chosen on Development › Code, only while pushing is turned on there, and
 * every commit `commit_files` makes says `[skip ci]`. (The tools themselves already refuse anything but `agent/`
 * branches of private repositories and `.git` / `.github`.) Reads are not affected. Returns the arguments to run with,
 * or why the call is refused.
 */
export function guardGithubWrite(tool: string, row: Integration | null, args: unknown): { args: unknown } | { reason: string } {
  if (!GITHUB_WRITE_TOOLS.has(tool)) return { args };
  const target = row ? codeRepositoryOf(row) : null;
  if (!target?.writeEnabled) return { reason: "Pushing to GitHub is not turned on for this business (Development › Code)" };
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  if (`${String(a.owner)}/${String(a.repo)}`.toLowerCase() !== target.fullName.toLowerCase()) return { reason: `Agents change only ${target.fullName}, the repository chosen on Development › Code` };
  if (tool !== "commit_files") return { args };
  const message = typeof a.message === "string" ? a.message.slice(0, 4_980) : "";
  return { args: { ...a, message: message.includes("[skip ci]") ? message : `${message}\n\n[skip ci]` } };
}

export class GatewayError extends AppError {
  constructor(code: string, message: string, status: number, details?: unknown) {
    super(code, message, status, details);
    this.name = "GatewayError";
  }
}

/** Thrown by `loadContext` when the club or the agent may not work (SEC-1); `executeToolCall` turns it into an audited 403. */
export class SessionStateDenied extends Error {
  constructor(readonly denial: StateDenial) {
    super(denial.reasons[0] ?? denial.policyId);
    this.name = "SessionStateDenied";
  }
}

export const SESSION_SCOPE_POLICY_ID = "session-scope";
export const HARD_GATE_POLICY_ID = "hard-gate";
export const AUDIT_ACTION_TOOL_CALL = "tool.call";
export { AGENT_ARCHIVED_POLICY_ID, AGENT_PAUSED_POLICY_ID, AGENTS_STOPPED_POLICY_ID, BUSINESS_ARCHIVED_POLICY_ID, KEY_REVOKED_POLICY_ID } from "./state";

/** Finance-module connectors: read-only in v1 (BUILD §11.8, AC-11.8.5). The policy forbids any of their tools that would spend. */
export const FINANCE_CONNECTORS: ReadonlySet<string> = new Set(["tink", "plaid", "ecb_rates"]);
/** Tools that create or amend a contract (assisted mode asks; signing itself is hard-gated by the connector). */
export const CONTRACT_TOOLS: ReadonlySet<string> = new Set(["dropbox_sign:send_signature_request"]);

/** `Tool.finance` / `Tool.contract` come from the gateway, not from `policyHints` (DECISIONS "Tool attributes beyond connector policyHints"). */
export function toolAttributes(connector: string, tool: string): { finance: boolean; contract: boolean } {
  return { finance: FINANCE_CONNECTORS.has(connector), contract: CONTRACT_TOOLS.has(toolRef(connector, tool)) };
}

const MODE_ORDER: readonly BusinessMode[] = ["augmented", "assisted", "automated"];

/** `agents.autonomy` (BUILD §9.2): `mode` is `inherit`, a business mode, or `lower` / `higher` relative to the business mode. */
export function agentAutonomy(agent: Pick<Agent, "autonomy">, businessMode: BusinessMode): { autonomy: AgentAutonomy; spendCapMinor?: number; approvalThresholdMinor?: number } {
  const raw = agent.autonomy ?? {};
  const mode = raw["mode"];
  let autonomy: AgentAutonomy = "inherit";
  if (typeof mode === "string") {
    if ((BUSINESS_MODES as readonly string[]).includes(mode)) autonomy = mode as BusinessMode;
    else if (mode === "lower" || mode === "higher") {
      const idx = MODE_ORDER.indexOf(businessMode);
      const next = MODE_ORDER[Math.min(MODE_ORDER.length - 1, Math.max(0, idx + (mode === "lower" ? -1 : 1)))];
      autonomy = next && next !== businessMode ? next : "inherit";
    }
  }
  const minor = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined);
  return { autonomy, spendCapMinor: minor(raw["spendCapMinor"]), approvalThresholdMinor: minor(raw["approvalThresholdMinor"]) };
}

/**
 * The approval threshold the Cedar request carries: the agent's own (the policy default when it has none), lowered to
 * the business's "Spend cap per action" when the founder set one (`businesses.spend_cap_minor`; DECISIONS 2026-10-05
 * "caps copied from the business"). Undefined leaves the policy default.
 */
export function businessApprovalThreshold(agentThresholdMinor: number | undefined, businessCapMinor: number | null): number | undefined {
  return effectiveApprovalThresholdMinor(agentThresholdMinor, businessCapMinor);
}

const argsHash = (args: unknown): string => createHash("sha256").update(canonical(args), "utf8").digest("hex").slice(0, 32);

function canonical(value: unknown): string {
  try {
    return canonicalJson(value) ?? "null";
  } catch {
    return "null";
  }
}

const argsSummary = (args: unknown): Record<string, unknown> => ({
  argsHash: argsHash(args ?? {}),
  argKeys: args && typeof args === "object" && !Array.isArray(args) ? Object.keys(args as object).slice(0, 40) : [],
});

const argsObject = (args: unknown): Record<string, unknown> => (args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : { value: args ?? null });

interface Loaded {
  connector: Connector;
  tool: McpToolDefinition;
  business: Business;
  agent: Agent;
  integrationRow: Integration | null;
  holidayActive: boolean;
  holidayBudgetMinor: number | null;
}

function findTool(connector: Connector, name: string): McpToolDefinition | undefined {
  return connector.tools.find((t) => t.name === name);
}

export async function executeToolCall(deps: GatewayDeps, session: SessionToken, req: CallRequestParsed): Promise<ToolCallResult> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log.child?.({ businessId: session.businessId, agentId: session.agentId, sessionId: session.sessionId, connector: req.connector, tool: req.tool }) ?? deps.log;
  const { businessId } = session;
  const ref = toolRef(req.connector, req.tool);
  const args = req.args ?? {};

  // 1. Session scope: a token only reaches the tools it was minted for (BUILD §9.3).
  if (!toolAllowed(session.allowedTools, req.connector, req.tool)) {
    const reasons = [`Tool ${ref} is not in this session's allowed tools`];
    const audit = await appendAudit(deps, session, req, { outcome: "deny", reasons, policyIds: [SESSION_SCOPE_POLICY_ID] });
    log.warn({ reasons }, "tool call outside session scope");
    return { status: 403, body: { outcome: "deny", reasons, policyIds: [SESSION_SCOPE_POLICY_ID], costMinor: 0, auditId: audit.id } };
  }

  // 2. Connector + tool.
  let connector: Connector;
  try {
    connector = deps.registry.get(req.connector, modeFor(deps, req.connector));
  } catch (e) {
    if (e instanceof NotFoundError) throw new GatewayError("unknown_connector", `Unknown connector "${req.connector}"`, 404, { connector: req.connector });
    throw e;
  }
  const tool = findTool(connector, req.tool);
  if (!tool) throw new GatewayError("unknown_tool", `${req.connector} has no tool "${req.tool}"`, 404, { connector: req.connector, tool: req.tool });

  // 3. Rate limit per connector per business.
  const limit = await checkRateLimit(deps.rateLimits, { businessId, connector: connector.key, limits: connector.rateLimits ?? {} }, now().getTime());
  if (!limit.allowed) {
    log.warn({ scope: limit.scope, limit: limit.limit }, "rate limited");
    const body: RateLimitedResponse = {
      outcome: "rate_limited",
      reasons: [`Rate limit for ${connector.key} reached (${limit.limit} per ${limit.scope}); retry in ${limit.retryAfterSeconds}s`],
      retryAfterSeconds: limit.retryAfterSeconds,
      limit: limit.limit,
      scope: limit.scope,
      costMinor: 0,
    };
    return { status: 429, body };
  }

  // 4. Business, agent, integration, holiday — and their state. An archived club, a released or paused agent
  //    (Stop all agents, key revoke) or a revoked BYOK key is refused here, before Cedar, so no permit can lift it.
  let loaded: Loaded;
  try {
    loaded = await loadContext(deps, session, connector, tool, now);
  } catch (e) {
    if (e instanceof SessionStateDenied) {
      const { policyId, reasons } = e.denial;
      const audit = await appendAudit(deps, session, req, { outcome: "deny", reasons, policyIds: [policyId] });
      log.warn({ reasons, policyIds: [policyId] }, "tool call refused: agent or club state");
      return { status: 403, body: { outcome: "deny", reasons, policyIds: [policyId], costMinor: 0, auditId: audit.id } };
    }
    throw e;
  }

  // 5. Cedar input.
  const policyInput = await buildPolicyInput(deps, session, req, loaded, args);
  const decision = evaluate(policyInput, deps.policyEngine ?? getPolicyEngine());

  if (decision.outcome === "deny") return deny(deps, session, req, loaded, decision, args, log);
  if (decision.outcome === "ask") {
    // The founder already approved this very call (0030): it runs once under that approval instead of asking again,
    // whether the session still waiting retries it or the next session on the task makes it. The approval covers the
    // amount it was asked for, in the same currency, and no more; a deny (spend cap, hard gate, suppression) never
    // reaches this point.
    const granted = await repos.approvals.useGranted(deps.db, businessId, { sessionId: session.sessionId, agentId: session.agentId, connectorKey: connector.key, tool: tool.name, args: argsObject(args), amountMinor: req.context.amountMinor ?? 0, currency: req.context.currency ?? loaded.agent.currency });
    if (granted) {
      log.info({ approvalId: granted.id }, "tool call runs under the founder's approval");
      return allow(deps, session, req, loaded, { ...decision, reasons: [...decision.reasons, `Approved by the founder (approval ${granted.id})`] }, args, log, now, granted.id);
    }
    return ask(deps, session, req, loaded, decision, args, log);
  }
  return allow(deps, session, req, loaded, decision, args, log, now);
}

async function loadContext(deps: GatewayDeps, session: SessionToken, connector: Connector, tool: McpToolDefinition, now: () => Date): Promise<Loaded> {
  const { db } = deps;
  const { businessId, agentId, sessionId } = session;
  // Archived clubs are loaded on purpose: the answer is a 403 with a stable policy id, not a 404.
  const business = await repos.businesses.get(db, businessId, { includeArchived: true }).catch(rethrowNotFound("business", businessId));
  const agent = await repos.agents.get(db, businessId, agentId).catch(rethrowNotFound("agent", agentId));
  const denial = stateDenial(business, agent) ?? (await checkByokKey(db, stateCacheFor(deps), { businessId, sessionId, business, connectorKey: connector.key }, now().getTime()));
  if (denial) throw new SessionStateDenied(denial);
  const integrationRow = await repos.integrations.getByKey(db, businessId, connector.key);
  const holiday = await repos.holidays.current(db, businessId);
  return { connector, tool, business, agent, integrationRow, holidayActive: holiday !== null, holidayBudgetMinor: holiday?.budgetCeilingMinor ?? null };
}

const rethrowNotFound =
  (what: string, id: string) =>
  (e: unknown): never => {
    if (e instanceof NotFoundError) throw new GatewayError(`${what}_not_found`, `${what} ${id} is not available to this gateway`, 404, { [what]: id });
    throw e;
  };

async function buildPolicyInput(deps: GatewayDeps, session: SessionToken, req: CallRequestParsed, loaded: Loaded, args: unknown): Promise<EvaluateInputInput> {
  const { connector, tool, business, agent } = loaded;
  const hints = connector.policyHints[tool.name] ?? {};
  const attrs = toolAttributes(connector.key, tool.name);
  const autonomy = agentAutonomy(agent, business.businessMode);

  const toolCtx: ToolCtxInput = {
    connector: connector.key,
    name: tool.name,
    spendsMoney: hints.spendsMoney ?? false,
    contactsThirdParty: hints.contactsThirdParty ?? false,
    requiresKitMode: hints.requiresKitMode ?? false,
    irreversible: hints.irreversible ?? false,
    hardGate: hints.hardGate ?? false,
    finance: attrs.finance,
    contract: attrs.contract,
  };

  // Spend cap: the agent's own cap, tightened by a holiday budget ceiling while one is active (BUILD §9.6).
  const caps = [autonomy.spendCapMinor, loaded.holidayActive ? (loaded.holidayBudgetMinor ?? undefined) : undefined].filter((v): v is number => typeof v === "number");
  // Approval threshold: the agent's own, lowered to the founder's "Spend cap per action" (Commit, Settings › Mode), so
  // above the business cap every spend asks first, whatever the mode.
  const approvalThresholdMinor = businessApprovalThreshold(autonomy.approvalThresholdMinor, business.spendCapMinor);
  const principal: AgentCtxInput = {
    id: agent.id,
    department: agent.departmentIds[0] ?? "unassigned",
    type: agent.agentType,
    modelKey: agent.modelKey,
    autonomy: autonomy.autonomy,
    ...(caps.length ? { spendCapMinor: Math.min(...caps) } : {}),
    ...(approvalThresholdMinor !== undefined ? { approvalThresholdMinor } : {}),
  };

  // Recipients: suppression and untrusted-content checks only matter for tools that contact a third party.
  let recipient = req.context.recipient;
  let suppressed = false;
  let recipientFirstSeenInUntrusted = false;
  if (toolCtx.contactsThirdParty) {
    const candidates = candidatesFromArgs(args, req.context.recipient);
    recipient ??= candidates[0]?.value;
    suppressed = await anySuppressed(deps, session.businessId, candidates);
    // A seeded session whose seed this replica does not hold (restart, another replica) fails closed.
    const seedMissing = session.untrustedSeeded && !deps.recipients.isSeeded(session.sessionId);
    recipientFirstSeenInUntrusted = candidates.length > 0 && (seedMissing || deps.recipients.firstSeenInUntrusted(session.sessionId, candidates).length > 0);
  }

  return {
    principal,
    tool: toolCtx,
    business: { id: business.id, businessMode: business.businessMode, holidayActive: loaded.holidayActive },
    context: {
      amountMinor: req.context.amountMinor ?? 0,
      ...(recipient ? { recipient } : {}),
      recipientFirstSeenInUntrusted,
      ...(req.context.recipientCountry ? { recipientCountry: req.context.recipientCountry } : {}),
      ...(req.context.localTimeAtRecipient ? { localTimeAtRecipient: req.context.localTimeAtRecipient } : {}),
      suppressed,
      holidayActive: loaded.holidayActive,
      kitMode: session.kitMode || (req.context.kitMode ?? false),
    },
  };
}

/** The global suppression list is checked before every contact (BUILD §2.3): any hash hit blocks the call. */
async function anySuppressed(deps: GatewayDeps, businessId: string, candidates: readonly RecipientCandidate[]): Promise<boolean> {
  for (const c of candidates) {
    if (c.kind === "url") continue;
    const hash = hashRecipient(c.kind, c.value);
    const hit = await repos.channels.isSuppressed(deps.db, businessId, c.kind === "email" ? { emailHash: hash } : { phoneHash: hash });
    if (hit) return true;
  }
  return false;
}

interface AuditInput {
  outcome: CallResponse["outcome"];
  reasons: string[];
  policyIds: string[];
  costMinor?: number;
  approvalId?: string;
  resultOk?: boolean;
  errorCode?: string;
  untrusted?: boolean;
}

async function appendAudit(deps: GatewayDeps, session: SessionToken, req: CallRequestParsed, input: AuditInput) {
  return repos.audit.append(deps.db, session.businessId, {
    actorKind: "agent",
    actorId: session.agentId,
    action: AUDIT_ACTION_TOOL_CALL,
    target: { connector: req.connector, tool: req.tool },
    details: {
      sessionId: session.sessionId,
      tokenId: session.jti,
      outcome: input.outcome,
      reasons: input.reasons,
      policyIds: input.policyIds,
      costMinor: input.costMinor ?? 0,
      ...(input.approvalId ? { approvalId: input.approvalId } : {}),
      ...(input.resultOk !== undefined ? { resultOk: input.resultOk } : {}),
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      ...(input.untrusted !== undefined ? { untrusted: input.untrusted } : {}),
      amountMinor: req.context.amountMinor ?? 0,
      mode: modeFor(deps, req.connector),
      ...argsSummary(req.args),
    },
  });
}

async function deny(deps: GatewayDeps, session: SessionToken, req: CallRequestParsed, loaded: Loaded, decision: EvaluateResult, args: unknown, log: GatewayLogger): Promise<ToolCallResult> {
  const hardGate = decision.policyIds.includes(HARD_GATE_POLICY_ID);
  let approvalId: string | undefined;
  let humanAction: HumanActionDescriptor | undefined;
  if (hardGate) {
    // The connector refuses hard-gated tools before any handler runs and answers with the founder's instructions.
    humanAction = await hardGateDescriptor(deps, session, loaded, args, log);
    approvalId = await queueApproval(deps, session, req, loaded, decision, args, true, humanAction);
  }
  const audit = await appendAudit(deps, session, req, { outcome: "deny", reasons: decision.reasons, policyIds: decision.policyIds, approvalId });
  log.warn({ reasons: decision.reasons, policyIds: decision.policyIds, hardGate }, "tool call denied");
  const body: DenyResponse = {
    outcome: "deny",
    reasons: decision.reasons,
    policyIds: decision.policyIds,
    costMinor: 0,
    auditId: audit.id,
    ...(approvalId ? { approvalId } : {}),
    ...(humanAction ? { humanAction } : {}),
  };
  return { status: 403, body };
}

async function hardGateDescriptor(deps: GatewayDeps, session: SessionToken, loaded: Loaded, args: unknown, log: GatewayLogger): Promise<HumanActionDescriptor> {
  const fallback: HumanActionDescriptor = {
    connector: loaded.connector.key,
    tool: loaded.tool.name,
    title: `Complete "${loaded.tool.name}" manually`,
    instructions: "This action always requires a human (BUILD §2.2).",
    args,
    reason: "hard_gate",
  };
  try {
    const ctx: ToolContext = { businessId: session.businessId, agentId: session.agentId, sessionId: session.sessionId, integration: placeholderIntegration(loaded, modeFor(deps, loaded.connector.key)), log, mode: modeFor(deps, loaded.connector.key) };
    const result = await loaded.connector.callTool(loaded.tool.name, args, ctx);
    if (result.error?.code === "hard_gate" && result.data && typeof result.data === "object") return result.data as HumanActionDescriptor;
    // A connector that did not refuse a hard-gated tool is a contract violation; the policy denial above already stopped the call.
    log.error({ connector: loaded.connector.key, tool: loaded.tool.name }, "hard-gated tool did not return a human-action descriptor");
    return fallback;
  } catch {
    return fallback;
  }
}

function placeholderIntegration(loaded: Loaded, mode: ConnectorMode): IntegrationRecord {
  if (loaded.integrationRow) return toIntegrationRecord(loaded.integrationRow, null);
  return mockIntegrationRecord(loaded.connector.key, loaded.business.id, mode === "mock" ? {} : { status: "disconnected" });
}

async function queueApproval(deps: GatewayDeps, session: SessionToken, req: CallRequestParsed, loaded: Loaded, decision: EvaluateResult, args: unknown, hardGate: boolean, humanAction?: HumanActionDescriptor): Promise<string> {
  const amount = req.context.amountMinor !== undefined && req.context.amountMinor > 0 ? { amountMinor: req.context.amountMinor, currency: req.context.currency ?? loaded.agent.currency } : null;
  const summary = humanAction ? `${humanAction.title}: ${humanAction.instructions}`.slice(0, 1000) : `${loaded.agent.name} wants to run ${loaded.connector.displayName} › ${loaded.tool.name}${req.context.recipient ? ` for ${req.context.recipient}` : ""}`.slice(0, 1000);
  return deps.db.transaction(async (tx) => {
    const approval = await repos.approvals.create(tx, session.businessId, {
      planActionId: req.context.planActionId ?? null,
      agentId: session.agentId,
      sessionId: session.sessionId,
      // A hard gate is a founder task, not a question: it never holds the task back for an answer (0030).
      ...(hardGate ? { taskId: null } : {}),
      connectorKey: loaded.connector.key,
      tool: loaded.tool.name,
      args: argsObject(args),
      reasons: decision.reasons,
      ...(amount ? { amountMinor: amount.amountMinor, currency: amount.currency } : {}),
    });
    const requested = await writeGatewayEvent(tx, {
      businessId: session.businessId,
      type: "approval.requested",
      actor: { kind: "agent", id: session.agentId },
      payload: {
        approvalId: approval.id,
        planActionId: req.context.planActionId ?? null,
        agentId: session.agentId,
        sessionId: session.sessionId,
        connectorKey: loaded.connector.key,
        tool: loaded.tool.name,
        amount,
        reasons: decision.reasons,
        policyIds: decision.policyIds,
        decisionType: decisionTypeFor(loaded, req, decision),
        hardGate,
        summary,
        expiresAt: null,
      },
    });
    // The founder answers an "ask" in the Inbox (audit FR-01): one decision item names the agent, the task, the call
    // and its amount, and its Approve or Reject reaches the session waiting on it. A hard gate stays a note.
    if (!hardGate) {
      const { item } = await openApprovalItem(tx, session.businessId, approval, { agentId: session.agentId, agentName: loaded.agent.name, connectorName: loaded.connector.displayName, sourceEventIds: [requested.id] });
      await writeGatewayEvent(tx, {
        businessId: session.businessId,
        type: "inbox.item_created",
        actor: { kind: "agent", id: session.agentId },
        payload: { inboxItemId: item.id, type: item.type, fromAgentId: item.fromAgentId, subject: item.subject, blocksContinue: item.blocksContinue, sourceEventIds: [requested.id], cost: null },
      });
    }
    return approval.id;
  });
}

function decisionTypeFor(loaded: Loaded, req: CallRequestParsed, decision: EvaluateResult) {
  const hints = loaded.connector.policyHints[loaded.tool.name] ?? {};
  if (decision.policyIds.some((id) => id.endsWith("above-threshold")) || (hints.spendsMoney && (req.context.amountMinor ?? 0) > 0)) return "spend_above_threshold" as const;
  if (toolAttributes(loaded.connector.key, loaded.tool.name).contract || loaded.connector.key === "dropbox_sign") return "sign_contracts" as const;
  if (loaded.connector.key === "github" && loaded.tool.name === "merge_pr") return "merge_to_main" as const;
  if (hints.contactsThirdParty) return "message_customers" as const;
  return null;
}

async function ask(deps: GatewayDeps, session: SessionToken, req: CallRequestParsed, loaded: Loaded, decision: EvaluateResult, args: unknown, log: GatewayLogger): Promise<ToolCallResult> {
  // One gated call has one approval (audit O-26): asked again while its approval is open (a retry, or the next session
  // on the task), the call waits on that one instead of queueing a second request and a second Inbox item.
  const open = await repos.approvals.claimOpen(deps.db, session.businessId, { sessionId: session.sessionId, agentId: session.agentId, connectorKey: loaded.connector.key, tool: loaded.tool.name, args: argsObject(args), amountMinor: req.context.amountMinor ?? 0, currency: req.context.currency ?? loaded.agent.currency });
  const approvalId = open?.id ?? (await queueApproval(deps, session, req, loaded, decision, args, false));
  const audit = await appendAudit(deps, session, req, { outcome: "ask", reasons: decision.reasons, policyIds: decision.policyIds, approvalId });
  log.info({ approvalId, reasons: decision.reasons }, "tool call needs approval");
  const body: AskResponse = { outcome: "ask", approvalId, reasons: decision.reasons, policyIds: decision.policyIds, costMinor: 0, auditId: audit.id };
  return { status: 200, body };
}

async function allow(deps: GatewayDeps, session: SessionToken, req: CallRequestParsed, loaded: Loaded, decision: EvaluateResult, args: unknown, log: GatewayLogger, now: () => Date, approvalId?: string): Promise<ToolCallResult> {
  const { connector, tool } = loaded;
  const mode = modeFor(deps, connector.key);
  // Credential: decrypted in memory for this call only; never logged, never part of any response.
  let credential: LoadedCredential | null = null;
  // An App connector (GitHub) authenticates with the platform's App keys for the business's installation: it needs an
  // integration row the live connector verified (who installed it, checked with GitHub), not a stored secret.
  const appInstalled = connector.auth.kind === "app" && loaded.integrationRow !== null && appInstallationVerified(loaded.integrationRow, await repos.integrations.verifiedInstallation(deps.db, session.businessId, connector.key));
  if (loaded.integrationRow) {
    if (deps.vault) credential = await loadCredential(deps.db, deps.vault, session.businessId, loaded.integrationRow.id);
    else if (mode === "live" && connector.auth.kind !== "none" && !appInstalled) throw new GatewayError("vault_unavailable", "No vault is configured; credentials cannot be decrypted", 503);
  }
  if (mode === "live" && connector.auth.kind !== "none" && !credential && !appInstalled) {
    throw new GatewayError("integration_not_connected", `${connector.displayName} is not connected for this business`, 409, { connector: connector.key });
  }
  const integration: IntegrationRecord = loaded.integrationRow ? toIntegrationRecord(loaded.integrationRow, credential) : mockIntegrationRecord(connector.key, session.businessId, mode === "mock" ? {} : { status: "connected" });

  const ctx: ToolContext = {
    businessId: session.businessId,
    agentId: session.agentId,
    sessionId: session.sessionId,
    integration,
    ...(credential ? { credential: credential.credential } : {}),
    log,
    mode,
  };

  const guarded = connector.key === "github" ? guardGithubWrite(tool.name, loaded.integrationRow, args) : { args };
  if ("reason" in guarded) {
    const reasons = [guarded.reason];
    const audit = await appendAudit(deps, session, req, { outcome: "deny", reasons, policyIds: [GITHUB_PUSH_SETTINGS_POLICY_ID] });
    log.info({ reasons }, "tool call refused: GitHub push settings");
    return { status: 403, body: { outcome: "deny", reasons, policyIds: [GITHUB_PUSH_SETTINGS_POLICY_ID], costMinor: 0, auditId: audit.id } };
  }

  let result: ToolResult;
  try {
    result = await connector.callTool(tool.name, guarded.args, ctx);
  } catch (e) {
    if (isConfigError(e)) throw new GatewayError("connector_unconfigured", e.message, 503, { connector: connector.key });
    throw e;
  }

  // Untrusted content: the agent receives the envelope; its recipients are remembered for this session (BUILD §9.8).
  let data = result.data;
  let untrusted = false;
  if (isUntrusted(result.data)) {
    const { content } = readForQuarantine(result.data);
    const found = candidatesFromContent(content);
    const added = deps.recipients.record(session.sessionId, found);
    if (added > 0) log.debug({ added }, "recipients first seen in untrusted content recorded for this session");
    data = toAgentEnvelope(result.data);
    untrusted = true;
  }

  const costMinor = Math.max(0, Math.round(result.costMinor ?? connector.costModel?.(tool.name, args) ?? 0));
  if (result.ok) {
    // A token minted outside an agent session (a plan action, an import, a Source Watcher read) carries a one-off
    // session id with no agent_sessions row, which usage_ledger.session_id references: that call is booked to the agent.
    const sessionKnown = await repos.agents.getSession(deps.db, session.businessId, session.sessionId).then(
      () => true,
      (e: unknown) => {
        if (e instanceof NotFoundError) return false;
        throw e;
      },
    );
    // Billed to the business's own key or the platform's credits; a credits row is charged to the period's balance.
    await bookUsage(deps.db, session.businessId, {
      agentId: session.agentId,
      sessionId: sessionKnown ? session.sessionId : null,
      kind: "tool",
      quantity: 1,
      unit: "calls",
      costMinor,
      currency: loaded.agent.currency,
      billedTo: loaded.business.modelBilling,
      occurredAt: now(),
      details: { connector: connector.key, tool: tool.name, mode: modeFor(deps, connector.key), untrusted, label: "Estimate" },
    });
  }
  const audit = await appendAudit(deps, session, req, {
    outcome: "allow",
    reasons: decision.reasons,
    policyIds: decision.policyIds,
    ...(approvalId ? { approvalId } : {}),
    costMinor,
    resultOk: result.ok,
    errorCode: result.error?.code,
    untrusted,
  });
  log.info({ ok: result.ok, costMinor, untrusted, errorCode: result.error?.code }, "tool call executed");
  const body: AllowResponse = {
    outcome: "allow",
    result: { ok: result.ok, ...(data !== undefined ? { data } : {}), ...(result.error ? { error: result.error } : {}), untrusted, costMinor },
    costMinor,
    auditId: audit.id,
    reasons: decision.reasons,
    policyIds: decision.policyIds,
  };
  return { status: 200, body };
}
