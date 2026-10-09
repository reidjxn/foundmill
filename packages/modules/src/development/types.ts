/**
 * Structural types for the tRPC responses the development screens read through `useWidgetQuery` (apps/api
 * `dev.*`, `team.agents.list`, `product.roadmap.list`; BUILD §8.3). Declared here, not imported from apps/api, so the
 * package depends only on wave-1 packages. Dates arrive as ISO strings on the wire (a `Date` is tolerated).
 */
import type { AgentStatus, DeptColourToken, ModelKey, TaskKind, TaskPhase, TaskStatus } from "@foundmill/shared";

export type Iso = string | Date;

/* dev.tasks.list */
export interface TaskRow {
  id: string;
  kind: TaskKind;
  title: string;
  goalMd?: string;
  acceptance?: unknown[];
  fileScope?: string[];
  roadmapItemId?: string | null;
  departmentId?: string | null;
  assigneeAgentId?: string | null;
  status: TaskStatus;
  /** numeric(5,4) arrives as a string from Drizzle; a number is tolerated. */
  progress?: string | number | null;
  phase?: TaskPhase | null;
  eta?: Iso | null;
  priority?: number;
  startedAt?: Iso | null;
  endedAt?: Iso | null;
  createdAt?: Iso;
  updatedAt?: Iso;
}

export interface TaskEdgeRow {
  id?: string;
  fromTask: string;
  toTask: string;
}

export interface TasksListResponse {
  items: TaskRow[];
  nextCursor?: string | null;
  edges: TaskEdgeRow[];
  counts: Partial<Record<TaskStatus, number>>;
}

/* dev.sessions.list / stream / replay */
export interface SessionRow {
  id: string;
  agentId: string;
  taskId?: string | null;
  workflowId?: string | null;
  modelKey?: ModelKey;
  startedAt: Iso;
  endedAt?: Iso | null;
  tokensIn?: number;
  tokensOut?: number;
  costMinor?: number;
  currency?: string;
  outcome?: string | null;
  recordingRef?: string | null;
}

export interface SessionsListResponse {
  items: SessionRow[];
  nextCursor?: string | null;
}

export interface SessionReplayResponse {
  session: SessionRow;
  recordingRef: string | null;
  channel: string;
  /** `dev.sessions.replay` events (packages/events SessionEvent: `kind` + `at`), from the `as:<sessionId>` stream or the mock recording; read through readSessionEvent. */
  events?: unknown[];
  total?: number;
  source?: "stream" | "recording" | "none";
  live?: boolean;
}

/* team.agents.list */
export interface AgentRow {
  id: string;
  name: string;
  role?: string;
  agentType?: string;
  status: AgentStatus;
  modelKey: ModelKey;
  avatarSeed?: string;
  departmentIds?: string[];
  departments?: { id: string; name: string; colourToken: DeptColourToken }[];
  currentTask?: { id: string; title: string } | null;
}

export interface AgentsListResponse {
  agents: AgentRow[];
  templates?: string[];
}

/* dev.prs.list */
export interface OpenPrRow {
  taskId: string;
  title: string;
  status: TaskStatus;
  branch: string;
  agentId: string | null;
}

export interface MergedPrRow {
  eventId: string;
  occurredAt: Iso;
  taskId?: string | null;
  repo?: string;
  prNumber?: number;
  title?: string;
  branch?: string;
  baseBranch?: string;
  mergeCommitSha?: string;
  mergedBy?: { kind?: string; id?: string | null; name?: string } | null;
  additions?: number;
  deletions?: number;
  filesChanged?: number;
  url?: string | null;
}

export interface PrsListResponse {
  open: OpenPrRow[];
  merged: MergedPrRow[];
}

/* product.roadmap.list (the planner trigger picks a roadmap item) */
export interface RoadmapItemRow {
  id: string;
  title: string;
  horizon?: "now" | "next" | "later" | string;
  position?: number;
  status?: string;
}

export interface RoadmapListResponse {
  items: RoadmapItemRow[];
}

/* dev.tasks.openInClaudeCode */
export interface OpenInClaudeCodeResponse {
  branch: string;
  checkout: string;
  contextMd: string;
  agent: { id: string; name: string; modelKey: ModelKey } | null;
}

/* dev.tasks.plan */
export interface PlanResponse {
  tasks: TaskRow[];
  graph: { tasks: TaskRow[]; edges: TaskEdgeRow[] };
  costMinor: number;
  costLabel: "Estimate";
}

/* Mutation results that carry a workflow signal outcome. */
export interface WorkflowOutcome {
  queued: boolean;
  workflowId?: string;
  reason?: string;
}

/* dev.code.list / files / file: the code agents wrote on code tasks, saved when each session ends (0013). */
export interface CodeSnapshotSummary {
  id: string;
  taskId: string;
  sessionId?: string | null;
  agentId?: string | null;
  branch?: string | null;
  fileCount: number;
  totalBytes: number;
  added: number;
  changed: number;
  removed: number;
  createdAt: Iso;
}

export interface CodeManifestEntry {
  path: string;
  sha256: string;
  size: number;
}

export interface CodeTaskRow {
  taskId: string;
  title: string;
  status: TaskStatus;
  assigneeAgentId: string | null;
  latest: CodeSnapshotSummary;
  snapshots: number;
}

export interface CodeFilesResponse {
  taskId: string;
  branch: string;
  snapshot: (CodeSnapshotSummary & { files: CodeManifestEntry[] }) | null;
  history: CodeSnapshotSummary[];
}

export interface CodeFileResponse {
  path: string;
  size: number;
  sha256: string;
  binary: boolean;
  truncated: boolean;
  text: string | null;
}
