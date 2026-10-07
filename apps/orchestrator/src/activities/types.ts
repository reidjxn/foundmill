/**
 * Shapes shared between workflows and activities. Workflow code imports this file with `import type` only, so it
 * never enters the workflow bundle; everything here must be JSON-serialisable (Temporal payloads).
 */
import type { SessionCommand } from "../control-bus";
import type { ProgressState } from "../progress";
import type { AgentStatus, BusinessMode, ModelKey, PlanActionType, PolicyOutcome, TaskKind, TaskStatus } from "@foundmill/shared";

// ---------------------------------------------------------------------------------------------------------------------
// Brief and cycle planning
// ---------------------------------------------------------------------------------------------------------------------

export interface BriefDepartment {
  id: string;
  name: string;
  slug: string;
  leadAgentId: string | null;
  moduleKeys: string[];
  budgetMinor: number | null;
}

export interface BriefAgent {
  id: string;
  name: string;
  role: string;
  agentType: string;
  layer: string;
  modelKey: ModelKey;
  status: AgentStatus;
  departmentIds: string[];
  wageCapMinor: number | null;
}

export interface BriefTask {
  id: string;
  title: string;
  kind: TaskKind;
  status: TaskStatus;
  departmentId: string | null;
  assigneeAgentId: string | null;
  priority: number;
  fileScope: string[];
  dependsOn: string[];
  budgetMinor: number | null;
  /** Dependencies not yet done block dispatch. */
  blocked: boolean;
}

export interface BusinessBrief {
  businessId: string;
  businessName: string;
  businessMode: BusinessMode;
  archetype: string | null;
  currency: string;
  glossary: Record<string, string>;
  holidayActive: boolean;
  departments: BriefDepartment[];
  agents: BriefAgent[];
  chiefOfStaffId: string | null;
  openTasks: BriefTask[];
  pendingApprovals: number;
  blockingInboxItems: number;
  /** Credits remaining for the period (label "Estimate"); null when unknown/uncapped. */
  budgetRemainingMinor: number | null;
  maxAgents: number;
  /** Rate-limit capacity summary for the planner prompt. */
  capacity: string;
  /** The ~4k-token prose brief given to every agent (prompt-cached). */
  text: string;
  /** Approximate token count of `text` (4 chars ≈ 1 token). */
  approxTokens: number;
  builtAt: string;
}

export interface CycleStart {
  taskId: string;
  agentId: string;
  departmentId: string | null;
  priority: number;
  reason: string;
  kind: TaskKind;
  fileScope: string[];
  budgetMinor: number | null;
}

export interface CyclePlan {
  summary: string;
  timeBoxHours: number;
  starts: CycleStart[];
  deferred: { taskId: string; reason: string }[];
  approvalsNeeded: string[];
  /** Model used (Opus unless downgraded, with the warning). */
  modelKey: ModelKey;
  warning: string | null;
  costMinor: number;
}

export type CycleTrigger = "continue" | "holiday" | "schedule" | "wake";

export interface BusinessCycleInput {
  businessId: string;
  cycleNumber: number;
  trigger: CycleTrigger;
  /** Override the time box (agent-hours). */
  timeBoxAgentHours?: number;
  /** Max concurrent sessions for this cycle (defaults from the brief). */
  maxConcurrent?: number;
}

export interface BusinessCycleResult {
  cycleId: string;
  outcome: "completed" | "time_box" | "waiting" | "stopped" | "failed";
  tasksDispatched: number;
  tasksCompleted: number;
  tasksBlocked: number;
  inboxItemIds: string[];
  costMinor: number;
}

// ---------------------------------------------------------------------------------------------------------------------
// Agent sessions
// ---------------------------------------------------------------------------------------------------------------------

export interface AgentSessionInput {
  businessId: string;
  agentId: string;
  taskId: string;
  /** The agent_sessions row (created by apps/api or `openSession`). */
  sessionId: string;
  /** Cycle that dispatched the session, when any. */
  cycleId?: string | null;
}

export interface SessionLaunch {
  sandboxMode: "mock" | "docker" | "e2b";
  fellBackFrom: string | null;
  modelKey: ModelKey;
  modelId: string;
  /** Recording key replayed in mock mode. */
  recordingKey: string | null;
  /** `connector:tool` refs granted to the session token. */
  allowedTools: string[];
  /** Connectors exposed as MCP servers (`GATEWAY_URL/mcp/<connector>`). */
  mcpConnectors: string[];
  /** Short-lived env names handed to the sandbox (never values). */
  envNames: string[];
  modelBilling: "byok" | "credits";
  branch: string;
  maxTurns: number;
  planSteps: number;
  acceptanceTests: number;
}

export type SessionOutcome = "done" | "blocked" | "failed" | "stopped";

export interface SessionResult {
  outcome: SessionOutcome;
  reason: string | null;
  blockedReason: "awaiting_approval" | "dependency" | "credential" | "budget" | "rate_limit" | "loop_detected" | "error" | "shout" | "stopped" | null;
  approvalId: string | null;
  progress: ProgressState;
  eventsEmitted: number;
  toolCalls: number;
  toolFailures: number;
  tokensIn: number;
  tokensOut: number;
  costMinor: number;
  durationMs: number;
  prNumber: number | null;
  summary: string;
  /** Last SDK/replay session id for resume. */
  providerSessionId: string | null;
}

export interface SessionFinish {
  taskStatus: TaskStatus;
  eventIds: string[];
  healthChanged: boolean;
}

export type { SessionCommand };

export interface ProgressSnapshot {
  state: "pending" | "preparing" | "running" | "paused" | "awaiting_approval" | "finishing" | "done" | "failed" | "stopped" | "blocked";
  progress: number;
  phase: string | null;
  planStepsDone: number;
  planSteps: number;
  acceptanceTestsPassing: number;
  acceptanceTests: number;
  reviewPassed: boolean;
  merged: boolean;
  etaAt: string | null;
  updatedAt: string | null;
  detail: string | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Plans and approvals
// ---------------------------------------------------------------------------------------------------------------------

export interface PlanActionView {
  id: string;
  type: PlanActionType;
  params: Record<string, unknown>;
  agentId: string | null;
  policyOutcome: PolicyOutcome | null;
  status: string;
}

export interface LoadedPlan {
  planId: string;
  status: string;
  businessMode: BusinessMode;
  actions: PlanActionView[];
}

export interface PlanActionResult {
  actionId: string;
  status: "done" | "failed" | "skipped" | "denied" | "awaiting_approval";
  outcome: PolicyOutcome | null;
  approvalId: string | null;
  result: Record<string, unknown> | null;
  /** Child workflows the handler wants started (agentSession for create_task with an assignee, trainingRun...). */
  spawn: { workflow: "agentSession" | "trainingRun" | "channelEngine"; workflowId: string; args: Record<string, unknown> }[];
}

export interface ApprovalDecision {
  approvalId?: string;
  planActionId?: string;
  outcome: "approved" | "rejected";
  by?: string | null;
  byKind?: "user" | "chief_of_staff" | "system";
  note?: string | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------------------------------------------------

export interface TrainingRunInput {
  businessId: string;
  trainingRunId: string;
}

export interface LoadedTrainingRun {
  trainingRunId: string;
  agentId: string;
  agentType: string;
  draftVersionId: string;
  liveVersionId: string | null;
  skillKeys: string[];
  modelKey: ModelKey;
  /** The draft tried to contradict a club rule; the rule still applies (AC-11.10.4). */
  clubRuleFlags: { ruleId: string; line: string; reason: string }[];
}

export interface SkillTestsOutcome {
  skillKey: string;
  group: "craft" | "judgement" | "execution";
  testsRun: number;
  meanScore: number;
  tested: number;
  previousTested: number | null;
  costMinor: number;
  checksFailed: number;
}

export interface TrainingRunResult {
  status: "awaiting_decision" | "failed" | "cancelled";
  skillDeltas: { skillKey: string; before: number; after: number }[];
  eventId: string | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Holiday
// ---------------------------------------------------------------------------------------------------------------------

export interface HolidayInput {
  businessId: string;
  holidayId: string;
  /** Override the cadence between auto-Continues (agent-hours). */
  cadenceAgentHours?: number;
}

export interface LoadedHoliday {
  holidayId: string;
  untilAt: string | null;
  untilCondition: string | null;
  authority: string[];
  budgetCeilingMinor: number | null;
  currency: string;
  wakeEvents: string[];
  startedAt: string;
  cadenceAgentHours: number;
  chiefOfStaffId: string | null;
}

export interface HolidayCheck {
  shouldEnd: boolean;
  reason: "until_reached" | "condition_met" | "founder_returned" | "wake_event" | "budget_exhausted" | "kill_switch" | null;
  wakeEventType: string | null;
  wakeEventId: string | null;
  spentMinor: number;
  now: string;
}

export interface HolidayDecisions {
  decided: number;
  queuedGated: number;
  inboxItemIds: string[];
}

export interface HolidayEnd {
  reportInboxItemId: string | null;
  eventId: string;
  cyclesRun: number;
  decisionsMade: number;
  customersWon: number;
  spentMinor: number;
  gatedItemsQueued: number;
}

export interface WakePayload {
  eventType: string;
  eventId?: string | null;
  reason?: string | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Channel engine
// ---------------------------------------------------------------------------------------------------------------------

export const CHANNEL_STEPS = ["plan", "create", "approve", "launch", "measure", "learn", "report"] as const;
export type ChannelStep = (typeof CHANNEL_STEPS)[number];

export interface ChannelEngineInput {
  businessId: string;
  channelId: string;
  channelKey: string;
  weekIndex?: number;
  state?: ChannelEngineState;
}

export interface ChannelEngineState {
  campaignId: string | null;
  approvalId: string | null;
  lastStep: ChannelStep | null;
  weeksRun: number;
  learnings: string[];
}

export interface ChannelStepResult {
  step: ChannelStep;
  state: ChannelEngineState;
  /** The step needs a founder decision before the next one (approve in augmented/kit mode). */
  awaitingApprovalId: string | null;
  /** The channel was disabled or archived; stop the engine. */
  stop: boolean;
  note: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// Playbooks, incorporation, journeys, import
// ---------------------------------------------------------------------------------------------------------------------

export interface PlaybookInput {
  businessId: string;
  playbookId: string;
  event: { type: string; id?: string | null; payload?: Record<string, unknown> } | null;
}

export interface LoadedPlaybook {
  playbookId: string;
  enabled: boolean;
  steps: Record<string, unknown>[];
  stop: Record<string, unknown>;
  departmentId: string | null;
}

export interface IncorporationInput {
  businessId: string;
  incorporationId: string;
}

export interface JourneyBuildInput {
  businessId: string;
  conversionId: string;
}

export interface JourneyBuildResult {
  journeyId: string;
  matchdayLevel: "friendly" | "league" | "cup";
  fullMatchDay: boolean;
  eventId: string | null;
}

export interface ImportBusinessInput {
  businessId: string;
  sourceIds: string[];
}

export interface ImportSourceResult {
  sourceId: string;
  ok: boolean;
  summary: string;
}

export interface ScheduleInput {
  businessIds: string[];
  /** ISO "now" for deterministic runs; defaults to the clock. */
  at?: string;
}

export interface ScheduleResult {
  businesses: number;
  touched: number;
  eventIds: string[];
  notes: string[];
}

export interface HealthRefreshResult {
  changed: { agentId: string; from: AgentStatus; to: AgentStatus; reason: string }[];
  eventIds: string[];
}
