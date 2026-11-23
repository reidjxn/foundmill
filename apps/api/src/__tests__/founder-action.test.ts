/**
 * The founder's press on a founder-executed request (founder, 2026-11-22), decided in-process by `inbox.decide`:
 * only a project founder, signed in, presses it; the api asks the gateway with the payload hash the note showed and says,
 * in plain words, what the gateway answered. No email link, no Today tap and no plan compiler can answer it.
 */
import { repos } from "@foundmill/db";
import { AppError } from "@foundmill/shared";
import { PATENT_REQUEST_NOTE, founderActionPayloadHash, oneClickOption } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mayPressFounderAction } from "../services/founder-actions";
import type { ApiGatewayClient, GatewayFounderActionRequest, GatewayFounderActionResult } from "../services/gateway";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

let hz: ApiHarness;
let seen: GatewayFounderActionRequest[] = [];
let answer: GatewayFounderActionResult = { status: "executed", simulated: true, message: PATENT_REQUEST_NOTE.simulated };
/** Runs inside the press, before the gateway answers: a second tab answering the same note, or the gateway timing out. */
let during: (() => Promise<void>) | null = null;
let failWith: Error | null = null;
const gateway = {
  executeFounderAction: async (input: GatewayFounderActionRequest) => {
    seen.push(input);
    await during?.();
    if (failWith) throw failWith;
    return answer;
  },
} as unknown as ApiGatewayClient;

let cofounder = "";
let collaborator = "";
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "founder-action", temporalClient: fakeTemporalClient(), gateway });
  cofounder = await hz.h.createUser("cofounder@founder-action.test");
  collaborator = await hz.h.createUser("collaborator@founder-action.test");
  await repos.memberships.add(hz.db, hz.A.businessId, { userId: cofounder, role: "cofounder" });
  await repos.memberships.add(hz.db, hz.A.businessId, { userId: collaborator, role: "collaborator" });
}, 120_000);
afterAll(() => hz.close());

/** What the gateway's prepare writes: the request and its one note. */
async function prepared(inv: string) {
  const { businessId, agentId } = hz.A;
  const { action } = await repos.founderActions.prepare(hz.db, businessId, { connectorKey: "lightbringer_mcp", tool: "request_patent_preparation", payload: { invention_id: inv }, summary: { title: PATENT_REQUEST_NOTE.subject, lines: [], facts: {} }, preparedByAgentId: agentId });
  const item = await repos.inbox.createItem(hz.db, businessId, {
    type: "decision",
    from_agent_id: agentId,
    subject: PATENT_REQUEST_NOTE.subject,
    body_md: PATENT_REQUEST_NOTE.does,
    status_strip: [],
    exhibit: { kind: "none", spec_ref: null },
    decision: {
      options: [
        { id: PATENT_REQUEST_NOTE.options.run, label: PATENT_REQUEST_NOTE.runLabel, recommended: true, consequence: "Lightbringer is asked.", because: PATENT_REQUEST_NOTE.timing, cost_minor: 0, reversible: false },
        { id: PATENT_REQUEST_NOTE.options.later, label: PATENT_REQUEST_NOTE.laterLabel, recommended: false, consequence: "Nothing is sent.", cost_minor: 0, reversible: true },
      ],
      free_text: false,
      expires_at: null,
      key: `founder_action:${action.id}`,
    },
    blocks_continue: false,
    source_event_ids: [],
    entity_ids: [],
  });
  await repos.founderActions.attachNote(hz.db, businessId, action.id, item.id);
  return { action, item };
}

const run = (userId: string, itemId: string, chosenOption: string = PATENT_REQUEST_NOTE.options.run) => hz.caller({ userId }).inbox.decide({ businessId: hz.A.businessId, itemId, chosenOption });

describe("pressing a founder request", () => {
  it("a founder's press sends the note's own payload hash to the gateway and answers the note with what happened", async () => {
    seen = [];
    answer = { status: "executed", simulated: true, message: PATENT_REQUEST_NOTE.simulated };
    const { action, item } = await prepared("inv_a");
    const out = await run(hz.A.ownerId, item.id);
    expect(seen).toEqual([{ businessId: hz.A.businessId, actionId: action.id, userId: hz.A.ownerId, payloadHash: founderActionPayloadHash({ invention_id: "inv_a" }) }]);
    expect(out.item.state).toBe("answered");
    expect(out.plan.summaryMd).toBe("This was simulated and not sent: Lightbringer is not connected for real here.");
  });

  it("says it was done only when the gateway ran it for real", async () => {
    answer = { status: "executed", simulated: false, message: PATENT_REQUEST_NOTE.done };
    const { item } = await prepared("inv_real");
    expect((await run(cofounder, item.id)).plan.summaryMd).toBe("Lightbringer has your request. Their team emails you next.");
  });

  it("a failure answers the note with Nothing was sent and the reason", async () => {
    answer = { status: "failed", reason: "Lightbringer did not accept the request." };
    const { item } = await prepared("inv_fail");
    const out = await run(hz.A.ownerId, item.id);
    expect(out.item.state).toBe("answered");
    expect(out.plan.summaryMd).toBe("Nothing was sent: Lightbringer did not accept the request.");
  });

  it("a request that is not connected or is stopped leaves the note open to press again", async () => {
    answer = { status: "refused", code: "not_connected", reason: "Lightbringer is not connected for this project." };
    const { item } = await prepared("inv_open");
    await expect(run(hz.A.ownerId, item.id)).rejects.toThrow("Nothing was sent: Lightbringer is not connected for this project.");
    expect((await repos.inbox.get(hz.db, hz.A.businessId, item.id)).state).not.toBe("answered");
  });

  it("an invention that changed answers the old note with the new-request sentence", async () => {
    answer = { status: "voided", message: PATENT_REQUEST_NOTE.voided, newActionId: null };
    const { item } = await prepared("inv_changed");
    expect((await run(hz.A.ownerId, item.id)).plan.summaryMd).toBe("The invention changed after you were asked. Here is a new request to check.");
  });

  it("Not now sends nothing and ends the request", async () => {
    seen = [];
    const { action, item } = await prepared("inv_later");
    const out = await run(hz.A.ownerId, item.id, PATENT_REQUEST_NOTE.options.later);
    expect(seen).toEqual([]);
    expect(out.item.state).toBe("answered");
    expect((await repos.founderActions.get(hz.db, hz.A.businessId, action.id))?.status).toBe("voided");
  });

  it("only an owner or a cofounder presses it: not an admin who is not a founder, a member, a collaborator or another project's founder, and nothing is sent", async () => {
    seen = [];
    answer = { status: "executed", simulated: false, message: PATENT_REQUEST_NOTE.done };
    const { item } = await prepared("inv_members");
    for (const who of [hz.A.adminId, hz.A.memberId, collaborator]) await expect(run(who, item.id), who).rejects.toThrow(/Only the project's founders|write access/);
    await expect(run(hz.B.ownerId, item.id)).rejects.toThrow();
    expect(seen).toEqual([]);
    expect((await repos.inbox.get(hz.db, hz.A.businessId, item.id)).state).not.toBe("answered");
    // An owner can, and so can a cofounder (the cofounder's press is the earlier test's).
    expect((await run(hz.A.ownerId, item.id)).item.state).toBe("answered");
    expect(seen).toHaveLength(1);
  });

  it("an example visitor never presses it, and the owner-or-cofounder rule is the whole rule", () => {
    expect(mayPressFounderAction({ role: "owner", membership: { source: "invite" } as never })).toBe(true);
    expect(mayPressFounderAction({ role: "cofounder", membership: { source: "invite" } as never })).toBe(true);
    expect(mayPressFounderAction({ role: "owner", membership: { source: "example" } as never })).toBe(false);
    for (const role of ["admin", "member", "viewer", "advisor", "collaborator"]) expect(mayPressFounderAction({ role: role as never, membership: { source: "invite" } as never }), role).toBe(false);
  });

  it("a result that may have gone out is never reported as Nothing was sent, and the note is answered so it cannot be pressed again", async () => {
    answer = { status: "unknown", reason: "The request may have reached Lightbringer." };
    const { item } = await prepared("inv_unknown");
    const out = await run(hz.A.ownerId, item.id);
    expect(out.item.state).toBe("answered");
    expect(out.plan.summaryMd).toBe("The request may have reached Lightbringer. Check in your Lightbringer account before you ask again.");
    expect(out.plan.summaryMd).not.toMatch(/Nothing was sent/);
  });

  it("an api-side timeout while the gateway may still be running it reports the same, and answers the note", async () => {
    const { item } = await prepared("inv_timeout");
    failWith = new AppError("gateway_unreachable", "The gateway did not answer: This operation was aborted", 503);
    try {
      expect((await run(hz.A.ownerId, item.id)).plan.summaryMd).toBe(PATENT_REQUEST_NOTE.unknown);
    } finally {
      failWith = null;
    }
    // A refused connection sent nothing: the note stays open to press again.
    const second = await prepared("inv_refused");
    failWith = new AppError("gateway_unreachable", "The gateway did not answer: connect ECONNREFUSED 127.0.0.1:4100", 503);
    try {
      await expect(run(hz.A.ownerId, second.item.id)).rejects.toThrow(/Nothing was sent/);
    } finally {
      failWith = null;
    }
    expect((await repos.inbox.get(hz.db, hz.A.businessId, second.item.id)).state).not.toBe("answered");
  });

  it("an executed press whose note another tab answered meanwhile still tells the founder what happened", async () => {
    answer = { status: "executed", simulated: false, message: PATENT_REQUEST_NOTE.done };
    const { item } = await prepared("inv_race");
    during = async () => {
      const plan = await repos.plans.create(hz.db, hz.A.businessId, { origin: "option", summaryMd: "answered elsewhere", inboxItemId: item.id, status: "executing", actions: [{ type: "reply_only", params: { acknowledgement: "x" }, agentId: null, policyOutcome: "allow" }] });
      await repos.inbox.decide(hz.db, hz.A.businessId, item.id, { chosenOption: PATENT_REQUEST_NOTE.options.run, decidedByKind: "user", decidedBy: hz.A.ownerId, planId: plan.id });
    };
    try {
      const out = await run(hz.A.ownerId, item.id);
      expect(out.plan.summaryMd).toBe(PATENT_REQUEST_NOTE.done);
    } finally {
      during = null;
    }
  });

  it("free text never decides it, and a pressed note cannot be pressed again", async () => {
    seen = [];
    answer = { status: "executed", simulated: false, message: PATENT_REQUEST_NOTE.done };
    const { item } = await prepared("inv_twice");
    await expect(hz.caller({ userId: hz.A.ownerId }).inbox.decide({ businessId: hz.A.businessId, itemId: item.id, freeText: "yes please send it" })).rejects.toThrow();
    await run(hz.A.ownerId, item.id);
    await expect(run(hz.A.ownerId, item.id)).rejects.toThrow(/already/);
    expect(seen).toHaveLength(1);
  });
});

describe("no shortcut answers it", () => {
  it("is never a one-click answer from an email and never a quick tap on Today", async () => {
    const { item } = await prepared("inv_shortcuts");
    const decision = item.decision as Record<string, unknown>;
    // Even if its option were marked reversible and free, a founder request is not a one-click answer (the email path also checks oneClickPlanAllowed).
    const loosened = { ...decision, options: (decision.options as Record<string, unknown>[]).map((o) => ({ ...o, reversible: true })) };
    expect(oneClickOption({ type: "decision", state: "unread", decision: loosened }, { isSignoff: false })).toBeNull();
    const today = (await hz.caller({ userId: hz.A.ownerId }).today.get({ businessId: hz.A.businessId })).needsYou?.items.find((i) => i.id === item.id);
    expect(today).toMatchObject({ kind: "decision", quickOption: null });
  });
});
