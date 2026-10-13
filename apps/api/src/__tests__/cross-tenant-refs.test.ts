/**
 * Reference fields through the API (audit RA-07, ARB-08, ARB-23, ARB-24): an id from another business is a 400 (or a
 * 404 for an item that is not the business's own), and nothing is stored. The caller owns both businesses, as in the
 * audit, so only the check on the business stands between the id and the row.
 */
import { TRPCError } from "@trpc/server";
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "refs" });
  // One person owns both businesses.
  await repos.memberships.add(hz.db, hz.B.businessId, { userId: hz.A.ownerId, role: "owner" });
}, 120_000);
afterAll(() => hz.close());

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (err) {
    return err instanceof TRPCError ? err.code : `other:${String(err)}`;
  }
};

describe("reference fields name rows of the business", () => {
  const businessId = () => hz.A.businessId;
  const owner = () => hz.caller({ userId: hz.A.ownerId });

  it("agent.profile.update: a line manager or department of another business is refused, and the profile still reads", async () => {
    expect(await codeOf(owner().agent.profile.update({ businessId: businessId(), agentId: hz.A.agentId, patch: { lineManagerId: hz.B.agentId } }))).toBe("BAD_REQUEST");
    expect(await codeOf(owner().agent.profile.update({ businessId: businessId(), agentId: hz.A.agentId, patch: { departmentIds: [hz.B.departmentId] } as never }))).toBe("BAD_REQUEST"); // the profile no longer takes departments at all (strict patch)
    expect(await codeOf(owner().agent.profile.get({ businessId: businessId(), agentId: hz.A.agentId }))).toBe("OK");
    expect(await codeOf(owner().agent.profile.update({ businessId: businessId(), agentId: hz.A.agentId, patch: { lineManagerId: hz.A.agent2Id } }))).toBe("OK");
  });

  it("department.update: a lead from another business is refused (the department router looks the lead up first: not found)", async () => {
    expect(await codeOf(owner().department.update({ businessId: businessId(), departmentId: hz.A.departmentId, patch: { leadAgentId: hz.B.agentId } }))).toBe("NOT_FOUND");
    expect((await repos.departments.get(hz.db, businessId(), hz.A.departmentId)).leadAgentId).not.toBe(hz.B.agentId);
  });

  it("dev.tasks.plan: a department of another business is refused before the planner runs", async () => {
    expect(await codeOf(owner().dev.tasks.plan({ businessId: businessId(), goal: "Ship the thing", departmentId: hz.B.departmentId }))).toBe("BAD_REQUEST");
  });

  it("crm.roles.add: an owner from another business is refused", async () => {
    expect(await codeOf(owner().crm.roles.add({ businessId: businessId(), entityId: hz.A.entityId, role: { role: "lead", ownerRef: { kind: "agent", id: hz.B.agentId } } }))).toBe("BAD_REQUEST");
    expect(await codeOf(owner().crm.roles.add({ businessId: businessId(), entityId: hz.A.entityId, role: { role: "lead", ownerRef: { kind: "agent", id: hz.A.agentId } } }))).toBe("OK");
  });

  it("legal.contracts.update: a counterparty from another business is refused, as on create", async () => {
    const contract = await owner().legal.contracts.create({ businessId: businessId(), kind: "nda", title: "Ref NDA" });
    expect(await codeOf(owner().legal.contracts.update({ businessId: businessId(), contractId: contract.id, patch: { counterpartyEntityId: hz.B.entityId } }))).toBe("BAD_REQUEST");
    expect(await codeOf(owner().legal.contracts.update({ businessId: businessId(), contractId: contract.id, patch: { counterpartyEntityId: hz.A.entity2Id } }))).toBe("OK");
  });

  it("product.roadmap: spec blocks of another business are refused, and another business's item id is a 404, not a 500", async () => {
    const item = { businessId: businessId(), title: "Ref item", horizon: "next" as const };
    expect(await codeOf(owner().product.roadmap.upsert({ ...item, specBlockIds: [hz.B.specBlockId] }))).toBe("BAD_REQUEST");
    expect(await codeOf(owner().product.roadmap.upsert({ ...item, id: hz.B.roadmapItemId }))).toBe("NOT_FOUND");
    expect(await codeOf(owner().product.roadmap.link({ businessId: businessId(), itemId: hz.A.roadmapItemId, specBlockIds: [hz.B.specBlockId] }))).toBe("BAD_REQUEST");
    expect(await codeOf(owner().product.roadmap.link({ businessId: businessId(), itemId: hz.A.roadmapItemId, specBlockIds: [hz.A.specBlockId] }))).toBe("OK");
  });

  it("team.agents.clone: departments of another business are refused; a clone joins the departments it is filed under", async () => {
    expect(await codeOf(owner().team.agents.clone({ businessId: businessId(), agentId: hz.A.agentId, name: "Copy", departmentIds: [hz.B.departmentId] }))).toBe("BAD_REQUEST");
    const copy = await owner().team.agents.clone({ businessId: businessId(), agentId: hz.A.agentId, name: "Copy", departmentIds: [hz.A.departmentId] });
    expect(copy.departmentIds).toEqual([hz.A.departmentId]);
    const members = await repos.departments.listMembers(hz.db, businessId(), hz.A.departmentId);
    expect(members.some((m) => m.memberKind === "agent" && m.memberId === copy.id)).toBe(true);
  });
});
