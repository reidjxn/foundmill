/**
 * Regulated-sector gates reach the team (audit W03 #176): every gate the founder has not cleared goes into the cycle
 * brief with what the team must not do under it, from the founder's saved choices or, without one, the suggestion from
 * the business profile. A cleared gate, a sector switched off, and a business with nothing suggested add nothing.
 */
import { repos } from "@foundmill/db";
import { SECTOR_GATES } from "@foundmill/shared/sectors";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBriefActivities } from "../activities/brief";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "regulatory" });
});
afterAll(async () => {
  await t?.close();
});

describe("loadBrief: regulated-sector gates", () => {
  it("lists an open gate with what the team must not do, and drops it once the founder clears or switches it off", async () => {
    const { loadBrief } = createBriefActivities(t.deps);
    await repos.businesses.update(t.db, t.businessId, { name: "Northwind Skincare", glossary: {} });
    // suggested from the name until the founder decides
    let brief = await loadBrief({ businessId: t.businessId });
    expect(brief.text).toContain("## Regulated areas (gates open)");
    expect(brief.text).toContain(`- Cosmetics: ${SECTOR_GATES.cosmetics.blocked.join("; ")}`);
    expect(brief.text).toContain("propose it to the founder as a decision instead");

    // switched on by hand: Health, with one item ticked
    await repos.legal.setSectorChoice(t.db, t.businessId, { sector: "health", applies: true, done: ["claims"] });
    brief = await loadBrief({ businessId: t.businessId });
    expect(brief.text).toContain(`- Health: ${SECTOR_GATES.health.blocked.join("; ")}`);

    // every item of Cosmetics done: cleared. Health switched off: not applicable.
    await repos.legal.setSectorChoice(t.db, t.businessId, { sector: "cosmetics", applies: true, done: SECTOR_GATES.cosmetics.checklist.map((i) => i.id) });
    await repos.legal.setSectorChoice(t.db, t.businessId, { sector: "health", applies: false });
    brief = await loadBrief({ businessId: t.businessId });
    expect(brief.text).not.toContain("- Cosmetics:");
    expect(brief.text).not.toContain("- Health:");
  });

  it("adds nothing for a business with no sector suggested and none chosen", async () => {
    const { loadBrief } = createBriefActivities(t.deps);
    await repos.businesses.update(t.db, t.businessId, { name: "Steady Teams", archetype: "b2b_saas", glossary: { squad: "lab team" } });
    for (const c of await repos.legal.listSectorChoices(t.db, t.businessId)) await repos.legal.setSectorChoice(t.db, t.businessId, { sector: c.sector, applies: false });
    const brief = await loadBrief({ businessId: t.businessId });
    expect(brief.text).not.toContain("Regulated areas");
  });
});
