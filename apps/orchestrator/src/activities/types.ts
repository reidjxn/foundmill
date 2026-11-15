/**
 * Shapes shared between workflows and activities. Workflow code imports this file with `import type` only, so it
 * never enters the workflow bundle; everything here must be JSON-serialisable (Temporal payloads).
 */
import type { SessionCommand } from "../control-bus";
import type { ProgressState } from "../progress";
import type { FoundationsDraft } from "@foundmill/agents";
import type { AgentStatus, BusinessMode, ModelKey, PlanActionType, PolicyOutcome, TaskKind, TaskStatus, ProductStage } from "@foundmill/shared";

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
  /** What is left of the wage cap this period (null: uncapped). At or below zero the agent takes no work (BUILD §10.4). */
  wageRemainingMinor?: number | null;
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
  /** A session of this task holds a gated call nobody has decided yet: starting it again would only wait on it again. */
  awaitingApproval?: boolean;
  /** A failed or blocked task's next automatic retry (`retry.ts`); absent for every other status. */
  retry?: { failures: number; due: boolean; exhausted: boolean; nextAttemptAt: string | null } | null;
  /**
   * The founder's answer the task waits for (0030): its approval is still open, or was rejected since its last session.
   * Such a task is not dispatched; approving makes it dispatchable again. Absent in briefs built before it existed.
   */
  approvalHold?: { approvalId: string; outcome: null | "rejected" } | null;
}

/** A roadmap item no task links to yet: the cycle plans it into tasks (`planRoadmap`, Now items first) before anyone starts it. */
export interface BriefRoadmapItem {
  id: string;
  title: string;
  horizon: string;
}

/** What a cycle planned from the roadmap before the Chief of Staff's plan (`planRoadmap`; lead, 2026-10-24). */
export interface RoadmapPlanResult {
  planned: { roadmapItemId: string; title: string; taskIds: string[]; costMinor: number }[];
  /** Items whose Planner call failed: named in the summary, tried again next cycle. */
  failed: { roadmapItemId: string; title: string; reason: string }[];
  /** Why nothing was tried (the stage, a closed gate, no Now item without tasks); null when items were tried. */
  skipped: string | null;
  /** The Planner calls' cost, US cents (an Estimate); added to the cycle's cost. */
  costMinor: number;
}

/** What `followUpStarts` is asked for: tasks that became dispatchable while the cycle ran (lead, 2026-10-24, decision 8). */
export interface FollowUpStartsInput {
  businessId: string;
  cycleId: string;
  /** Every task already started, pending, skipped or finished in this cycle: never offered again. */
  exclude: string[];
  /** Agents with a session open in this cycle: avoided when another usable agent fits. */
  busyAgentIds?: string[];
  /** Most starts to hand back (the cycle's concurrency); every dispatchable task when absent. */
  limit?: number;
  /**
   * What started the cycle. A founder's Continue retries every failed or blocked task whatever its wait or count
   * (`retryDeferral`), in the follow-ups as in the first plan: the Foundmill business's five retried code tasks were
   * left out of the plan by four coordination tasks and then skipped by the follow-ups, which read the retry limit
   * again (Oct 30, 2026). Absent: the limit and the doubling waits apply.
   */
  trigger?: CycleTrigger;
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
  /** How many tasks a cycle could plan in all (`openTasks` lists the most important and oldest of them). */
  openTaskTotal?: number;
  /** Roadmap items without tasks, Now first. */
  untaskedRoadmap?: BriefRoadmapItem[];
  pendingApprovals: number;
  blockingInboxItems: number;
  /**
   * The team is stopped (Stop all agents, a revoked key, used-up credits; 0023): nothing is planned or dispatched until
   * an owner or admin resumes it. Absent in briefs built before the flag existed.
   */
  agentsStopped?: boolean;
  /** Credits remaining for the period in `creditsCurrency` (label "Estimate"); null for a business on its own key. */
  budgetRemainingMinor: number | null;
  /**
   * What is left of the business's monthly model budget (0059), US cents, an Estimate; null when none is set. It applies
   * whoever pays the model. Absent in briefs built before the budget existed.
   */
  modelBudgetRemainingMinor?: number | null;
  /** The currency of credits and of every model cost (USD, `CREDITS_CURRENCY`), never the business's `currency`. */
  creditsCurrency: string;
  /** Agents this cycle may run at once: the plan tier's limit less the sessions already open (0: none may start). */
  maxAgents: number;
  /** Rate-limit capacity summary for the planner prompt. */
  capacity: string;
  /**
   * Where the business stands in its first days (founder, 2026-10-18; `productStageOf`): before `selling` no channel
   * task is planned; before the sign-offs only groundwork. Absent in briefs built before the stage existed (read as selling).
   */
  productStage?: ProductStage;
  /** `businesses.distribution_started_at` is set: the channel engines may run. */
  distributionStarted?: boolean;
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
  /** Nothing could start, so no model was called: the cycle posts one plain note instead of a narration. */
  idle?: boolean;
}

export type CycleTrigger = "continue" | "holiday" | "schedule" | "wake" | "autopilot";

export interface BusinessCycleInput {
  businessId: string;
  cycleNumber: number;
  trigger: CycleTrigger;
  /** Override the time box (agent-hours). */
  timeBoxAgentHours?: number;
  /** Max concurrent sessions for this cycle (defaults from the brief). */
  maxConcurrent?: number;
  /**
   * What this cycle may spend, USD cents (an Estimate): the rest of Autopilot's own spend ceiling for the day (0084), for
   * a cycle Autopilot starts on its own. Starts stop once it is reserved, and each session is capped at its reserve.
   * Absent: the credits left, as for any cycle.
   */
  budgetCapMinor?: number | null;
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
  /** The most the session may spend, USD cents: its share of a capped cycle's budget (`budgetCapMinor`). Absent: no such cap. */
  spendCapMinor?: number | null;
}

export interface SessionLaunch {
  sandboxMode: "mock" | "docker" | "e2b";
  fellBackFrom: string | null;
  modelKey: ModelKey;
  modelId: string;
  /**
   * The credit saver moved this launch to its route's lower-cost model (`prepareSession`). Only such a launch is moved
   * back up by a later run (`keptModelForRun`); a launch prepared before the field existed has none.
   */
  lowCredits?: boolean;
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
  blockedReason: "awaiting_approval" | "approval_rejected" | "dependency" | "credential" | "budget" | "rate_limit" | "loop_detected" | "error" | "shout" | "stopped" | "needs_update" | null;
  approvalId: string | null;
  progress: ProgressState;
  eventsEmitted: number;
  toolCalls: number;
  toolFailures: number;
  tokensIn: number;
  tokensOut: number;
  costMinor: number;
  /** The exact model cost in millionths of a US cent (`costMinor` is its rounding); absent on results from before 0039. */
  costMicroMinor?: number;
  durationMs: number;
  /** Milliseconds a sandbox was running for this session (a live code task's acceptance run); 0 when none was used. */
  sandboxMs?: number;
  prNumber: number | null;
  summary: string;
  /** Last SDK/replay session id for resume. */
  providerSessionId: string | null;
  /** The model the session was moved to by a nudge ("Upgrade to Opus"); absent when it ran on its launch model throughout. */
  modelKey?: ModelKey | null;
  /**
   * Set when the run handed its slot back because the session stayed paused past SESSION_PAUSE_HOLD_MINUTES (the
   * workflow waits for Resume without holding a slot, then starts another run) or because its worker shut down
   * (`handoff`: the workflow starts the next run at once). Never set on a finished session.
   */
  parked?: SessionParked | null;
  /**
   * Set on a `done` session whose task must wait for the founder instead (`review`): it changed how the tests run
   * (package.json scripts, a test runner config, a deleted test) compared with its checkout. Says why.
   */
  review?: string | null;
}

export interface SessionParked {
  /** Where a mock replay picks up (`<recording>@<next event index>`); null for live sessions (the work is saved). */
  cursor: string | null;
  /** Nudges and decisions the run read but did not act on (they came while it parked); the next run gets them. */
  carry: SessionCommand[];
  /**
   * The number (`seq`) of the last control command the run read (its `fromSeq` − 1 when none). The workflow hands the
   * next run every nudge and decision it numbered after this one too: they reached the list after the run's last poll.
   */
  lastSeq: number;
  /**
   * The worker is shutting down (a deploy, ../drain.ts): the run saved its work and returned, and the workflow starts
   * the next run at once, on the next worker, instead of waiting for Resume. Absent on a park.
   */
  handoff?: boolean;
}

/** How one run of a session starts (agentSession may run several when a paused session parks and resumes). */
export interface SessionRunOptions {
  /** Control commands numbered below this were meant for an earlier run and are ignored. */
  fromSeq: number;
  /**
   * Set when this run continues an earlier one: after a park (Resume), a hand-off from a worker that shut down, or a
   * retry after a worker that died (absent reason = a park, as in histories from before hand-offs).
   */
  resume: { cursor: string | null; progress: ProgressState; reason?: "park" | "handoff" | "retry" } | null;
}

export interface SessionFinish {
  taskStatus: TaskStatus;
  eventIds: string[];
  healthChanged: boolean;
  /**
   * Set when the task is a code task that passed its acceptance tests and now waits in `review`: the session workflow
   * starts the `mergeReview` workflow with it, which opens the pull request, starts CI and asks for (or makes) the merge.
   */
  merge?: MergeInput | null;
}

/** What `mergeReview` needs: the task, the branch that carries its work, and what the session reported. */
export interface MergeInput {
  businessId: string;
  taskId: string;
  /** The agent whose work it is: the merge is asked for in its name (the Inbox decision names it). */
  agentId: string;
  /** The session that finished the work; its id scopes the gateway token. */
  sessionId: string;
  branch: string;
  /** Acceptance tests the platform ran on the branch (null when nothing was there to test, such as documentation). */
  acceptance: { passing: number; total: number } | null;
  summary: string;
}

/** One pull request of a merge review, as the workflow carries it between activities. */
export interface MergePullRequest {
  prNumber: number;
  prUrl: string | null;
}

export type MergePrepared =
  /** The pull request exists and the repository's tests were asked for; the review goes on to GitHub's merge state. */
  | ({ status: "ready"; checksStarted: boolean; checksNote: string | null } & MergePullRequest)
  /** Nothing to merge: not a code task, not in review, no repository, pushing off, already merged, nothing new. */
  | { status: "skipped"; reason: string }
  /** The pull request could not be opened; the task stays in review. */
  | { status: "held"; reason: string; prNumber: number | null; prUrl: string | null };

/** GitHub's view of the pull request before anyone is asked. */
export interface MergeAssessment {
  /** `ready` (clean, or only waiting on checks), `conflicts` (dirty), `behind` (the base moved and must be brought in), `unknown` (GitHub still computing). */
  mergeable: "ready" | "conflicts" | "behind" | "unknown";
  /** The repository's own checks on the branch head. */
  checks: "pending" | "success" | "failure" | "unknown";
  detail: string | null;
  /**
   * Commits the default branch has that the branch lacks (GitHub's compare); null when the compare did not answer. GitHub
   * says `behind` only under a strict ruleset, so this is how the review knows a branch's tests ran against yesterday's
   * default branch (Nov 2, 2026: two approved branches failed CI for fixes they lacked, not for their own work).
   */
  behindBy?: number | null;
}

/** The branch brought up to date with the default branch (GitHub's update-branch), before the founder is asked. */
export interface MergeBranchUpdated {
  /** True when GitHub merged the default branch in (the head moved); false when it could not (conflicts) or had nothing to do. */
  updated: boolean;
  /** Why not, when `updated` is false and it was not already up to date. */
  reason: string | null;
  /** The repository's tests were started on the new head. */
  checksStarted: boolean;
}

export type MergeAsked =
  /** The founder decides (every mode, decision 2026-11-01): the approval and its pull request. */
  | ({ status: "awaiting_approval"; approvalId: string } & MergePullRequest)
  /** The gateway ran the merge (a decision Team › Responsibilities delegated): the task is done. */
  | ({ status: "merged"; mergeCommitSha: string } & MergePullRequest)
  | ({ status: "held"; reason: string } & MergePullRequest);

/**
 * Why a merge was not made after the pull request existed. `founder`: the founder said no with words, and the change
 * goes back to its agent with them (the api hands it back at the answer, WP-05 T16; the wording is shared here).
 * `review`: the second read asked for changes, and the change goes back to its author once before the founder is asked
 * (WP-05 T17).
 */
export type MergeHoldReason = "conflicts" | "behind" | "checks_failed" | "checks_timeout" | "refused" | "founder" | "review";

export type MergeOutcome =
  | ({ status: "merged"; mergeCommitSha: string } & MergePullRequest)
  /** The founder decided against it (or the approval expired or was withdrawn); the task stays in review. */
  | ({ status: "not_merged"; reason: string } & MergePullRequest)
  | { status: "skipped"; reason: string }
  /** The merge could not be made; the task stays in review and the next cycle tries again. */
  | { status: "held"; reason: string; prNumber: number | null; prUrl: string | null }
  /** The branch went back to its agent (conflicts, behind, or the checks failed): the task is blocked with the instruction. */
  | ({ status: "handed_back"; why: MergeHoldReason; reason: string } & MergePullRequest);

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
  /** Workflows the handler wants stopped (a model change's superseded retests). Absent for every other action. */
  stop?: string[];
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
  /** A model change's retest (AC-11.10.5): the live version copied onto another model. Absent on runs loaded before it existed. */
  retest?: { fromModelKey: ModelKey; toModelKey: ModelKey } | null;
}

export interface SkillTestsOutcome {
  skillKey: string;
  group: "craft" | "judgement" | "execution";
  testsRun: number;
  meanScore: number;
  tested: number;
  previousTested: number | null;
  costMinor: number;
  /** The exact cost in millionths of a US cent (`costMinor` is its rounding); absent on outcomes from before 0039. */
  costMicroMinor?: number;
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
  /** Cycles run by earlier runs of this vacation (a long vacation continues as new). */
  cyclesRun?: number;
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
  reason: "until_reached" | "condition_met" | "founder_returned" | "wake_event" | "budget_exhausted" | "kill_switch" | "cycle_cap" | null;
  wakeEventType: string | null;
  wakeEventId: string | null;
  spentMinor: number;
  now: string;
}

export interface AutomatedModeInput {
  businessId: string;
  /** Cycles run by earlier runs of this loop (it continues as new to keep its history short). */
  cyclesRun?: number;
  /** Override the cadence between cycles (agent-hours). */
  cadenceAgentHours?: number;
}

export interface LoadedAutomatedMode {
  chiefOfStaffId: string | null;
  authority: string[];
  cadenceAgentHours: number;
}

export interface AutomatedModeCheck {
  /** False once the business left Automated mode or was archived: the loop ends. */
  active: boolean;
  /** Why no cycle runs this tick although the loop continues. */
  hold: "vacation" | "stopped" | null;
  reason: string;
}

export interface HolidayDecisions {
  decided: number;
  queuedGated: number;
  /** The items the Chief of Staff decided in this pass. */
  inboxItemIds: string[];
  /**
   * Plans of this vacation's decisions still to run (origin `holiday`, executing): this pass's, and any an earlier pass
   * wrote but whose start a retry lost. The holiday workflow starts `planExecution` (`plan:<id>`) for each; one already
   * running is left alone.
   */
  planIds: string[];
  /** The items left to the founder in this pass, with the reason in words (the report lists them). */
  waiting: { inboxItemId: string; reason: string }[];
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
  /** Steps that wait for the founder: `step` is an index into `steps`; `first_run` only until the playbook has run once. */
  approvals: { step: number; scope: "first_run" | "every_run" }[];
  /** The playbook has not run before. */
  firstRun: boolean;
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
  /** The `customer.converted` ingest wrote for the conversion (absent when the workflow builds a journey from nothing). */
  convertedEventId?: string | null;
  /** Ingest could not narrate the win: narrate `convertedEventId` if it is still un-narrated. */
  narrate?: boolean;
}

export interface JourneyBuildResult {
  /** Null for a repeat payment, which has no Customer Update. */
  journeyId: string | null;
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

/** businessFoundations (BUILD §11.1 first open, §11.5): one claimed drafting attempt of a business's foundations. */
export interface BusinessFoundationsInput {
  businessId: string;
  attempt: number;
}

/** What a drafting step's model calls cost (summed by the workflow into the summary's model metadata; an Estimate). */
export interface FoundationsStepUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costMinor: number;
  model: string | null;
  mode: "mock" | "live" | null;
  repaired: boolean;
}

/** Step 1 (the plan) done: the section batches still to write. */
export interface FoundationsPlanned {
  /** False when the attempt is no longer the current drafting one (nothing was asked of the model). */
  current: boolean;
  door: "ideation" | "import";
  /** Outline sections still to write, in batches (one `draftFoundationsSections` activity each). */
  chunks: string[][];
  usage: FoundationsStepUsage;
}

/**
 * Step 0 (the project's public page, package 1.2) done. `written` is false when nothing was needed (a page row exists,
 * a sample business) or the attempt is no longer current; `source` says whether the Product lead's draft or the
 * deterministic starter was written.
 */
export interface ProjectPageStepDone {
  current: boolean;
  written: boolean;
  source: "model" | "starter" | null;
  inboxItemId: string | null;
  usage: FoundationsStepUsage;
}

/** Step 2 (a batch of sections) or step 3 (the roadmap) done. */
export interface FoundationsStepDone {
  current: boolean;
  usage: FoundationsStepUsage;
}

/**
 * The single-call `draftFoundations` result (23545f4), kept for one release so a businessFoundations workflow started
 * before the staged drafting finishes on its old path (review item 6; remove with `legacyBusinessFoundations`).
 */
export interface FoundationsDrafted {
  /** False when the attempt is no longer the current drafting one (nothing was asked of the model). */
  current: boolean;
  draft: FoundationsDraft | null;
  door: "ideation" | "import";
  /** Model metadata kept on the row's summary (cost in minor units, an Estimate). */
  model: Record<string, unknown>;
}

export interface BusinessFoundationsResult {
  status: "ready" | "failed" | "skipped";
  inboxItemId: string | null;
  error: string | null;
}

/**
 * What a schedule workflow is started with. The registered Temporal Schedules (src/schedules.ts) pass no business ids:
 * the workflow lists the businesses when it runs, so a business committed after the schedule was registered is included.
 * Tests and one-off runs may name them.
 */
export interface ScheduleInput {
  businessIds?: string[];
  /** ISO "now" for deterministic runs; defaults to the clock. */
  at?: string;
}

/** What the schedule activities process: the businesses the workflow resolved. */
export interface ScheduleBatch {
  businessIds: string[];
  at?: string;
}

export interface ScheduleResult {
  businesses: number;
  touched: number;
  eventIds: string[];
  notes: string[];
}

/** A channel whose engine the reconciler makes sure is running (`engine:<channelId>`). */
export interface EngineToEnsure {
  businessId: string;
  channelId: string;
  channelKey: string;
  engineWorkflowId: string | null;
}

/** A business whose scheduled deletion came due, with the workflows to stop before it is purged. */
export interface DueBusinessDeletion {
  businessId: string;
  scheduledFor: string;
  workflowIds: string[];
}


export interface HealthRefreshResult {
  changed: { agentId: string; from: AgentStatus; to: AgentStatus; reason: string }[];
  eventIds: string[];
}
