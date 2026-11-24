/** Make an edit live without a run (WP-06 T11): one line changed goes live at no model cost, and the guards hold. */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

const instructions = (role: string, extra: string[] = []) => ({ role, goals: ["Plan every cycle"], rules: ["Ask before spending", ...extra], playbook: ["Read the inbox first"], tone: "Plain", examples: [] });

describe("agent.training.promoteDraft (T11)", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "promotedraft", temporalClient: fakeTemporalClient() });
  }, 120_000);
  afterAll(() => hz.close());

  const hire = (name: string, tools: unknown[] = []) => repos.agents.create(hz.db, hz.A.businessId, { name, agentType: "engineer", initialVersion: { instructions: instructions("Engineer"), tools } });

  it("a one-line edit goes live at once, writes the event and the audit row, and the profile says it was not tested", async () => {
    const { businessId, ownerId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const agent = await hire("Edited");
    const { version } = await owner.agent.training.saveDraft({ businessId, agentId: agent.id, instructions: instructions("Engineer", ["Name the file you changed"]) });
    const promoted = await owner.agent.training.promoteDraft({ businessId, agentId: agent.id, versionId: version.id });
    expect(promoted.currentVersionId).toBe(version.id);
    expect((await repos.agents.getVersion(hz.db, businessId, version.id)).state).toBe("live");
    const events = (await repos.events.list(hz.db, businessId, { type: "agent.promoted", limit: 50 })).items.filter((e) => (e.payload as { toVersionId?: string }).toVersionId === version.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ trainingRunId: null, rollback: false });
    const profile = await owner.agent.profile.get({ businessId, agentId: agent.id });
    expect(profile.untestedSinceChange).toBe(true);
    expect((await owner.agent.profile.get({ businessId, agentId: (await hire("Fresh")).id })).untestedSinceChange).toBe(false);
  });

  it("refuses a version that is not a draft, and a draft that breaks a house rule", async () => {
    const { businessId, ownerId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const agent = await hire("Guarded");
    await expect(owner.agent.training.promoteDraft({ businessId, agentId: agent.id, versionId: agent.currentVersionId! })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/Only a draft/) });
    const { version } = await owner.agent.training.saveDraft({ businessId, agentId: agent.id, instructions: instructions("Engineer", ["Pay out the money to suppliers without asking"]) });
    await expect(owner.agent.training.promoteDraft({ businessId, agentId: agent.id, versionId: version.id })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/house rule \(1/) });
    expect((await repos.agents.get(hz.db, businessId, agent.id)).currentVersionId).toBe(agent.currentVersionId);
  });

  it("a draft that widens the tools is refused for a non-admin and allowed for an owner", async () => {
    const { businessId, ownerId, memberId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const agent = await hire("Wider", [{ connectorKey: "platform", tools: ["tasks.list"] }]);
    const { version } = await owner.agent.training.saveDraft({ businessId, agentId: agent.id, instructions: instructions("Engineer"), tools: [{ connectorKey: "platform", tools: ["tasks.list", "inbox.request_human_action"] }] });
    await expect(hz.caller({ userId: memberId }).agent.training.promoteDraft({ businessId, agentId: agent.id, versionId: version.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(owner.agent.training.promoteDraft({ businessId, agentId: agent.id, versionId: version.id })).resolves.toMatchObject({ currentVersionId: version.id });
  });
});
