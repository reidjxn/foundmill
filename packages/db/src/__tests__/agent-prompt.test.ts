/**
 * `resolveAgentPrompt` (WP-06 T1): the instructions and skills a call made in an agent's name renders. The business's
 * live agent of the role brings its live version (unless it still follows the template) and its skills; without one the
 * template stands; another business's agent is never returned.
 */
import { getChannelTemplate, getLibrarySkill, getTemplate } from "@foundmill/agents";
import { NotFoundError } from "@foundmill/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveAgentPrompt } from "../agent-prompt";
import { repos } from "../repos";
import * as s from "../schema";
import { attachAddedSkills, resolveLibrarySkill } from "../skill-attach";
import { setupRepoHarness, type RepoHarness } from "./repos/helpers";

let r: RepoHarness;
let leadId: string;
const lead = getTemplate("product_lead");
const edited = { ...lead.instructions, role: "Head of Product, edited by the founder", rules: [...lead.instructions.rules, "Name the customer in every decision."] };
const skill = getLibrarySkill("interview_synthesis")!;

async function hire(businessId: string, key: string, name: string) {
  const t = getTemplate(key);
  return repos.agents.create(r.db, businessId, { name, role: t.role, agentType: t.agentType, layer: "worker", initialVersion: { instructions: t.instructions, tools: t.tools, createdByKind: "system" } });
}

beforeAll(async () => {
  r = await setupRepoHarness("agent-prompt");
  const agent = await hire(r.A.businessId, "product_lead", "Mira");
  leadId = agent.id;
  const v2 = await repos.agents.createVersion(r.db, r.A.businessId, agent.id, { instructions: edited, state: "draft" });
  await repos.agents.promoteVersion(r.db, r.A.businessId, agent.id, v2.id);
  await attachAddedSkills(r.db, r.A.businessId, agent, [resolveLibrarySkill(skill.key)], async () => {});
  // A later Product Lead in A that still follows the template: the oldest one is the role's agent.
  await hire(r.A.businessId, "product_lead", "Second lead");
}, 120_000);

afterAll(async () => {
  await r?.close();
});

describe("resolveAgentPrompt", () => {
  it("an edited Product Lead brings version 2's instructions and its added library skill", async () => {
    const got = await resolveAgentPrompt(r.db, r.A.businessId, { templateKey: "product_lead" });
    expect(got.agentId).toBe(leadId);
    expect(got.templateKey).toBe("product_lead");
    expect(got.instructions.role).toBe(edited.role);
    expect(got.instructions.rules).toContain("Name the customer in every decision.");
    expect(got.description).toBe(lead.description);
    expect(got.skills).toEqual([{ name: skill.attribute.name, source: "library", instructionsMd: skill.instructionsMd }]);
    const byId = await resolveAgentPrompt(r.db, r.A.businessId, { agentId: leadId });
    expect(byId).toEqual(got);
  });

  it("a business with no agent of the role resolves to the template and its role skills", async () => {
    const got = await resolveAgentPrompt(r.db, r.B.businessId, { templateKey: "product_lead" });
    expect(got).toEqual({ agentId: null, templateKey: "product_lead", instructions: lead.instructions, description: lead.description, skills: [] });
    const social = getChannelTemplate("social");
    const channel = await resolveAgentPrompt(r.db, r.B.businessId, { channelKey: "social" });
    expect(channel).toMatchObject({ agentId: null, templateKey: social.key, instructions: social.instructions });
  });

  it("another business's agent is never returned", async () => {
    await expect(resolveAgentPrompt(r.db, r.B.businessId, { agentId: leadId })).rejects.toBeInstanceOf(NotFoundError);
    const got = await resolveAgentPrompt(r.db, r.B.businessId, { templateKey: "product_lead" });
    expect(got.agentId).toBeNull();
    expect(got.instructions.role).not.toBe(edited.role);
  });

  it("the foundations inputs carry the business's Product lead, so the first page and plan render its edit and skill", async () => {
    const inputs = await repos.foundations.inputs(r.db, r.A.businessId);
    expect(inputs.agent?.instructions.role).toBe(edited.role);
    expect(inputs.agent?.skills.map((s) => s.name)).toEqual([skill.attribute.name]);
  });

  it("version 1 written by the system follows the template; an archived agent is skipped", async () => {
    const researcher = await hire(r.B.businessId, "product_researcher", "Ola");
    // A template edit after hiring reaches the agent: its stored copy is not read.
    await r.h.db.update(s.agentVersions).set({ instructions: { ...edited, role: "stale copy" } }).where(eq(s.agentVersions.agentId, researcher.id));
    const got = await resolveAgentPrompt(r.db, r.B.businessId, { templateKey: "product_researcher" });
    expect(got.agentId).toBe(researcher.id);
    expect(got.instructions).toEqual(getTemplate("product_researcher").instructions);
    await r.h.db.update(s.agents).set({ archivedAt: new Date() }).where(eq(s.agents.id, researcher.id));
    expect((await resolveAgentPrompt(r.db, r.B.businessId, { templateKey: "product_researcher" })).agentId).toBeNull();
  });
});
