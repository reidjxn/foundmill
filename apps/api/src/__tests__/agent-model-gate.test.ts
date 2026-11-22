/**
 * WP-13 T7: the model dialog by who pays. On the free plan the founder chooses Haiku 5.5 or GLM-5.3 Flash; Opus and
 * Sonnet come back gated (`upgrade_or_own_key`) and `agent.model.set` refuses them, keeping the stored choice.
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

describe("agent.model by plan (WP-13 T7)", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "modelgate", temporalClient: fakeTemporalClient() });
  }, 120_000);
  afterAll(() => hz.close());

  const compare = async (agentId: string) => {
    const { businessId, ownerId } = hz.A;
    const c = await hz.caller({ userId: ownerId }).agent.model.compare({ businessId, agentId });
    return { ...c, gates: Object.fromEntries(c.options.map((o) => [o.modelKey, (o as { gate?: string }).gate ?? null])) };
  };
  const hire = (name: string, modelKey: "opus" | "sonnet" | "haiku") => repos.agents.create(hz.db, hz.A.businessId, { name, agentType: "backend_engineer", modelKey });

  it("free plan: Haiku and GLM are open, Opus and Sonnet are gated, and a stored Opus is kept and shown as in use", async () => {
    await repos.businesses.update(hz.db, hz.A.businessId, { planTier: "free", modelBilling: "credits" });
    const a = await hire("Stored Opus", "opus");
    const c = await compare(a.id);
    expect(c.gates).toEqual({ opus: "upgrade_or_own_key", sonnet: "upgrade_or_own_key", haiku: null, glm: null });
    // `FREE_SESSION_MODEL` is `routed` by default: the session runs on the agent's own model, so that is what is in use.
    expect(c).toMatchObject({ current: "opus", inUse: "opus" });
  });

  it("free plan: setting Opus or Sonnet is refused and changes nothing; GLM and Haiku are set, with no retest for GLM", async () => {
    const { businessId, ownerId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const a = await hire("Free chooser", "sonnet");
    await expect(owner.agent.model.set({ businessId, agentId: a.id, modelKey: "opus" })).rejects.toMatchObject({ message: expect.stringMatching(/paid plan, or connect your own Anthropic key/) });
    expect((await repos.agents.get(hz.db, businessId, a.id)).modelKey).toBe("sonnet");

    const glm = await owner.agent.model.set({ businessId, agentId: a.id, modelKey: "glm" });
    expect(glm).toMatchObject({ updated: [a.id], retests: [] });
    expect((await repos.agents.get(hz.db, businessId, a.id)).modelKey).toBe("glm");
    expect(await compare(a.id)).toMatchObject({ current: "glm", inUse: "glm" });
    expect((await owner.agent.model.set({ businessId, agentId: a.id, modelKey: "haiku" })).updated).toEqual([a.id]);
  });

  it("a paid plan has every option open, GLM included", async () => {
    await repos.businesses.update(hz.db, hz.A.businessId, { planTier: "pro", modelBilling: "credits" });
    const a = await hire("Paid chooser", "haiku");
    expect((await compare(a.id)).gates).toEqual({ opus: null, sonnet: null, haiku: null, glm: null });
    expect((await hz.caller({ userId: hz.A.ownerId }).agent.model.set({ businessId: hz.A.businessId, agentId: a.id, modelKey: "opus" })).updated).toEqual([a.id]);
  });

  it("an own Anthropic key opens every Claude model and is not offered GLM, which runs on Foundmill's key", async () => {
    await repos.businesses.update(hz.db, hz.A.businessId, { planTier: "free", modelBilling: "byok" });
    const a = await hire("Own key", "haiku");
    const c = await compare(a.id);
    expect(c.gates).toEqual({ opus: null, sonnet: null, haiku: null });
    expect(c.inUse).toBe("haiku");
    await expect(hz.caller({ userId: hz.A.ownerId }).agent.model.set({ businessId: hz.A.businessId, agentId: a.id, modelKey: "glm" })).rejects.toMatchObject({ message: expect.stringMatching(/own Anthropic key/) });
    expect((await hz.caller({ userId: hz.A.ownerId }).agent.model.set({ businessId: hz.A.businessId, agentId: a.id, modelKey: "sonnet" })).updated).toEqual([a.id]);
  });
});
