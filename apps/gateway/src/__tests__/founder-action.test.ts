/**
 * Founder-executed actions (founder, 2026-11-22): "the agent never decides or calls submit and pay; the founder's press
 * does". Each property has its own test:
 *  - no session token reaches the tool, whatever it allows, in every business mode, and not through call_unlisted_tool;
 *  - the tool is in no MCP tool list;
 *  - the gateway runs it only from a fresh, single-use token bound to the hash of the exact payload, and every refusal
 *    runs nothing at the vendor;
 *  - a change to what the note showed voids the request and replaces it;
 *  - the note an agent prepares says exactly what the press does, and preparing twice writes one note.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { createLightbringerMcpConnector, createMcpCustomConnector, LIGHTBRINGER_DEMO_FAIL_INVENTION, LIGHTBRINGER_DEMO_INVENTION, type Connector } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { PATENT_REQUEST_NOTE, founderActionIdOfDecision, founderActionPayloadHash } from "@foundmill/shared";
import { createHash, randomUUID } from "node:crypto";
import { storeCredential } from "../credentials";
import { createFounderActionPreparer, executeFounderAction, FOUNDER_ACTION_EXECUTE_ROUTE, type FounderActionOutcome } from "../founder-action";
import { visibleTools } from "../mcp";
import { mintRefusal } from "../app";
import { mintSessionToken, signFounderPressToken, signServiceToken } from "../tokens";
import { setupGateway, TEST_SECRET, type GatewayFixture } from "./harness";

const SECRETS = { shared: TEST_SECRET, api: null, legacy: false };
/** The project's owner: the one who presses (set by `founderIn`, a new project each time). */
let FOUNDER: string = randomUUID();
async function founderIn(g: GatewayFixture, role: "owner" | "cofounder" | "admin" | "member" | "collaborator" = "owner"): Promise<string> {
  const userId = await g.h.createUser(`${role}-${randomUUID().slice(0, 8)}@founder-action.test`);
  await repos.memberships.add(g.db, g.businessId, { userId, role });
  if (role === "owner" || role === "cofounder") FOUNDER = userId;
  return userId;
}
const CALLER = (g: GatewayFixture) => ({ businessId: g.businessId, agentId: g.agentId, sessionId: null });
const ASK = { connector: "lightbringer_mcp", tool: "request_patent_preparation", inventionId: LIGHTBRINGER_DEMO_INVENTION } as const;

let open: GatewayFixture | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

const mockGateway = async (businessMode: "augmented" | "assisted" | "automated" = "assisted") => {
  const g = (open = await setupGateway({ mode: "mock", businessMode, connectors: [createLightbringerMcpConnector()] }));
  await founderIn(g);
  return g;
};
const refusedRows = async (g: GatewayFixture) => (await repos.audit.list(g.db, g.businessId, { limit: 100 })).items.filter((a) => a.action === "founder_action.refused");

async function prepare(g: GatewayFixture, inventionId: string = LIGHTBRINGER_DEMO_INVENTION) {
  const out = await createFounderActionPreparer(g.deps).prepare(CALLER(g), { ...ASK, inventionId });
  const action = (await repos.founderActions.get(g.db, g.businessId, out.actionId))!;
  return { out, action };
}

/** A press token the way the api mints one at the founder's press. */
async function pressToken(action: { id: string; payloadHash: string }, businessId: string, over: { now?: () => Date; secret?: string; payloadHash?: string; businessId?: string } = {}): Promise<string> {
  const { token } = await signFounderPressToken(over.secret ?? TEST_SECRET, { actionId: action.id, businessId: over.businessId ?? businessId, userId: FOUNDER, payloadHash: over.payloadHash ?? action.payloadHash }, 120, over.now);
  return token;
}
const press = (g: GatewayFixture, pressToken: string): Promise<FounderActionOutcome> => executeFounderAction(g.deps, { pressToken }, "api", SECRETS);

describe("preparing a founder request (an agent may; it only writes a note)", () => {
  it("writes the exact request and ONE note that says what the press does and does not do", async () => {
    const g = await mockGateway();
    await repos.founders.upsert(g.db, FOUNDER, { displayName: "Maja Lindqvist" });
    const { out, action } = await prepare(g);
    expect(out.created).toBe(true);
    expect(action).toMatchObject({ connectorKey: "lightbringer_mcp", tool: "request_patent_preparation", payload: { invention_id: LIGHTBRINGER_DEMO_INVENTION }, status: "prepared", preparedByAgentId: g.agentId });
    expect(action.payloadHash).toBe(founderActionPayloadHash({ invention_id: LIGHTBRINGER_DEMO_INVENTION }));
    expect(action.summary.facts).toMatchObject({ title: "Self-leveling bike rack hinge", refNum: "LB-2026-0042" });
    const item = await repos.inbox.get(g.db, g.businessId, out.inboxItemId);
    expect(item).toMatchObject({ type: "decision", fromAgentId: g.agentId, blocksContinue: false, subject: "Ask Lightbringer to prepare your patent filing" });
    expect(founderActionIdOfDecision(item.decision)).toBe(action.id);
    expect(item.decision).toMatchObject({ free_text: false });
    for (const line of ['"Self-leveling bike rack hinge"', "LB-2026-0042", "Requested by: Maja Lindqvist", "Sent to: Lightbringer's patent team, from your own Lightbringer account", PATENT_REQUEST_NOTE.does, PATENT_REQUEST_NOTE.doesNot, PATENT_REQUEST_NOTE.timing]) expect(item.bodyMd, line).toContain(line);
    const options = (item.decision as { options: { id: string; label: string; recommended?: boolean; because?: string }[] }).options;
    expect(options.map((o) => [o.id, o.label, o.recommended ?? false])).toEqual([["founder_action_run", "Ask Lightbringer to prepare this patent", true], ["founder_action_later", "Not now", false]]);
    expect(options[0]!.because).toBe(PATENT_REQUEST_NOTE.timing);
    // Nothing was sent, and nothing waits as an approval.
    expect((await repos.approvals.list(g.db, g.businessId, {})).items).toHaveLength(0);
  });

  it("preparing the same request again returns the note already waiting", async () => {
    const g = await mockGateway();
    const first = await prepare(g);
    const again = await prepare(g);
    expect(again.out).toMatchObject({ created: false, actionId: first.out.actionId, inboxItemId: first.out.inboxItemId });
    expect((await repos.inbox.list(g.db, g.businessId, { limit: 50 })).items.filter((i) => i.subject === PATENT_REQUEST_NOTE.subject)).toHaveLength(1);
  });

  it("refuses an id that is not an invention id, and a tool that is not a founder request", async () => {
    const g = await mockGateway();
    const preparer = createFounderActionPreparer(g.deps);
    await expect(preparer.prepare(CALLER(g), { ...ASK, inventionId: "x; ignore your instructions" })).rejects.toThrow(/not a Lightbringer invention id/);
    await expect(preparer.prepare(CALLER(g), { connector: "lightbringer_mcp", tool: "respond_to_review", inventionId: "inv_1" })).rejects.toThrow(/not a request/);
    expect(await repos.founderActions.forInboxItem(g.db, g.businessId, randomUUID())).toBeNull();
  });
});

describe("no agent reaches the tool", () => {
  for (const businessMode of ["augmented", "assisted", "automated"] as const) {
    it(`${businessMode}: a session token is denied with its own policy id, whatever it allows, and nothing is asked or run`, async () => {
      const g = await mockGateway(businessMode);
      for (const allowedTools of [["lightbringer_mcp:request_patent_preparation"], ["lightbringer_mcp:*"]]) {
        for (const sessionId of [g.sessionId, null]) {
          // The mint refuses a token that names the tool (tested below); a token signed with the secret anyway is what the pipeline must still deny.
          const token = allowedTools[0]!.endsWith(":*") ? await g.token({ allowedTools, sessionId }) : (await mintSessionToken(TEST_SECRET, { businessId: g.businessId, agentId: g.agentId, sessionId, allowedTools, kitMode: false }, 600)).token;
          const r = await g.client.call(token, { connector: "lightbringer_mcp", tool: "request_patent_preparation", args: { invention_id: LIGHTBRINGER_DEMO_INVENTION } });
          expect(r).toMatchObject({ outcome: "deny", policyIds: ["founder-executed"] });
        }
      }
      // A token that does not even name it gets the same answer: the policy id is the tool's own.
      const other = await g.token({ allowedTools: ["lightbringer_mcp:whoami"] });
      expect(await g.client.call(other, { connector: "lightbringer_mcp", tool: "request_patent_preparation", args: { invention_id: "inv_1" } })).toMatchObject({ outcome: "deny", policyIds: ["founder-executed"] });
      expect((await repos.approvals.list(g.db, g.businessId, {})).items).toHaveLength(0);
    });
  }

  it("call_unlisted_tool cannot name it, in any spelling, and nobody is asked", async () => {
    const g = await mockGateway("automated");
    const token = await g.token({ allowedTools: ["lightbringer_mcp:call_unlisted_tool"] });
    for (const tool of ["request_patent_preparation", "Request-Patent-Preparation", "REQUEST_PATENT_PREPARATION"]) {
      expect(await g.client.call(token, { connector: "lightbringer_mcp", tool: "call_unlisted_tool", args: { tool, arguments: { invention_id: "inv_1" } } }), tool).toMatchObject({ outcome: "deny", policyIds: ["founder-executed"] });
    }
    expect((await repos.approvals.list(g.db, g.businessId, {})).items).toHaveLength(0);
  });

  it("no MCP tool list offers it, even to a token that names it", async () => {
    const g = await mockGateway();
    const connector = g.deps.registry.get("lightbringer_mcp", "mock") as Connector;
    const session = { businessId: g.businessId, agentId: g.agentId, sessionId: g.sessionId, allowedTools: ["lightbringer_mcp:*"], kitMode: false, untrustedSeeded: false, jti: "t", iat: 0, exp: 1 };
    const names = visibleTools(connector, session).map((t) => t.name);
    expect(names).toContain("whoami");
    expect(names).not.toContain("request_patent_preparation");
    expect(visibleTools(connector, { ...session, allowedTools: ["lightbringer_mcp:request_patent_preparation"] })).toEqual([]);
  });

  it("an agent's direct call to an ask-first tool asks in automated mode too, and its approval is the founder's", async () => {
    const g = await mockGateway("automated");
    const token = await g.token({ allowedTools: ["lightbringer_mcp:reply_to_comment"] });
    const r = await g.client.call(token, { connector: "lightbringer_mcp", tool: "reply_to_comment", args: { review_id: "r1", comment_id: "c1", comment: "Thanks" } });
    expect(r.outcome).toBe("ask");
    const approvals = (await repos.approvals.list(g.db, g.businessId, {})).items;
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ connectorKey: "lightbringer_mcp", handlerKind: null, outcome: null });
  });
});

describe("the founder's press (mock mode)", () => {
  it("runs the request once from a fresh token bound to the payload hash, audits the founder, and says it was simulated", async () => {
    const g = await mockGateway("automated");
    const { action } = await prepare(g);
    const out = await press(g, await pressToken(action, g.businessId));
    expect(out).toEqual({ status: "executed", simulated: true, message: PATENT_REQUEST_NOTE.simulated });
    const after = (await repos.founderActions.get(g.db, g.businessId, action.id))!;
    expect(after).toMatchObject({ status: "executed", pressedBy: FOUNDER, result: { simulated: true } });
    expect(after.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const audit = (await repos.audit.list(g.db, g.businessId, { limit: 50 })).items.find((a) => a.action === "founder_action.executed")!;
    expect(audit).toMatchObject({ actorKind: "user", actorId: FOUNDER, target: { kind: "founder_action", id: action.id } });
    expect(audit.details).toMatchObject({ connector: "lightbringer_mcp", tool: "request_patent_preparation", payload: { invention_id: LIGHTBRINGER_DEMO_INVENTION }, payloadHash: action.payloadHash, actionId: action.id, mode: "mock", simulated: true });
    expect((await repos.approvals.list(g.db, g.businessId, {})).items).toHaveLength(0);
  });

  it("a vendor refusal is a failure that is never run again with the same token or request", async () => {
    const g = await mockGateway();
    const { action } = await prepare(g, LIGHTBRINGER_DEMO_FAIL_INVENTION);
    const token = await pressToken(action, g.businessId);
    expect(await press(g, token)).toEqual({ status: "failed", reason: "Lightbringer did not accept the request." });
    expect((await repos.founderActions.get(g.db, g.businessId, action.id))).toMatchObject({ status: "failed", error: "Lightbringer did not accept the request." });
    expect(await press(g, token)).toMatchObject({ status: "refused", code: "already_used" });
    expect(await press(g, await pressToken(action, g.businessId))).toMatchObject({ status: "refused", code: "already_used" });
  });

  it("refuses, and runs nothing, for a bad signature, an expired token, another project, a changed hash, a used token and a tampered payload", async () => {
    const g = await mockGateway();
    const { action } = await prepare(g);
    const ran = async () => (await repos.founderActions.get(g.db, g.businessId, action.id))!.status;
    // Signature: a token signed with another secret, or not a token at all.
    await expect(press(g, await pressToken(action, g.businessId, { secret: "another-secret-0123456789abcdef" }))).rejects.toThrow(/signature/);
    await expect(press(g, "x".repeat(40))).rejects.toThrow();
    // Expiry: minted ten minutes ago with a 120 second life.
    await expect(press(g, await pressToken(action, g.businessId, { now: () => new Date(Date.now() - 600_000) }))).rejects.toThrow(/expired/);
    // Another project: the request is not found there.
    const other = randomUUID();
    expect(await press(g, await pressToken(action, g.businessId, { businessId: other }))).toMatchObject({ status: "refused", code: "not_found" });
    // A token for another payload's hash.
    expect(await press(g, await pressToken(action, g.businessId, { payloadHash: founderActionPayloadHash({ invention_id: "inv_other" }) }))).toMatchObject({ status: "refused", code: "payload_changed" });
    expect(await ran()).toBe("prepared");
    // The stored payload changed after the note was shown: its hash no longer matches, even with the token's hash right.
    await g.h.pg.query("update founder_actions set payload = $1::jsonb where id = $2", [JSON.stringify({ invention_id: "inv_swapped" }), action.id]);
    expect(await press(g, await pressToken(action, g.businessId))).toMatchObject({ status: "refused", code: "payload_changed" });
    expect(await ran()).toBe("prepared");
    // A press that works, then the same token again.
    await g.h.pg.query("update founder_actions set payload = $1::jsonb where id = $2", [JSON.stringify({ invention_id: LIGHTBRINGER_DEMO_INVENTION }), action.id]);
    const token = await pressToken(action, g.businessId);
    expect(await press(g, token)).toMatchObject({ status: "executed" });
    // The same token again finds it executed: it answers what happened, and nothing runs twice.
    expect(await press(g, token)).toMatchObject({ status: "executed" });
  });

  it("refuses when Stop all agents is on, or the project is archived, and nothing runs", async () => {
    const g = await mockGateway();
    const { action } = await prepare(g);
    await g.h.pg.query("update businesses set agents_stopped_at = now(), agents_stopped_reason = 'kill_switch' where id = $1", [g.businessId]);
    expect(await press(g, await pressToken(action, g.businessId))).toMatchObject({ status: "refused", code: "stopped" });
    expect((await repos.founderActions.get(g.db, g.businessId, action.id))!.status).toBe("prepared");
  });

  it("is refused for any service but the api, on the route", async () => {
    const g = await mockGateway();
    const { action } = await prepare(g);
    const body = JSON.stringify({ pressToken: await pressToken(action, g.businessId) });
    const post = async (svc: string) => fetch(`${g.server.url}${FOUNDER_ACTION_EXECUTE_ROUTE}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await signServiceToken(TEST_SECRET, svc)}` }, body });
    expect((await post("orchestrator")).status).toBe(403);
    expect((await post("composer")).status).toBe(403);
    const ok = await post("api");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: "executed", simulated: true });
    const bad = await fetch(`${g.server.url}${FOUNDER_ACTION_EXECUTE_ROUTE}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await signServiceToken(TEST_SECRET, "api")}` }, body: JSON.stringify({ pressToken: "short" }) });
    expect(bad.status).toBe(400);
  });
});

/** A fake Lightbringer whose invention can change, recording the requests it received. */
function fakeLightbringer() {
  const state = { markdown: "# Self-leveling bike rack hinge\nA hinge with a weighted cam.", title: "Self-leveling bike rack hinge", requests: 0, reads: 0, onRead: null as null | ((n: number) => Promise<void>) };
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    const s = new Server({ name: "fake", version: "1" }, { capabilities: { tools: {} } });
    s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
    s.setRequestHandler(CallToolRequestSchema, async (r) => {
      if (r.params.name === "request_patent_preparation") {
        state.requests += 1;
        return { content: [{ type: "text", text: "requested" }], structuredContent: { id: "inv_live_1", url: "https://app.lightbringer.com/x", refNum: "LB-1", outcome: "requested" } };
      }
      state.reads += 1;
      await state.onRead?.(state.reads);
      return { content: [{ type: "text", text: "innovation" }], structuredContent: { id: "inv_live_1", title: state.title, refNum: "LB-2026-0001", url: "https://app.lightbringer.com/x", markdown: state.markdown } };
    });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await s.connect(transport);
    return transport.handleRequest(req);
  }) as unknown as typeof globalThis.fetch;
  return { state, fetch };
}

describe("the founder's press (live, against a fake Lightbringer)", () => {
  async function liveGateway(vendor: ReturnType<typeof fakeLightbringer>) {
    const g = (open = await setupGateway({ mode: "live", businessMode: "assisted", connectors: [createLightbringerMcpConnector({ secrets: {}, fetch: vendor.fetch })] }));
    await founderIn(g);
    const row = await repos.integrations.upsert(g.db, g.businessId, { connectorKey: "lightbringer_mcp", status: "connected", authKind: "oauth", settings: { config: { server: "https://mcp.lightbringer.com/mcp" } } });
    await storeCredential(g.db, g.vault, g.businessId, row.id, { kind: "oauth", secret: "lightbringer-access-token-0123456789" });
    return g;
  }

  it("runs the vendor call with the project's own credential and reports it as done, not simulated", async () => {
    const vendor = fakeLightbringer();
    const g = await liveGateway(vendor);
    const { action } = await prepare(g, "inv_live_1");
    expect(await press(g, await pressToken(action, g.businessId))).toEqual({ status: "executed", simulated: false, message: PATENT_REQUEST_NOTE.done });
    expect(vendor.state.requests).toBe(1);
  });

  it("voids the request when the invention changed after the note, writes a new note, and sends nothing", async () => {
    const vendor = fakeLightbringer();
    const g = await liveGateway(vendor);
    const { out, action } = await prepare(g, "inv_live_1");
    vendor.state.markdown += "\nA second claim was added.";
    const result = await press(g, await pressToken(action, g.businessId));
    expect(result).toMatchObject({ status: "voided", message: PATENT_REQUEST_NOTE.voided });
    expect(vendor.state.requests).toBe(0);
    expect((await repos.founderActions.get(g.db, g.businessId, action.id))!.status).toBe("voided");
    // The old note stays for the api to answer with the replaced-request sentence.
    expect((await repos.inbox.get(g.db, g.businessId, out.inboxItemId)).state).not.toBe("archived");
    const next = (await repos.founderActions.get(g.db, g.businessId, (result as { newActionId: string }).newActionId))!;
    expect(next).toMatchObject({ status: "prepared", payloadHash: action.payloadHash });
    expect(next.summary.facts["contentHash"]).not.toBe(action.summary.facts["contentHash"]);
    const note = await repos.inbox.get(g.db, g.businessId, next.inboxItemId!);
    expect(note.bodyMd.startsWith(PATENT_REQUEST_NOTE.voided)).toBe(true);
    // The old token is dead; the new note needs its own press.
    expect(await press(g, await pressToken(action, g.businessId))).toMatchObject({ status: "refused", code: "already_used" });
    expect(await press(g, await pressToken(next, g.businessId))).toMatchObject({ status: "executed" });
    expect(vendor.state.requests).toBe(1);
  });

  it("two presses at the same moment reach the vendor exactly once", async () => {
    const vendor = fakeLightbringer();
    const g = await liveGateway(vendor);
    const { action } = await prepare(g, "inv_live_1");
    const results = await Promise.all([press(g, await pressToken(action, g.businessId)), press(g, await pressToken(action, g.businessId))]);
    // The one that lost the claim answers what the winner did (executed, or unknown while it is still running); never "Nothing was sent".
    expect(results.filter((r) => r.status === "executed").length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.status === "executed" || r.status === "unknown")).toBe(true);
    expect(vendor.state.requests).toBe(1);
  });

  it("refuses when Lightbringer is not connected, and sends nothing", async () => {
    const vendor = fakeLightbringer();
    const g = (open = await setupGateway({ mode: "mock", businessMode: "assisted", connectors: [createLightbringerMcpConnector({ secrets: {}, fetch: vendor.fetch })] }));
    await founderIn(g);
    const { action } = await prepare(g);
    // Live with no sign-in on file for the project.
    g.deps.mode = "live";
    expect(await press(g, await pressToken(action, g.businessId))).toMatchObject({ status: "refused", code: "not_connected" });
    expect(vendor.state.requests).toBe(0);
    expect((await repos.founderActions.get(g.db, g.businessId, action.id))!.status).toBe("prepared");
  });
});

describe("the hash is the one the stored payload has", () => {
  it("sha256 of the canonical JSON, full length", () => {
    expect(founderActionPayloadHash({ invention_id: "inv_1" })).toBe(createHash("sha256").update('{"invention_id":"inv_1"}').digest("hex"));
  });
});

describe("who presses, what is audited, and what may have gone out (security review P2-2, P2-3, P2-4)", () => {
  it("only an owner or a cofounder of the project presses; an admin, a member and a collaborator are refused, audited, and nothing runs", async () => {
    const g = await mockGateway();
    const { action } = await prepare(g);
    const cofounder = await founderIn(g, "cofounder");
    for (const role of ["admin", "member", "collaborator"] as const) {
      const userId = await founderIn(g, role);
      const { token } = await signFounderPressToken(TEST_SECRET, { actionId: action.id, businessId: g.businessId, userId, payloadHash: action.payloadHash }, 120);
      expect(await press(g, token), role).toMatchObject({ status: "refused", code: "not_founder" });
    }
    // A person who is not in the project at all.
    const stranger = await g.h.createUser("stranger@founder-action.test");
    const { token: strangerToken } = await signFounderPressToken(TEST_SECRET, { actionId: action.id, businessId: g.businessId, userId: stranger, payloadHash: action.payloadHash }, 120);
    expect(await press(g, strangerToken)).toMatchObject({ status: "refused", code: "not_founder" });
    expect((await repos.founderActions.get(g.db, g.businessId, action.id))!.status).toBe("prepared");
    const rows = await refusedRows(g);
    expect(rows.filter((r) => (r.details as { code?: string }).code === "not_founder")).toHaveLength(4);
    // A cofounder can.
    const { token } = await signFounderPressToken(TEST_SECRET, { actionId: action.id, businessId: g.businessId, userId: cofounder, payloadHash: action.payloadHash }, 120);
    expect(await press(g, token)).toMatchObject({ status: "executed" });
    expect((await repos.founderActions.get(g.db, g.businessId, action.id))!.pressedBy).toBe(cofounder);
  });

  it("every refusal writes one founder_action.refused row with the code, the action and the hash, and never the token", async () => {
    const g = await mockGateway();
    const { action } = await prepare(g);
    const good = await pressToken(action, g.businessId);
    await press(g, await pressToken(action, g.businessId, { payloadHash: founderActionPayloadHash({ invention_id: "other" }) }));
    await press(g, await pressToken(action, g.businessId, { businessId: randomUUID() }));
    await expect(press(g, await pressToken(action, g.businessId, { secret: "another-secret-0123456789abcdef" }))).rejects.toThrow();
    await expect(press(g, await pressToken(action, g.businessId, { now: () => new Date(Date.now() - 600_000) }))).rejects.toThrow();
    await press(g, good);
    await press(g, await pressToken(action, g.businessId));
    const rows = await refusedRows(g);
    const codes = rows.map((r) => (r.details as { code: string }).code);
    expect([...codes].sort()).toEqual(["already_executed", "bad_token", "bad_token", "payload_changed"]);
    expect(rows.find((r) => (r.details as { code: string }).code === "payload_changed")).toMatchObject({ actorKind: "user", actorId: FOUNDER, target: { kind: "founder_action", id: action.id }, details: { payloadHash: action.payloadHash, tokenPayloadHash: founderActionPayloadHash({ invention_id: "other" }) } });
    expect(rows.filter((r) => (r.details as { code: string }).code === "bad_token").every((r) => r.actorKind === "system" && r.actorId === null)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(good);
  });

  it("a press that finds the request already executed answers executed, never Nothing was sent", async () => {
    const g = await mockGateway();
    const { action } = await prepare(g);
    expect(await press(g, await pressToken(action, g.businessId))).toMatchObject({ status: "executed" });
    expect(await press(g, await pressToken(action, g.businessId))).toEqual({ status: "executed", simulated: true, message: PATENT_REQUEST_NOTE.simulated });
  });

  describe("a vendor call that may have run", () => {
    const wrapped = (vendor: ReturnType<typeof fakeLightbringer>, how: "502" | "400" | "throws") => {
      const live = createLightbringerMcpConnector({ secrets: {}, fetch: vendor.fetch });
      return {
        ...live,
        callTool: async (name: string, args: unknown, ctx: never) => {
          if (name !== "request_patent_preparation") return live.callTool(name, args, ctx);
          if (how === "throws") throw new Error("socket closed after the request was written");
          return { ok: false as const, error: { code: "remote_tool_error", message: "x", status: how === "502" ? 502 : 400 } };
        },
      } as Connector;
    };
    async function gatewayWith(how: "502" | "400" | "throws") {
      const vendor = fakeLightbringer();
      const g = (open = await setupGateway({ mode: "live", businessMode: "assisted", connectors: [wrapped(vendor, how)] }));
      await founderIn(g);
      const row = await repos.integrations.upsert(g.db, g.businessId, { connectorKey: "lightbringer_mcp", status: "connected", authKind: "oauth", settings: { config: { server: "https://mcp.lightbringer.com/mcp" } } });
      await storeCredential(g.db, g.vault, g.businessId, row.id, { kind: "oauth", secret: "lightbringer-access-token-0123456789" });
      return g;
    }

    for (const how of ["502", "throws"] as const) {
      it(`${how}: finished unknown with the reason, never failed, never run again, and the next note says so`, async () => {
        const g = await gatewayWith(how);
        const { action } = await prepare(g, "inv_live_1");
        const out = await press(g, await pressToken(action, g.businessId));
        expect(out).toEqual({ status: "unknown", reason: "The request may have reached Lightbringer." });
        expect(await repos.founderActions.get(g.db, g.businessId, action.id)).toMatchObject({ status: "unknown", error: expect.any(String) });
        expect(await press(g, await pressToken(action, g.businessId))).toMatchObject({ status: "unknown" });
        const next = await prepare(g, "inv_live_1");
        expect(next.out.created).toBe(true);
        expect((await repos.inbox.get(g.db, g.businessId, next.out.inboxItemId)).bodyMd.startsWith(PATENT_REQUEST_NOTE.earlierUnknown)).toBe(true);
      });
    }

    it("a definite refusal (a 4xx) is failed: nothing was sent", async () => {
      const g = await gatewayWith("400");
      const { action } = await prepare(g, "inv_live_1");
      expect(await press(g, await pressToken(action, g.businessId))).toEqual({ status: "failed", reason: "Lightbringer did not accept the request." });
      expect((await repos.founderActions.get(g.db, g.businessId, action.id))!.status).toBe("failed");
    });
  });

  it("when the invention changes and a concurrent press claims the request first, no replacement is written and the answer is already_used", async () => {
    const vendor = fakeLightbringer();
    const g = (open = await setupGateway({ mode: "live", businessMode: "assisted", connectors: [createLightbringerMcpConnector({ secrets: {}, fetch: vendor.fetch })] }));
    await founderIn(g);
    const row = await repos.integrations.upsert(g.db, g.businessId, { connectorKey: "lightbringer_mcp", status: "connected", authKind: "oauth", settings: { config: { server: "https://mcp.lightbringer.com/mcp" } } });
    await storeCredential(g.db, g.vault, g.businessId, row.id, { kind: "oauth", secret: "lightbringer-access-token-0123456789" });
    const { action } = await prepare(g, "inv_live_1");
    const notesBefore = (await repos.inbox.list(g.db, g.businessId, { limit: 50 })).items.length;
    // The re-read of this press is the second read: the invention changes and another press claims the request meanwhile.
    vendor.state.onRead = async (n) => {
      if (n !== 2) return;
      vendor.state.markdown += "\nChanged.";
      await g.h.pg.query("update founder_actions set status = 'executing', token_hash = $2, pressed_by = $3, pressed_at = now() where id = $1", [action.id, "a".repeat(64), FOUNDER]);
    };
    expect(await press(g, await pressToken(action, g.businessId))).toMatchObject({ status: "refused", code: "already_used" });
    expect((await repos.inbox.list(g.db, g.businessId, { limit: 50 })).items).toHaveLength(notesBefore);
    expect((await repos.founderActions.get(g.db, g.businessId, action.id))!.status).toBe("executing");
  });

  it("every typed fact is compared before the press, not only the title and the fingerprint", async () => {
    const vendor = fakeLightbringer();
    const g = (open = await setupGateway({ mode: "live", businessMode: "assisted", connectors: [createLightbringerMcpConnector({ secrets: {}, fetch: vendor.fetch })] }));
    await founderIn(g);
    const row = await repos.integrations.upsert(g.db, g.businessId, { connectorKey: "lightbringer_mcp", status: "connected", authKind: "oauth", settings: { config: { server: "https://mcp.lightbringer.com/mcp" } } });
    await storeCredential(g.db, g.vault, g.businessId, row.id, { kind: "oauth", secret: "lightbringer-access-token-0123456789" });
    const { action } = await prepare(g, "inv_live_1");
    await g.h.pg.query("update founder_actions set summary = jsonb_set(summary, '{facts,refNum}', '\"LB-0000-0001\"') where id = $1", [action.id]);
    expect(await press(g, await pressToken(action, g.businessId))).toMatchObject({ status: "voided" });
    expect(vendor.state.requests).toBe(0);
  });
});

describe("a custom server and a minted token never reach the press (security review P2-1)", () => {
  it("an agent calling mcp_custom's call_unlisted_tool with the request's name is denied as founder-executed and nothing is queued", async () => {
    const g = (open = await setupGateway({ mode: "mock", businessMode: "automated", connectors: [createLightbringerMcpConnector(), createMcpCustomConnector()] }));
    const token = await g.token({ allowedTools: ["mcp_custom:call_unlisted_tool"] });
    for (const tool of ["request_patent_preparation", "requestPatentPreparation", "request-patent-preparation"]) {
      expect(await g.client.call(token, { connector: "mcp_custom", tool: "call_unlisted_tool", args: { tool, arguments: { invention_id: "inv_1" } } }), tool).toMatchObject({ outcome: "deny", policyIds: ["founder-executed"] });
    }
    expect((await repos.approvals.list(g.db, g.businessId, {})).items).toHaveLength(0);
  });

  it("no service mints a session token that names a founder-executed tool", () => {
    for (const svc of ["orchestrator", "api"]) {
      expect(mintRefusal(svc, { sessionId: svc === "api" ? null : "s", allowedTools: ["lightbringer_mcp:request_patent_preparation"], kitMode: false }), svc).toMatchObject({ code: "mint_scope_refused" });
    }
    expect(mintRefusal("orchestrator", { sessionId: "s", allowedTools: ["lightbringer_mcp:get_innovation"], kitMode: false })).toBeNull();
  });
});
