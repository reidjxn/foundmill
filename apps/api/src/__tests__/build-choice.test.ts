/**
 * The founder's answer to the Chief of Staff's build recommendation (founder, Nov 25, 2026): Build it ourselves is
 * recorded; Build it with Lovable creates the project through the gateway when Lovable is connected, reports a simulated
 * result as simulated, and otherwise (not connected, refused) gives the Build with URL link. Never a dead end.
 */
import { buildChoiceNote, BUILD_CHOICE_NOTE } from "@foundmill/agents";
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GatewayToolCallOutcome, GatewayToolCallRequest } from "../services/gateway";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
const calls: GatewayToolCallRequest[] = [];
let answer: (input: GatewayToolCallRequest) => GatewayToolCallOutcome;

beforeAll(async () => {
  hz = await createApiHarness({ prefix: "buildch" });
  hz.deps.gateway.toolCall = async (input) => {
    calls.push(input);
    return answer(input);
  };
}, 120_000);
afterAll(() => hz?.close());

async function note(businessId: string, agentId: string) {
  const n = buildChoiceNote(businessId, { ideaText: "A web app where tutors log in and track each student's homework on a dashboard.", archetype: "b2b_saas", founderFirstName: null });
  return repos.inbox.createItem(hz.db, businessId, { type: "decision", from_agent_id: agentId, subject: n.subject, body_md: n.bodyMd, status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: n.decision, blocks_continue: false, source_event_ids: [], entity_ids: [] });
}

const summaryOf = (out: { plan: { summaryMd: string } | null }) => out.plan?.summaryMd ?? "";
/** What the founder reads after Build it with Lovable: the Chief of Staff's next note. */
const followOf = (out: { followUp: { bodyMd: string } | null }) => out.followUp?.bodyMd ?? "";

describe("the build choice", () => {
  it("only an owner, cofounder or admin chooses; Build it ourselves is recorded and calls nothing", async () => {
    const { businessId, ownerId, agentId, memberId } = hz.A;
    const item = await note(businessId, agentId);
    await expect(hz.caller({ userId: memberId }).inbox.decide({ businessId, itemId: item.id, chosenOption: BUILD_CHOICE_NOTE.options.ours })).rejects.toThrow(/choose how the project gets built/);
    const before = calls.length;
    const out = await hz.caller({ userId: ownerId }).inbox.decide({ businessId, itemId: item.id, chosenOption: BUILD_CHOICE_NOTE.options.ours });
    expect(out.item.state).toBe("answered");
    expect(summaryOf(out)).toMatch(/engineering agents build it/);
    expect(calls.length).toBe(before);
  });

  it("not connected: no call, and the Build with URL link with the plan, plus how to connect", async () => {
    const { businessId, ownerId, agentId } = hz.A;
    // The note-writer's current update (the welcome note on day one) stays open: the outcome is a report, never an update.
    const welcome = await repos.inbox.createItem(hz.db, businessId, { type: "update", from_agent_id: agentId, subject: "Northwind has started", body_md: "Welcome.", status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: null, blocks_continue: false, source_event_ids: [], entity_ids: [] }, { state: "unread" });
    const item = await note(businessId, agentId);
    const before = calls.length;
    const out = await hz.caller({ userId: ownerId }).inbox.decide({ businessId, itemId: item.id, chosenOption: BUILD_CHOICE_NOTE.options.lovable });
    expect(calls.length).toBe(before);
    expect(out.followUp?.type).toBe("report");
    expect((await repos.inbox.get(hz.db, businessId, welcome.id)).state).toBe("unread");
    expect(followOf(out)).toMatch(/Lovable is not connected/);
    expect(followOf(out)).toContain("https://lovable.dev/#prompt=");
    expect(followOf(out)).toMatch(/Settings › Integrations/);
  });

  it("connected: create_project, then set_project_knowledge; a mock result is reported as simulated, never as done", async () => {
    const { businessId, ownerId, agentId } = hz.B;
    await repos.integrations.upsert(hz.db, businessId, { connectorKey: "lovable_mcp", status: "connected", authKind: "oauth" });
    answer = (input) => ({ outcome: "allow", auditId: "a1", result: { ok: true, simulated: true, notice: "Simulated", data: { untrusted: true, content: { text: "Created", structured: input.tool === "create_project" ? { id: "lov_demo_1", url: "https://lovable.dev/projects/lov_demo_1" } : {} } } } });
    const item = await note(businessId, agentId);
    const out = await hz.caller({ userId: ownerId }).inbox.decide({ businessId, itemId: item.id, chosenOption: BUILD_CHOICE_NOTE.options.lovable });
    expect(calls.slice(-2).map((c) => `${c.connector}:${c.tool}`)).toEqual(["lovable_mcp:create_project", "lovable_mcp:set_project_knowledge"]);
    expect(String(calls.at(-2)!.args.prompt)).toMatch(/^Build the first version of /);
    expect(followOf(out)).toMatch(/^This was simulated and not done: no Lovable project was created/);
    expect(followOf(out)).toContain("https://lovable.dev/#prompt=");
  });

  it("connected and live: the project's link from Lovable's own host goes to the inbox", async () => {
    const { businessId, ownerId, agentId } = hz.B;
    answer = (input) => ({ outcome: "allow", auditId: "a2", result: { ok: true, data: { untrusted: true, content: { text: "ok", structured: input.tool === "create_project" ? { id: "p1", url: "https://lovable.dev/projects/p1" } : {} } } } });
    const out = await hz.caller({ userId: ownerId }).inbox.decide({ businessId, itemId: (await note(businessId, agentId)).id, chosenOption: BUILD_CHOICE_NOTE.options.lovable });
    expect(followOf(out)).toContain("[open it in Lovable](https://lovable.dev/projects/p1)");
    expect(followOf(out)).toMatch(/used your Lovable credits, billed by Lovable/);
  });

  it("refused by Lovable: the reason in plain words and the Build with URL link; a link off Lovable's host is never shown", async () => {
    const { businessId, ownerId, agentId } = hz.B;
    answer = () => ({ outcome: "allow", auditId: "a3", result: { ok: false, error: { code: "remote_tool_error", details: { reason: "insufficient_credits" } } as never } });
    const refused = await hz.caller({ userId: ownerId }).inbox.decide({ businessId, itemId: (await note(businessId, agentId)).id, chosenOption: BUILD_CHOICE_NOTE.options.lovable });
    expect(followOf(refused)).toMatch(/Lovable did not create the project \(your Lovable workspace has no credits left for it\)/);
    expect(followOf(refused)).toContain("https://lovable.dev/#prompt=");

    answer = (input) => ({ outcome: "allow", auditId: "a4", result: { ok: true, data: { untrusted: true, content: { text: "ok", structured: input.tool === "create_project" ? { id: "p2", url: "https://evil.example/p2" } : {} } } } });
    const odd = await hz.caller({ userId: ownerId }).inbox.decide({ businessId, itemId: (await note(businessId, agentId)).id, chosenOption: BUILD_CHOICE_NOTE.options.lovable });
    expect(followOf(odd)).not.toContain("evil.example");
    expect(followOf(odd)).toContain("https://lovable.dev/projects/p2");
  });

  it("Settings' way in when connecting is refused: the Build with URL link with this project's plan, for admins only", async () => {
    const { businessId, ownerId, memberId } = hz.A;
    const { url } = await hz.caller({ userId: ownerId }).integrations.lovableBuildLink({ businessId });
    expect(url).toMatch(/^https:\/\/lovable\.dev\/#prompt=Build%20the%20first%20version%20of%20/);
    await expect(hz.caller({ userId: memberId }).integrations.lovableBuildLink({ businessId })).rejects.toThrow();
    await expect(hz.caller({ userId: ownerId }).integrations.lovableBuildLink({ businessId: hz.B.businessId })).rejects.toThrow();
  });

  it("two presses at once create one Lovable project: the note is answered before the call", async () => {
    const { businessId, ownerId, agentId } = hz.B;
    answer = (input) => ({ outcome: "allow", auditId: "a5", result: { ok: true, data: { untrusted: true, content: { text: "ok", structured: input.tool === "create_project" ? { id: "p3" } : {} } } } });
    const item = await note(businessId, agentId);
    const before = calls.filter((c) => c.tool === "create_project").length;
    const owner = hz.caller({ userId: ownerId });
    const results = await Promise.allSettled([1, 2].map(() => owner.inbox.decide({ businessId, itemId: item.id, chosenOption: BUILD_CHOICE_NOTE.options.lovable })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(calls.filter((c) => c.tool === "create_project").length - before).toBe(1);
  });
});
