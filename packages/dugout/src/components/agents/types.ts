/**
 * Agents group types (BUILD §11.6 Training Ground, §11.7 Formation Board, §11.9 squad table, §11.10 profiles and
 * training, DESIGN §8 AgentTile/FormationBoard/Avatar, §9 Team/Agent profile).
 *
 * Session events are a structural mirror of `@foundmill/events` `SessionEvent` (dugout has no dependency on the
 * events package, see docs/NEEDED_DEPS.md): the orchestrator's events are assignable to `AgentSessionEvent` unchanged.
 */
import type { Money, AgentStatus, ChannelKey, ChannelLine, DeptColourToken, ModelKey, SkillGroup, TaskKind, TaskPhase, TaskStatus } from "@foundmill/shared";

// ---------------------------------------------------------------------------------------------------------------------
// Session events (as:{sessionId} stream)
// ---------------------------------------------------------------------------------------------------------------------

export const AGENT_SESSION_EVENT_KINDS = ["tool_call", "stdout", "file_changed", "test_result", "phase_changed", "progress", "note"] as const;
export type AgentSessionEventKind = (typeof AGENT_SESSION_EVENT_KINDS)[number];

export interface ToolCallSessionEvent {
  kind: "tool_call";
  at: string;
  callId: string;
  connectorKey?: string | null;
  tool: string;
  status: "started" | "succeeded" | "failed" | "denied" | "awaiting_approval";
  argsSummary?: string;
  resultSummary?: string | null;
  durationMs?: number | null;
  costMinor?: number | null;
  policyOutcome?: "allow" | "ask" | "deny" | null;
  approvalId?: string | null;
  error?: string | null;
}

export interface StdoutSessionEvent {
  kind: "stdout";
  at: string;
  channel?: "stdout" | "stderr";
  text: string;
  command?: string | null;
}

export interface FileChangedSessionEvent {
  kind: "file_changed";
  at: string;
  path: string;
  change: "created" | "modified" | "deleted" | "renamed";
  fromPath?: string | null;
  additions?: number;
  deletions?: number;
  /** Unified diff; null for large or binary files. */
  diff?: string | null;
}

export interface TestResultSessionEvent {
  kind: "test_result";
  at: string;
  suite?: string;
  command?: string | null;
  passed: number;
  failed: number;
  skipped?: number;
  durationMs?: number | null;
  /** Acceptance tests count towards progress; the agent's own checks do not. */
  acceptance?: boolean;
  failures?: string[];
}

export interface PhaseChangedSessionEvent {
  kind: "phase_changed";
  at: string;
  from: TaskPhase | null;
  to: TaskPhase;
  reason?: string | null;
}

export interface ProgressSessionEvent {
  kind: "progress";
  at: string;
  progress: number;
  planStepsDone: number;
  planSteps: number;
  acceptanceTestsPassing: number;
  acceptanceTests: number;
  reviewPassed: boolean;
  merged: boolean;
  /** Estimate; the footer labels it. */
  etaAt?: string | null;
}

export interface NoteSessionEvent {
  kind: "note";
  at: string;
  level?: "info" | "warn" | "error";
  source?: "agent" | "system" | "shout" | "reviewer";
  text: string;
}

export type AgentSessionEvent =
  | ToolCallSessionEvent
  | StdoutSessionEvent
  | FileChangedSessionEvent
  | TestResultSessionEvent
  | PhaseChangedSessionEvent
  | ProgressSessionEvent
  | NoteSessionEvent;

export type AgentSessionEventOf<K extends AgentSessionEventKind> = Extract<AgentSessionEvent, { kind: K }>;

// ---------------------------------------------------------------------------------------------------------------------
// Tile state (derived from events by `reduceSessionEvents`, or supplied by the app's store)
// ---------------------------------------------------------------------------------------------------------------------

export const TILE_VIEWS = ["terminal", "diff", "preview", "plan"] as const;
export type TileView = (typeof TILE_VIEWS)[number];

export type PlanStepState = "todo" | "active" | "done" | "skipped";

export interface PlanStep {
  id: string;
  text: string;
  state: PlanStepState;
}

export interface TileAgent {
  id: string;
  name: string;
  /** `avatar_seed` from the agent row. */
  seed: string | number;
  dept: DeptColourToken;
  status: AgentStatus;
  model: ModelKey;
  /** Template or role label ("Frontend engineer"). */
  role?: string;
}

export interface TileTask {
  id: string;
  title: string;
  href?: string;
  kind?: TaskKind;
  /** `agent/<taskId>` worktree branch. */
  branch?: string;
  /** The task's goal in one plain sentence (the brief): what a tile with nothing to show yet says it is working on. */
  goal?: string;
}

export interface StdoutChunk {
  at: string;
  channel: "stdout" | "stderr";
  text: string;
  command?: string | null;
}

export interface FileChange {
  path: string;
  change: FileChangedSessionEvent["change"];
  fromPath?: string | null;
  additions: number;
  deletions: number;
  diff: string | null;
  at: string;
}

export interface TestSummary {
  passed: number;
  failed: number;
  skipped: number;
  /** Last acceptance run, if any. */
  acceptance: { passed: number; failed: number; failures: string[] } | null;
  lastAt: string | null;
}

export interface ToolCallSummary {
  callId: string;
  tool: string;
  connectorKey: string | null;
  status: ToolCallSessionEvent["status"];
  argsSummary: string;
  at: string;
  approvalId: string | null;
}

export interface SessionNote {
  at: string;
  level: "info" | "warn" | "error";
  source: "agent" | "system" | "shout" | "reviewer";
  text: string;
}

export interface PreviewState {
  /** Preview deployment URL (iframe). */
  url?: string | null;
  /** Latest Playwright screenshot. */
  screenshotUrl?: string | null;
  capturedAt?: string | null;
  /** What the view says before there is anything to show. Default: the first build's preview and its Playwright screenshots. */
  emptyNote?: string | null;
}

export interface ProgressCounts {
  planStepsDone: number;
  planSteps: number;
  acceptanceTestsPassing: number;
  acceptanceTests: number;
  reviewPassed: boolean;
  merged: boolean;
}

/** Everything an AgentTile renders. */
export interface AgentTileSession {
  id: string;
  agent: TileAgent;
  task: TileTask;
  status: TaskStatus;
  phase: TaskPhase;
  /** 0–1, BUILD §11.6 formula (never token-based). */
  progress: number;
  counts: ProgressCounts;
  startedAt: string;
  endedAt: string | null;
  tokens: number;
  cost: Money;
  /** Estimate: median duration of similar tasks (BUILD §11.6). */
  etaAt: string | null;
  lastNote: SessionNote | null;
  plan: PlanStep[];
  stdout: StdoutChunk[];
  files: FileChange[];
  tests: TestSummary;
  toolCalls: ToolCallSummary[];
  notes: SessionNote[];
  preview: PreviewState;
  /** Awaiting a founder decision (approval hold). */
  awaitingApprovalId: string | null;
  /**
   * Started but not yet picked up by a worker: the session's stream holds no event yet. The tile says "Queued" and shows
   * no elapsed clock or streaming prompt until the first event arrives.
   */
  queued?: boolean;
}

export type ShoutPreset = "focus_on_tests" | "simplify" | "ask_before_schema_changes" | "match_design_system" | "hurry_up";

export interface Shout {
  preset: ShoutPreset | null;
  text: string;
}

export interface TileControls {
  onPause?: (sessionId: string) => void;
  onResume?: (sessionId: string) => void;
  onShout?: (sessionId: string, shout: Shout) => void;
  onReassign?: (sessionId: string) => void;
  onUpgradeModel?: (sessionId: string) => void;
  onStop?: (sessionId: string) => void;
  onOpenInClaudeCode?: (sessionId: string) => void;
}

// ---------------------------------------------------------------------------------------------------------------------
// Task graph (Formation view)
// ---------------------------------------------------------------------------------------------------------------------

export interface TaskGraphNode {
  id: string;
  title: string;
  status: TaskStatus;
  /** Ids this task depends on. */
  deps: string[];
  agent?: Pick<TileAgent, "id" | "name" | "seed" | "dept"> | null;
  progress?: number;
  /** File-scope hints; overlapping scopes are never scheduled together (AC-11.6.2). */
  fileScope?: string[];
  kind?: TaskKind;
}

// ---------------------------------------------------------------------------------------------------------------------
// Specialists (BUILD §11.6)
// ---------------------------------------------------------------------------------------------------------------------

export interface RfqStage {
  id: string;
  label: string;
  count: number;
}

export type QuoteStatus = "received" | "shortlisted" | "negotiating" | "rejected" | "accepted";

export interface SupplierQuote {
  id: string;
  supplier: string;
  country?: string;
  unitPrice: Money;
  moq: number;
  leadTimeDays: number;
  /** 1–20 score from the specialist. */
  score: number;
  status: QuoteStatus;
}

export type SampleStage = "requested" | "shipped" | "received" | "testing" | "approved" | "rejected";

export interface SampleItem {
  id: string;
  supplier: string;
  stage: SampleStage;
  etaAt?: string | null;
  note?: string;
}

export type ShipmentStatus = "quoted" | "booked" | "in_transit" | "customs" | "delivered" | "delayed";

export interface Shipment {
  id: string;
  ref: string;
  carrier: string;
  from: string;
  to: string;
  status: ShipmentStatus;
  etaAt?: string | null;
  /** Landed-cost estimate. */
  cost?: Money;
}

export interface SpecialistData {
  rfq: RfqStage[];
  quotes: SupplierQuote[];
  samples: SampleItem[];
  shipments: Shipment[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Formation Board (BUILD §11.7)
// ---------------------------------------------------------------------------------------------------------------------

export type FormCell = "good" | "warn" | "bad" | "none";

export interface ChannelTokenData {
  key: ChannelKey;
  /** 1–20 fit from the Distribution Strategist. */
  fit: number;
  /** False until the Distribution Strategist has scored the channel: the fit badge and the card show no score. Default true. */
  scored?: boolean;
  recommended: boolean;
  /** On the board (engine enabled) or on the bench. */
  enabled: boolean;
  /** Last five weeks of CPA versus cap, newest last. */
  form: FormCell[];
  /** 0–5 stars. */
  potential?: number;
  cpaRange?: { low: Money; high: Money };
  why?: string;
  agents?: Array<Pick<TileAgent, "name" | "seed" | "dept" | "status">>;
  /** Share of the monthly distribution budget, 0–1. */
  budgetShare?: number;
  paused?: boolean;
  /**
   * Offline tracking (bookings go through a founder task, never an API) as this channel is set, which can differ from
   * the channel's default; absent means the default (`CHANNEL_META[key].kitModeByDefault`).
   */
  kitMode?: boolean;
  results?: Array<{ label: string; value: string }>;
}

export interface ChannelLineGroup {
  line: ChannelLine;
  label: string;
  channels: ChannelTokenData[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Squad table (BUILD §11.9)
// ---------------------------------------------------------------------------------------------------------------------

export type FormResult = "success" | "partial" | "failure";

export interface SquadRow {
  id: string;
  name: string;
  seed: string | number;
  dept: DeptColourToken;
  role: string;
  departments: string[];
  status: AgentStatus;
  currentTask: { id: string; title: string } | null;
  /** Last five outcomes, oldest first. */
  form: FormResult[];
  /** 1–10 average. */
  rating: number;
  tools: string[];
  model: ModelKey;
  /** Monthly cost estimate. */
  wage: Money;
  latestUpdate: { at: string; text: string } | null;
  /** Down: when it should be back. */
  expectedReturnAt?: string | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Training (BUILD §11.10)
// ---------------------------------------------------------------------------------------------------------------------

export interface InstructionExample {
  input: string;
  output: string;
}

/** BUILD §9.2 `AgentVersion.instructions`. */
export interface AgentInstructions {
  role: string;
  goals: string[];
  rules: string[];
  playbook: string[];
  tone: string;
  examples: InstructionExample[];
}

export interface InstructionVersion {
  version: number;
  createdAt: string;
  author: string;
  comment?: string;
  state: "draft" | "live" | "retired";
  instructions: AgentInstructions;
}

export interface TrainingSkillResult {
  id: string;
  name: string;
  group: SkillGroup;
  before: number;
  after: number;
  /** Tests run / passed for the hover. */
  tests?: { run: number; passed: number };
}

export interface ModelOption {
  key: ModelKey;
  label: string;
  description: string;
  /** Predicted change in the average skill rating (points, Estimate); null when no preview run has measured it. */
  skillDelta: number | null;
  /** Predicted monthly wage change (Estimate). */
  wageDelta: Money;
  /** Why this option is unavailable (e.g. "Inbox Composer is locked to Opus"). */
  lockedReason?: string;
  warning?: string;
}

export type PositionLevel = "natural" | "accomplished" | "competent" | "unconvincing";

export interface PositionRole {
  id: string;
  label: string;
  level: PositionLevel;
  /** Optional 1–20 rating behind the level. */
  rating?: number;
}

export interface Trait {
  id: string;
  label: string;
  /** The instruction line the trait was derived from. */
  derivedFrom?: string;
  tone?: "neutral" | "good" | "warn";
}

export interface SkillHistorySeries {
  skillId: string;
  name: string;
  points: Array<{ at: string; value: number }>;
}

export interface TrainingSessionMark {
  at: string;
  label: string;
  promoted: boolean;
}

export interface HealthDetails {
  lastHeartbeatAt?: string | null;
  /** 0–1 over the last 24 h. */
  errorRate?: number | null;
  loopDetected?: boolean;
  /** Down: expected return once reconnected (BUILD §11.9). */
  expectedReturnAt?: string | null;
  reason?: string | null;
}

export type HierarchyKind = "founder" | "assistant" | "lead" | "worker" | "utility" | "human";

export interface HierarchyNode {
  id: string;
  name: string;
  role: string;
  kind: HierarchyKind;
  parentId: string | null;
  avatar?: { seed: string | number; dept: DeptColourToken } | null;
  status?: AgentStatus;
  model?: ModelKey;
  department?: string;
}
