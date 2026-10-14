/**
 * Reference fields name rows of the same business (audit RA-07, ARB-08, ARB-23, ARB-24). The foreign keys point at the
 * parent's id alone and Postgres checks them without row-level security, so a real id from another business used to be
 * stored; every repository that takes such an id now asks first.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("refs");
});
afterAll(() => r?.close());

const A = () => r.A.businessId;
const REFUSED = /must be an? .* of this business|not an entity of this business/;

describe("agents", () => {
  it("a line manager and departments must belong to the business, on update and create", async () => {
    await expect(repos.agents.update(r.db, A(), r.A.agentId, { lineManagerId: r.B.agentId })).rejects.toThrow(/lineManagerId must be an agent of this business/);
    await expect(repos.agents.update(r.db, A(), r.A.agentId, { departmentIds: [r.A.departmentId, r.B.departmentId] })).rejects.toThrow(/departmentIds must be a department of this business/);
    await expect(repos.agents.update(r.db, A(), r.A.agentId, { lineManagerId: r.A.agentId })).rejects.toThrow(/own line manager/);
    // Nothing was stored, so the agent still reads back.
    const unchanged = await repos.agents.get(r.db, A(), r.A.agentId);
    expect(unchanged.lineManagerId).not.toBe(r.B.agentId);
    expect(unchanged.departmentIds).not.toContain(r.B.departmentId);
    // Own rows are fine.
    const updated = await repos.agents.update(r.db, A(), r.A.agentId, { lineManagerId: r.A.agent2Id, departmentIds: [r.A.departmentId] });
    expect(updated).toMatchObject({ lineManagerId: r.A.agent2Id, departmentIds: [r.A.departmentId] });
    const hired = { name: "Ref check", role: "Researcher", agentType: "researcher", layer: "worker" as const, modelKey: "sonnet" as const };
    await expect(repos.agents.create(r.db, A(), { ...hired, departmentIds: [r.B.departmentId] })).rejects.toThrow(REFUSED);
    await expect(repos.agents.create(r.db, A(), { ...hired, lineManagerId: r.B.agentId })).rejects.toThrow(REFUSED);
  });

  it("a clone cannot be filed under another business's department either", async () => {
    await expect(repos.agents.clone(r.db, A(), r.A.agentId, { name: "Copy", departmentIds: [r.B.departmentId, "00000000-0000-4000-8000-000000000123"] })).rejects.toThrow(REFUSED);
    const copy = await repos.agents.clone(r.db, A(), r.A.agentId, { name: "Copy", departmentIds: [r.A.departmentId] });
    expect(copy.departmentIds).toEqual([r.A.departmentId]);
  });
});

describe("departments, tasks and CRM roles", () => {
  it("a department's lead must be one of the business's agents", async () => {
    await expect(repos.departments.update(r.db, A(), r.A.departmentId, { leadAgentId: r.B.agentId })).rejects.toThrow(/leadAgentId must be an agent of this business/);
    await expect(repos.departments.create(r.db, A(), { name: "Elsewhere", leadAgentId: r.B.agentId })).rejects.toThrow(REFUSED);
    await expect(repos.departments.setLead(r.db, A(), r.A.departmentId, r.B.agentId)).rejects.toThrow(REFUSED);
    expect((await repos.departments.update(r.db, A(), r.A.departmentId, { leadAgentId: r.A.agentId })).leadAgentId).toBe(r.A.agentId);
    await expect(repos.departments.assertOwned(r.db, A(), [r.A.departmentId])).resolves.toBeUndefined();
    await expect(repos.departments.assertOwned(r.db, A(), [r.B.departmentId], "departmentId")).rejects.toThrow(/departmentId must be a department of this business/);
  });

  it("a task's department, assignee and roadmap item must belong to the business", async () => {
    const base = { kind: "code" as const, title: "Ref task" };
    await expect(repos.tasks.create(r.db, A(), { ...base, departmentId: r.B.departmentId })).rejects.toThrow(/departmentId must be a department/);
    await expect(repos.tasks.create(r.db, A(), { ...base, assigneeAgentId: r.B.agentId })).rejects.toThrow(/assigneeAgentId must be an agent/);
    await expect(repos.tasks.create(r.db, A(), { ...base, roadmapItemId: r.B.roadmapItemId })).rejects.toThrow(/roadmapItemId must be a roadmap item/);
    await expect(repos.tasks.update(r.db, A(), r.A.taskId, { departmentId: r.B.departmentId })).rejects.toThrow(/departmentId must be a department/);
    const ok = await repos.tasks.create(r.db, A(), { ...base, departmentId: r.A.departmentId, assigneeAgentId: r.A.agentId, roadmapItemId: r.A.roadmapItemId });
    expect(ok).toMatchObject({ departmentId: r.A.departmentId, assigneeAgentId: r.A.agentId, roadmapItemId: r.A.roadmapItemId });
  });

  it("a CRM role's owner (a jsonb with no foreign key at all) must belong to the business", async () => {
    await expect(repos.entities.addRole(r.db, A(), r.A.entityId, { role: "lead", ownerRef: { kind: "agent", id: r.B.agentId } })).rejects.toThrow(/ownerRef must be an agent/);
    await expect(repos.entities.addRole(r.db, A(), r.A.entityId, { role: "lead", ownerRef: { kind: "department", id: r.B.departmentId } })).rejects.toThrow(/ownerRef must be a department/);
    await expect(repos.entities.addRole(r.db, A(), r.A.entityId, { role: "lead", ownerRef: { kind: "user", id: r.B.ownerId } })).rejects.toThrow(/ownerRef must be a member/);
    const role = await repos.entities.addRole(r.db, A(), r.A.entityId, { role: "lead", ownerRef: { kind: "user", id: r.A.memberId } });
    expect(role.ownerRef).toEqual({ kind: "user", id: r.A.memberId });
    await expect(repos.entities.updateRole(r.db, A(), role.id, { ownerRef: { kind: "agent", id: r.B.agentId } })).rejects.toThrow(/ownerRef must be an agent/);
    expect((await repos.entities.updateRole(r.db, A(), role.id, { ownerRef: { kind: "agent", id: r.A.agentId } })).ownerRef).toEqual({ kind: "agent", id: r.A.agentId });
  });
});

describe("contracts and the roadmap", () => {
  it("a contract's counterparty is checked on update as it is on create", async () => {
    const contract = await repos.legal.createContract(r.db, A(), { kind: "nda", title: "Ref NDA" });
    await expect(repos.legal.updateContract(r.db, A(), contract.id, { counterpartyEntityId: r.B.entityId })).rejects.toThrow(/not an entity of this business/);
    expect((await repos.legal.getContract(r.db, A(), contract.id)).counterpartyEntityId).toBeNull();
    expect((await repos.legal.updateContract(r.db, A(), contract.id, { counterpartyEntityId: r.A.entity2Id })).counterpartyEntityId).toBe(r.A.entity2Id);
  });

  it("a roadmap item's spec blocks and owner must be the business's own, and an id that is not its own is a 404", async () => {
    const item = { title: "Ref item", horizon: "next" as const };
    await expect(repos.product.upsertRoadmapItem(r.db, A(), { ...item, specBlockIds: [r.B.specBlockId] })).rejects.toThrow(/specBlockIds must be a spec block/);
    await expect(repos.product.upsertRoadmapItem(r.db, A(), { ...item, specBlockIds: [r.A.specBlockId, "00000000-0000-4000-8000-000000000999"] })).rejects.toThrow(/specBlockIds must be a spec block/);
    await expect(repos.product.upsertRoadmapItem(r.db, A(), { ...item, ownerRef: { kind: "agent", id: r.B.agentId } })).rejects.toThrow(/ownerRef must be an agent/);
    // Another business's item id is not an item of this one: a clean 404 (it used to fall through to an insert and hit the primary key).
    await expect(repos.product.upsertRoadmapItem(r.db, A(), { ...item, id: r.B.roadmapItemId })).rejects.toMatchObject({ code: "not_found", status: 404 });
    // Nor does an unused client-chosen id create a row.
    await expect(repos.product.upsertRoadmapItem(r.db, A(), { ...item, id: "00000000-0000-4000-8000-0000000000aa" })).rejects.toMatchObject({ code: "not_found", status: 404 });
    const created = await repos.product.upsertRoadmapItem(r.db, A(), { ...item, specBlockIds: [r.A.specBlockId] });
    expect(created.specBlockIds).toEqual([r.A.specBlockId]);
    expect((await repos.product.upsertRoadmapItem(r.db, A(), { ...item, id: created.id, title: "Renamed" })).title).toBe("Renamed");
    // The B item was not touched.
    expect((await repos.product.getRoadmapItem(r.db, r.B.businessId, r.B.roadmapItemId)).title).not.toBe("Ref item");
  });
});
