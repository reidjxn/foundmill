/**
 * The platform built-in (task board, typed messages, the founder escalation and read-only views; audit GPC-03): the
 * contract suite on the in-memory mock, the board's rules (workers act on their own tasks, one business never sees
 * another's), and the live side, which runs only over a host the gateway wires in.
 */
import { describe, expect, it } from "vitest";
import { isConfigError, type ToolResult } from "../../contract";
import { uuidFromSeed } from "../../mock-utils";
import { isUntrusted } from "../../quarantine";
import { describeConnectorContract, makeToolContext } from "../../testing/contract-suite";
import { createPlatformConnector, createPlatformMock } from "./index";
import { createMemoryPlatformHost, platformMock } from "./mock";

describeConnectorContract("platform (mock)", {
  connector: platformMock,
  mode: "mock",
  calls: [
    { tool: "list_tasks", args: { scope: "team" }, check: (r) => expect((r.data as { items: unknown[] }).items).toHaveLength(3) },
    { tool: "read_business", args: {}, check: (r) => expect(r.data).toMatchObject({ name: "Northwind Skincare", vacation: null }) },
    { tool: "list_pay_links", args: {}, check: (r) => expect(r.data).toEqual({ items: [{ key: "starter-kit", label: "Starter kit", priceMinor: 1900, currency: "USD" }] }) },
    { tool: "check_contact", args: { email: "unsubscribed@example.com" }, check: (r) => expect(r.data).toEqual({ email: "unsubscribed@example.com", contactable: false, basis: "none" }) },
    { tool: "get_task", args: { taskId: uuidFromSeed("nowhere", "task") }, expectOk: false, check: (r) => expect(r.error).toMatchObject({ code: "not_found", status: 404 }) },
  ],
});

const A = uuidFromSeed("platform-test", "business", "a");
const B = uuidFromSeed("platform-test", "business", "b");
const WORKER = uuidFromSeed("platform-test", "agent", "worker");
const LEAD = uuidFromSeed("platform-test", "agent", "lead");

const ok = <T>(r: ToolResult): T => {
  expect(r.error, JSON.stringify(r.error)).toBeUndefined();
  return (isUntrusted(r.data) ? r.data.content : r.data) as T;
};

describe("platform task board", () => {
  const connector = createPlatformMock(createMemoryPlatformHost());
  const as = (businessId: string, agentId: string) => (tool: string, args: unknown) => connector.callTool(tool, args, makeToolContext(connector, { businessId, agentId }));

  it("a worker claims a task, a stranger cannot finish it, the worker completes it (code goes to review)", async () => {
    const worker = as(A, WORKER);
    const lead = as(A, LEAD);
    const { items } = ok<{ items: { id: string; kind: string }[] }>(await worker("list_tasks", { scope: "unassigned" }));
    const code = items.find((t) => t.kind === "code")!;
    expect(ok(await worker("claim_task", { taskId: code.id }))).toMatchObject({ assigneeAgentId: WORKER });
    expect((await lead("claim_task", { taskId: code.id })).error).toMatchObject({ code: "not_yours", status: 403 });
    expect((await lead("complete_task", { taskId: code.id, summary: "Done." })).error).toMatchObject({ code: "not_yours" });
    expect(ok<{ items: unknown[] }>(await worker("list_tasks", {})).items).toHaveLength(1);
    expect(ok(await worker("complete_task", { taskId: code.id, summary: "Pricing page drafted." }))).toMatchObject({ status: "review", progress: 1 });
  });

  it("leads create and assign; a hand-off moves the task and tells the next agent", async () => {
    const lead = as(A, LEAD);
    const created = ok<{ id: string; assigneeAgentId: string | null }>(await lead("create_task", { title: "Compare two suppliers", kind: "research", assigneeAgentId: LEAD }));
    expect(ok(await lead("assign_task", { taskId: created.id, priority: 90 }))).toMatchObject({ priority: 90, assigneeAgentId: LEAD });
    expect((await lead("assign_task", { taskId: created.id })).error).toMatchObject({ code: "invalid_args" });
    expect(ok(await lead("handoff_task", { taskId: created.id, toAgentId: WORKER, note: "Two quotes are in the shared folder." }))).toMatchObject({ assigneeAgentId: WORKER });
    const inbox = ok<{ items: { type: string; fromAgentId: string; taskId: string; body: string }[] }>(await as(A, WORKER)("list_messages", {}));
    expect(inbox.items[0]).toMatchObject({ type: "inform", fromAgentId: LEAD, taskId: created.id, body: "Two quotes are in the shared folder." });
  });

  it("typed messages reach only their recipient and come back as another agent's data (untrusted)", async () => {
    ok(await as(A, WORKER)("send_message", { toAgentId: LEAD, type: "review", subject: "Check the claims", body: "Draft is on the task." }));
    expect((await as(A, WORKER)("send_message", { toAgentId: LEAD, type: "chat", subject: "x", body: "y" })).error).toMatchObject({ code: "invalid_args" });
    const r = await as(A, LEAD)("list_messages", {});
    expect(r.untrusted).toBe(true);
    expect(ok<{ items: { subject: string }[] }>(r).items.map((m) => m.subject)).toContain("Check the claims");
    expect(ok<{ items: { subject: string }[] }>(await as(A, WORKER)("list_messages", {})).items.map((m) => m.subject)).not.toContain("Check the claims");
  });

  it("names found in the business's records came from customers and leads, so they come back as data (untrusted)", async () => {
    const r = await as(A, WORKER)("search_entities", { query: "maja" });
    expect(r.untrusted).toBe(true);
    expect(ok<{ items: { name: string }[] }>(r).items.map((e) => e.name)).toEqual(["Maja Lindgren"]);
  });

  it("one business never sees or touches another's board or messages", async () => {
    const { items } = ok<{ items: { id: string }[] }>(await as(A, WORKER)("list_tasks", { scope: "team" }));
    for (const t of items) {
      expect((await as(B, WORKER)("get_task", { taskId: t.id })).error).toMatchObject({ code: "not_found" });
      expect((await as(B, WORKER)("claim_task", { taskId: t.id })).error).toMatchObject({ code: "not_found" });
    }
    expect(ok<{ items: { id: string }[] }>(await as(B, WORKER)("list_tasks", { scope: "team" })).items.map((t) => t.id)).not.toEqual(items.map((t) => t.id));
    expect(ok<{ items: unknown[] }>(await as(B, LEAD)("list_messages", {})).items).toEqual([]);
  });

  it("request_human_action never runs: it is a hard gate the gateway queues for the founder", async () => {
    const r = await as(A, WORKER)("request_human_action", { title: "Pay the supplier deposit", instructions: "Pay invoice 1042 from the business account." });
    expect(r).toMatchObject({ ok: false, error: { code: "hard_gate" }, data: { connector: "platform", tool: "request_human_action", title: "Pay the supplier deposit" } });
    expect(connector.policyHints.request_human_action).toMatchObject({ hardGate: true, irreversible: true });
  });
});

describe("platform live side", () => {
  it("refuses with a configuration error when the process wired no host", async () => {
    const connector = createPlatformConnector();
    await expect(connector.callTool("list_tasks", {}, makeToolContext(connector, { mode: "live" }))).rejects.toSatisfy(isConfigError);
    expect((await connector.healthcheck(makeToolContext(connector).integration)).status).toBe("disconnected");
  });

  it("calls the host it is given with the session token's business, agent and session", async () => {
    const seen: unknown[] = [];
    const host = createMemoryPlatformHost();
    const connector = createPlatformConnector({ platform: { ...host, listTasks: async (caller, args) => (seen.push({ caller, args }), host.listTasks(caller, args)) } });
    const ctx = makeToolContext(connector, { mode: "live", businessId: A, agentId: WORKER, sessionId: null });
    ok(await connector.callTool("list_tasks", { scope: "team", limit: 2 }, ctx));
    expect(seen).toEqual([{ caller: { businessId: A, agentId: WORKER, sessionId: null }, args: { scope: "team", limit: 2 } }]);
  });
});
