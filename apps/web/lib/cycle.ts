/**
 * Business-cycle status for the shell (processing strip segments + the Continue "processing" state): a snapshot from
 * the API's `cycle.status` (running cycle, paused flag, active departments/agents, completed count) kept current
 * by reducing the `ev:<businessId>` stream (`cycle.started`, `task.started`, `task.completed`, `task.failed`,
 * `cycle.completed`) on top of it.
 */
export interface CycleStatus {
  running: boolean;
  /** The founder paused the running cycle (`business.pauseCycle`); Continue resumes it. */
  paused: boolean;
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

export const EMPTY_CYCLE: CycleStatus = { running: false, paused: false, cycleId: null, cycleNumber: null, activeDepartmentIds: [], activeAgentIds: [], completedCount: 0, lastCompletedAt: null, lastOutcome: null };

export interface CycleEvent {
  type: string;
  occurredAt?: string;
  payload?: Record<string, unknown>;
}

/** The subset of the API's `cycle.status` result the shell reads. */
export interface CycleSnapshotInput {
  running: boolean;
  paused?: boolean;
  cycleId?: string | null;
  cycleNumber?: number | null;
  activeDepartmentIds?: readonly string[];
  activeAgentIds?: readonly string[];
  completedCount?: number;
  lastCompletedAt?: string | null;
  lastOutcome?: string | null;
}

/** `cycle.status` → the shell's status. */
export function cycleFromSnapshot(input: CycleSnapshotInput): CycleStatus {
  return {
    running: input.running,
    paused: input.paused ?? false,
    cycleId: input.cycleId ?? null,
    cycleNumber: input.cycleNumber ?? null,
    activeDepartmentIds: [...(input.activeDepartmentIds ?? [])],
    activeAgentIds: [...(input.activeAgentIds ?? [])],
    completedCount: input.completedCount ?? 0,
    lastCompletedAt: input.lastCompletedAt ?? null,
    lastOutcome: input.lastOutcome ?? null,
  };
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

/** Apply one platform event; unknown types return the same object. */
export function reduceCycleEvent(status: CycleStatus, event: CycleEvent, agentDepartment?: (agentId: string) => string | null | undefined): CycleStatus {
  const p = event.payload ?? {};
  switch (event.type) {
    case "cycle.started":
      return { ...status, running: true, paused: false, cycleId: str(p.cycleId), cycleNumber: num(p.cycleNumber), activeDepartmentIds: [], activeAgentIds: [] };
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
        paused: false,
        activeAgentIds: [],
        activeDepartmentIds: [],
        completedCount: status.completedCount + 1,
        lastCompletedAt: event.occurredAt ?? new Date().toISOString(),
        lastOutcome: str(p.outcome),
      };
    case "holiday.ended":
    case "agents.stopped":
      return { ...status, running: false, paused: false, activeAgentIds: [], activeDepartmentIds: [] };
    default:
      return status;
  }
}

/** The events the shell subscribes to for the strip and the Continue pulse. */
export const CYCLE_EVENT_TYPES = ["cycle.started", "cycle.completed", "task.started", "task.completed", "task.failed", "task.stopped", "task.paused", "holiday.ended"] as const;

/** Pause/resume are mutations, not platform events: the shell applies them to its own status. */
export function setPaused(status: CycleStatus, paused: boolean): CycleStatus {
  return status.paused === paused ? status : { ...status, paused, running: paused ? status.running : true };
}

/**
 * The shell's first cycle status: the server's snapshot when the page arrived with one (the layout prefetches
 * `cycle.status`), so the count of finished cycles is right from the first render (audit WEB-15).
 */
export function initialCycle(snapshot: CycleSnapshotInput | undefined): CycleStatus {
  return snapshot ? cycleFromSnapshot(snapshot) : EMPTY_CYCLE;
}

/** Continue pulses once per `cycle.completed` from the stream, never because a snapshot was adopted (audit WEB-15). */
export function nextPulseKey(key: number, eventType: string): number {
  return eventType === "cycle.completed" ? key + 1 : key;
}
