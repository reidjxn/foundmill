/**
 * Settings › Departments (BUILD §11.13; audits MLSL-08, WEB-19, AC-06): an archived department can be restored, "Reset
 * to defaults" brings an archived seed department back instead of failing on its slug, a department of the same name
 * as an archived one gets a free slug, and a lead-less department can be given a lead.
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

describe("department structure and people", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "depts" });
  }, 120_000);
  afterAll(() => hz.close());

  it("archive, then restore by id or by Reset to defaults; the archived slug never breaks an insert", async () => {
    const { businessId } = hz.A;
    const admin = hz.caller({ userId: hz.A.adminId });
    // Reset first so the archetype's departments (Team among them) exist.
    await admin.department.resetDefaults({ businessId });
    const team = (await admin.department.list({ businessId })).find((d) => d.slug === "team")!;
    expect(team).toBeTruthy();
    const tabsBefore = team.tabs.map((t) => t.slug).sort();
    expect(tabsBefore.length).toBeGreaterThan(0);

    await admin.department.archive({ businessId, departmentId: team.id });
    expect((await admin.department.list({ businessId, includeHidden: true })).map((d) => d.id)).not.toContain(team.id);
    const archived = (await admin.department.list({ businessId, includeHidden: true, includeArchived: true })).find((d) => d.id === team.id);
    expect(archived?.archivedAt).toBeInstanceOf(Date);

    // A member cannot restore; another business's admin cannot either.
    await expect(hz.caller({ userId: hz.A.memberId }).department.restore({ businessId, departmentId: team.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hz.caller({ userId: hz.B.adminId }).department.restore({ businessId, departmentId: team.id })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const restored = await admin.department.restore({ businessId, departmentId: team.id });
    expect(restored.archivedAt).toBeNull();
    expect(restored.hidden).toBe(false);
    const back = (await admin.department.list({ businessId })).find((d) => d.id === team.id)!;
    expect(back.tabs.map((t) => t.slug).sort()).toEqual(tabsBefore);
    expect((await repos.audit.list(hz.db, businessId, { action: "department.restore" })).items).toHaveLength(1);

    // Archive again: Reset to defaults restores the same row (it used to insert the seed slug again and fail).
    await admin.department.archive({ businessId, departmentId: team.id });
    const reset = await admin.department.resetDefaults({ businessId });
    expect(reset.map((d) => d.id)).toContain(team.id);
    expect(reset.filter((d) => d.slug === "team")).toHaveLength(1);
    expect((await admin.department.list({ businessId })).find((d) => d.id === team.id)?.tabs.map((t) => t.slug).sort()).toEqual(tabsBefore);

    // A new department named like an archived one gets the next free slug and its module tabs.
    await admin.department.archive({ businessId, departmentId: team.id });
    const again = await admin.department.create({ businessId, name: "Team", moduleKeys: ["team"] });
    expect(again.slug).toBe("team-2");
    expect((await admin.department.list({ businessId })).find((d) => d.id === again.id)?.tabs.length).toBe(tabsBefore.length);
    await admin.department.restore({ businessId, departmentId: team.id });
  });

  it("templates are the archetype's departments, then one per module, marked in use or archived", async () => {
    const { businessId } = hz.A;
    const admin = hz.caller({ userId: hz.A.adminId });
    const templates = await admin.department.templates({ businessId });
    expect(templates.map((t) => t.key)).toEqual(expect.arrayContaining(["product", "development", "distribution", "finance", "team", "legal"]));
    expect(new Set(templates.map((t) => t.key)).size).toBe(templates.length);
    expect(templates.every((t) => t.moduleKeys.length > 0 && t.icon && t.colourToken)).toBe(true);
    expect(templates.find((t) => t.key === "product")).toMatchObject({ inUse: true, archivedId: null });
    const legal = (await admin.department.list({ businessId })).find((d) => d.slug === "legal")!;
    await admin.department.archive({ businessId, departmentId: legal.id });
    expect((await admin.department.templates({ businessId })).find((t) => t.key === "legal")).toMatchObject({ inUse: false, archivedId: legal.id });
    await admin.department.restore({ businessId, departmentId: legal.id });
  });

  it("a lead-less department gets a lead: the agent joins it and its agents with no manager report to the lead", async () => {
    const { businessId } = hz.A;
    const admin = hz.caller({ userId: hz.A.adminId });
    const support = await admin.department.create({ businessId, name: "Support desk", moduleKeys: ["product"], icon: "headset", colourToken: "dept-3" });
    expect(support.leadAgentId).toBeNull();
    await admin.team.agents.loan({ businessId, agentId: hz.A.agent2Id, departmentId: support.id });
    expect((await repos.agents.get(hz.db, businessId, hz.A.agent2Id)).lineManagerId).toBeNull();

    // Another business's agent and a released agent are refused.
    await expect(admin.department.update({ businessId, departmentId: support.id, patch: { leadAgentId: hz.B.agentId } })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const released = await repos.agents.create(hz.db, businessId, { name: "Gone", agentType: "researcher", layer: "worker", modelKey: "sonnet" });
    await repos.agents.release(hz.db, businessId, released.id);
    await expect(admin.department.update({ businessId, departmentId: support.id, patch: { leadAgentId: released.id } })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const updated = await admin.department.update({ businessId, departmentId: support.id, patch: { leadAgentId: hz.A.agentId, icon: "life-buoy", colourToken: "dept-5", budgetMinor: 45_000, currency: "USD" } });
    expect(updated).toMatchObject({ leadAgentId: hz.A.agentId, icon: "life-buoy", colourToken: "dept-5", budgetMinor: 45_000, currency: "USD" });
    const lead = await repos.agents.get(hz.db, businessId, hz.A.agentId);
    expect(lead.departmentIds).toContain(support.id);
    expect((await repos.departments.listMembers(hz.db, businessId, support.id)).map((m) => m.memberId)).toEqual(expect.arrayContaining([hz.A.agentId, hz.A.agent2Id]));
    expect((await repos.agents.get(hz.db, businessId, hz.A.agent2Id)).lineManagerId).toBe(hz.A.agentId);
    expect(lead.lineManagerId).toBeNull();
    const listed = (await admin.department.list({ businessId })).find((d) => d.id === support.id);
    expect(listed?.lead?.id).toBe(hz.A.agentId);

    // A new lead takes over the reports of the previous one, and the previous lead does not report to someone below it.
    await admin.department.update({ businessId, departmentId: support.id, patch: { leadAgentId: hz.A.agent2Id } });
    expect((await repos.agents.get(hz.db, businessId, hz.A.agent2Id)).lineManagerId).toBe(hz.A.agentId);
    expect((await repos.agents.get(hz.db, businessId, hz.A.agentId)).lineManagerId).toBeNull();

    // Members cannot change a department.
    await expect(hz.caller({ userId: hz.A.memberId }).department.update({ businessId, departmentId: support.id, patch: { budgetMinor: 1 } })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
