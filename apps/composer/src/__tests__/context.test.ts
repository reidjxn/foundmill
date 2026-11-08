/**
 * The composer's manifest (Leads first, 2026-11-08): background helpers (the utility templates) never write to the
 * founder and are out of the founder's lists, so the composer is never offered one to name. Everyone else stays in it.
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadContext } from "../context";
import { createComposerHarness, type ComposerHarness } from "./harness";

let hz: ComposerHarness;

beforeAll(async () => {
  hz = await createComposerHarness("context");
}, 120_000);

afterAll(async () => {
  await hz?.close();
});

describe("loadContext manifest", () => {
  it("leaves background helpers out and keeps the specialists, the Planner included", async () => {
    const { businessId } = hz.A;
    const helper = await repos.agents.create(hz.db, businessId, { name: "Entity linker", agentType: "entity_linker", layer: "utility" });
    const sorter = await repos.agents.create(hz.db, businessId, { name: "Inbound sorter", agentType: "triage", layer: "worker" });
    const planner = await repos.agents.create(hz.db, businessId, { name: "Planner", agentType: "planner", layer: "worker" });
    const ctx = await loadContext(hz.db, businessId, { skipUnnarrated: true });
    expect(ctx.manifest.has(helper.id)).toBe(false);
    // A utility template is a helper by its template even on another layer.
    expect(ctx.manifest.has(sorter.id)).toBe(false);
    expect(ctx.manifest.has(planner.id)).toBe(true);
    expect(ctx.manifest.text).not.toContain("Entity linker");
    // The business's own agents are all still known to the composer (an old draft that names one still validates).
    expect(ctx.agentIds.has(helper.id)).toBe(true);
  });
});
