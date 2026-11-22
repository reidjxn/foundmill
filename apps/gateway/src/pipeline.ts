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
 *             its recipients for the session (the quarantined reader's digest for sessions with outbound tools, except
 *             first-party reads of the business's own Code-tab repository) → meter into usage_ledger → audit → return
 *
 * `/v1/call` and `/mcp/:connector` both run this function; nothing reaches a vendor any other way.
 */
import type { RecipientBasisCheck } from "./follower-update";
import { createHash } from "node:crypto";
import { LIMITS } from "@foundmill/config";
import type { TurnstileConfig } from "./turnstile";
import { AppError, isMailSendTool, mockResultsAllowed, NotFoundError, type RecipientBasis } from "@foundmill/shared";
import { mailRecipientEmails, recipientBasis, weakestBasis } from "./recipient-basis";
import type { Vault } from "@foundmill/shared/crypto";
import type { KeyValidation } from "@foundmill/models";
import { bookUsage, codeRepositoryOf, openApprovalItem, repos, type Db, type Agent, type AppInstallation, type Approval, type Business, type Integration } from "@foundmill/db";
import { agentAutonomy, businessApprovalThreshold, evaluate, getPolicyEngine, type AgentCtxInput, type EvaluateInputInput, type EvaluateResult, type PolicyEngine, type ToolCtxInput } from "@foundmill/policy";
import {
  ALWAYS_LIVE_CONNECTORS,
  connectionRefused,
  canonicalJson,
  isConfigError,
  isFounderExecutedTool,
  isServiceMediaTool,
  isServiceOnlyConnector,
  isUntrusted,
  mockIntegrationRecord,
  modeKeyOf,
  PLATFORM_MAIL_KEY,
  readForQuarantine,
  readableContent,
  remoteFounderExecutedCall,
  remoteHardGateCall,
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
  type SpeechStreamer,
} from "@foundmill/connectors";
import { loadCredential, persistRefreshedCredential, toIntegrationRecord, type LoadedCredential } from "./credentials";
import { writeGatewayEvent } from "./events";
import { securitySettingsChange } from "./security-settings";
import { grantsOutboundTools, READER_UNAVAILABLE, type UntrustedReader } from "./untrusted-reader";
import { decideFirstParty, FIRST_PARTY_REPO_TOOLS, type RepoMetadataCache } from "./code-repository";
import { checkRateLimit, type RateLimitStore } from "./rate-limit";
import { candidatesFromArgs, candidatesFromContent, hashRecipient, type RecipientCandidate, type UntrustedRegister } from "./recipients";
import { checkByokKey, SessionStateCache, stateDenial, type StateDenial } from "./state";
import { sessionKey, toolAllowed, toolRef, type SessionToken } from "./tokens";
import { ownSenderUnsubscribeUrl, platformMailSwitchRefusal, preparePlatformMail, type PlatformMailConfig, type PreparedPlatformMail } from "./platform-mail";
import { SIMULATED_NOTICE, type AllowResponse, type AskResponse, type CallRequestParsed, type CallResponse, type DenyResponse, type RateLimitedResponse } from "./types";

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
  /**
   * `APP_ENV`. With it set, a mock connector the business never connected is refused for a person's own business on
   * staging and production (`mockResultsAllowed`): "not connected" is the truth there, a simulated success is not.
   * Unset (tests that do not exercise the rule): mock connectors answer for every business, as in development.
   */
  appEnv?: string;
  rateLimits: RateLimitStore;
  /** Recipients first seen in untrusted content, shared by every session of a business (Redis in staging and production). */
  recipients: UntrustedRegister;
  /**
   * Reads untrusted content for sessions that hold outbound tools (BUILD §9.8 step 2). Always set in a running gateway;
   * tests that do not exercise the reader leave it out and get the content as before.
   */
  reader?: UntrustedReader;
  log: GatewayLogger;
  /** The entry plan's recurring Stripe price (`STRIPE_ENTRY_PRICE_ID`, WP-09 T16); unset, a live entry-plan checkout answers 503. */
  entryPriceId?: string;
  /** `PAID_ENTRY` (WP-09 T16): sign-up is paid entry, so an owner's credit pack also removes the "Built on" mark. */
  paidEntry?: boolean;
  /** Team call's streamed speech (ElevenLabs' streaming endpoint on the platform key); unset, `/v1/speech/stream` answers 503. */
  speechStreamer?: SpeechStreamer;
  now?: () => Date;
  policyEngine?: PolicyEngine;
  /** Per-session memo of the BYOK credential check (≤ 5 s). One is created per `deps` when omitted. */
  stateCache?: SessionStateCache;
  /** GitHub's answers about repositories for the first-party rule (5 minutes). One is created per `deps` when omitted. */
  repoCache?: RepoMetadataCache;
  /** Repository archives served at once (`download_archive`, archive.ts); default MAX_CONCURRENT_ARCHIVES. */
  archiveConcurrency?: number;
  /**
   * The one-token check of a founder's own Anthropic key (`POST /v1/keys/validate`, keys.ts); default packages/models
   * `validateApiKey` in live mode. Tests pass one over a fake Anthropic.
   */
  validateModelKey?: (apiKey: string) => Promise<KeyValidation>;
  /** Anthropic's Messages API for the own-key model route (model-proxy.ts, WP-13 T11); default `fetch`. Tests pass a fake. */
  anthropicFetch?: typeof globalThis.fetch;
  /** A project's Foundmill sending address (platform-mail.ts); absent or with no domain, `platform_mail` refuses every send. */
  platformMail?: PlatformMailConfig;
  /** Replaces WP-08 T10's recipient basis check in the follower update (follower-update.ts); for tests. */
  recipientBasis?: RecipientBasisCheck;
  /** The idea box's bot check (turnstile.ts); no secret: mock on a development stack, refused elsewhere. */
  turnstile?: TurnstileConfig;
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
 * their live side is the platform's own database and model client (ALWAYS_LIVE_CONNECTORS), never a vendor. A connector
 * whose switch is another's follows it (`modeKeyOf`: `platform_mail` runs live exactly where `sendgrid` does).
 */
export function modeFor(deps: Pick<GatewayDeps, "mode" | "liveConnectors">, connectorKey: string): ConnectorMode {
  return deps.mode === "live" || deps.liveConnectors?.includes(modeKeyOf(connectorKey)) || ALWAYS_LIVE_CONNECTORS.has(connectorKey) ? "live" : deps.mode;
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
const GITHUB_WRITE_TOOLS = new Set(["create_branch", "commit_files", "open_pr", "run_checks", "update_branch", "merge_pr"]);

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

/**
 * GitHub reads whose result can be the business's own code (DECISIONS "Coding agents can read and change the repository
 * (2026-10-23)"): read from the repository chosen on Development › Code, private, with the id pinned for it, at HEAD or a
 * branch, it is first-party content and reaches the agent raw instead of as the quarantined reader's digest, still inside
 * the untrusted envelope and its notice. Every outbound action stays gated by policy as before. The rule is in
 * code-repository.ts.
 */
export { FIRST_PARTY_REPO_TOOLS, firstPartyVerdict, isFirstPartyRef, isFirstPartyRepoRead } from "./code-repository";
/**
 * GitHub tools whose result is a whole repository archive (a compressed tarball, as bytes). It holds no text to scan for
 * recipients, and no digest of it means anything, so it is delivered only when it is first-party and withheld otherwise.
 */
export const REPO_ARCHIVE_TOOLS: ReadonlySet<string> = new Set(["download_archive"]);
/** What an agent gets in place of an archive of any repository but the Code tab's. */
export const ARCHIVE_WITHHELD = "Repository archives are delivered only for the repository chosen on the Code tab.";

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
/** A tool its connector declares no policy hints for is refused: a missing entry must not read as "internal, never asks". */
export const MISSING_POLICY_HINTS_POLICY_ID = "missing-policy-hints";
export const HARD_GATE_POLICY_ID = "hard-gate";
/** The Cedar policy that refuses mail to someone with no basis (15-mail-basis.cedar); on an unconnected connector "not connected" answers first. */
export const MAIL_NEEDS_BASIS_POLICY_ID = "mail-needs-basis";
/** The Cedar policy that forbids a call the gateway recognised as a security-settings change (security-settings.ts). */
export const SECURITY_SETTINGS_POLICY_ID = "hard-gate-security-settings";
export const AUDIT_ACTION_TOOL_CALL = "tool.call";
export { AGENT_ARCHIVED_POLICY_ID, AGENT_PAUSED_POLICY_ID, AGENTS_STOPPED_POLICY_ID, BUSINESS_ARCHIVED_POLICY_ID, KEY_REVOKED_POLICY_ID } from "./state";

/** Finance-module connectors: read-only in v1 (BUILD §11.8, AC-11.8.5). The policy forbids any of their tools that would spend. */
export const FINANCE_CONNECTORS: ReadonlySet<string> = new Set(["tink", "plaid", "ecb_rates"]);
/** Tools that create or amend a contract (assisted mode asks; signing itself is hard-gated by the connector). */
export const CONTRACT_TOOLS: ReadonlySet<string> = new Set(["dropbox_sign:send_signature_request"]);
/**
 * Tools that create an immutable or customer-visible record that brings money in (founder, Nov 16, 2026). They ask in
 * every mode, and in automated mode and on vacation unless the business gave agents the inbound payment power.
 * Paying out, refunding and transferring are hard gates and never on this list.
 */
export const PAYMENT_RECORD_TOOLS: ReadonlySet<string> = new Set(["stripe:create_invoice", "stripe:create_checkout_session"]);

/** `Tool.finance` / `Tool.contract` come from the gateway, not from `policyHints` (DECISIONS "Tool attributes beyond connector policyHints"). */
export function toolAttributes(connector: string, tool: string): { finance: boolean; contract: boolean; paymentRecord: boolean } {
  return { finance: FINANCE_CONNECTORS.has(connector), contract: CONTRACT_TOOLS.has(toolRef(connector, tool)), paymentRecord: PAYMENT_RECORD_TOOLS.has(toolRef(connector, tool)) };
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

/** Platform tools that act once per ask: a second identical request is the same request (WP-05 T14). */
const ONCE_PER_SESSION_TOOLS: ReadonlySet<string> = new Set(["platform:request_human_action", "platform:create_task"]);
/** How far back a session's earlier identical call counts (a session never runs longer). */
const REPLAY_WINDOW_MS = 8 * 60 * 60 * 1000;
export const REPLAYED_NOTE = "This exact call already ran in this session and went through. It was not run again.";
export const STILL_RUNNING_NOTE = "This exact call is still running in this session. It was not run a second time.";
/** Outward calls running now in this process; a repeat that arrives meanwhile is not run (WP-05 T14). */
const IN_FLIGHT = new Set<string>();

/**
 * The key of an outward call (it contacts someone, spends, cannot be undone, or asks the founder) that went through:
 * `<agentId>:<connector>:<tool>:<hash of args and context>`, written on its audit row. Null for a read-only call or a
 * token with no session.
 */
export function doneKeyOf(connector: Pick<Connector, "key" | "policyHints">, toolName: string, args: unknown, context: unknown, session: Pick<SessionToken, "agentId" | "sessionId">): string | null {
  if (!session.sessionId) return null;
  const hints = connector.policyHints[toolName] ?? {};
  const outward = hints.contactsThirdParty === true || hints.spendsMoney === true || hints.irreversible === true || ONCE_PER_SESSION_TOOLS.has(`${connector.key}:${toolName}`);
  // The context (recipient, amount, currency, plan action) is part of the call: a different one is a different call.
  return outward ? `${session.agentId}:${connector.key}:${toolName}:${argsHash({ args: args ?? {}, context: context ?? {} })}` : null;
}

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

/** 403 `service_only_connector` for a connector agents never reach (packages/connectors `SERVICE_ONLY_CONNECTORS`). */
export function refuseServiceOnly(connectorKey: string): void {
  if (isServiceOnlyConnector(connectorKey)) throw new GatewayError("service_only_connector", `${connectorKey} is called by the platform itself; agent sessions cannot use it`, 403, { connector: connectorKey });
}

/** Policy id of the refusal of a founder-executed tool for any session token (policy `founder-executed` says the same in Cedar). */
export const FOUNDER_EXECUTED_POLICY_ID = "founder-executed";

async function refuseFounderExecuted(deps: GatewayDeps, session: SessionToken, req: CallRequestParsed, log: GatewayLogger, ref: string): Promise<ToolCallResult> {
  const reasons = [`${ref} runs only from the founder's own press on the exact request, never for an agent or any token`];
  const audit = await appendAudit(deps, session, req, { outcome: "deny", reasons, policyIds: [FOUNDER_EXECUTED_POLICY_ID] });
  log.warn({ reasons }, "tool call refused: founder-executed tool");
  return { status: 403, body: { outcome: "deny", reasons, policyIds: [FOUNDER_EXECUTED_POLICY_ID], costMinor: 0, auditId: audit.id } };
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

  // 0. Service-only connectors (openai_images): only the platform's own service routes call them, never an agent session,
  // whatever its token was minted with.
  refuseServiceOnly(req.connector);

  // 0b. A founder-executed tool (founder, 2026-11-22) never runs for a session token, whatever it allows (even `*`), in
  // every business mode: only the founder's own press runs it, on `POST /v1/founder-actions/execute` (founder-action.ts).
  if (isFounderExecutedTool(req.connector, req.tool)) return refuseFounderExecuted(deps, session, req, log, ref);

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
  // 2b. A tool with no policy hints entry fails closed (A7-16). The contract suite demands an entry for every tool, so
  // this guards a connector that skipped it, not one that passed.
  if (!Object.hasOwn(connector.policyHints, tool.name)) {
    const reasons = [`Tool ${ref} declares no policy hints`];
    const audit = await appendAudit(deps, session, req, { outcome: "deny", reasons, policyIds: [MISSING_POLICY_HINTS_POLICY_ID] });
    log.warn({ reasons }, "tool call without policy hints");
    return { status: 403, body: { outcome: "deny", reasons, policyIds: [MISSING_POLICY_HINTS_POLICY_ID], costMinor: 0, auditId: audit.id } };
  }

  // 2c. A remote MCP server's unlisted tool whose name would move money, sign, accept terms, delete permanently or change
  // security settings is a hard gate: denied before anyone is asked (the tool is not on Foundmill's list for that server).
  // The same for a founder-executed tool named through `call_unlisted_tool` (in any spelling): denied before anyone is asked.
  const founderNamed = remoteFounderExecutedCall(connector.key, tool.name, args);
  if (founderNamed) return refuseFounderExecuted(deps, session, req, log, `${connector.key}:${founderNamed}`);
  const gatedRemote = remoteHardGateCall(connector.key, tool.name, args);
  if (gatedRemote) {
    const reasons = [`${gatedRemote} on ${connector.displayName} would move money, sign, accept terms, delete permanently or change security settings: only the founder does that, at ${connector.displayName}`];
    const audit = await appendAudit(deps, session, req, { outcome: "deny", reasons, policyIds: [HARD_GATE_POLICY_ID] });
    log.info({ remoteTool: gatedRemote }, "tool call refused: hard-gated remote tool");
    return { status: 403, body: { outcome: "deny", reasons, policyIds: [HARD_GATE_POLICY_ID], costMinor: 0, auditId: audit.id } };
  }

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

  // 4b. Once per session (WP-05 T14, AR-12): the same outward call that already went through in this session is
  //     answered from its audit row, so a retried run cannot send, post, spend or ask twice. Nothing is called. A
  //     repeat that arrives while the first is still running is answered the same way, without running it.
  const doneKey = doneKeyOf(connector, tool.name, req.args, req.context, session);
  const replayed = async (note: string, first: { id: string; createdAt: Date; mode: unknown } | null): Promise<ToolCallResult> => {
    const reasons = [first ? "The same call already ran in this session and went through" : "The same call is still running in this session"];
    const audit = await appendAudit(deps, session, req, { outcome: "replayed", reasons, policyIds: [], ...(first ? { replayOf: first.id } : {}) });
    log.info({ firstAuditId: first?.id ?? null }, "tool call already made in this session; answered without running it again");
    // Simulated or not as the first run was (its audit row's mode), not as the deployment is now.
    const simulated = (first ? first.mode : modeFor(deps, connector.key)) === "mock";
    const data = { replayed: true, ...(first ? { firstRanAt: first.createdAt.toISOString() } : { stillRunning: true }), note };
    const body: AllowResponse = { outcome: "allow", result: { ok: true, data, untrusted: false, costMinor: 0, ...(simulated ? { simulated: true as const, notice: SIMULATED_NOTICE } : {}) }, costMinor: 0, auditId: audit.id, reasons, policyIds: [] };
    return { status: 200, body };
  };
  // 5 onward: Cedar, then deny, ask or allow.
  const decideAndRun = async (): Promise<ToolCallResult> => {
    // 5. Cedar input.
    const policyInput = await buildPolicyInput(deps, session, req, loaded, args);
    const decision = evaluate(policyInput, deps.policyEngine ?? getPolicyEngine());

    // A connector that cannot run here (not connected, or the project's Foundmill address off) is answered as that,
    // before the founder is asked. On a deny it is answered so only when the deny is the basis rule alone
    // (`mail-needs-basis`), so the agent learns mail is not connected; every other deny (untrusted or suppressed
    // recipient, spend cap, hard gate) keeps its own answer. Cedar's deny is audited either way.
    const notRunnable = async (cedarDeny?: EvaluateResult): Promise<ToolCallResult | null> => {
      const refused = connectionRefusal(deps, loaded, modeFor(deps, connector.key));
      if (refused) {
        if (cedarDeny) await appendAudit(deps, session, req, { outcome: "deny", reasons: cedarDeny.reasons, policyIds: cedarDeny.policyIds, errorCode: refused.code });
        throw refused;
      }
      // The project's Foundmill address switched off here: refused as `allow` would refuse it, before anyone is asked.
      const mailOff = connector.key === PLATFORM_MAIL_KEY ? platformMailSwitchRefusal({ config: deps.platformMail, ...(deps.appEnv !== undefined ? { appEnv: deps.appEnv } : {}) }, { business: loaded.business, mode: modeFor(deps, connector.key) }) : null;
      if (!mailOff) return null;
      const reasons = [mailOff.reason];
      const audit = await appendAudit(deps, session, req, { outcome: "deny", reasons: [...reasons, ...(cedarDeny?.reasons ?? [])], policyIds: [mailOff.policyId, ...(cedarDeny?.policyIds ?? [])] });
      log.info({ policyId: mailOff.policyId }, "tool call refused: Foundmill sending address");
      return { status: 403, body: { outcome: "deny", reasons, policyIds: [mailOff.policyId], costMinor: 0, auditId: audit.id } };
    };
    if (decision.outcome === "deny") {
      const basisOnly = decision.policyIds.length > 0 && decision.policyIds.every((id) => id === MAIL_NEEDS_BASIS_POLICY_ID);
      return (basisOnly ? await notRunnable(decision) : null) ?? deny(deps, session, req, loaded, decision, args, log);
    }
    if (decision.outcome === "ask") {
      // The founder already approved this very call (0030): it runs once under that approval instead of asking again,
      // whether the session still waiting retries it or the next session on the task makes it. The approval covers the
      // amount it was asked for, in the same currency, and no more; a deny (spend cap, hard gate, suppression) never
      // reaches this point.
      const granted = await repos.approvals.useGranted(deps.db, businessId, { sessionId: session.sessionId, agentId: session.agentId, connectorKey: connector.key, tool: tool.name, args: argsObject(args), amountMinor: req.context.amountMinor ?? 0, currency: req.context.currency ?? loaded.agent.currency });
      if (granted) {
        log.info({ approvalId: granted.id }, "tool call runs under the founder's approval");
        return runUnderApproval(deps, session, req, loaded, decision, args, log, now, granted);
      }
      return (await notRunnable()) ?? ask(deps, session, req, loaded, decision, args, log, now);
    }
    return allow(deps, session, req, loaded, decision, args, log, now);
  };
  if (!doneKey) return decideAndRun();
  const flightKey = `${businessId}:${session.sessionId}:${doneKey}`;
  if (IN_FLIGHT.has(flightKey)) return replayed(STILL_RUNNING_NOTE, null);
  IN_FLIGHT.add(flightKey);
  try {
    const first = await repos.audit.latestMatching(deps.db, businessId, AUDIT_ACTION_TOOL_CALL, { sessionId: session.sessionId!, doneKey }, new Date(now().getTime() - REPLAY_WINDOW_MS));
    if (first) return await replayed(REPLAYED_NOTE, { id: first.id, createdAt: first.createdAt, mode: (first.details as Record<string, unknown> | null)?.mode });
    return await decideAndRun();
  } finally {
    IN_FLIGHT.delete(flightKey);
  }
}

/**
 * Runs a gated call under the approval this session has just used (`useGranted`, or `useDecided` for one an agent
 * decided). A call the vendor refused outright, or the gateway stopped before the vendor saw it, did nothing: the
 * approval goes back, so the retry (or the next cycle) runs under it instead of asking the same question again.
 */
async function runUnderApproval(deps: GatewayDeps, session: SessionToken, req: CallRequestParsed, loaded: Loaded, decision: EvaluateResult, args: unknown, log: GatewayLogger, now: () => Date, approval: Pick<Approval, "id" | "byKind">): Promise<ToolCallResult> {
  const by = approval.byKind === "agent" ? "the agent Team › Responsibilities names" : "the founder";
  const giveBack = async (why: string) => {
    if (await repos.approvals.releaseUse(deps.db, session.businessId, approval.id, session.sessionId).catch(() => false)) log.info({ approvalId: approval.id, why }, "the call did not run; the approval is kept for the next try");
  };
  try {
    const out = await allow(deps, session, req, loaded, { ...decision, reasons: [...decision.reasons, `Approved by ${by} (approval ${approval.id})`] }, args, log, now, approval.id);
    if (out.body.outcome === "deny") await giveBack("refused before the vendor call");
    else if (out.body.outcome === "allow" && !out.body.result.ok && vendorRefusedOutright(out.body.result.error)) await giveBack(out.body.result.error?.code ?? "refused");
    return out;
  } catch (e) {
    if (e instanceof GatewayError && NOT_RUN_ERRORS.has(e.code)) await giveBack(e.code);
    throw e;
  }
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
 * `mail.sent` for a message that left from the project's Foundmill address (through the outbox). The vendor call has
 * run, so a failure to write it is logged, never returned.
 */
async function recordPlatformMailSent(deps: GatewayDeps, session: SessionToken, sent: PreparedPlatformMail, result: ToolResult, mode: ConnectorMode, log: GatewayLogger): Promise<void> {
  const data = (result.data ?? {}) as { messageId?: unknown };
  try {
    await deps.db.transaction((tx) =>
      writeGatewayEvent(tx, {
        businessId: session.businessId,
        type: "mail.sent",
        actor: { kind: "agent", id: session.agentId },
        payload: { messageRef: sent.envelope.messageRef, messageId: typeof data.messageId === "string" && data.messageId ? data.messageId.slice(0, 200) : sent.envelope.messageRef, recipientHash: sent.recipientHash, fromLocalPart: sent.localPart, channelKey: null, agentId: session.agentId, sessionId: session.sessionId, simulated: mode === "mock" },
      }),
    );
  } catch (e) {
    log.error({ err: safeError(e) }, "message sent from the project's address but mail.sent could not be written");
  }
}

/**
 * The connection checks that need no credential and touch nothing (WP-02 T3): run before a call is allowed and before
 * the founder is asked, so nobody approves a call that cannot run. Live: a connector that needs a sign-in and has no row
 * here (a row without a usable credential is caught in `allow`, after the vault). Mock: a sample business, development
 * and test get the mock's answer (marked simulated); a person's own business on staging or production, with no row or
 * only a `mock` one, is told the truth before anything runs, so no agent plans around a send, a lookup or a post that
 * cannot happen (docs/THESIS_REVIEW.md, package 0.3).
 */
export function connectionRefusal(deps: Pick<GatewayDeps, "appEnv">, loaded: Pick<Loaded, "connector" | "business" | "integrationRow">, mode: ConnectorMode): GatewayError | null {
  const { connector, integrationRow } = loaded;
  // One rule with the orchestrator, which tells an agent what is not connected before it starts (packages/connectors
  // `connectionRefused`, WP-05 T12). An account-free connector in mock mode (web search, exchange rates, domains)
  // answers with made-up results: a person's project on staging or production never receives them as if they were
  // read (WP-05 T1, AR-01). With no APP_ENV (unit hosts) simulated results stay allowed.
  const accountFree = connector.auth.kind === "none";
  const refused = connectionRefused(connector.key, { accountFree, mode, mockResultsAllowed: deps.appEnv === undefined || mockResultsAllowed(deps.appEnv, loaded.business.isDemo), integrationStatus: integrationRow ? integrationRow.status : null });
  if (!refused) return null;
  const message = accountFree ? `${connector.displayName} is not switched on here yet, so nothing was read or done` : mode === "live" ? `${connector.displayName} is not connected for this business` : `${connector.displayName} is not connected for this business, so nothing was done`;
  return new GatewayError("integration_not_connected", message, 409, { connector: connector.key });
}

/** Gateway errors raised before the vendor is called: the call did nothing. */
const NOT_RUN_ERRORS = new Set(["vault_unavailable", "integration_not_connected", "connector_unconfigured"]);
/** The refusal when an agent's approval was taken by another call twice in a row (`ask`): nothing ran, try again. */
const DELEGATED_APPROVAL_TAKEN_POLICY_ID = "delegated-approval-taken";

/**
 * The vendor answered and refused (a 4xx other than a timeout: GitHub's 405 "not mergeable" or 409 "base branch was
 * modified", a 422), or the connector stopped the call before it reached the vendor (bad arguments, an unknown tool).
 * Nothing happened, so an approval used for it can be used again. A 5xx, a timeout or an error with no status may have
 * run: the approval stays spent.
 */
export function vendorRefusedOutright(error: { code?: string; status?: number } | undefined): boolean {
  if (!error) return false;
  if (error.code === "invalid_args" || error.code === "unknown_tool") return true;
  const status = error.status;
  return typeof status === "number" && status >= 400 && status < 500 && status !== 408;
}

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
    paymentRecord: attrs.paymentRecord,
    askAlways: hints.askAlways ?? false,
    founderExecuted: hints.founderExecuted ?? false,
    // Decided here from the call's arguments (never reported by the agent): a DNS change that routes or authenticates email.
    securitySettings: securitySettingsChange(connector.key, tool.name, args) !== null,
  };

  // Spend cap: the agent's own cap, tightened by a holiday budget ceiling while one is active (BUILD §9.6).
  const caps = [autonomy.spendCapMinor, loaded.holidayActive ? (loaded.holidayBudgetMinor ?? undefined) : undefined].filter((v): v is number => typeof v === "number");
  // Approval threshold: the agent's own, lowered to the founder's "Spend cap per action" (Commit, Settings › What the team can do), so
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
  let recipientBasisFound: RecipientBasis | undefined;
  if (toolCtx.contactsThirdParty) {
    const candidates = candidatesFromArgs(args, req.context.recipient);
    recipient ??= candidates[0]?.value;
    suppressed = await anySuppressed(deps, session.businessId, candidates);
    // A seeded session whose seed this replica does not hold (restart, another replica) fails closed.
    const seedMissing = session.untrustedSeeded && !(await deps.recipients.isSeeded(sessionKey(session)));
    recipientFirstSeenInUntrusted = candidates.length > 0 && (seedMissing || (await deps.recipients.firstSeenInUntrusted(session.businessId, sessionKey(session), candidates)).length > 0);
    // A page signup nobody confirmed (package 1.6, double opt-in) proves nothing about who owns the address: a contact
    // whose only basis it is counts as an address first seen in untrusted content, so the same policy refuses it.
    const emails = candidates.filter((c) => c.kind === "email").map((c) => c.value);
    if (!recipientFirstSeenInUntrusted && emails.length > 0) recipientFirstSeenInUntrusted = (await repos.followers.awaitingConfirmation(deps.db, session.businessId, emails)).length > 0;
    // No email without a basis (WP-08 T10, 15-mail-basis.cedar): for the mail-sending tools, the weakest basis among the
    // addresses the mail goes to. A campaign to one of the founder's own lists names nobody: the founder decides it.
    if (isMailSendTool(connector.key, tool.name)) {
      const at = (deps.now ?? (() => new Date()))();
      const to = mailRecipientEmails(args);
      recipientBasisFound = to.length ? weakestBasis(await Promise.all(to.map((e) => recipientBasis(deps.db, session.businessId, e, at)))) : "recorded";
    }
  }

  return {
    principal,
    tool: toolCtx,
    business: { id: business.id, businessMode: business.businessMode, holidayActive: loaded.holidayActive, paymentPowers: business.paymentPowers ?? [] },
    context: {
      amountMinor: policyAmountMinor({ spendsMoney: toolCtx.spendsMoney ?? false, declaredMinor: connector.estimateCostMinor?.(tool.name, args) ?? null, reportedMinor: req.context.amountMinor ?? 0, thresholdMinor: principal.approvalThresholdMinor }),
      ...(recipient ? { recipient } : {}),
      recipientFirstSeenInUntrusted,
      ...(req.context.recipientCountry ? { recipientCountry: req.context.recipientCountry } : {}),
      ...(req.context.localTimeAtRecipient ? { localTimeAtRecipient: req.context.localTimeAtRecipient } : {}),
      suppressed,
      ...(recipientBasisFound ? { recipientBasis: recipientBasisFound } : {}),
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
  /** `replayed`: an outward call answered from its first run in this session (WP-05 T14). */
  outcome: CallResponse["outcome"] | "replayed";
  /** Written when an outward call went through, so a repeat in the same session is not run again. */
  doneKey?: string;
  /** On a `replayed` row: the audit row of the run it answers from. */
  replayOf?: string;
  reasons: string[];
  policyIds: string[];
  costMinor?: number;
  approvalId?: string;
  resultOk?: boolean;
  errorCode?: string;
  untrusted?: boolean;
  /** Untrusted content read from the business's own repository and delivered raw (isFirstPartyRepoRead). */
  firstParty?: boolean;
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
      ...(input.firstParty ? { firstParty: true } : {}),
      ...(input.doneKey ? { doneKey: input.doneKey } : {}),
      ...(input.replayOf ? { replayOf: input.replayOf } : {}),
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
  // An invoice or payment page is the founder's to approve (founder, Nov 16, 2026): never routed as spend, so an agent
  // reporting a large amount cannot hand it to an agent the Responsibilities matrix names.
  if (toolAttributes(loaded.connector.key, loaded.tool.name).paymentRecord) return null;
  if (decision.policyIds.some((id) => id.endsWith("above-threshold")) || (hints.spendsMoney && (req.context.amountMinor ?? 0) > 0)) return "spend_above_threshold" as const;
  if (toolAttributes(loaded.connector.key, loaded.tool.name).contract || loaded.connector.key === "dropbox_sign") return "sign_contracts" as const;
  if (hints.contactsThirdParty) return "message_customers" as const;
  return null;
}

async function ask(deps: GatewayDeps, session: SessionToken, req: CallRequestParsed, loaded: Loaded, decision: EvaluateResult, args: unknown, log: GatewayLogger, now: () => Date, retried = false): Promise<ToolCallResult> {
  // One gated call has one approval (audit O-26): asked again while its approval is open (a retry, or the next session
  // on the task), the call waits on that one instead of queueing a second request and a second Inbox item.
  const open = await repos.approvals.claimOpen(deps.db, session.businessId, { sessionId: session.sessionId, agentId: session.agentId, connectorKey: loaded.connector.key, tool: loaded.tool.name, args: argsObject(args), amountMinor: req.context.amountMinor ?? 0, currency: req.context.currency ?? loaded.agent.currency });
  const queued = open ? { id: open.id, approvedByAgent: false } : await queueApproval(deps, session, req, loaded, decision, args, false);
  const approvalId = queued.id;
  if (queued.approvedByAgent) {
    // The agent's decision covers this call only: it is used now, so no later identical call runs under it (after the
    // founder takes the delegation back, say).
    const used = await repos.approvals.useDecided(deps.db, session.businessId, approvalId, session.sessionId);
    if (used) {
      log.info({ approvalId }, "approval decided by the agent Team › Responsibilities names; the call goes ahead");
      return runUnderApproval(deps, session, req, loaded, decision, args, log, now, used);
    }
    // Another call used it first: that approval has no Inbox item, so waiting on it would wait for nothing. Ask again
    // (once), which opens a fresh approval under the routing as it is now.
    if (!retried) {
      log.info({ approvalId }, "the agent's approval was used by another call; asking again");
      return ask(deps, session, req, loaded, decision, args, log, now, true);
    }
    // Taken again: refuse this once rather than answer "ask" for an approval with no Inbox item. Nothing ran.
    const reasons = ["Another call used this approval at the same moment, so nothing was run. Try again."];
    const policyIds = [DELEGATED_APPROVAL_TAKEN_POLICY_ID];
    const audit = await appendAudit(deps, session, req, { outcome: "deny", reasons, policyIds, approvalId });
    log.warn({ approvalId }, "the agent's approval was used by another call twice; refused, try again");
    return { status: 403, body: { outcome: "deny", reasons, policyIds, costMinor: 0, auditId: audit.id } };
  }
  const audit = await appendAudit(deps, session, req, { outcome: "ask", reasons: decision.reasons, policyIds: decision.policyIds, approvalId });
  log.info({ approvalId, reasons: decision.reasons }, "tool call needs approval");
  const body: AskResponse = { outcome: "ask", approvalId, reasons: decision.reasons, policyIds: decision.policyIds, costMinor: 0, auditId: audit.id };
  return { status: 200, body };
}

async function allow(deps: GatewayDeps, session: SessionToken, req: CallRequestParsed, loaded: Loaded, decision: EvaluateResult, args: unknown, log: GatewayLogger, now: () => Date, approvalId?: string): Promise<ToolCallResult> {
  const { connector, tool } = loaded;
  const mode = modeFor(deps, connector.key);
  const refused = connectionRefusal(deps, loaded, mode);
  if (refused) throw refused;
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
  // IndexNow connected for the project's Foundmill-hosted page speaks for the page at the address it was connected
  // with. Once the page is taken down or its address changes (the old address may be another project's by now), nothing
  // is sent until the founder connects it again (security review, Nov 12, 2026).
  if (mode === "live" && connector.key === "indexnow" && integration.config.hosted === true) {
    const page = await repos.pages.get(deps.db, session.businessId);
    if (!page || page.published === null || page.slug !== integration.config.slug) {
      throw new GatewayError("integration_not_connected", "IndexNow was connected for a public page address that is no longer this project's live page, so nothing was sent. Connect IndexNow again in Settings › Integrations.", 409, { connector: connector.key });
    }
  }

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

  // A project's Foundmill sending address: its own guards, after Cedar and before the vendor (platform-mail.ts).
  let platformMail: PreparedPlatformMail | null = null;
  if (connector.key === PLATFORM_MAIL_KEY) {
    const decision = await preparePlatformMail({ db: deps.db, rateLimits: deps.rateLimits, config: deps.platformMail, ...(deps.appEnv !== undefined ? { appEnv: deps.appEnv } : {}) }, { business: loaded.business, args: guarded.args, mode, now: now().getTime(), agentId: session.agentId, log });
    if (!decision.ok) {
      const reasons = [decision.reason];
      const audit = await appendAudit(deps, session, req, { outcome: "deny", reasons, policyIds: [decision.policyId] });
      log.info({ policyId: decision.policyId }, "tool call refused: Foundmill sending address");
      return { status: 403, body: { outcome: "deny", reasons, policyIds: [decision.policyId], costMinor: 0, auditId: audit.id } };
    }
    platformMail = decision.prepared;
    ctx.platformMail = platformMail.envelope;
  }

  // A founder's own Resend: the unsubscribe link is Foundmill's signed one for this recipient, never the agent's, so an
  // opt-out reaches this project's suppression list. Where no such link can be made, the connector sends nothing.
  if (connector.key === "resend" && tool.name === "send_mail") {
    const to = (guarded.args as { to?: { email?: unknown } } | null)?.to?.email;
    const link = typeof to === "string" ? ownSenderUnsubscribeUrl(deps.platformMail, { businessId: session.businessId, email: to, mode, ...(deps.appEnv !== undefined ? { appEnv: deps.appEnv } : {}) }) : null;
    if (link) ctx.unsubscribeUrl = link;
  }

  let result: ToolResult;
  try {
    result = await connector.callTool(tool.name, guarded.args, ctx);
  } catch (e) {
    // The count goes back only when nothing can have gone out: the connector stopped before the vendor (configuration).
    if (isConfigError(e)) {
      await platformMail?.release();
      throw new GatewayError("connector_unconfigured", e.message, 503, { connector: connector.key });
    }
    throw e;
  }
  if (platformMail) {
    // A definite refusal (a 4xx, or the connector's own check) sent nothing; a timeout or a 5xx may have, so it stays counted.
    if (!result.ok && vendorRefusedOutright(result.error)) await platformMail.release();
    else if (result.ok) await recordPlatformMailSent(deps, session, platformMail, result, mode, log);
  }

  // Untrusted content: the agent receives the envelope; its recipients are remembered for this session (BUILD §9.8).
  let data = result.data;
  let untrusted = false;
  let firstParty = false;
  if (isUntrusted(result.data)) {
    const { content } = readForQuarantine(result.data);
    // The business's own repository (the Code tab, or its installation's repository list) is first-party: raw, below.
    // Decided only for a call that succeeded: GitHub is asked about the repository (cached) only when the call names the
    // Code-tab repository at HEAD or a branch.
    if (result.ok && connector.key === "github" && FIRST_PARTY_REPO_TOOLS.has(tool.name)) {
      const installed = mode === "live" ? appInstalled : loaded.integrationRow !== null && platformKeyConnected(loaded.integrationRow);
      firstParty = await decideFirstParty(deps, { connector, tool: tool.name, args: guarded.args, ctx, installed, log });
    }
    const archive = connector.key === "github" && REPO_ARCHIVE_TOOLS.has(tool.name);
    // Recipients first seen here still need the founder's approval, first-party or not. An archive is compressed bytes
    // with no text to scan; it reaches an agent only when it is the Code tab's (withheld below otherwise).
    if (!archive) {
      // The typed read's values too: an address there is written the way the agent will use it (an encoded quote, a
      // normalized path), which the scan of the raw content can cut short (security review, Nov 12, 2026).
      const found = [...candidatesFromContent(content), ...candidatesFromContent(toAgentEnvelope(result.data).facts ?? null)];
      const added = await deps.recipients.record(session.businessId, found);
      if (added > 0) log.debug({ added }, "recipients first seen in untrusted content recorded for this business");
    }
    data = toAgentEnvelope(result.data);
    if (firstParty) {
      // Still the untrusted envelope with its notice (data, never instructions); only the digest step is skipped.
      data = { ...toAgentEnvelope(result.data), firstParty: true };
    } else if (archive) {
      const { facts: _withheld, ...withoutFacts } = toAgentEnvelope(result.data);
      data = { ...withoutFacts, content: null, quarantined: true, unavailable: ARCHIVE_WITHHELD };
    } else if (session.sessionId === null && isServiceMediaTool(connector.key, tool.name)) {
      // A media file the platform stores (a post draft's voiceover), asked for by a platform token outside any session:
      // code stores it and no agent reads it, so it is handed over as it came, inside the envelope with its notice.
      // An agent session calling the same tool still gets the reader's digest below.
    } else if (deps.reader && grantsOutboundTools(deps.registry, session.allowedTools)) {
      // An agent that can contact people, spend or do something irreversible never reads third-party text raw: a model with no
      // tools reads it and the agent gets typed fields only (BUILD §9.8 step 2). If the reader fails, the agent gets nothing.
      try {
        // The reader is shown the content's text, with any binary value (a voiceover's base64) as a note of its size: its
        // window then holds the words around the bytes, and a 4 MB file is never serialized into its prompt.
        const digest = await deps.reader.digest({ content: readableContent(content), businessId: session.businessId, agentId: session.agentId, sessionId: session.sessionId });
        // The digest is third-party content too: an address the reader wrote out (one the raw scan missed or cut short)
        // reaches the agent as an ordinary address, so it is remembered like the raw text's. If that fails, nothing is passed on.
        const fromDigest = await deps.recipients.record(session.businessId, candidatesFromContent(digest));
        if (fromDigest > 0) log.debug({ added: fromDigest }, "recipients first seen in the quarantined reader's digest recorded for this business");
        // `toAgentEnvelope` carries the tool's typed read (`facts`, already held to the facts limits) beside the digest.
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
    firstParty,
    ...(result.ok ? (() => { const doneKey = doneKeyOf(connector, tool.name, req.args, req.context, session); return doneKey ? { doneKey } : {}; })() : {}),
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
  log.info({ ok: result.ok, costMinor, untrusted, ...(firstParty ? { firstParty } : {}), errorCode: result.error?.code }, "tool call executed");
  const body: AllowResponse = {
    outcome: "allow",
    result: { ok: result.ok, ...(data !== undefined ? { data } : {}), ...(result.error ? { error: result.error } : {}), untrusted, costMinor, ...(mode === "mock" ? { simulated: true as const, notice: SIMULATED_NOTICE } : {}) },
    costMinor,
    auditId: audit.id,
    reasons: decision.reasons,
    policyIds: decision.policyIds,
  };
  return { status: 200, body };
}
