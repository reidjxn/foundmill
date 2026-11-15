/**
 * Where an agent's tools and instructions come from (activities/session.ts `followsTemplate`, `parseGrants`,
 * `instructionsFor`): the version the platform wrote at hiring follows its template, so a tool or rule added to the
 * template reaches the agent; a version anyone edited keeps its own.
 */
import type { AgentVersion } from "@foundmill/db";
import { describe, expect, it } from "vitest";
import { followsTemplate, instructionsFor, parseGrants } from "../activities/session";

const instructions = (role: string) => ({ role, goals: ["g"], rules: ["r"], playbook: ["p"], tone: "t", examples: [] });
const template = { tools: [{ connectorKey: "platform", tools: ["tasks.list", "tasks.update"] }], instructions: instructions("Template role") };
const version = (overrides: Partial<AgentVersion>): AgentVersion =>
  ({ id: "v", businessId: "b", agentId: "a", version: 1, state: "live", createdByKind: "system", createdBy: null, modelKey: "sonnet", tools: [{ connectorKey: "platform", tools: ["tasks.list"] }], instructions: instructions("Version role"), createdAt: new Date(), updatedAt: new Date(), ...overrides }) as AgentVersion;

describe("an agent's live version and its template", () => {
  it("the hiring version (1, by the system) follows the template: the template's new tool and rule reach the agent", () => {
    const hired = version({});
    expect(followsTemplate(hired)).toBe(true);
    expect(parseGrants(hired, template)).toEqual([{ connectorKey: "platform", tools: ["tasks.list", "tasks.update"] }]);
    expect(instructionsFor(hired, template).role).toBe("Template role");
    expect(followsTemplate(null)).toBe(true);
    expect(parseGrants(null, template)[0]!.tools).toContain("tasks.update");
  });

  it("a version the founder, the coach or an agent wrote keeps its own tools and instructions", () => {
    for (const edited of [version({ version: 2, createdByKind: "user" }), version({ version: 2, createdByKind: "agent" }), version({ version: 1, createdByKind: "user" }), version({ version: 3, createdByKind: "system" })]) {
      expect(followsTemplate(edited)).toBe(false);
      expect(parseGrants(edited, template)).toEqual([{ connectorKey: "platform", tools: ["tasks.list"] }]);
      expect(instructionsFor(edited, template).role).toBe("Version role");
    }
    // An edited version with nothing readable falls back to the template rather than to no tools at all.
    expect(parseGrants(version({ version: 2, createdByKind: "user", tools: [] }), template)[0]!.tools).toContain("tasks.update");
    expect(instructionsFor(version({ version: 2, createdByKind: "user", instructions: { broken: true } }), template).role).toBe("Template role");
  });
});
