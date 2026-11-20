import { describe, expect, it } from "vitest";
import { agentTier, backgroundHelpersLine, founderVisible, isBackgroundAgent, leadAgentIds, teamCaption, teamTree, type TierAgent } from "./team-tiers";

const departments = [
  { id: "d-dev", leadAgentId: "eng-lead", position: 1 },
  { id: "d-prod", leadAgentId: "prod-lead", position: 0 },
  { id: "d-team", leadAgentId: "cos", position: 2 },
  { id: "d-empty", leadAgentId: null, position: 3 },
];

const agents: TierAgent[] = [
  { id: "cos", layer: "assistant", agentType: "chief_of_staff", departmentIds: ["d-team"] },
  { id: "eng-lead", layer: "lead", agentType: "engineering_lead", departmentIds: ["d-dev"], lineManagerId: "cos" },
  { id: "prod-lead", layer: "lead", agentType: "product_lead", departmentIds: ["d-prod"], lineManagerId: "cos" },
  { id: "planner", layer: "worker", agentType: "planner", departmentIds: ["d-dev"], lineManagerId: "eng-lead" },
  { id: "frontend", layer: "worker", agentType: "frontend_engineer", departmentIds: ["d-dev"] },
  { id: "pm", layer: "worker", agentType: "researcher", departmentIds: ["d-prod"], lineManagerId: "prod-lead" },
  { id: "linker", layer: "utility", agentType: "entity_linker", departmentIds: ["d-team"], lineManagerId: "cos" },
  { id: "triage", layer: "utility", agentType: "triage", departmentIds: ["d-team"], lineManagerId: "cos" },
  { id: "gone", layer: "worker", agentType: "qa_engineer", departmentIds: ["d-dev"], archivedAt: "2026-10-01T00:00:00.000Z" },
];

describe("agentTier", () => {
  it("reads the Chief of Staff, leads, specialists and background helpers from what is stored", () => {
    const leads = leadAgentIds(departments);
    expect(agents.map((a) => [a.id, agentTier(a, leads)])).toEqual([
      ["cos", "chief"],
      ["eng-lead", "lead"],
      ["prod-lead", "lead"],
      // The Planner takes coding and research tasks: a specialist, not a background helper (founder, 2026-11-08).
      ["planner", "specialist"],
      ["frontend", "specialist"],
      ["pm", "specialist"],
      ["linker", "background"],
      ["triage", "background"],
      ["gone", "specialist"],
    ]);
  });

  it("makes a department's lead a lead whatever its layer, and never a background helper one", () => {
    expect(agentTier({ id: "w", layer: "worker", agentType: "growth_marketer" }, [{ id: "d", leadAgentId: "w" }])).toBe("lead");
    expect(agentTier({ id: "u", layer: "utility", agentType: "classifier" }, [{ id: "d", leadAgentId: "u" }])).toBe("background");
    expect(agentTier({ id: "x", agentType: "operations_lead" })).toBe("lead");
  });

  it("follows the API's Chief of Staff flag and its stored tier", () => {
    expect(agentTier({ id: "a", layer: "assistant", chiefOfStaff: true })).toBe("chief");
    // A second assistant that is not the designated one ranks with the leads.
    expect(agentTier({ id: "b", layer: "assistant", chiefOfStaff: false })).toBe("lead");
    expect(agentTier({ id: "c", layer: "worker", tier: "background" })).toBe("background");
    expect(isBackgroundAgent({ tier: "specialist", layer: "utility" })).toBe(false);
    expect(isBackgroundAgent({ layer: "utility" })).toBe(true);
    expect(isBackgroundAgent({ agentType: "moderation" })).toBe(true);
    expect(founderVisible(agents).map((a) => a.id)).not.toContain("linker");
  });
});

describe("teamTree", () => {
  const tree = teamTree(agents, departments);

  it("puts the Chief of Staff first, then the leads in department order, each with its specialists", () => {
    expect(tree.groups.map((g) => [g.agent.id, g.specialists.map((s) => s.id)])).toEqual([
      ["cos", []],
      ["prod-lead", ["pm"]],
      ["eng-lead", ["planner", "frontend"]],
    ]);
    expect(tree.visible.map((a) => a.id)).toEqual(["cos", "prod-lead", "pm", "eng-lead", "planner", "frontend"]);
    expect(tree.background.map((a) => a.id)).toEqual(["linker", "triage"]);
    expect(tree.counts).toEqual({ chief: 1, lead: 2, specialist: 3, background: 2 });
  });

  it("draws the Hierarchy's reporting line: the line manager, else the department's lead, else the Chief of Staff", () => {
    expect(Object.fromEntries(tree.parentOf)).toEqual({ cos: null, "eng-lead": "cos", "prod-lead": "cos", planner: "eng-lead", frontend: "eng-lead", pm: "prod-lead" });
    // Background helpers and archived agents have no place in it.
    expect(tree.parentOf.has("linker")).toBe(false);
    expect(tree.parentOf.has("gone")).toBe(false);
  });

  it("never hangs anyone under a background helper, and groups a specialist managed by a specialist with that one's lead", () => {
    const t = teamTree(
      [
        ...agents,
        { id: "junior", layer: "worker", agentType: "backend_engineer", departmentIds: ["d-dev"], lineManagerId: "frontend" },
        { id: "odd", layer: "worker", agentType: "backend_engineer", departmentIds: ["d-empty"], lineManagerId: "linker" },
      ],
      departments,
    );
    expect(t.parentOf.get("junior")).toBe("frontend");
    expect(t.groupOf.get("junior")).toBe("eng-lead");
    // Its line manager is a helper: it falls back to its department's lead, and that department has none, so the Chief of Staff.
    expect(t.parentOf.get("odd")).toBe("cos");
    expect(t.groupOf.get("odd")).toBe("cos");
  });

  it("survives a reporting round of work and a team with no Chief of Staff", () => {
    const t = teamTree(
      [
        { id: "a", layer: "worker", agentType: "x", lineManagerId: "b" },
        { id: "b", layer: "worker", agentType: "y", lineManagerId: "a" },
        { id: "l", layer: "lead", agentType: "product_lead" },
      ],
      [],
    );
    expect(t.chief).toBeNull();
    expect(t.groups.map((g) => g.agent.id)).toEqual(["l", "a", "b"]);
    expect(t.parentOf.get("l")).toBeNull();
  });
});

describe("founder copy", () => {
  it("names the Chief of Staff, counts leads and specialists, and says how many need the founder", () => {
    expect(teamCaption({ chief: 1, lead: 6, specialist: 23 }, 2)).toBe("Chief of Staff · 6 leads · 23 specialists · 2 need you");
    expect(teamCaption({ chief: 1, lead: 1, specialist: 1 }, 1)).toBe("Chief of Staff · 1 lead · 1 specialist · 1 needs you");
    expect(teamCaption({ chief: 0, lead: 0, specialist: 2 })).toBe("0 leads · 2 specialists");
  });

  it("says what the background helpers do in one line", () => {
    expect(backgroundHelpersLine(5)).toBe("5 background helpers also run, linking names, sorting what comes in and checking drafts. They never take tasks or write to you.");
    expect(backgroundHelpersLine(1)).toMatch(/^1 background helper also runs,/);
  });
});
