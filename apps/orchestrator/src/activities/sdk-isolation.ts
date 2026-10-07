/**
 * Isolation for the host process that runs the Claude Agent SDK in a live session (SECURITY_REVIEW SEC-3; BUILD §9.3
 * "no long-lived credentials inside the sandbox", AC-11.6.6).
 *
 * The SDK subprocess is the only part of a live session that runs on the orchestrator host, so it gets:
 *
 * - **a minimal environment** built from scratch (`sdkEnvFor`): PATH and locale from the host, HOME and TMPDIR inside
 *   the per-session workspace, the short-lived sandbox identifiers, the gateway session token and the model key the
 *   SDK itself needs. `process.env` is never spread in; the result is asserted with `assertNoLongLivedCredentials`
 *   with the model key as the single exemption, so a platform secret (DATABASE_URL, SESSION_TOKEN_SECRET, Stripe,
 *   GitHub App...) in the host environment can never reach the agent;
 * - **a per-session workspace** (`createSessionWorkspace`): a fresh 0700 directory under ORCHESTRATOR_WORKSPACE_DIR that
 *   is the SDK's `cwd`, `HOME` (so `~/.claude` lives inside it) and `TMPDIR`, deleted in `finally`;
 * - **tools by task kind** (`sdkToolPolicyFor`): code tasks get the five file tools (Read/Glob/Grep/Edit/Write) plus the
 *   gateway MCP tools; every other kind gets the MCP tools only and no built-in tool at all (`tools: []`). Bash,
 *   WebFetch, WebSearch, sub-agents and notebooks are disallowed for every kind;
 * - **a path guard** (`guardToolCall`, wired as a PreToolUse hook): every file-tool call must resolve, symlinks
 *   followed, inside the workspace; anything else (and any non-MCP tool outside the policy) is denied before it runs.
 *   MCP tools pass through: the gateway's policy pipeline is their guard.
 *
 * Nothing in this module logs or returns environment values; `describeEnvForAudit` names are the most a log may carry.
 */
import { mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { assertNoLongLivedCredentials } from "@foundmill/sandbox";
import type { TaskKind } from "@foundmill/shared";

/** The one credential the SDK host process has to hold. */
export const SDK_MODEL_KEY_NAME = "ANTHROPIC_API_KEY";
/** Environment variable carrying the short-lived gateway session token (a JWT that expires with the session). */
export const SDK_SESSION_TOKEN_NAME = "FM_GATEWAY_SESSION_TOKEN";

/**
 * Host variables copied into the SDK environment when set: binary lookup, locale and outbound connectivity only.
 * Nothing here is a credential; a proxy URL carrying user info is refused rather than passed on.
 */
export const SDK_HOST_PASSTHROUGH = ["PATH", "LANG", "LC_ALL", "TZ", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS", "ANTHROPIC_BASE_URL"] as const;

const PROXY_NAMES = new Set(["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy", "ANTHROPIC_BASE_URL"]);

/** Built-in SDK tools a code task may use, all confined to the workspace by `guardToolCall`. */
export const FILE_TOOLS = ["Read", "Glob", "Grep", "Edit", "Write"] as const;
/** Built-in tools no session may use, whatever the task kind. Listed explicitly so a preset change upstream cannot re-enable them. */
export const ALWAYS_DISALLOWED_TOOLS = ["Bash", "BashOutput", "KillBash", "KillShell", "WebFetch", "WebSearch", "NotebookEdit", "NotebookRead", "MultiEdit", "Agent", "Task", "Skill", "TodoWrite", "ExitPlanMode", "EnterWorktree", "ExitWorktree", "LS"] as const;

export interface SdkEnvInput {
  /** The per-session workspace; becomes HOME and TMPDIR's parent. */
  cwd: string;
  /** Model key the SDK process authenticates with (BYOK or platform). */
  apiKey: string;
  /** Short-lived gateway session token (expires with the session). */
  sessionToken: string;
  /** The sandbox's short-lived identifiers (`buildSandboxEnv`), already asserted. */
  sandboxEnv: Record<string, string>;
  /** Host environment to copy `SDK_HOST_PASSTHROUGH` from. Defaults to `process.env`. */
  host?: Record<string, string | undefined>;
}

function assertNoProxyCredentials(name: string, value: string): void {
  if (!PROXY_NAMES.has(name)) return;
  try {
    const u = new URL(value);
    if (u.username || u.password) throw new Error(`${name} carries credentials; the SDK process cannot receive them`);
  } catch (err) {
    if ((err as Error).message.includes("cannot receive")) throw err;
    /* not a URL: let the credential check judge it */
  }
}

/**
 * Build the SDK subprocess environment from scratch. Asserted with `assertNoLongLivedCredentials`, exempting only
 * `ANTHROPIC_API_KEY` (name and value), so the gateway session token must still be short-lived and no sandbox
 * identifier may carry a secret. Throws `LongLivedCredentialError` (names only, never values) otherwise.
 */
export function sdkEnvFor(input: SdkEnvInput): Record<string, string> {
  const host = input.host ?? process.env;
  const env: Record<string, string> = {};
  for (const name of SDK_HOST_PASSTHROUGH) {
    const value = host[name];
    if (typeof value !== "string" || value.length === 0) continue;
    assertNoProxyCredentials(name, value);
    env[name] = value;
  }
  if (!env.PATH) env.PATH = "/usr/local/bin:/usr/bin:/bin";
  if (!env.LANG) env.LANG = "C.UTF-8";
  env.HOME = input.cwd;
  env.TMPDIR = path.join(input.cwd, ".tmp");
  env.CLAUDE_CONFIG_DIR = path.join(input.cwd, ".claude");
  // Telemetry, auto-update checks and feedback surveys: none of it belongs in an agent session.
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  env.DISABLE_AUTOUPDATER = "1";
  for (const [k, v] of Object.entries(input.sandboxEnv)) {
    if (k === SDK_MODEL_KEY_NAME || k === SDK_SESSION_TOKEN_NAME || k === "HOME" || k === "PATH") throw new Error(`sandbox env may not set ${k}`);
    env[k] = v;
  }
  env[SDK_SESSION_TOKEN_NAME] = input.sessionToken;
  env[SDK_MODEL_KEY_NAME] = input.apiKey;
  assertNoLongLivedCredentials(env, { allowNames: [SDK_MODEL_KEY_NAME], allowValues: [SDK_MODEL_KEY_NAME] });
  return env;
}

export interface SdkToolPolicy {
  /** `Options.tools`: the base set of built-in tools. Empty for non-code tasks (no built-in tool exists). */
  tools: string[];
  /** `Options.allowedTools`: auto-allowed in `dontAsk` mode (MCP tools, plus the file tools for code tasks). */
  allowedTools: string[];
  /** `Options.disallowedTools`: removed from the model's context whatever the mode. */
  disallowedTools: string[];
  /** Whether the file tools exist in this session. */
  fileTools: boolean;
}

/** Built-in tools by task kind: code tasks edit files inside the workspace; nothing else touches the host file system. */
export function sdkToolPolicyFor(kind: TaskKind, mcpTools: readonly string[]): SdkToolPolicy {
  const fileTools = kind === "code";
  const mcp = mcpTools.filter((t) => t.startsWith("mcp__"));
  return {
    tools: fileTools ? [...FILE_TOOLS] : [],
    allowedTools: fileTools ? [...mcp, ...FILE_TOOLS] : [...mcp],
    disallowedTools: fileTools ? [...ALWAYS_DISALLOWED_TOOLS] : [...ALWAYS_DISALLOWED_TOOLS, ...FILE_TOOLS],
    fileTools,
  };
}

export type ToolGuardVerdict = { allow: true } | { allow: false; reason: string };

const PATH_KEYS = ["file_path", "path", "notebook_path", "directory", "cwd"] as const;
const PATTERN_KEYS = ["pattern", "glob"] as const;

/** Resolve `p` against `cwd`, following symlinks on the deepest existing ancestor, and tell whether it stays inside `cwdReal`. */
async function resolvesInside(cwdReal: string, cwd: string, p: string): Promise<boolean> {
  const expanded = p === "~" || p.startsWith("~/") ? path.join(cwd, p.slice(1)) : p;
  const absolute = path.resolve(cwd, expanded);
  let probe = absolute;
  const tail: string[] = [];
  for (;;) {
    try {
      const real = await realpath(probe);
      const resolved = tail.length ? path.join(real, ...tail.reverse()) : real;
      return resolved === cwdReal || resolved.startsWith(cwdReal + path.sep);
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) return false;
      tail.push(path.basename(probe));
      probe = parent;
    }
  }
}

const escapesByPattern = (pattern: string): boolean => path.isAbsolute(pattern) || pattern.startsWith("~") || pattern.split(/[\\/]/).includes("..");

/**
 * Decide whether a tool call may run. MCP tools always may (the gateway is their policy engine); file tools may when
 * every path-like argument resolves inside the workspace; everything else is denied.
 */
export async function guardToolCall(toolName: string, input: unknown, opts: { cwd: string; policy: SdkToolPolicy }): Promise<ToolGuardVerdict> {
  if (toolName.startsWith("mcp__")) return { allow: true };
  if (!opts.policy.fileTools || !(FILE_TOOLS as readonly string[]).includes(toolName)) return { allow: false, reason: `${toolName} is not available in this session` };
  const args = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  let cwdReal: string;
  try {
    cwdReal = await realpath(opts.cwd);
  } catch {
    return { allow: false, reason: "the session workspace is gone" };
  }
  for (const key of PATH_KEYS) {
    const v = args[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string" || v.includes("\0")) return { allow: false, reason: `${toolName}.${key} must be a path inside the session workspace` };
    if (!(await resolvesInside(cwdReal, opts.cwd, v))) return { allow: false, reason: `${toolName}.${key} is outside the session workspace` };
  }
  for (const key of PATTERN_KEYS) {
    const v = args[key];
    if (typeof v === "string" && escapesByPattern(v)) return { allow: false, reason: `${toolName}.${key} must stay inside the session workspace` };
  }
  return { allow: true };
}

/** The SDK `PreToolUse` hook shape (`SyncHookJSONOutput` subset) built from a verdict. */
export function hookOutputFor(verdict: ToolGuardVerdict): { continue: true } | { hookSpecificOutput: { hookEventName: "PreToolUse"; permissionDecision: "deny"; permissionDecisionReason: string } } {
  return verdict.allow ? { continue: true } : { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: verdict.reason } };
}

/** A fresh, private (0700) workspace for one session: cwd, HOME and TMPDIR of the SDK process. Any leftover from a retry is removed first. */
export async function createSessionWorkspace(root: string, sessionId: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{8,}$/.test(sessionId)) throw new Error("session id is not a safe directory name");
  const cwd = path.join(path.resolve(root), sessionId);
  await rm(cwd, { recursive: true, force: true });
  await mkdir(cwd, { recursive: true, mode: 0o700 });
  await mkdir(path.join(cwd, ".tmp"), { mode: 0o700 });
  return cwd;
}

/** Delete the workspace and everything the SDK wrote under it (`~/.claude`, temp files, session files). Idempotent. */
export async function removeSessionWorkspace(cwd: string): Promise<void> {
  await rm(cwd, { recursive: true, force: true, maxRetries: 3 });
}
