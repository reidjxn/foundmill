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
import { LIMITS } from "@foundmill/config";
import { AppError, NotFoundError } from "@foundmill/shared";
import type { Vault } from "@foundmill/shared/crypto";
import { bookUsage, codeRepositoryOf, openApprovalItem, repos, type Db, type Agent, type AppInstallation, type Business, type Integration } from "@foundmill/db";
import { agentAutonomy, businessApprovalThreshold, evaluate, getPolicyEngine, type AgentCtxInput, type EvaluateInputInput, type EvaluateResult, type PolicyEngine, type ToolCtxInput } from "@foundmill/policy";
import {
  ALWAYS_LIVE_CONNECTORS,
  canonicalJson,
  isConfigError,
  isUntrusted,
  mockIntegrationRecord,
  readForQuarantine,
  toAgentEnvelope,
  type Connector,
  type ConnectorMode,
  type ConnectorRegistry,
  type DecryptedCredential,
  type HumanActionDescriptor,
  type IntegrationRecord,
  type McpToolDefinition,
  type ToolContext,
  type ToolLogger,
  type ToolResult,
} from "@foundmill/connectors";
import { loadCredential, persistRefreshedCredential, toIntegrationRecord, type LoadedCredential } from "./credentials";
import { writeGatewayEvent } from "./events";
import { securitySettingsChange } from "./security-settings";
import { grantsOutboundTools, READER_UNAVAILABLE, type UntrustedReader } from "./untrusted-reader";
import { checkRateLimit, type RateLimitStore } from "./rate-limit";
import { candidatesFromArgs, candidatesFromContent, hashRecipient, type RecipientCandidate, type UntrustedRegister } from "./recipients";
import { checkByokKey, SessionStateCache, stateDenial, type StateDenial } from "./state";
import { sessionKey, toolAllowed, toolRef, type SessionToken } from "./tokens";
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
  /** Recipients first seen in untrusted content, shared by every session of a business (Redis in staging and production). */
  recipients: UntrustedRegister;
  /**
   * Reads untrusted content for sessions that hold outbound tools (BUILD §9.8 step 2). Always set in a running gateway;
   * tests that do not exercise the reader leave it out and get the content as before.
   */
  reader?: UntrustedReader;
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

/**
 * The mode one connector runs in for this gateway. The built-in `platform` and `quarantine` connectors always run live:
 * their live side is the platform's own database and model client (ALWAYS_LIVE_CONNECTORS), never a vendor.
 */
export function modeFor(deps: Pick<GatewayDeps, "mode" | "liveConnectors">, connectorKey: string): ConnectorMode {
  return deps.mode === "live" || deps.liveConnectors?.includes(connectorKey) || ALWAYS_LIVE_CONNECTORS.has(connectorKey) ? "live" : deps.mode;
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

/**
 * An integration a platform-key connector may run for (`auth.platformKey`): connected (or degraded) and not archived.
 * A disconnected, expired, mock or archived row does not count, so disconnecting stops the platform key too.
 */
export function platformKeyConnected(row: Pick<Integration, "status" | "archivedAt">): boolean {
  return row.archivedAt === null && (row.status === "connected" || row.status === "degraded");
}

/** Policy id on a call refused by the founder's GitHub push settings (audited like any deny). */
export const GITHUB_PUSH_SETTINGS_POLICY_ID = "github-push-settings";
/** GitHub tools that change a repository: held to the founder's push settings. */
const GITHUB_WRITE_TOOLS = new Set(["create_branch", "commit_files", "open_pr", "run_checks", "merge_pr"]);

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
  if (!target?.writeEnabled) return { reason: "Pushing to GitHub is not turned on for this business (the Code tab)" };
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  if (`${String(a.owner)}/${String(a.repo)}`.toLowerCase() !== target.fullName.toLowerCase()) return { reason: `Agents change only ${target.fullName}, the repository chosen on the Code tab` };
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

/**
 * What a log line may carry about an error. A failed query's message ends with its parameters (tool arguments, email
 * bodies, amounts), and the error object itself carries them, so neither is ever logged: only the statement part of the
 * message and the database's code, constraint and table.
 */
export function safeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { message: typeof err === "string" ? err.slice(0, 200) : "non-error thrown" };
  const message = (err.message.split(/\n\s*params:/i)[0] ?? "").slice(0, 500);
  const cause = (err as { cause?: unknown }).cause;
  const db = cause && typeof cause === "object" ? (cause as { code?: unknown; constraint?: unknown; constraint_name?: unknown; table?: unknown; table_name?: unknown; message?: unknown }) : null;
  return {
    name: err.name,
    message,
    ...(err instanceof AppError ? { code: err.code } : {}),
    ...(db ? { cause: { code: db.code, constraint: db.constraint ?? db.constraint_name, table: db.table ?? db.table_name, message: typeof db.message === "string" ? db.message.slice(0, 300) : undefined } } : {}),
  };
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
/** The Cedar policy that forbids a call the gateway recognised as a security-settings change (security-settings.ts). */
export const SECURITY_SETTINGS_POLICY_ID = "hard-gate-security-settings";
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

// The principal's autonomy and thresholds live in @foundmill/policy, shared with plan evaluation (audit api-services-03).
export { agentAutonomy, businessApprovalThreshold };

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
    return ask(deps, session, req, loaded, decision, args, log, now);
  }
  return allow(deps, session, req, loaded, decision, args, log, now);
}

async function loadContext(deps: GatewayDeps, session: SessionToken, connector: Connector, tool: McpToolDefinition, now: () => Date): Promise<Loaded> {
  const { db } = deps;
  const { businessId, agentId } = session;
  // Archived clubs are loaded on purpose: the answer is a 403 with a stable policy id, not a 404.
  const business = await repos.businesses.get(db, businessId, { includeArchived: true }).catch(rethrowNotFound("business", businessId));
  const agent = await repos.agents.get(db, businessId, agentId).catch(rethrowNotFound("agent", agentId));
  const denial = stateDenial(business, agent) ?? (await checkByokKey(db, stateCacheFor(deps), { businessId, sessionId: sessionKey(session), business, connectorKey: connector.key }, now().getTime()));
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

/**
 * The amount the spend policy sees: never less than what the connector says the call costs (a number it derives from the
 * arguments, which the agent cannot lower) and never less than what the caller reported. A spending tool the connector
 * cannot price is treated as above the approval threshold, so it asks (audit GPC-09, SECX-9).
 */
export function policyAmountMinor(input: { spendsMoney: boolean; declaredMinor: number | null; reportedMinor: number; thresholdMinor: number | undefined }): number {
  const known = Math.max(input.declaredMinor ?? 0, input.reportedMinor);
  if (!input.spendsMoney || input.declaredMinor !== null) return known;
  return Math.max(known, (input.thresholdMinor ?? LIMITS.approvalThresholdMinorDefault) + 1);
}

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
    // Decided here from the call's arguments (never reported by the agent): a DNS change that routes or authenticates email.
    securitySettings: securitySettingsChange(connector.key, tool.name, args) !== null,
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
    const seedMissing = session.untrustedSeeded && !(await deps.recipients.isSeeded(sessionKey(session)));
    recipientFirstSeenInUntrusted = candidates.length > 0 && (seedMissing || (await deps.recipients.firstSeenInUntrusted(session.businessId, sessionKey(session), candidates)).length > 0);
  }

  return {
    principal,
    tool: toolCtx,
    business: { id: business.id, businessMode: business.businessMode, holidayActive: loaded.holidayActive },
    context: {
      amountMinor: policyAmountMinor({ spendsMoney: toolCtx.spendsMoney ?? false, declaredMinor: connector.estimateCostMinor?.(tool.name, args) ?? null, reportedMinor: req.context.amountMinor ?? 0, thresholdMinor: principal.approvalThresholdMinor }),
      ...(recipient ? { recipient } : {}),
      recipientFirstSeenInUntrusted,
      ...(req.context.recipientCountry ? { recipientCountry: req.context.recipientCountry } : {}),
      ...(req.context.localTimeAtRecipient ? { localTimeAtRecipient: req.context.localTimeAtRecipient } : {}),
      suppressed,
      holidayActive: loaded.holidayActive,
      // The session's flag, minted by the orchestrator: a kit-mode channel is never unlocked by an argument of the call.
      kitMode: session.kitMode,
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
  const securityChange = decision.policyIds.includes(SECURITY_SETTINGS_POLICY_ID) ? securitySettingsChange(loaded.connector.key, loaded.tool.name, args) : null;
  const hardGate = decision.policyIds.includes(HARD_GATE_POLICY_ID) || securityChange !== null;
  let approvalId: string | undefined;
  let humanAction: HumanActionDescriptor | undefined;
  if (securityChange) {
    // The tool itself is not hard-gated, so it is never called here: the founder's task is described from the change.
    humanAction = { connector: loaded.connector.key, tool: loaded.tool.name, title: securityChange.title, instructions: securityChange.instructions, args, reason: "hard_gate" };
    approvalId = (await queueApproval(deps, session, req, loaded, decision, args, true, humanAction)).id;
  } else if (hardGate) {
    // The connector refuses hard-gated tools before any handler runs and answers with the founder's instructions.
    humanAction = await hardGateDescriptor(deps, session, loaded, args, log);
    approvalId = (await queueApproval(deps, session, req, loaded, decision, args, true, humanAction)).id;
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

async function queueApproval(deps: GatewayDeps, session: SessionToken, req: CallRequestParsed, loaded: Loaded, decision: EvaluateResult, args: unknown, hardGate: boolean, humanAction?: HumanActionDescriptor): Promise<{ id: string; approvedByAgent: boolean }> {
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
      // Routed by Team › Responsibilities (AC-11.9.2); a hard gate is always the founder's, never routed.
      decisionType: hardGate ? null : decisionTypeFor(loaded, req, decision),
    });
    // An agent the Responsibilities matrix names approved it as it opened: nothing to ask the founder, and the decision
    // is on record like any other (`approval.resolved`, by that agent).
    if (approval.outcome === "approved" && approval.byKind === "agent" && approval.byId) {
      await writeGatewayEvent(tx, {
        businessId: session.businessId,
        type: "approval.resolved",
        actor: { kind: "agent", id: approval.byId },
        payload: { approvalId: approval.id, planActionId: approval.planActionId, agentId: session.agentId, outcome: "approved", resolvedBy: { kind: "agent", id: approval.byId }, note: "Delegated in Team › Responsibilities", latencyMs: 0 },
      });
      return { id: approval.id, approvedByAgent: true };
    }
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
    return { id: approval.id, approvedByAgent: false };
  });
}

function decisionTypeFor(loaded: Loaded, req: CallRequestParsed, decision: EvaluateResult) {
  const hints = loaded.connector.policyHints[loaded.tool.name] ?? {};
  // A merge is a merge whatever its amount: checked before the spend threshold, so a merge carrying an amount is not routed as spend.
  if (loaded.connector.key === "github" && loaded.tool.name === "merge_pr") return "merge_to_main" as const;
  if (decision.policyIds.some((id) => id.endsWith("above-threshold")) || (hints.spendsMoney && (req.context.amountMinor ?? 0) > 0)) return "spend_above_threshold" as const;
  if (toolAttributes(loaded.connector.key, loaded.tool.name).contract || loaded.connector.key === "dropbox_sign") return "sign_contracts" as const;
  if (hints.contactsThirdParty) return "message_customers" as const;
  return null;
}

async function ask(deps: GatewayDeps, session: SessionToken, req: CallRequestParsed, loaded: Loaded, decision: EvaluateResult, args: unknown, log: GatewayLogger, now: () => Date): Promise<ToolCallResult> {
  // One gated call has one approval (audit O-26): asked again while its approval is open (a retry, or the next session
  // on the task), the call waits on that one instead of queueing a second request and a second Inbox item.
  const open = await repos.approvals.claimOpen(deps.db, session.businessId, { sessionId: session.sessionId, agentId: session.agentId, connectorKey: loaded.connector.key, tool: loaded.tool.name, args: argsObject(args), amountMinor: req.context.amountMinor ?? 0, currency: req.context.currency ?? loaded.agent.currency });
  const queued = open ? { id: open.id, approvedByAgent: false } : await queueApproval(deps, session, req, loaded, decision, args, false);
  const approvalId = queued.id;
  if (queued.approvedByAgent) {
    log.info({ approvalId }, "approval decided by the agent Team › Responsibilities names; the call goes ahead");
    return allow(deps, session, req, loaded, decision, args, log, now);
  }
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
  // A platform-key connector (registries, Voyage, E2B, Anthropic on credits, Stripe Connect) runs on the platform's own
  // secret once the business connected it: its connect() stores no credential, so a stored one is not required.
  const onPlatformKey = connector.auth.platformKey === true && loaded.integrationRow !== null && platformKeyConnected(loaded.integrationRow);
  if (loaded.integrationRow) {
    if (deps.vault) credential = await loadCredential(deps.db, deps.vault, session.businessId, loaded.integrationRow.id);
    else if (mode === "live" && connector.auth.kind !== "none" && !appInstalled && !onPlatformKey) throw new GatewayError("vault_unavailable", "No vault is configured; credentials cannot be decrypted", 503);
  }
  if (mode === "live" && connector.auth.kind !== "none" && !credential && !appInstalled && !onPlatformKey) {
    throw new GatewayError("integration_not_connected", `${connector.displayName} is not connected for this business`, 409, { connector: connector.key });
  }
  const integration: IntegrationRecord = loaded.integrationRow ? toIntegrationRecord(loaded.integrationRow, credential) : mockIntegrationRecord(connector.key, session.businessId, mode === "mock" ? {} : { status: "connected" });

  const vault = deps.vault;
  const loadedCredential = credential;
  const ctx: ToolContext = {
    businessId: session.businessId,
    agentId: session.agentId,
    sessionId: session.sessionId,
    integration,
    ...(loadedCredential ? { credential: loadedCredential.credential } : {}),
    // A token the connector refreshed (Google, Tink) is sealed back into the same row, so the next call reuses it.
    ...(loadedCredential && vault ? { onCredentialRefreshed: (refreshed: DecryptedCredential) => persistRefreshedCredential(deps.db, vault, session.businessId, loadedCredential, refreshed) } : {}),
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
    const added = await deps.recipients.record(session.businessId, found);
    if (added > 0) log.debug({ added }, "recipients first seen in untrusted content recorded for this business");
    data = toAgentEnvelope(result.data);
    // An agent that can contact people, spend or do something irreversible never reads third-party text raw: a model with no
    // tools reads it and the agent gets typed fields only (BUILD §9.8 step 2). If the reader fails, the agent gets nothing.
    if (deps.reader && grantsOutboundTools(deps.registry, session.allowedTools)) {
      try {
        const digest = await deps.reader.digest({ content, businessId: session.businessId, agentId: session.agentId, sessionId: session.sessionId });
        data = { ...toAgentEnvelope(result.data), content: digest, quarantined: true };
      } catch (err) {
        log.warn({ err: (err as Error).message }, "quarantined reader failed; the content is withheld");
        data = { ...toAgentEnvelope(result.data), content: null, quarantined: true, unavailable: READER_UNAVAILABLE };
      }
    }
    untrusted = true;
  }

  const costMinor = Math.max(0, Math.round(result.costMinor ?? connector.costModel?.(tool.name, args) ?? 0));
  // The vendor action has run: from here on nothing may turn it into a failure the agent (or a Temporal retry) repeats.
  // The audit row comes first and on its own; booking the usage cannot fail the call, it is logged instead.
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
  if (result.ok) {
    try {
      // Billed to the business's own key or the platform's credits; a credits row is charged to the period's balance.
      await bookUsage(deps.db, session.businessId, {
        agentId: session.agentId,
        sessionId: session.sessionId,
        kind: "tool",
        quantity: 1,
        unit: "calls",
        costMinor,
        currency: loaded.agent.currency,
        billedTo: loaded.business.modelBilling,
        occurredAt: now(),
        details: { connector: connector.key, tool: tool.name, mode: modeFor(deps, connector.key), untrusted, label: "Estimate", auditId: audit.id },
      });
    } catch (e) {
      log.error({ err: safeError(e), auditId: audit.id, costMinor }, "tool call executed but its usage could not be booked");
    }
  }
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
