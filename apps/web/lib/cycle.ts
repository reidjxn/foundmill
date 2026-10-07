/**
 * Business-cycle status for the shell (processing strip segments + the Continue "processing" state), reduced from
 * the `ev:<businessId>` stream (`cycle.started`, `task.started`, `task.completed`, `task.failed`, `cycle.completed`)
 * on top of a snapshot taken from the API (agents by status, running tasks).
 *
 * The API has no `cycle.status` procedure yet (open issue), so the snapshot is derived: a cycle counts as running
 * when any task is `running`; the departments with running tasks are the active segments.
 */
export interface CycleStatus {
  running: boolean;
  cycleId: string | null;
  cycleNumber: number | null;
  /** Department ids with agents working this cycle. */
  activeDepartmentIds: readonly string[];
  /** Agent ids currently running a task (mapped to departments through the squad lists). */
  activeAgentIds: readonly string[];
  /** Bumped on every `cycle.completed`; the shell uses it as the Continue pulse key. */
  completedCount: number;
  lastCompletedAt: string | null;
  lastOutcome: string | null;
}

export const EMPTY_CYCLE: CycleStatus = { running: false, cycleId: null, cycleNumber: null, activeDepartmentIds: [], activeAgentIds: [], completedCount: 0, lastCompletedAt: null, lastOutcome: null };

export interface CycleEvent {
  type: string;
  occurredAt?: string;
  payload?: Record<string, unknown>;
}

export interface CycleSnapshotInput {
  tasks?: readonly { status: string; assigneeAgentId?: string | null; departmentId?: string | null }[];
}

export function cycleFromSnapshot(input: CycleSnapshotInput): CycleStatus {
  const running = (input.tasks ?? []).filter((t) => t.status === "running");
  const depts = new Set<string>();
  const agents = new Set<string>();
  for (const t of running) {
    if (t.departmentId) depts.add(t.departmentId);
    if (t.assigneeAgentId) agents.add(t.assigneeAgentId);
  }
  return { ...EMPTY_CYCLE, running: running.length > 0, activeDepartmentIds: [...depts], activeAgentIds: [...agents] };
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

/** Apply one platform event; unknown types return the same object. */
export function reduceCycleEvent(status: CycleStatus, event: CycleEvent, agentDepartment?: (agentId: string) => string | null | undefined): CycleStatus {
  const p = event.payload ?? {};
  switch (event.type) {
    case "cycle.started":
      return { ...status, running: true, cycleId: str(p.cycleId), cycleNumber: num(p.cycleNumber), activeDepartmentIds: [], activeAgentIds: [] };
    case "task.started": {
      const agentId = str(p.assigneeAgentId);
      const deptId = str(p.departmentId) ?? (agentId ? (agentDepartment?.(agentId) ?? null) : null);
      const agents = agentId && !status.activeAgentIds.includes(agentId) ? [...status.activeAgentIds, agentId] : status.activeAgentIds;
      const depts = deptId && !status.activeDepartmentIds.includes(deptId) ? [...status.activeDepartmentIds, deptId] : status.activeDepartmentIds;
      return { ...status, running: true, activeAgentIds: agents, activeDepartmentIds: depts };
    }
    case "task.completed":
    case "task.failed":
    case "task.stopped":
    case "task.paused": {
      const agentId = str(p.assigneeAgentId);
      if (!agentId) return status;
      const agents = status.activeAgentIds.filter((a) => a !== agentId);
      const deptId = str(p.departmentId) ?? agentDepartment?.(agentId) ?? null;
      const stillActive = deptId ? agents.some((a) => agentDepartment?.(a) === deptId) : true;
      const depts = deptId && !stillActive ? status.activeDepartmentIds.filter((d) => d !== deptId) : status.activeDepartmentIds;
      return { ...status, activeAgentIds: agents, activeDepartmentIds: depts };
    }
    case "cycle.completed":
      return {
        ...status,
        running: false,
        activeAgentIds: [],
        activeDepartmentIds: [],
        completedCount: status.completedCount + 1,
        lastCompletedAt: event.occurredAt ?? new Date().toISOString(),
        lastOutcome: str(p.outcome),
      };
    case "holiday.ended":
    case "agents.stopped":
      return { ...status, running: false, activeAgentIds: [], activeDepartmentIds: [] };
    default:
      return status;
  }
}

/** The events the shell subscribes to for the strip and the Continue pulse. */
export const CYCLE_EVENT_TYPES = ["cycle.started", "cycle.completed", "task.started", "task.completed", "task.failed", "task.stopped", "task.paused", "holiday.ended"] as const;
