/**
 * Outcome evals (WP-05 T6, AR-15): one agent session with real tools reaches a result, checked on the database.
 *
 * `runSessionCase` seeds an agent and a task in a test database (PGlite, apps/orchestrator's harness), runs one session
 * through the orchestrator's own activities (`prepareSession` → `runAgentSession` → `finishSession`, the live runner on
 * the Claude Agent SDK) against an in-process gateway (`buildGateway`, the real pipeline and the real `platform` tools),
 * then reads back what the session left: the task's status, its report, the tool calls, the pages it read, the mail it
 * sent. Outside the process nothing is reached but the model:
 *  - `web` runs live over a fixture: three fixed pages, and a search that lists them (the Anthropic search call is
 *    answered by the fixture, never sent);
 *  - `sendgrid` runs live into a capture inbox (`platform_mail` follows it); the project's own address is off;
 *  - the gateway and the orchestrator run as on staging (`APP_ENV=staging`), so a simulated or not-connected result is
 *    never counted as done (`mockResultsAllowed` is false for a person's project).
 *
 * Mock mode (`MODEL_MODE` not live, no key): the SDK is replaced by the case's script, which calls the same gateway over
 * HTTP with the session's own token, so the seeding, the gateway, the runner and the checks run in the unit suite. Live:
 * the real SDK runs, and the cost of every case comes off one run budget (`OUTCOME_EVAL_BUDGET_USD`, Estimate).
 *
 * A test file routes the SDK through `interceptQuery` with `vi.mock("@anthropic-ai/claude-agent-sdk", ...)`; see
 * `__tests__/sessions.eval.test.ts`.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAllConnectors, createRegistry, createWebConnector, type Connector } from "@foundmill/connectors";
import { initialVersionFromTemplate, listTemplates } from "@foundmill/agents";
import { periodOf, repos, type Task, type TaskReport } from "@foundmill/db";
import { readSessionEvents } from "@foundmill/events";
import { buildGateway, createGatewayBuiltins, createUntrustedReader, listenGateway, platformSearchWeb, type RunningGateway } from "@foundmill/gateway";
import { MemoryRateLimitStore, type RateLimitStore } from "@foundmill/gateway/rate-limit";
import type { GatewayLogger } from "@foundmill/gateway/pipeline";
import { createModelClient, type ModelClient } from "@foundmill/models";
import { ACCEPTANCE_RUN_LOG, createSessionActivities } from "@foundmill/orchestrator/activities/session";
import type { SessionResult } from "@foundmill/orchestrator/activities/types";
import { createGatewayClient } from "@foundmill/orchestrator/gateway-client";
import { openSessionRow, setupOrchestratorHarness, type OrchestratorTestHarness } from "@foundmill/orchestrator/__tests__/harness";
import { createBusinessFixture } from "@foundmill/db/__tests__/rls/fixtures";
import type { SandboxProvider } from "@foundmill/sandbox";
import { loadEnv, type TaskKind } from "@foundmill/shared";

/** The whole nightly run's model budget, US dollars (Estimate; founder decision D4, Nov 15, 2026). */
export const OUTCOME_EVAL_BUDGET_USD = 2;
/** A case does not start with less than this left (US cents): it could not finish, and would only spend. */
export const MIN_CASE_BUDGET_MINOR = 10;

// ------------------------------------------------------------------------------------------------ the fixture web

export interface FixturePage {
  url: string;
  title: string;
  html: string;
}

const page = (title: string, body: string) => `<html><head><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;

/** The only pages the web serves in an outcome eval: three suppliers of compostable cups, with facts a report can cite. */
export const FIXTURE_PAGES: readonly FixturePage[] = Object.freeze([
  {
    url: "https://greencup-supply.example/wholesale",
    title: "GreenCup Supply: wholesale compostable cups",
    html: page("GreenCup Supply: wholesale compostable cups", "<p>Plant-based PLA-lined paper cups, 8 oz and 12 oz, certified compostable (EN 13432).</p><p>Minimum order: 1,000 cups. Price: $0.11 per 12 oz cup at 5,000 cups. Ships in 5 business days.</p>"),
  },
  {
    url: "https://leafware.example/catering/cups",
    title: "Leafware catering cups",
    html: page("Leafware catering cups", "<p>Bagasse and bamboo-fiber cups with water-based lining, home compostable.</p><p>Minimum order: 500 cups. Price: $0.16 per 12 oz cup. Free samples for cafes. Ships in 10 business days.</p>"),
  },
  {
    url: "https://northbay-packaging.example/compostable",
    title: "Northbay Packaging: compostable range",
    html: page("Northbay Packaging: compostable range", "<p>Industrial-compostable paper cups and lids (BPI certified).</p><p>Minimum order: 10,000 cups. Price: $0.08 per 12 oz cup. Custom printing from 20,000 cups. Ships in 3 weeks.</p>"),
  },
]);

/** An address as the fixture compares it: no fragment, no trailing slash. */
export const normalUrl = (u: string): string => {
  try {
    const url = new URL(u);
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return u;
  }
};

const FIXTURE_BY_URL = new Map(FIXTURE_PAGES.map((p) => [normalUrl(p.url), p]));
/** Every fixture host resolves to this public address (documentation range is private-looking; this one is not). */
const FIXTURE_ADDRESS = "93.184.215.14";

export interface FixtureWeb {
  connector: Connector;
  /** Addresses of fixture pages the gateway read, in order. */
  served: string[];
  /** Searches the gateway ran. */
  searches: string[];
  /** Anything else the web connector tried to reach (should stay empty). */
  refused: string[];
}

/** The live `web` connector (its real `fetch_page` and `search_web` code) over the fixture: nothing leaves the process. */
export function createFixtureWeb(): FixtureWeb {
  const served: string[] = [];
  const searches: string[] = [];
  const refused: string[] = [];
  const fixtureFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(href);
    // `search_web` asks Anthropic's server search; the fixture answers in its place with the three pages.
    if (url.hostname === "api.anthropic.com") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: { content?: string }[] };
      searches.push(String(body.messages?.[0]?.content ?? "").slice(0, 200));
      const results = FIXTURE_PAGES.map((p) => ({ type: "web_search_result", url: p.url, title: p.title, page_age: null, encrypted_content: "fixture" }));
      const message = {
        id: "msg_fixture",
        type: "message",
        role: "assistant",
        model: "fixture",
        content: [
          { type: "server_tool_use", id: "srvtoolu_fixture", name: "web_search", input: { query: "fixture" } },
          { type: "web_search_tool_result", tool_use_id: "srvtoolu_fixture", content: results },
        ],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      };
      return new Response(JSON.stringify(message), { status: 200, headers: { "content-type": "application/json" } });
    }
    const fixture = FIXTURE_BY_URL.get(normalUrl(href));
    if (!fixture) {
      refused.push(href);
      return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
    }
    served.push(normalUrl(fixture.url));
    return new Response(fixture.html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  }) as typeof fetch;
  // The search runs the model client's real request code (`LiveModelClient.searchWeb`, WP-09 T3) against the fixture.
  const searchClient = createModelClient({ mode: "live", apiKey: "fixture-search-key", fetch: fixtureFetch });
  const connector = createWebConnector({ secrets: {}, fetch: fixtureFetch, resolveHost: async () => [FIXTURE_ADDRESS], searchWeb: platformSearchWeb(searchClient) });
  return { connector, served, searches, refused };
}

// ------------------------------------------------------------------------------------------------ the capture inbox

export interface CapturedMail {
  url: string;
  body: string;
}

/** Every vendor request the catalogue's live connectors make lands here (only `sendgrid` runs live): nothing is sent. */
export function createCaptureInbox(): { fetch: typeof fetch; mail: CapturedMail[] } {
  const mail: CapturedMail[] = [];
  const capture = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    mail.push({ url, body: String(init?.body ?? "").slice(0, 4000) });
    return new Response("", { status: 202, headers: { "x-message-id": `captured-${mail.length}` } });
  }) as typeof fetch;
  return { fetch: capture, mail };
}

// ------------------------------------------------------------------------------------------------ the SDK seam

/**
 * One call of the agent's tools in a mock run: what the scripted agent calls, with arguments built from the case and from
 * what its earlier calls returned (`seen`: each tool result as the agent received it, parsed), as a live agent's are.
 */
export interface ScriptStep {
  connector: string;
  tool: string;
  args: (ctx: CaseContext, seen: readonly unknown[]) => Record<string, unknown>;
}

/**
 * A step of a code case's script: a tool call, a file written in the session's workspace (`write`, as the SDK's Write
 * tool does), or the end of the agent's turn (`endTurn`): the script then waits for the next turn the session sends (a
 * fix turn after failing tests), and stops when the session sends none.
 */
export type CodeStep = ScriptStep | { write: string; content: string } | { endTurn: true };

export interface CaseContext {
  businessId: string;
  agentId: string;
  taskId: string;
  sessionId: string;
}

type QueryCall = { prompt: unknown; options: Record<string, unknown> };
type HookFn = (input: Record<string, unknown>) => Promise<unknown>;

/** Built-in tools a session must never run without a grant (checked on every case). */
export const PROBED_BUILTINS = ["Bash", "WebFetch", "Skill"] as const;
const PROBE_INPUTS: Record<(typeof PROBED_BUILTINS)[number], Record<string, unknown>> = {
  Bash: { command: "env" },
  WebFetch: { url: "https://greencup-supply.example/wholesale", prompt: "Summarize." },
  Skill: { skill: "anything" },
};

interface ActiveCase {
  live: boolean;
  ctx: CaseContext;
  script: readonly CodeStep[];
  options: Record<string, unknown> | null;
  probe: Promise<Record<string, { allow: boolean }>> | null;
  /** The turns the session sent after the first (mock: the script's `endTurn`s read them). */
  turns: string[];
  /** The case's test sandbox, when it has acceptance tests. */
  sandbox: SandboxProvider | null;
}

let active: ActiveCase | null = null;

/** The verdicts of the session's own PreToolUse hook on Bash, WebFetch and Skill (allowed or not). */
async function probeBuiltins(options: Record<string, unknown>): Promise<Record<string, { allow: boolean }>> {
  const hooks = (options.hooks as { PreToolUse?: { hooks: HookFn[] }[] } | undefined)?.PreToolUse ?? [];
  const out: Record<string, { allow: boolean }> = {};
  for (const name of PROBED_BUILTINS) {
    let allow = true;
    for (const matcher of hooks)
      for (const hook of matcher.hooks) {
        const verdict = (await hook({ hook_event_name: "PreToolUse", tool_name: name, tool_input: PROBE_INPUTS[name], tool_use_id: `probe-${name}`, session_id: "probe", transcript_path: "", cwd: String(options.cwd ?? "") })) as { hookSpecificOutput?: { permissionDecision?: string } } | undefined;
        if (verdict?.hookSpecificOutput?.permissionDecision === "deny") allow = false;
      }
    out[name] = { allow };
  }
  return out;
}

/**
 * The SDK's `query`, as the outcome evals see it: the options are kept for the checks, the session's PreToolUse hook is
 * asked about Bash, WebFetch and Skill, and then the real SDK runs (live) or the case's script does (mock).
 */
export function interceptQuery(actual: (call: QueryCall) => unknown, call: QueryCall): unknown {
  const run = active;
  if (!run) return actual(call);
  run.options = call.options;
  run.probe = probeBuiltins(call.options);
  const watched = { ...call, prompt: keepTurns(call.prompt as AsyncIterable<UserTurn>, run.turns) };
  if (run.live) return actual(watched);
  return Object.assign(scriptedRun(watched, run.script, run.ctx), { async interrupt() {}, async setModel() {} });
}

type UserTurn = { message?: { content?: unknown } };

/** The session's turns as the SDK reads them, every one after the first kept as text. */
async function* keepTurns(prompts: AsyncIterable<UserTurn>, turns: string[]): AsyncGenerator<UserTurn> {
  let first = true;
  for await (const turn of prompts) {
    if (!first) turns.push(typeof turn.message?.content === "string" ? turn.message.content : JSON.stringify(turn.message?.content ?? ""));
    first = false;
    yield turn;
  }
}

/**
 * The mock agent: each step a tool_use, run through the gateway with the session's token, and its tool_result; a
 * `write` puts a file in the workspace; an `endTurn` ends the turn and waits for the next (none: the session ended).
 */
async function* scriptedRun(call: QueryCall, script: readonly CodeStep[], ctx: CaseContext): AsyncGenerator<Record<string, unknown>> {
  const servers = (call.options.mcpServers ?? {}) as Record<string, { url: string; headers: Record<string, string> }>;
  const prompts = script.some((s) => "endTurn" in s) ? (call.prompt as AsyncIterable<UserTurn>)[Symbol.asyncIterator]() : null;
  if (prompts) await prompts.next();
  yield { type: "system", subtype: "init", session_id: `script-${ctx.sessionId}` };
  const seen: unknown[] = [];
  for (const [i, step] of script.entries()) {
    const id = `tu-${i}`;
    if ("endTurn" in step) {
      yield { type: "result", subtype: "success", modelUsage: {} };
      if ((await prompts!.next()).done) return;
      continue;
    }
    if ("write" in step) {
      const file = path.join(String(call.options.cwd), step.write);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, step.content);
      yield { type: "assistant", message: { content: [{ type: "tool_use", id, name: "Write", input: { file_path: file, content: step.content } }] } };
      yield { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: "File written." }] } };
      continue;
    }
    const args = step.args(ctx, seen);
    yield { type: "assistant", message: { content: [{ type: "tool_use", id, name: `mcp__${step.connector}__${step.tool}`, input: args }] } };
    const server = servers[step.connector];
    let text: string;
    let isError: boolean;
    if (!server) {
      text = JSON.stringify({ error: { code: "not_granted", message: `no ${step.connector} tools in this session` } });
      isError = true;
    } else {
      const base = server.url.replace(/\/mcp\/[^/]+$/, "");
      const res = await fetch(`${base}/v1/call`, { method: "POST", headers: { ...server.headers, "content-type": "application/json" }, body: JSON.stringify({ connector: step.connector, tool: step.tool, args }) });
      text = await res.text();
      isError = !res.ok;
    }
    try {
      seen.push(JSON.parse(text) as unknown);
    } catch {
      seen.push(text);
    }
    yield { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: text, ...(isError ? { is_error: true } : {}) }] } };
  }
  yield { type: "result", subtype: "success", modelUsage: {} };
}

// ------------------------------------------------------------------------------------------------ the run budget

/** What the run has spent so far, US cents (Estimate): every case's session cost, plus the gateway's model calls. */
export class RunBudget {
  spentMinor = 0;
  constructor(readonly totalMinor: number = Math.round(OUTCOME_EVAL_BUDGET_USD * 100)) {}
  get remainingMinor(): number {
    return Math.max(0, this.totalMinor - this.spentMinor);
  }
  /** True when the next case may not start (too little left to finish one). */
  get reached(): boolean {
    return this.remainingMinor < MIN_CASE_BUDGET_MINOR;
  }
  add(minor: number): void {
    if (Number.isFinite(minor) && minor > 0) this.spentMinor += minor;
  }
}

// ------------------------------------------------------------------------------------------------ cases and results

export interface ToolCallSeen {
  connectorKey: string | null;
  tool: string;
  status: string;
  policyOutcome: string | null;
  resultSummary: string;
}

export interface SessionObservation {
  task: Task;
  result: SessionResult;
  report: TaskReport | null;
  /** Finished tool calls of the session, from its event stream. */
  toolCalls: ToolCallSeen[];
  /** Fixture pages the gateway read during this case. */
  served: string[];
  /** Mail that reached the capture inbox during this case. */
  mail: CapturedMail[];
  /** The options the session handed the SDK. */
  options: Record<string, unknown> | null;
  /** The session's PreToolUse hook on Bash, WebFetch and Skill. */
  builtins: Record<string, { allow: boolean }>;
  /** The turns the session sent the agent after its first (a fix turn after failing tests). */
  turns: string[];
  /** The session's acceptance runs, in order (`test_result` events). */
  tests: { passed: number; failed: number }[];
  /** The workspace as the last acceptance run saw it (path → text); empty without one. */
  testedFiles: ReadonlyMap<string, string>;
  /** The Needs you items this case's agent left for the founder (WP-05 T22, T26), newest first. */
  needsYou: { subject: string; bodyMd: string }[];
}

/** What the case's own check of the copied workspace found: a test runner's summary line and output. */
export interface FixtureTestRun {
  passed: number;
  failed: number;
  output: string;
}

export interface SessionCase {
  id: string;
  title: string;
  /** Agent template (`agentType`). */
  agentType: string;
  /** `platform_only`: the agent holds only its template's platform grant (the narrowest a session can have). */
  grants?: "template" | "platform_only";
  /**
   * `sample`: the session runs in a sample project (`is_demo`), where a mock connector answers as if connected, marked
   * simulated (the "connected" half of a not-connected pair). Default `person`: a person's project, where it does not.
   */
  business?: "person" | "sample";
  task: { kind: TaskKind; title: string; goalMd: string; acceptance?: unknown[] };
  /** `free`: the project is on the free plan for this case (WP-13), as a new project made in the Ideation Studio is. */
  plan?: "free";
  /** The task is a second read's revision (WP-05 T23): its session keeps only the revision's tools. */
  revision?: boolean;
  /** Files saved on the task before the session starts (a code task's codebase): restored into its workspace. */
  workspace?: Readonly<Record<string, string>>;
  /**
   * A code case's acceptance run, in a fixture sandbox: the workspace is copied in as the live runner copies it and this
   * function reads it and answers in place of the test command. No code the agent wrote is executed.
   */
  acceptanceRun?: (files: ReadonlyMap<string, string>) => FixtureTestRun;
  /** The mock agent's tool calls (mock mode only). */
  script: readonly ScriptStep[];
  /** A code case's mock agent (mock mode only), in place of `script`: tool calls, file writes and turn ends. */
  codeScript?: readonly CodeStep[];
  /** Problems with what the session left; empty is a pass. */
  check(o: SessionObservation): string[];
}

export interface SessionCaseResult {
  caseId: string;
  passed: boolean;
  problems: string[];
  /** US cents (Estimate). */
  costMinor: number;
  outcome: string | null;
  taskStatus: string | null;
  summary: string | null;
  /** The start of the session's report, for a failing case's log line. */
  reportExcerpt?: string;
  /** The session's finished tool calls in order, as `connector:tool/status`, for a failing case's log line. */
  toolTrail?: string;
  /** The session's last notes (the agent's words and the system's), for a failing case's log line. */
  notes?: string;
  error?: string;
}

export interface SessionEvalEnv {
  live: boolean;
  budget: RunBudget;
  close(): Promise<void>;
  runSessionCase(c: SessionCase): Promise<SessionCaseResult>;
}

const silentLog: GatewayLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => silentLog };

/** No sandbox: a task that is not code needs none, and the outcome cases have no acceptance run. */
const noSandbox: SandboxProvider = {
  mode: "docker",
  async available() {
    return { available: true };
  },
  async create() {
    throw new Error("outcome evals run no sandbox");
  },
};

/**
 * The fixture sandbox of a code case: it keeps the files the live runner copies in, installs nothing, and answers the
 * acceptance command (the exec that writes the run log) with the case's `acceptanceRun` over those files, as a runner
 * prints its summary ("N passed, M failed"). Every other exec succeeds with no output. Nothing is executed.
 */
export function createFixtureSandbox(acceptanceRun: (files: ReadonlyMap<string, string>) => FixtureTestRun): { provider: SandboxProvider; lastFiles: () => ReadonlyMap<string, string> } {
  let last: ReadonlyMap<string, string> = new Map();
  const provider: SandboxProvider = {
    mode: "docker",
    async available() {
      return { available: true };
    },
    async create(input) {
      const files = new Map<string, string>();
      last = files;
      const ok = { code: 0, stdout: "", stderr: "", timedOut: false, durationMs: 1 };
      return {
        id: `fixture-${input.sessionId ?? "session"}`,
        provider: "docker",
        spec: input as never,
        workdir: "/work",
        state: "running",
        async start() {},
        async exec(cmd: string) {
          if (!cmd.includes(ACCEPTANCE_RUN_LOG)) return ok;
          const r = acceptanceRun(files);
          return { code: r.failed > 0 ? 1 : 0, stdout: `${r.passed} passed${r.failed > 0 ? `, ${r.failed} failed` : ""}\n${r.output}`, stderr: "", timedOut: false, durationMs: 1 };
        },
        async writeFile(p: string, content: string | Uint8Array) {
          files.set(p.replace(/^(\/work\/|\.\/)/, ""), typeof content === "string" ? content : Buffer.from(content).toString("utf8"));
        },
        async closeEgress() {},
        async readFile() {
          return "";
        },
        async listFiles() {
          return [];
        },
        async snapshot() {
          return { id: "fixture", sandboxId: "fixture", provider: "docker", ref: "fixture", createdAt: new Date(0).toISOString() };
        },
        async stop() {},
      };
    },
  };
  return { provider, lastFiles: () => last };
}

const GATEWAY_SECRET = "outcome-evals-session-token-secret-0123456789";

/**
 * One database, one gateway and one orchestrator for the run; `runSessionCase` adds an agent and a task per case. The
 * key is read before the orchestrator harness sets MODEL_MODE=mock for its own defaults.
 */
export async function createSessionEvalEnv(options: { budget?: RunBudget } = {}): Promise<SessionEvalEnv> {
  const shared = loadEnv();
  const apiKey = shared.MODEL_MODE === "live" && shared.ANTHROPIC_API_KEY ? shared.ANTHROPIC_API_KEY : null;
  const live = apiKey !== null;
  const budget = options.budget ?? new RunBudget();

  const t: OrchestratorTestHarness = await setupOrchestratorHarness({ prefix: "outcome" });
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "fm-outcome-ws-"));
  const web = createFixtureWeb();
  const inbox = createCaptureInbox();

  // The gateway's own model calls (the quarantined reader) run on the same key and count against the run budget.
  const gatewayModels: ModelClient = live ? createModelClient({ mode: "live", apiKey, onUsage: (e) => budget.add(e.cost.costMinorInt) }) : createModelClient({ mode: "mock" });
  const catalogue = createAllConnectors({ secrets: { sendgridApiKey: "SG.capture-inbox" }, fetch: inbox.fetch });
  const builtins = createGatewayBuiltins({ db: t.db, vault: null, models: gatewayModels, mode: live ? "live" : "mock", log: silentLog, live: { secrets: { sendgridApiKey: "SG.capture-inbox" }, fetch: inbox.fetch } }).filter((c) => c.key !== "web");
  const registry = createRegistry([...catalogue, ...builtins, web.connector]);
  const gatewayEnv = loadEnv({ APP_ENV: "staging", INTEGRATIONS_MODE: "mock", MODEL_MODE: live ? "live" : "mock", LIVE_CONNECTORS: "web,sendgrid", SESSION_TOKEN_SECRET: GATEWAY_SECRET });
  // The reader runs on `gatewayModels` as well: given a registry, `buildGateway` builds its own from the env otherwise,
  // and its calls were off the run budget.
  const reader = createUntrustedReader(gatewayModels);
  // Each case counts its own calls (the web's 30 a minute is per business, and every case runs on one business).
  let caseLimits = new MemoryRateLimitStore();
  const caseRateLimits: RateLimitStore = {
    hit: (...a) => caseLimits.hit(...a),
    release: (...a) => caseLimits.release(...a),
    count: (...a) => caseLimits.count(...a),
    claim: (...a) => caseLimits.claim(...a),
    unclaim: (...a) => caseLimits.unclaim(...a),
  };
  const built = buildGateway({ env: gatewayEnv, db: t.db, registry, models: gatewayModels, reader, vault: null, rateLimits: caseRateLimits, log: silentLog });
  const server: RunningGateway = await listenGateway(built.app, { port: 0, host: "127.0.0.1" });
  const gateway = createGatewayClient({ baseUrl: server.url, serviceSecret: GATEWAY_SECRET, serviceName: "orchestrator" });

  const deps = {
    ...t.deps,
    // As on staging: a simulated or not-connected result is never a person's result.
    env: { ...t.deps.env, APP_ENV: "staging" as const, INTEGRATIONS_MODE: "mock" as const, LIVE_CONNECTORS: "web,sendgrid", ANTHROPIC_API_KEY: apiKey ?? "sk-ant-api03-outcome-evals-mock-key", ORCHESTRATOR_WORKSPACE_DIR: workspaceRoot },
    gateway,
    // A code case brings its fixture sandbox; every other case runs none.
    sandbox: async () => ({ provider: active?.sandbox ?? noSandbox, mode: "docker" as const, fellBackFrom: null }),
  };
  const acts = createSessionActivities(deps);
  const templates = listTemplates();
  // The projects stay on their plan (the session model a founder gets), with credits for a whole run: the fixture's
  // included credits ran out four dollars into the launch gate's first pass and paused every agent after (run 45380563437).
  const RUN_CREDITS_MINOR = 10_000;
  const fund = (businessId: string) => repos.usage.grantCredits(t.db, businessId, periodOf(t.clock.now()), RUN_CREDITS_MINOR);
  await fund(t.businessId);
  // The sample project, made on first use: the same fixture as the person's project, marked `is_demo`.
  let sample: { businessId: string; departmentId: string } | null = null;
  const sampleProject = async () => {
    if (!sample) {
      const f = await createBusinessFixture(t.h, `sample-${Math.random().toString(36).slice(2, 7)}`);
      await t.h.pg.query("update businesses set is_demo = true where id = $1", [f.businessId]);
      await fund(f.businessId);
      sample = { businessId: f.businessId, departmentId: f.departmentId };
    }
    return sample;
  };

  async function runSessionCase(c: SessionCase): Promise<SessionCaseResult> {
    const base = { caseId: c.id, costMinor: 0, outcome: null, taskStatus: null, summary: null };
    if (budget.reached) return { ...base, passed: false, problems: [`the run budget of $${OUTCOME_EVAL_BUDGET_USD} (Estimate) is reached; the case did not start`] };
    const template = templates.find((x) => x.agentType === c.agentType);
    if (!template) return { ...base, passed: false, problems: [`no agent template ${c.agentType}`] };
    const spec = initialVersionFromTemplate(template, "00000000-0000-0000-0000-000000000000");
    const tools = c.grants === "platform_only" ? spec.tools.filter((g) => g.connectorKey === "platform") : spec.tools;
    const where = c.business === "sample" ? await sampleProject() : { businessId: t.businessId, departmentId: t.fixture.departmentId };
    const businessId = where.businessId;
    const agent = await repos.agents.create(t.db, businessId, { name: `Eval ${template.name}`.slice(0, 80), role: template.role, agentType: template.agentType, layer: "worker", descriptionMd: template.description, departmentIds: [where.departmentId], modelKey: template.modelKey, status: "idle", autonomy: spec.autonomy, initialVersion: { instructions: spec.instructions, tools, modelKey: spec.modelKey } });
    const task = await repos.tasks.create(t.db, businessId, { kind: c.task.kind, title: c.task.title, goalMd: c.task.goalMd, ...(c.task.acceptance ? { acceptance: c.task.acceptance as never } : {}), assigneeAgentId: agent.id, status: "ready" });
    // A code case's codebase: saved on the task as an earlier session's work, so the session starts from it.
    if (c.workspace) {
      const files = Object.entries(c.workspace).map(([p, text]) => ({ path: p, content: new TextEncoder().encode(text) }));
      await t.db.transaction((tx) => repos.workspaces.save(tx as never, businessId, { taskId: task.id, files, carryOver: true }));
    }
    caseLimits = new MemoryRateLimitStore();
    // Each case starts with no Needs you item, so one said once in an earlier case does not hide this case's.
    for (const i of (await repos.inbox.list(t.db, businessId, { tab: "respond", limit: 200 })).items) await repos.inbox.archive(t.db, businessId, i.id, { force: true });
    if (c.revision) await repos.audit.append(t.db, businessId, { actorKind: "system", action: "second_read.completed", target: { kind: "task", id: task.id }, details: { revisionTaskId: task.id } });
    if (c.plan === "free") await repos.businesses.update(t.db, businessId, { planTier: "free", modelBilling: "credits" });
    const sessionId = await openSessionRow({ ...t, businessId }, agent.id, task.id);
    const ctx: CaseContext = { businessId, agentId: agent.id, taskId: task.id, sessionId };
    const servedFrom = web.served.length;
    const mailFrom = inbox.mail.length;
    const fixture = c.acceptanceRun ? createFixtureSandbox(c.acceptanceRun) : null;
    const planBefore = (await repos.businesses.get(t.db, businessId)).planTier;
    const run: ActiveCase = { live, ctx, script: c.codeScript ?? c.script, options: null, probe: null, turns: [], sandbox: fixture?.provider ?? null };
    active = run;
    try {
      // The run's budget left is this session's cap (the SDK stops at it: `maxBudgetUsd`).
      const input = { ...ctx, spendCapMinor: Math.floor(budget.remainingMinor) };
      const launch = await acts.prepareSession(input);
      const result = await acts.runAgentSession(input, launch);
      await acts.finishSession(input, launch, result);
      const costMinor = (result.costMicroMinor ?? result.costMinor * 1_000_000) / 1_000_000;
      budget.add(costMinor);
      const after = await repos.tasks.get(t.db, businessId, task.id);
      const report = await repos.taskReports.latestForTask(t.db, businessId, task.id);
      const events = await readSessionEvents(t.redis, sessionId);
      const toolCalls: ToolCallSeen[] = events
        .map((r) => r.event)
        .filter((e): e is Extract<typeof e, { kind: "tool_call" }> => e.kind === "tool_call" && e.status !== "started")
        .map((e) => ({ connectorKey: e.connectorKey ?? null, tool: e.tool, status: e.status, policyOutcome: e.policyOutcome ?? null, resultSummary: e.resultSummary ?? "" }));
      const builtinsSeen = run.probe ? await run.probe : {};
      const tests = events.map((r) => r.event).flatMap((e) => (e.kind === "test_result" && e.acceptance ? [{ passed: e.passed, failed: e.failed }] : []));
      const needsYou = (await repos.inbox.list(t.db, businessId, { tab: "respond", limit: 50 })).items.filter((i) => i.fromAgentId === agent.id).map((i) => ({ subject: i.subject, bodyMd: i.bodyMd }));
      const observation: SessionObservation = { task: after, result, report, toolCalls, served: web.served.slice(servedFrom), mail: inbox.mail.slice(mailFrom), options: run.options, builtins: builtinsSeen, turns: run.turns, tests, testedFiles: fixture?.lastFiles() ?? new Map(), needsYou };
      const problems = run.options ? c.check(observation) : ["the session never reached the SDK", ...c.check(observation)];
      return { caseId: c.id, passed: problems.length === 0, problems, costMinor, outcome: result.outcome, taskStatus: after.status, summary: result.summary, reportExcerpt: report?.bodyMd.slice(0, 1500), toolTrail: toolCalls.map((x) => `${x.connectorKey ?? "sdk"}:${x.tool}/${x.status}${x.policyOutcome ? `/${x.policyOutcome}` : ""}`).join(", "), notes: events.map((e) => e.event).flatMap((e) => (e.kind === "note" ? [`${e.source}: ${e.text.slice(0, 300)}`] : [])).slice(-4).join("\n") };
    } catch (err) {
      return { ...base, passed: false, problems: [`the session threw: ${(err as Error).message}`], error: (err as Error).message };
    } finally {
      active = null;
      if (c.plan === "free") await repos.businesses.update(t.db, businessId, { planTier: planBefore });
    }
  }

  return {
    live,
    budget,
    runSessionCase,
    async close() {
      await server.stop();
      await built.close();
      await rm(workspaceRoot, { recursive: true, force: true });
      await t.close();
    },
  };
}
