/**
 * The founder reads a task's result (WP-05 T7): `dev.tasks.get` carries the task's latest report, read under RLS.
 * Members read it with only valid entity mentions left in; a collaborator, who reads Development, gets `report: null`
 * (`task_reports` is closed to collaborators, as T3's policy says); another business's member reads nothing of it.
 */
import { repos } from "@foundmill/db";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
let collaboratorId: string;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "devreport" });
  collaboratorId = await hz.h.createUser("devreport-collaborator@test.local");
  await repos.memberships.add(hz.db, hz.A.businessId, { userId: collaboratorId, role: "collaborator" });
}, 120_000);
afterAll(() => hz?.close());

const GHOST = "7d4f2a1e-9b3c-4e8d-a6f5-0c1b2d3e4f5a";

describe("dev.tasks.get report", () => {
  it("returns the latest report with invalid mentions stripped; null before one is saved", async () => {
    const { businessId, ownerId, agentId } = hz.A;
    const agent = await repos.agents.get(hz.db, businessId, agentId);
    const owner = hz.caller({ userId: ownerId });
    const rival = await repos.entities.create(hz.db, businessId, { kind: "organisation", displayName: "Rival Labs" });
    const task = await repos.tasks.create(hz.db, businessId, { kind: "research", title: "Refill pricing scan", status: "done", assigneeAgentId: agentId });

    expect((await owner.dev.tasks.get({ businessId, taskId: task.id })).report).toBeNull();

    await repos.taskReports.save(hz.db, businessId, { taskId: task.id, agentId, title: "First pass", bodyMd: "Old." });
    await new Promise((r) => setTimeout(r, 5));
    const saved = await repos.taskReports.save(hz.db, businessId, {
      taskId: task.id,
      agentId,
      title: "Refill pricing: three rivals",
      bodyMd: `Found by [[ent:${agentId}|${agent.name}]]. [[ent:${GHOST}|Ghost Co]] charges £38 a quarter; [[ent:${rival.id}|Rival Labs]] £32.`,
      sources: [{ url: "https://example.com/pricing", title: "Example pricing" }],
      simulated: true,
    });

    const { report } = await owner.dev.tasks.get({ businessId, taskId: task.id });
    expect(report).toMatchObject({ id: saved.id, title: "Refill pricing: three rivals", simulated: true, sources: [{ url: "https://example.com/pricing", title: "Example pricing" }] });
    expect(report!.bodyMd).toContain(`[[ent:${agentId}|${agent.name}]]`);
    expect(report!.bodyMd).not.toContain(GHOST);
    expect(report!.bodyMd).toContain("Ghost Co charges £38");
    expect(report!.bodyMd).toContain(`[[ent:${rival.id}|Rival Labs]] £32`);
    expect(typeof report!.createdAt).toBe("string");
  });

  it("a collaborator reads the task but not its report; a member of another business reads neither", async () => {
    const { businessId, agentId } = hz.A;
    const task = await repos.tasks.create(hz.db, businessId, { kind: "research", title: "Clinic referral scan", status: "done", assigneeAgentId: agentId });
    await repos.taskReports.save(hz.db, businessId, { taskId: task.id, agentId, title: "Clinics", bodyMd: "Two clinics refer." });

    const asCollaborator = await hz.caller({ userId: collaboratorId }).dev.tasks.get({ businessId, taskId: task.id });
    expect(asCollaborator.task.id).toBe(task.id);
    expect(asCollaborator.report).toBeNull();

    const outsider = hz.caller({ userId: hz.B.ownerId });
    await expect(outsider.dev.tasks.get({ businessId, taskId: task.id })).rejects.toBeInstanceOf(TRPCError);
    // B's own business id with A's task id: the task is not B's, so nothing comes back.
    await expect(outsider.dev.tasks.get({ businessId: hz.B.businessId, taskId: task.id })).rejects.toBeInstanceOf(TRPCError);
  });
});
