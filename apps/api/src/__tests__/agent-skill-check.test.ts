/** The scoped per-agent check (WP-06 T10): a run limited to chosen skills, and a skill check priced before it starts. */
import { hireFromTemplate, repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

describe("scoped checks (T10)", () => {
  let hz: ApiHarness;
  const temporal = fakeTemporalClient();
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "skillcheck", temporalClient: temporal });
  }, 120_000);
  afterAll(() => hz.close());

  it("an estimate and a run limited to skillKeys cover only those skills; a key the agent lacks is a 400", async () => {
    const { businessId, ownerId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const agentId = (await hireFromTemplate(hz.db, businessId, "backend_engineer")).agent.id;
    const carried = (await repos.skills.listForAgent(hz.db, businessId, agentId)).map((s) => s.skillKey);
    expect(carried.length).toBeGreaterThan(1);
    const all = await owner.agent.training.estimate({ businessId, agentId });
    const one = await owner.agent.training.estimate({ businessId, agentId, skillKeys: [carried[0]!] });
    expect(one.skills).toBe(1);
    expect(one.tests).toBeLessThan(all.tests);
    await expect(owner.agent.training.estimate({ businessId, agentId, skillKeys: ["not_a_skill"] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const { version } = await owner.agent.training.saveDraft({ businessId, agentId, instructions: { role: "Chief of Staff", goals: ["Plan every cycle"], rules: ["Ask before spending"], playbook: ["Read the inbox first"], tone: "Plain", examples: [] } });
    await expect(owner.agent.training.run({ businessId, agentId, versionId: version.id, skillKeys: ["not_a_skill"] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const { run } = await owner.agent.training.run({ businessId, agentId, versionId: version.id, skillKeys: [carried[0]!] });
    expect(run.skillKeys).toEqual([carried[0]]);
  });

  it("skills.measure queues a skill_check on the live version of the rated skills the skill improves, priced first", async () => {
    const { businessId, ownerId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const hired = await hireFromTemplate(hz.db, businessId, "backend_engineer");
    const result = await owner.agent.skills.measure({ businessId, agentId: hired.agent.id, skillKey: "library_ponytail" });
    expect(result.run).toMatchObject({ kind: "skill_check", status: "queued", toVersionId: null, fromVersionId: hired.agent.currentVersionId, measuredSkillKey: "library_ponytail" });
    expect(result.run.skillKeys!.length).toBeGreaterThan(0);
    expect(result.run.skillKeys!.length).toBeLessThanOrEqual(3);
    expect(result.estimate).toMatchObject({ arms: 2, label: "Estimate" });
    expect(result.estimate.tests).toBeGreaterThan(0);
    expect(temporal.starts.some((s) => s.workflowId === `training:${result.run.id}`)).toBe(true);
    // A skill the agent does not carry cannot be checked.
    await expect(owner.agent.skills.measure({ businessId, agentId: hired.agent.id, skillKey: "library_cold_email" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
