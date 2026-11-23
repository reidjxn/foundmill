/**
 * Founder-executed actions (founder, 2026-11-22): "the agent never decides or calls submit and pay. The founder's press
 * does, so this is the founder filing, not agent code acting in their name."
 *
 * A founder-executed tool (`policyHints.founderExecuted`, packages/connectors `FOUNDER_EXECUTED_TOOLS`) is in no agent's
 * tool list and `executeToolCall` refuses it for every session token (policy id `founder-executed`). Two things exist:
 *
 *  - PREPARE (`prepareFounderAction`, reached by an agent through the platform tool `prepare_founder_action`): reads the
 *    subject through the gateway, records the exact payload and its hash in `founder_actions`, and writes ONE Needs you
 *    note that shows exactly what the press will do. It sends nothing.
 *  - EXECUTE (`POST /v1/founder-actions/execute`, service token `svc: api` only): the api calls it when the founder
 *    presses the note's one option in a signed-in session, with a single-use press token (tokens.ts) bound to the
 *    request, the project, the founder and the sha256 of the payload the note showed. In order, each a refusal that
 *    runs nothing:
 *
 *      1. the token verifies (signature, audience, expiry, a lifetime of at most five minutes);
 *      2. the request is loaded for the token's own project, and is still `prepared` (a used, voided or failed one is not run again);
 *      3. the token's hash equals the row's hash AND the sha256 of the canonical JSON of the stored payload;
 *      4. the tool is founder-executed, its connector is connected (live, or the recorded mock where mock results are allowed);
 *      5. the project is not archived and Stop all agents is not on;
 *      6. what the note showed is read again; if it changed the request is voided and a NEW request and note replace it;
 *      7. the request is claimed in one atomic update (`prepared` to `executing`, the token's id recorded): a replay or a
 *         second press at the same moment gets nothing;
 *      8. Cedar, with `context.founderPress`, which the `founder-executed` policy requires and no agent call can carry;
 *      9. the vendor call, with the project's own credential; then the audit row (`founder_action.executed`, the founder
 *         the actor) and the usage row, and the request is finished `executed` or `failed`.
 *
 * Autopilot, automated mode, vacation and standing approvals never reach this route: there is no `approvals` row for
 * a founder action, the note is excluded from every automatic answer, and only a signed-in founder's press mints a token.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { repos, bookUsage, type FounderAction } from "@foundmill/db";
import { evaluate, getPolicyEngine, type PolicyEngine } from "@foundmill/policy";
import { isOwnerRole, PATENT_REQUEST_NOTE, FOUNDER_ACTION_KEY_PREFIX, MODEL_KEYS, founderActionPayloadHash, patentRequestNote, uuid, type InventionFacts } from "@foundmill/shared";
import { isConfigError, isFounderExecutedTool, isUntrusted, mockIntegrationRecord, type Connector, type PlatformCaller, type ToolContext, type ToolResult } from "@foundmill/connectors";
import { loadCredential, persistRefreshedCredential, toIntegrationRecord } from "./credentials";
import { writeGatewayEvent } from "./events";
import { connectionRefusal, modeFor, safeError, vendorRefusedOutright, type GatewayDeps } from "./pipeline";
import { stateDenial } from "./state";
import { verifyFounderPressToken } from "./tokens";
import { tracedToolCall } from "./tracing";
import { CallRequest } from "./types";

export const FOUNDER_ACTION_EXECUTE_ROUTE = "/v1/founder-actions/execute";

export const ExecuteFounderActionRequest = z.strictObject({ pressToken: z.string().min(20).max(4000) });
export type ExecuteFounderActionRequest = z.infer<typeof ExecuteFounderActionRequest>;

/** What the api is told. `refused` and `failed` ran nothing at the vendor or got a refusal from it; `voided` means the subject changed. */
export type FounderActionOutcome =
  | { status: "executed"; simulated: boolean; message: string }
  | { status: "voided"; message: string; newActionId: string | null }
  | { status: "failed"; reason: string }
  /** The vendor call may have run and nothing proves otherwise: the request is finished `unknown`, never "failed", and is not run again. */
  | { status: "unknown"; reason: string }
  | { status: "refused"; code: RefusalCode; reason: string };

export type RefusalCode = "not_found" | "already_used" | "payload_changed" | "not_founder_executed" | "not_connected" | "stopped" | "could_not_check" | "policy" | "unsupported" | "not_founder";

const FACT_KEYS = ["inventionId", "title", "refNum", "contentHash"] as const;
const INVENTION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

/** The typed read of `get_innovation`'s untrusted answer, or null when the answer carried none. */
function inventionFactsOf(data: unknown): InventionFacts | null {
  const facts = isUntrusted(data) ? ((data as { facts?: Record<string, unknown> }).facts ?? null) : ((data as { facts?: Record<string, unknown> } | null)?.facts ?? null);
  if (!facts) return null;
  const s = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const inventionId = s(facts["inventionId"]);
  const contentHash = s(facts["contentHash"]);
  return inventionId && contentHash ? { inventionId, title: s(facts["title"]), refNum: s(facts["refNum"]), contentHash } : null;
}

const factsRecord = (f: InventionFacts): Record<string, string | null> => Object.fromEntries(FACT_KEYS.map((k) => [k, f[k]]));

/** The call context for a tool call the gateway makes itself, with the project's own credential (no agent session). Building it calls no vendor. */
async function directContext(deps: GatewayDeps, input: { businessId: string; connector: Connector; agentId: string | null; log: GatewayDeps["log"] }): Promise<ToolContext> {
  const { businessId, connector } = input;
  const mode = modeFor(deps, connector.key);
  const row = await repos.integrations.getByKey(deps.db, businessId, connector.key);
  let credential = null as Awaited<ReturnType<typeof loadCredential>> | null;
  if (row && deps.vault) credential = await loadCredential(deps.db, deps.vault, businessId, row.id);
  const integration = row ? toIntegrationRecord(row, credential) : mockIntegrationRecord(connector.key, businessId, mode === "mock" ? {} : { status: "connected" });
  const vault = deps.vault;
  const held = credential;
  return {
    businessId,
    agentId: input.agentId ?? "",
    sessionId: null,
    integration,
    ...(held ? { credential: held.credential } : {}),
    ...(held && vault ? { onCredentialRefreshed: (c) => persistRefreshedCredential(deps.db, vault, businessId, held, c) } : {}),
    log: input.log,
    mode,
  };
}

async function callDirect(deps: GatewayDeps, input: { businessId: string; connector: Connector; tool: string; args: Record<string, unknown>; agentId: string | null; log: GatewayDeps["log"] }): Promise<ToolResult> {
  return input.connector.callTool(input.tool, input.args, await directContext(deps, input));
}

function connectorOf(deps: GatewayDeps, key: string): Connector | null {
  try {
    return deps.registry.get(key, modeFor(deps, key));
  } catch {
    return null;
  }
}

/** The typed facts of one invention, read as the founder's own account (the re-read before a press). */
async function readInventionDirect(deps: GatewayDeps, businessId: string, connector: Connector, inventionId: string, log: GatewayDeps["log"]): Promise<InventionFacts | null> {
  const r = await callDirect(deps, { businessId, connector, tool: "get_innovation", args: { invention_id: inventionId }, agentId: null, log });
  return r.ok ? inventionFactsOf(r.data) : null;
}

export interface FounderActionPreparer {
  prepare(caller: PlatformCaller, input: { connector: string; tool: string; inventionId: string }): Promise<{ actionId: string; inboxItemId: string; created: boolean; note: string }>;
}

/** The pairs an agent may prepare: each founder-executed tool the platform knows how to show a note for. */
const PREPARABLE: ReadonlySet<string> = new Set(["lightbringer_mcp:request_patent_preparation"]);

export class FounderActionError extends Error {}

/**
 * Prepares a request and its one note. `readFacts` is how the invention is read: through the gateway as the calling
 * agent (the platform tool), or as the founder's own account (the replacement after a change).
 */
async function writePreparedRequest(deps: GatewayDeps, input: { businessId: string; agentId: string | null; sessionId: string | null; facts: InventionFacts; intro?: string }): Promise<{ actionId: string; inboxItemId: string; created: boolean }> {
  const { businessId } = input;
  const owner = await repos.memberships.owner(deps.db, businessId);
  const profile = owner ? await repos.founders.get(deps.db, owner.userId).catch(() => null) : null;
  const founderName = profile?.displayName?.trim().slice(0, 80) || null;
  const payload = { invention_id: input.facts.inventionId };
  // A previous request for this invention whose result is unknown: the founder is told before pressing again.
  const earlier = !input.intro && (await repos.founderActions.hadUnknown(deps.db, businessId, "lightbringer_mcp", "request_patent_preparation", founderActionPayloadHash(payload)));
  const intro = input.intro ?? (earlier ? PATENT_REQUEST_NOTE.earlierUnknown : undefined);
  const note = patentRequestNote({ facts: input.facts, founderName, ...(intro ? { intro } : {}) });
  return deps.db.transaction(async (tx) => {
    const { action, created } = await repos.founderActions.prepare(tx, businessId, { connectorKey: "lightbringer_mcp", tool: "request_patent_preparation", payload, summary: { title: note.subject, lines: note.lines, facts: factsRecord(input.facts) }, preparedByAgentId: input.agentId });
    // The same request still open: its note is the one note.
    if (!created && action.inboxItemId) return { actionId: action.id, inboxItemId: action.inboxItemId, created: false };
    const item = await repos.inbox.createItem(tx, businessId, {
      type: "decision",
      from_agent_id: input.agentId,
      subject: note.subject,
      body_md: note.bodyMd,
      status_strip: [],
      exhibit: { kind: "none", spec_ref: null },
      decision: { options: note.options as never, free_text: false, expires_at: null, key: `${FOUNDER_ACTION_KEY_PREFIX}${action.id}` },
      blocks_continue: false,
      source_event_ids: [],
      entity_ids: [],
    });
    await repos.founderActions.attachNote(tx, businessId, action.id, item.id);
    await repos.audit.append(tx, businessId, { actorKind: input.agentId ? "agent" : "system", actorId: input.agentId, action: "founder_action.prepared", target: { kind: "founder_action", id: action.id }, details: { connector: "lightbringer_mcp", tool: "request_patent_preparation", payloadHash: action.payloadHash, inboxItemId: item.id, sessionId: input.sessionId } });
    await writeGatewayEvent(tx, { businessId, type: "inbox.item_created", actor: input.agentId ? { kind: "agent", id: input.agentId } : { kind: "system", id: "gateway" }, payload: { inboxItemId: item.id, type: item.type, fromAgentId: item.fromAgentId, subject: item.subject, blocksContinue: item.blocksContinue, sourceEventIds: [], cost: null } });
    return { actionId: action.id, inboxItemId: item.id, created: true };
  });
}

/**
 * The preparer the platform tool uses. The invention is read through the gateway's own pipeline as the calling agent
 * (token for `get_innovation` alone: session scope, rate limit, Cedar, audit and the untrusted envelope all apply), and
 * only its typed read is used.
 */
export function createFounderActionPreparer(deps: GatewayDeps): FounderActionPreparer {
  return {
    async prepare(caller, { connector, tool, inventionId }) {
      if (!PREPARABLE.has(`${connector}:${tool}`) || !isFounderExecutedTool(connector, tool)) throw new FounderActionError(`${connector}:${tool} is not a request ${caller.agentId ? "an agent" : "anyone"} can prepare for the founder.`);
      if (!INVENTION_ID.test(inventionId)) throw new FounderActionError("That is not a Lightbringer invention id (letters, digits, - and _ only).");
      const iat = Math.floor(Date.now() / 1000);
      const session = { businessId: caller.businessId, agentId: caller.agentId, sessionId: caller.sessionId, allowedTools: ["lightbringer_mcp:get_innovation"], kitMode: false, untrustedSeeded: false, jti: `founder-action:${uuid()}`, iat, exp: iat + 120 };
      const req = CallRequest.parse({ connector, tool: "get_innovation", args: { invention_id: inventionId } });
      const { body } = await tracedToolCall(deps, session, req);
      if (body.outcome !== "allow") throw new FounderActionError(body.reasons?.[0] ?? "Lightbringer could not be read right now.");
      if (!body.result.ok) throw new FounderActionError("Lightbringer did not return that invention. Check the id, and that Lightbringer is connected.");
      const facts = inventionFactsOf(body.result.data);
      if (!facts) throw new FounderActionError("Lightbringer's answer did not carry the invention's title, reference and fingerprint, so no request was prepared.");
      const written = await writePreparedRequest(deps, { businessId: caller.businessId, agentId: caller.agentId, sessionId: caller.sessionId, facts });
      return { ...written, note: written.created ? "The founder has one note to press. Nothing was sent to Lightbringer." : "The same request is already waiting for the founder. No second note was written." };
    },
  };
}

const refused = (code: RefusalCode, reason: string): FounderActionOutcome => ({ status: "refused", code, reason });

export const UNKNOWN_REASON = "The request may have reached Lightbringer.";

export interface ExecuteOptions {
  now?: () => Date;
  policyEngine?: PolicyEngine;
}

/** The claims of a token read without checking it: only to say which project a refusal belongs to (never trusted for anything else). */
function unverifiedBusinessId(token: string): string | null {
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { businessId?: unknown };
    return typeof claims.businessId === "string" && /^[0-9a-f-]{36}$/i.test(claims.businessId) ? claims.businessId : null;
  } catch {
    return null;
  }
}

/** What a request that is already past `prepared` answers to a later press: what it became, never "nothing was sent" for a result that may have gone out. */
function settledOutcome(row: FounderAction): FounderActionOutcome {
  if (row.status === "executed") {
    const simulated = (row.result as { simulated?: unknown } | null)?.simulated === true;
    return { status: "executed", simulated, message: simulated ? PATENT_REQUEST_NOTE.simulated : PATENT_REQUEST_NOTE.done };
  }
  if (row.status === "executing" || row.status === "unknown") return { status: "unknown", reason: UNKNOWN_REASON };
  return refused("already_used", row.status === "failed" ? "This request already failed and sent nothing. Ask for a new one." : `This request was already ${row.status}.`);
}

export async function executeFounderAction(deps: GatewayDeps, input: ExecuteFounderActionRequest, service: string, secrets: { shared: string; api: string | null; legacy: boolean }): Promise<FounderActionOutcome> {
  if (service !== "api") throw new FounderActionError("Only the api carries a founder's press.");
  const now = deps.now ?? (() => new Date());
  const log = deps.log;
  // One audit row for every refusal, never the token. A failed write is logged: it must not turn a refusal into an error.
  const audit = async (businessId: string, userId: string | null, action: string, details: Record<string, unknown>, actionId: string | null) => {
    try {
      await repos.audit.append(deps.db, businessId, { actorKind: userId ? "user" : "system", actorId: userId, action, target: { kind: "founder_action", ...(actionId ? { id: actionId } : {}) }, details });
    } catch (e) {
      log.error({ err: safeError(e), action }, "founder action audit row could not be written");
    }
  };
  // 1. The token: signature, audience, expiry, lifetime. A bad one throws (401), after one audit row when its project is known.
  let press;
  try {
    press = await verifyFounderPressToken(secrets, input.pressToken, now);
  } catch (e) {
    const claimed = unverifiedBusinessId(input.pressToken);
    if (claimed && (await repos.businesses.get(deps.db, claimed, { includeArchived: true }).catch(() => null))) await audit(claimed, null, "founder_action.refused", { code: "bad_token" }, null);
    throw e;
  }
  const { businessId } = press;
  const refuse = async (code: RefusalCode, reason: string, row?: FounderAction): Promise<FounderActionOutcome> => {
    await audit(businessId, press.userId, "founder_action.refused", { code, payloadHash: row?.payloadHash ?? press.payloadHash, tokenPayloadHash: press.payloadHash, connector: row?.connectorKey ?? null, tool: row?.tool ?? null }, row?.id ?? press.actionId);
    return refused(code, reason);
  };
  // 2. The request, for the token's own project; and still prepared. One already settled answers with what it became.
  const row = await repos.founderActions.get(deps.db, businessId, press.actionId);
  if (!row) return refuse("not_found", "That request does not exist for this project.");
  // 2b. Only an owner or a cofounder of this project, active now and not an example visitor, presses it.
  const member = await repos.memberships.getActive(deps.db, businessId, press.userId);
  if (!member || !isOwnerRole(member.role) || member.source === "example") return refuse("not_founder", "Only the project's founders can press this.", row);
  if (row.status !== "prepared") {
    const settled = settledOutcome(row);
    if (settled.status === "refused") return refuse(settled.code, settled.reason, row);
    await audit(businessId, press.userId, "founder_action.refused", { code: `already_${row.status}`, payloadHash: row.payloadHash }, row.id);
    return settled;
  }
  // 3. The payload the founder saw is the payload that is stored, byte for byte.
  if (press.payloadHash !== row.payloadHash || founderActionPayloadHash(row.payload) !== row.payloadHash) return refuse("payload_changed", "The request changed after you were shown it. Nothing was sent.", row);
  // 4. A founder-executed tool of a connector that is connected (or the recorded mock where mock results are allowed).
  const connector = connectorOf(deps, row.connectorKey);
  if (!connector || !isFounderExecutedTool(row.connectorKey, row.tool) || !Object.hasOwn(connector.policyHints, row.tool) || !connector.policyHints[row.tool]?.founderExecuted) return refuse("not_founder_executed", `${row.connectorKey}:${row.tool} is not a tool the founder's press runs.`, row);
  const business = await repos.businesses.get(deps.db, businessId, { includeArchived: true }).catch(() => null);
  if (!business) return refuse("not_found", "That project does not exist.", row);
  const integrationRow = await repos.integrations.getByKey(deps.db, businessId, connector.key);
  const mode = modeFor(deps, connector.key);
  const noConnection = connectionRefusal(deps, { connector, business, integrationRow }, mode);
  if (noConnection) return refuse("not_connected", noConnection.message, row);
  // 5. The kill switch and an archived project still stop it.
  const stopped = stateDenial(business, { status: "idle", archivedAt: null, name: "The team" });
  if (stopped && (stopped.policyId === "business-archived" || business.agentsStoppedReason === "kill_switch")) return refuse("stopped", stopped.reasons[0] ?? "The project is stopped.", row);
  // 6. What the note showed is read again, every typed fact of it. A change voids the request and replaces it with a new one to check.
  const shown = row.summary.facts;
  const fresh = await readInventionDirect(deps, businessId, connector, String((row.payload as { invention_id?: unknown }).invention_id ?? ""), log).catch(() => null);
  if (!fresh) return refuse("could_not_check", "Lightbringer could not be asked whether the invention still reads the same, so nothing was sent.", row);
  if (FACT_KEYS.some((k) => fresh[k] !== (shown[k] ?? null))) {
    // Only the press that voids it writes the replacement: a request a concurrent press already claimed is not replaced.
    const voided = await repos.founderActions.voidOpen(deps.db, businessId, row.id, "What the note showed changed before the press.");
    if (!voided) {
      const now2 = await repos.founderActions.get(deps.db, businessId, row.id);
      return refuse("already_used", "This request was already pressed.", now2 ?? row);
    }
    const next = await writePreparedRequest(deps, { businessId, agentId: row.preparedByAgentId, sessionId: null, facts: fresh, intro: PATENT_REQUEST_NOTE.voided });
    await audit(businessId, press.userId, "founder_action.voided", { connector: row.connectorKey, tool: row.tool, payloadHash: row.payloadHash, newActionId: next.actionId }, row.id);
    return { status: "voided", message: PATENT_REQUEST_NOTE.voided, newActionId: next.actionId };
  }
  // 7. One claim: a replayed token or a second press at the same moment gets nothing.
  const expiresAt = new Date(press.exp * 1000);
  const claimed = await repos.founderActions.claim(deps.db, businessId, row.id, { tokenHash: sha256(press.jti), expiresAt, pressedBy: press.userId, now: now() });
  if (!claimed) {
    const latest = await repos.founderActions.get(deps.db, businessId, row.id);
    if (latest && latest.status !== "prepared") {
      const settled = settledOutcome(latest);
      if (settled.status !== "refused") return settled;
    }
    return refuse("already_used", "This request was already pressed.", latest ?? row);
  }
  const finish = (status: "executed" | "failed" | "unknown", extra: { result?: Record<string, unknown>; error?: string }) => repos.founderActions.finish(deps.db, businessId, row.id, { status, now: now(), ...extra });
  // Nothing went to the vendor: a definite "not sent". The request is finished `failed`, and a new note is the retry.
  const notSent = async (reason: string): Promise<FounderActionOutcome> => {
    await finish("failed", { error: reason });
    await audit(businessId, press.userId, "founder_action.failed", { connector: row.connectorKey, tool: row.tool, payloadHash: row.payloadHash, reason }, row.id);
    return { status: "failed", reason };
  };
  // The vendor call may have run: never "failed". The request is finished `unknown`, the founder is told to check, and it is never run again.
  const maybeSent = async (why: string): Promise<FounderActionOutcome> => {
    await finish("unknown", { error: why }).catch((e) => log.error({ err: safeError(e), actionId: row.id }, "founder action could not be marked unknown"));
    await audit(businessId, press.userId, "founder_action.unknown", { connector: row.connectorKey, tool: row.tool, payloadHash: row.payloadHash, reason: why }, row.id);
    return { status: "unknown", reason: UNKNOWN_REASON };
  };
  // 8. Cedar. The principal is the founder's press; the tool carries only `founderExecuted`, so the press is the go-ahead that "ask" would have waited for.
  let ctx: ToolContext;
  try {
    const verdict = evaluate(
      { principal: { id: press.userId, department: "founder", type: "founder_press", modelKey: MODEL_KEYS[0]! }, tool: { connector: row.connectorKey, name: row.tool, founderExecuted: true }, business: { id: businessId, businessMode: business.businessMode, holidayActive: false }, context: { founderPress: true } },
      deps.policyEngine ?? getPolicyEngine(),
    );
    if (verdict.outcome !== "allow") return await notSent(verdict.reasons[0] ?? "The policy did not allow it.");
    ctx = await directContext(deps, { businessId, connector, agentId: row.preparedByAgentId, log });
  } catch (e) {
    log.error({ err: safeError(e), actionId: row.id }, "founder action stopped before the vendor call");
    return notSent("The request could not be started.");
  }
  // 9. The vendor call, with the project's own credential. From here on, an error never says "nothing was sent" (a recorded mock sends nothing, so it can).
  let result: ToolResult;
  try {
    result = await connector.callTool(row.tool, row.payload, ctx);
  } catch (e) {
    if (isConfigError(e)) return notSent("Lightbringer is not set up on this deployment yet.");
    log.error({ err: safeError(e), actionId: row.id }, "founder action vendor call threw");
    return mode === "mock" ? notSent("The request could not be completed.") : maybeSent("The call to Lightbringer ended with an error.");
  }
  if (!result.ok) {
    if (mode === "mock" || vendorRefusedOutright(result.error)) return notSent("Lightbringer did not accept the request.");
    return maybeSent(`Lightbringer answered with an error (${result.error?.code ?? "unknown"}).`);
  }
  const simulated = mode === "mock";
  try {
    const audited = await repos.audit.append(deps.db, businessId, { actorKind: "user", actorId: press.userId, action: "founder_action.executed", target: { kind: "founder_action", id: row.id }, details: { connector: row.connectorKey, tool: row.tool, payload: row.payload, payloadHash: row.payloadHash, actionId: row.id, mode, simulated } });
    if (!(await finish("executed", { result: { simulated, auditId: audited.id } }))) return await maybeSent("The result could not be recorded.");
    try {
      await bookUsage(deps.db, businessId, { agentId: row.preparedByAgentId, sessionId: null, kind: "tool", quantity: 1, unit: "calls", costMinor: Math.max(0, Math.round(result.costMinor ?? 0)), currency: business.currency, billedTo: business.modelBilling, occurredAt: now(), details: { connector: row.connectorKey, tool: row.tool, mode, untrusted: isUntrusted(result.data), founderPress: true, label: "Estimate", auditId: audited.id } });
    } catch (e) {
      log.error({ err: safeError(e), auditId: audited.id }, "founder action executed but its usage could not be booked");
    }
  } catch (e) {
    // The vendor accepted it and a write failed: the request may well have gone out, so it is never "failed".
    log.error({ err: safeError(e), actionId: row.id }, "founder action ran but its record could not be written");
    return maybeSent("The request ran, and its record could not be written.");
  }
  return { status: "executed", simulated, message: simulated ? PATENT_REQUEST_NOTE.simulated : PATENT_REQUEST_NOTE.done };
}
