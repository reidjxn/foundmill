/**
 * The composer's manifest (Leads first, 2026-11-08): background helpers (the utility templates) never write to the
 * founder and are out of the founder's lists, so the composer is never offered one to name. Everyone else stays in it.
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { composerInputs, systemPrompt } from "../compose";
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

describe("loadContext founder (WP-04 T10)", () => {
  it("knows who the note is written to and sends it as trusted JSON in the inputs, not in the instructions", async () => {
    const { businessId, ownerId } = hz.A;
    await repos.founders.upsert(hz.db, ownerId, { displayName: "Maya Lopez", experience: "first_time", budgetMinor: 0 });
    const ctx = await loadContext(hz.db, businessId, { skipUnnarrated: true });
    expect(ctx.founder).toMatchObject({ firstName: "Maya", experience: "first_time", budget: "none", others: [] });
    expect(ctx.founderExperience).toBe("first_time");
    const inputs = composerInputs(ctx, { mode: "events", events: [] });
    expect(inputs.founder).toEqual({ first_name: "Maya", experience: "first_time", good_at: "not_said", wants_to_learn: "not_said", here_for: "on_my_own", budget: "none" });
    const [, rules] = systemPrompt(ctx);
    expect(rules).toContain("`founder`, who the note is written to");
    expect(rules).not.toContain("Maya");
  });
});
