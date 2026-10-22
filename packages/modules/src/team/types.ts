/**
 * Structural types for the tRPC responses the team screens read through `useWidgetQuery` (apps/api `team.*`,
 * `agent.model.*`, `department.list`, `founder.profile.get`; BUILD §8.3, §11.9). Declared here, not imported from
 * apps/api, so the package depends only on wave-1 packages. Every field the API may omit is optional-tolerant; dates
 * arrive as ISO strings on the wire (a `Date` is tolerated).
 */
import type { AgentLayer, AgentStatus, DecisionType, DeptColourToken, MembershipRole, ModelKey, SkillGroup } from "@foundmill/shared";

export type Iso = string | Date;

/* team.agents.list */
export interface AgentDepartmentRef {
  id: string;
  name: string;
  colourToken: DeptColourToken;
}

export interface AgentSkillRow {
  skillKey: string;
  group: SkillGroup;
  /** numeric(6,3) arrives as a string from Drizzle; a number is tolerated. */
  tested?: string | number | null;
  proven?: string | number | null;
  nLive?: number;
  /** 1–20 */
  displayed: number;
  potential?: number;
}

export interface AgentWage {
  costMinor: number;
  /** The currency of `costMinor`: platform costs are metered in US dollars (the cap is in the agent's currency). */
  currency?: string;
  capMinor?: number | null;
  period?: string;
  label?: "Estimate";
}

/** The health signals the API may attach (BUILD §9.10); also carried on `agent.health_changed` events. */
export interface AgentHealthRow {
  lastHeartbeatAt?: Iso | null;
  errorRate?: number | null;
  loopDetected?: boolean;
  credentialExpired?: boolean;
  rateLimited?: boolean;
  expectedReturnAt?: Iso | null;
  reason?: string | null;
}

export interface AgentRow {
  id: string;
  name: string;
  role?: string;
  agentType?: string;
  layer?: AgentLayer;
  descriptionMd?: string;
  status: AgentStatus;
  modelKey: ModelKey;
  avatarSeed?: string;
  departmentIds?: string[];
  departments?: AgentDepartmentRef[];
  lineManagerId?: string | null;
  currentTask?: { id: string; title: string; status?: string } | null;
  skills?: AgentSkillRow[];
  /** The 1–20 mean of the displayed skills to one decimal, the one scale the product shows (null until the first training run). */
  rating20?: number | null;
  /**
   * @deprecated The same mean on a 1–10 scale, kept for one release so older callers keep working; read `rating20`.
   * Null until the first training run.
   */
  rating?: number | null;
  wage?: AgentWage;
  currency?: string;
  wageCapMinor?: number | null;
  /** Tool grants of the live version when the API includes them: connector keys or `{ connectorKey, tools }`. */
  tools?: (string | { connectorKey: string; tools?: string[] })[];
  /** Last five session outcomes, oldest first, when the API includes them. */
  form?: ("success" | "partial" | "failure")[];
  latestUpdate?: { at: Iso; text: string } | null;
  health?: AgentHealthRow | null;
  expectedReturnAt?: Iso | null;
  /** The business's Chief of Staff (one per business): never released or cloned. Absent on older payloads. */
  chiefOfStaff?: boolean;
  archivedAt?: Iso | null;
  createdAt?: Iso;
  updatedAt?: Iso;
}

export interface AgentsListResponse {
  agents: AgentRow[];
  templates?: string[];
}

/* team.agents.catalogue */
export type TemplateFamily = "assistant" | "lead" | "worker" | "channel" | "specialist" | "utility";

export interface TemplateRow {
  key: string;
  name: string;
  role: string;
  family: TemplateFamily;
  layer?: AgentLayer;
  module: string | null;
  channelKey?: string | null;
  modelKey: ModelKey;
  description: string;
  skills: string[];
  wageCapMinor: number;
  wageLabel?: "Estimate";
  traits?: string[];
  neverDoes?: string[];
}

/* team.humans.list */
export type SectionPermission = "read" | "write" | "none";

export interface MembershipRow {
  id: string;
  userId: string;
  role: MembershipRole;
  sectionPermissions: Record<string, SectionPermission>;
  /** Not returned by memberships today; honoured when the API or the CRM join adds them. */
  displayName?: string | null;
  email?: string | null;
  entityId?: string | null;
  createdAt?: Iso;
  updatedAt?: Iso;
}

/* founder.profile.get (the signed-in user) */
export interface FounderProfileResponse {
  profile: { userId?: string; displayName?: string } | null;
  complete?: boolean;
  email?: string | null;
  memberships?: { businessId: string; userId: string; role: MembershipRole }[];
}

/* team.responsibilities.get / set */
export type HandlerKind = "founder" | "user" | "agent";

export interface ResponsibilityHandler {
  kind: HandlerKind;
  id: string | null;
}

export interface ResponsibilityRow {
  decisionType: DecisionType;
  handler: ResponsibilityHandler;
  /** Every department agrees; when false the business-wide value shows the founder and the departments differ. */
  uniform?: boolean;
}

export interface ResponsibilitiesResponse {
  matrix: ResponsibilityRow[];
  perDepartment?: { departmentId: string; rows: { decisionType: DecisionType; handler: ResponsibilityHandler }[] }[];
  decisionTypes?: readonly DecisionType[];
}

/* agent.model.compare */
export interface ModelCompareOption {
  modelKey: ModelKey;
  modelId?: string;
  allowed: boolean;
  warning?: string | null;
  /** Predicted monthly wage at this model (Estimate). */
  predictedWageMinor: number;
  predictedSkillDelta?: number | null;
  label?: "Estimate";
}

export interface ModelCompareResponse {
  current: ModelKey;
  locked?: boolean;
  /** What the predictions scale: this month's spend, the last 30 days, or a typical month for an agent with none. */
  basis?: "this_month" | "last_30_days" | "typical_month";
  /** Currency of `predictedWageMinor`: metered model cost, so US dollars (absent from older answers). */
  currency?: string;
  options: ModelCompareOption[];
}

/* agent.model.set */
export interface ModelSetResponse {
  updated: string[];
  skipped: { agentId: string; reason: string }[];
  warnings: string[];
  retests?: { runId: string }[];
  /** Earlier retests the change canceled: they scored a model the agents no longer run. */
  superseded?: string[];
}

/* `agent.health_changed` payload (packages/events) */
export interface AgentHealthChangedPayload {
  agentId: string;
  from: AgentStatus;
  to: AgentStatus;
  reason?: string;
  signals?: {
    heartbeatAgeMs?: number | null;
    errorRate?: number | null;
    loopDetected?: boolean;
    credentialExpired?: boolean;
    rateLimited?: boolean;
  };
  expectedReturnAt?: string | null;
}
