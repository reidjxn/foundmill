/**
 * Builder for connectors. A connector is declared as a list of `ToolSpec`s (Zod input/output + policy
 * hints) plus typed handlers; the builder derives the MCP tool definitions and `policyHints`, validates
 * arguments and outputs, refuses hard-gated tools before any handler can run, wraps third-party content as
 * untrusted and maps vendor failures to `ToolError`s. Both the live and the mock side of every connector go
 * through it, so they behave identically at the contract boundary.
 */
import { z } from "zod";
import { AppError } from "@foundmill/shared";
import {
  ConfigError,
  VendorError,
  type Connector,
  type ConnectorAuth,
  type ConnectorMode,
  type ConnectorPhase,
  type ConnectorWebhook,
  type HealthResult,
  type HumanActionDescriptor,
  type IntegrationRecord,
  type JsonSchemaObject,
  type McpToolAnnotations,
  type McpToolDefinition,
  type MockConnector,
  type PlatformEvent,
  type PolicyHint,
  type PolicyHints,
  type SimulateParams,
  type ToolContext,
  type ToolError,
  type ToolResult,
} from "./contract";
import { wrapUntrusted, type UntrustedSourceKind } from "./quarantine";

export interface ToolSpec<N extends string = string, I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  name: N;
  title?: string;
  description: string;
  input: I;
  output?: O;
  hints: PolicyHint;
  annotations?: McpToolAnnotations;
  /** Set when the tool returns third-party content; the result is wrapped with `wrapUntrusted` (BUILD §9.8). */
  untrusted?: UntrustedSourceKind;
  /** Vendor reference for the untrusted wrapper (message id, file id...). Method syntax keeps specs assignable to `AnyToolSpec`. */
  untrustedRef?(args: z.output<I>): string | undefined;
  /** Required for `hints.hardGate` tools: what the founder must do instead. The tool itself never executes. */
  humanAction?(args: z.output<I>): { title: string; instructions: string; url?: string };
  /** Estimated cost per call in minor units; falls back to the connector's `costModel`, then 0. */
  costMinor?(args: z.output<I>): number;
}

export type AnyToolSpec = ToolSpec<string, z.ZodType, z.ZodType>;

export type ToolHandler<S extends AnyToolSpec> = (args: z.output<S["input"]>, ctx: ToolContext) => Promise<z.input<S["output"]>>;

/** Handler map typed from the tool tuple; hard-gated tools have no handler (enforced at build time). */
export type ToolHandlers<S extends readonly AnyToolSpec[]> = {
  [T in S[number] as T["name"]]?: ToolHandler<T>;
};

const TOOL_NAME_RE = /^[a-z][a-z0-9_]{1,63}$/;

export function defineTool<N extends string, I extends z.ZodType, O extends z.ZodType = z.ZodType>(spec: ToolSpec<N, I, O>): ToolSpec<N, I, O> {
  if (!TOOL_NAME_RE.test(spec.name)) throw new Error(`Tool name "${spec.name}" must be snake_case`);
  if (spec.hints.hardGate && !spec.humanAction) throw new Error(`Hard-gated tool "${spec.name}" must describe its human action`);
  if (!spec.hints.hardGate && spec.humanAction) throw new Error(`Tool "${spec.name}" has a humanAction but is not hardGate`);
  return spec;
}

/** Zod → JSON Schema (draft-07) object schema for MCP. `$schema` is dropped; non-object roots are rejected. */
export function zodToJsonSchema(schema: z.ZodType, io: "input" | "output"): JsonSchemaObject {
  const json = z.toJSONSchema(schema, { target: "draft-7", io, unrepresentable: "any" }) as Record<string, unknown>;
  delete json.$schema;
  if (json.type !== "object") {
    // MCP requires an object root; wrap scalars/arrays so the definition stays valid.
    return { type: "object", properties: { value: json }, required: ["value"], additionalProperties: false };
  }
  return json as JsonSchemaObject;
}

export function toMcpDefinition(spec: AnyToolSpec): McpToolDefinition {
  const def: McpToolDefinition = {
    name: spec.name,
    description: spec.description,
    inputSchema: zodToJsonSchema(spec.input, "input"),
    annotations: {
      readOnlyHint: !(spec.hints.irreversible || spec.hints.spendsMoney || spec.hints.contactsThirdParty || spec.hints.hardGate),
      destructiveHint: Boolean(spec.hints.irreversible || spec.hints.hardGate),
      openWorldHint: Boolean(spec.hints.contactsThirdParty),
      ...spec.annotations,
    },
  };
  if (spec.title) def.title = spec.title;
  if (spec.output) def.outputSchema = zodToJsonSchema(spec.output, "output");
  return def;
}

export function policyHintsFor(specs: readonly AnyToolSpec[]): PolicyHints {
  const hints: PolicyHints = {};
  for (const s of specs) hints[s.name] = { ...s.hints };
  return hints;
}

export interface ConnectorSpec<S extends readonly AnyToolSpec[]> {
  key: string;
  displayName: string;
  phase: ConnectorPhase;
  auth: ConnectorAuth;
  tools: S;
  /** `NoInfer` keeps S inferred from `tools` only, so handler parameters are contextually typed. */
  handlers: NoInfer<ToolHandlers<S>>;
  rateLimits: Connector["rateLimits"];
  costModel?: Connector["costModel"];
  webhooks?: ConnectorWebhook[];
  connect(businessId: string, input: unknown): Promise<IntegrationRecord>;
  healthcheck(integration: IntegrationRecord): Promise<HealthResult>;
  /** Mock side only: named simulations for the dev Simulate panel and tests. */
  simulations?: Record<string, (params: SimulateParams) => Promise<PlatformEvent[]> | PlatformEvent[]>;
  now?: () => Date;
}

type Handlers = Record<string, ((args: unknown, ctx: ToolContext) => Promise<unknown>) | undefined>;

export const CONNECTOR_KEY_RE = /^[a-z][a-z0-9_]{1,40}$/;

function assertSpec(spec: ConnectorSpec<readonly AnyToolSpec[]>, mode: ConnectorMode): void {
  if (!CONNECTOR_KEY_RE.test(spec.key)) throw new Error(`Connector key "${spec.key}" must be snake_case`);
  const names = new Set<string>();
  const handlers = spec.handlers as Handlers;
  for (const t of spec.tools) {
    if (names.has(t.name)) throw new Error(`${spec.key}: duplicate tool "${t.name}"`);
    names.add(t.name);
    const hasHandler = typeof handlers[t.name] === "function";
    if (t.hints.hardGate && hasHandler) throw new Error(`${spec.key}: hard-gated tool "${t.name}" must not have a handler (BUILD §2.2)`);
    if (!t.hints.hardGate && !hasHandler) throw new Error(`${spec.key} (${mode}): tool "${t.name}" has no handler`);
  }
  for (const name of Object.keys(handlers)) {
    if (!names.has(name)) throw new Error(`${spec.key}: handler "${name}" has no tool definition`);
  }
}

export function toToolError(e: unknown): ToolError {
  if (e instanceof VendorError) {
    const code = e.httpStatus === 429 ? "rate_limited" : e.httpStatus === 404 ? "not_found" : e.httpStatus === 401 || e.httpStatus === 403 ? "unauthorized" : "vendor_error";
    return { code, message: e.message, status: e.httpStatus, retryable: e.retryable, details: e.body };
  }
  if (e instanceof AppError) return { code: e.code, message: e.message, status: e.status, details: e.details };
  if (e instanceof Error) {
    const status = numberProp(e, "status") ?? numberProp(e, "statusCode");
    if (status !== undefined) return { code: status === 429 ? "rate_limited" : status === 404 ? "not_found" : "vendor_error", message: e.message, status, retryable: status === 429 || status >= 500 };
    return { code: "tool_failed", message: e.message };
  }
  return { code: "tool_failed", message: String(e) };
}

function numberProp(obj: object, key: string): number | undefined {
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "number" ? v : undefined;
}

export function hardGateResult(connector: string, spec: AnyToolSpec, args: unknown): ToolResult<HumanActionDescriptor> {
  const action = spec.humanAction?.(args) ?? { title: `Complete "${spec.name}" manually`, instructions: "This action always requires a human (BUILD §2.2)." };
  return {
    ok: false,
    error: { code: "hard_gate", message: `${connector}.${spec.name} always requires a human action (BUILD §2.2); queued for the founder.` },
    data: { connector, tool: spec.name, args, reason: "hard_gate", ...action },
    costMinor: 0,
  };
}

function createCallTool(spec: ConnectorSpec<readonly AnyToolSpec[]>, mode: ConnectorMode, now: () => Date) {
  const byName = new Map<string, AnyToolSpec>(spec.tools.map((t) => [t.name, t]));
  const handlers = spec.handlers as Handlers;
  return async function callTool(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const tool = byName.get(name);
    if (!tool) return { ok: false, error: { code: "unknown_tool", message: `${spec.key} has no tool "${name}"` }, costMinor: 0 };
    // Hard gates are refused before argument parsing: nothing about the call may run.
    if (tool.hints.hardGate) {
      ctx.log.warn({ connector: spec.key, tool: name, businessId: ctx.businessId, agentId: ctx.agentId }, "hard-gated tool requested; returning human-action descriptor");
      return hardGateResult(spec.key, tool, args);
    }
    const parsed = tool.input.safeParse(args ?? {});
    if (!parsed.success) {
      return { ok: false, error: { code: "invalid_args", message: `${spec.key}.${name}: ${z.prettifyError(parsed.error)}`, details: parsed.error.issues }, costMinor: 0 };
    }
    const handler = handlers[name];
    if (!handler) return { ok: false, error: { code: "unknown_tool", message: `${spec.key}.${name} has no handler` }, costMinor: 0 };
    const startedAt = now().getTime();
    let data: unknown;
    try {
      data = await handler(parsed.data, ctx);
    } catch (e) {
      if (e instanceof ConfigError) throw e; // misconfiguration is the operator's problem, not the agent's
      const error = toToolError(e);
      ctx.log.warn({ connector: spec.key, tool: name, code: error.code, status: error.status }, "tool call failed");
      return { ok: false, error, costMinor: 0 };
    }
    if (tool.output) {
      const out = tool.output.safeParse(data);
      if (!out.success) {
        ctx.log.error({ connector: spec.key, tool: name, issues: out.error.issues.slice(0, 5) }, "tool returned data that does not match its output schema");
        return { ok: false, error: { code: "invalid_output", message: `${spec.key}.${name} returned an unexpected shape: ${z.prettifyError(out.error)}` }, costMinor: 0 };
      }
      data = out.data;
    }
    const costMinor = tool.costMinor ? tool.costMinor(parsed.data) : (spec.costModel?.(name, parsed.data) ?? 0);
    const result: ToolResult = { ok: true, data, costMinor };
    if (tool.untrusted) {
      result.data = wrapUntrusted(data, { connector: spec.key, kind: tool.untrusted, ref: tool.untrustedRef?.(parsed.data) }, { now });
      result.untrusted = true;
    }
    ctx.log.debug({ connector: spec.key, tool: name, mode, ms: now().getTime() - startedAt, costMinor, untrusted: result.untrusted ?? false }, "tool call ok");
    return result;
  };
}

function assemble<S extends readonly AnyToolSpec[]>(spec: ConnectorSpec<S>, mode: ConnectorMode): Omit<Connector, "mock"> {
  assertSpec(spec as ConnectorSpec<readonly AnyToolSpec[]>, mode);
  const now = spec.now ?? (() => new Date());
  const base: Omit<Connector, "mock"> = {
    key: spec.key,
    displayName: spec.displayName,
    phase: spec.phase,
    auth: spec.auth,
    connect: (businessId, input) => spec.connect(businessId, input),
    healthcheck: (integration) => spec.healthcheck(integration),
    tools: spec.tools.map(toMcpDefinition),
    callTool: createCallTool(spec as ConnectorSpec<readonly AnyToolSpec[]>, mode, now),
    rateLimits: spec.rateLimits,
    policyHints: policyHintsFor(spec.tools),
  };
  if (spec.costModel) base.costModel = spec.costModel;
  const byName = new Map<string, AnyToolSpec>(spec.tools.map((t) => [t.name, t]));
  base.estimateCostMinor = (name, args) => {
    const tool = byName.get(name);
    if (!tool) return null;
    const parsed = tool.input.safeParse(args ?? {});
    // Arguments the tool rejects spend nothing: the call fails validation before any handler runs.
    if (!parsed.success) return 0;
    if (tool.costMinor) return tool.costMinor(parsed.data);
    return spec.costModel ? spec.costModel(name, parsed.data) : null;
  };
  if (spec.webhooks) base.webhooks = spec.webhooks;
  return base;
}

/** Build the mock side. Its `mock` is itself, so `registry.get(key, "mock").mock.mock` is still the mock. */
export function buildMockConnector<S extends readonly AnyToolSpec[]>(spec: ConnectorSpec<S>): MockConnector {
  const base = assemble(spec, "mock");
  const simulations = spec.simulations ?? {};
  const mock = {
    ...base,
    isMock: true as const,
    simulations: Object.freeze(Object.keys(simulations)),
    async simulate(eventName: string, params: SimulateParams): Promise<PlatformEvent[]> {
      const fn = simulations[eventName];
      if (!fn) throw new AppError("unknown_simulation", `${spec.key} mock cannot simulate "${eventName}" (available: ${Object.keys(simulations).join(", ") || "none"})`, 400);
      return fn(params);
    },
  } as MockConnector;
  (mock as { mock: Connector }).mock = mock;
  return mock;
}

/** Build the live side around its mock. */
export function buildLiveConnector<S extends readonly AnyToolSpec[]>(spec: ConnectorSpec<S>, mock: MockConnector): Connector {
  if (mock.key !== spec.key) throw new Error(`mock key "${mock.key}" does not match connector "${spec.key}"`);
  const base = assemble(spec, "live");
  return { ...base, mock };
}

export const isMockConnector = (c: Connector): c is MockConnector => (c as MockConnector).isMock === true;

/** Common output fragments. */
export const MoneyOut = z.object({ amountMinor: z.number().int(), currency: z.string().length(3) });
export const PageOut = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export function healthResult(status: HealthResult["status"], startedAt: number, extra: { message?: string; details?: Record<string, unknown>; now?: () => Date } = {}): HealthResult {
  const nowDate = (extra.now ?? (() => new Date()))();
  return { ok: status === "connected" || status === "mock", status, checkedAt: nowDate.toISOString(), latencyMs: Math.max(0, nowDate.getTime() - startedAt), ...(extra.message ? { message: extra.message } : {}), ...(extra.details ? { details: extra.details } : {}) };
}
