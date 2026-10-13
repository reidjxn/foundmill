/**
 * Usage by department adds up (audit ARB-21): an agent's cost counts once, in its primary department, so a loaned agent
 * does not double the table; the departments sum to the agent-attributed total.
 */
import { describe, expect, it } from "vitest";
import { costByDepartment } from "../services/billing-usage";

const departments = [
  { id: "d-team", name: "Team" },
  { id: "d-design", name: "Service design" },
];

describe("costByDepartment", () => {
  it("counts a loaned agent's cost once, in its primary department", () => {
    const agents = [
      { id: "chief", departmentIds: ["d-team", "d-design"] },
      { id: "designer", departmentIds: ["d-design"] },
    ];
    const wages = [
      { agentId: "chief", costMinor: 5 },
      { agentId: "designer", costMinor: 3 },
    ];
    const rows = costByDepartment(departments, agents, wages);
    expect(rows).toEqual([
      { departmentId: "d-team", name: "Team", costMinor: 5 },
      { departmentId: "d-design", name: "Service design", costMinor: 3 },
    ]);
    // Department costs add up to the agents' total.
    expect(rows.reduce((s, r) => s + r.costMinor, 0)).toBe(wages.reduce((s, w) => s + w.costMinor, 0));
  });

  it("an agent whose primary department is archived counts in its first live one; an agent in none counts nowhere; unattributed cost is left out", () => {
    const agents = [
      { id: "a", departmentIds: ["d-gone", "d-design"] },
      { id: "b", departmentIds: ["d-gone"] },
      { id: "c", departmentIds: [] },
    ];
    const rows = costByDepartment(departments, agents, [
      { agentId: "a", costMinor: 4 },
      { agentId: "b", costMinor: 9 },
      { agentId: "c", costMinor: 1 },
      { agentId: null, costMinor: 7 },
    ]);
    expect(rows.map((r) => r.costMinor)).toEqual([0, 4]);
  });
});
