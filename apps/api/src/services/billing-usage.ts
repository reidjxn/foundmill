/**
 * Usage by department for Settings › Billing. An agent's cost belongs to one department, its primary one (the first of
 * its `departmentIds`, as a session is attributed, DECISIONS 2026-10-07), so the departments add up to the agent-attributed
 * total. Counting a loaned agent's whole cost in every department it belongs to made the table sum to more than the
 * total (audit ARB-21).
 */

export interface DepartmentCost {
  departmentId: string;
  name: string;
  costMinor: number;
}

/**
 * `departments` are the ones shown (live ones); an agent whose primary department is not among them (archived) is
 * counted in its first listed department, and an agent in none of them is counted nowhere (it still shows by agent).
 */
export function costByDepartment(departments: readonly { id: string; name: string }[], agents: readonly { id: string; departmentIds: readonly string[] }[], wages: readonly { agentId: string | null; costMinor: number }[]): DepartmentCost[] {
  const shown = new Set(departments.map((d) => d.id));
  const primary = new Map<string, string>();
  for (const a of agents) {
    const home = a.departmentIds.find((id) => shown.has(id));
    if (home) primary.set(a.id, home);
  }
  const cost = new Map<string, number>();
  for (const w of wages) {
    const home = w.agentId ? primary.get(w.agentId) : undefined;
    if (home) cost.set(home, (cost.get(home) ?? 0) + w.costMinor);
  }
  return departments.map((d) => ({ departmentId: d.id, name: d.name, costMinor: cost.get(d.id) ?? 0 }));
}
