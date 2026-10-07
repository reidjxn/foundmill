/** Deterministic rows for the team screen tests, shaped like the apps/api responses (team.*, agent.model.*, department.list, founder.profile.get). */
import type { DepartmentRow } from "@foundmill/widgets";
import type { AgentRow, AgentsListResponse, FounderProfileResponse, MembershipRow, ModelCompareResponse, ResponsibilitiesResponse, TemplateRow } from "../types";

export const BID = "00000000-0000-4000-8000-000000000001";
export const ME = "90000000-0000-4000-8000-000000000001";
export const USER_ADA = "90000000-0000-4000-8000-000000000002";
export const USER_BEN = "90000000-0000-4000-8000-000000000003";
export const AGENT_COS = "10000000-0000-4000-8000-000000000001";
export const AGENT_JUNO = "10000000-0000-4000-8000-000000000002";
export const AGENT_PIKE = "10000000-0000-4000-8000-000000000003";
export const AGENT_MARA = "10000000-0000-4000-8000-000000000004";
export const AGENT_LINK = "10000000-0000-4000-8000-000000000005";
export const DEPT_TEAM = "d0000000-0000-4000-8000-000000000001";
export const DEPT_DEV = "d0000000-0000-4000-8000-000000000002";
export const DEPT_DIST = "d0000000-0000-4000-8000-000000000003";
export const TASK_BUNDLE = "20000000-0000-4000-8000-000000000001";

const dev = { id: DEPT_DEV, name: "Development", colourToken: "dept-2" as const };
const dist = { id: DEPT_DIST, name: "Distribution", colourToken: "dept-3" as const };
const team = { id: DEPT_TEAM, name: "Team", colourToken: "dept-5" as const };

export const agents: AgentRow[] = [
  { id: AGENT_COS, name: "Orla", role: "Chief of Staff", agentType: "chief_of_staff", layer: "assistant", status: "healthy", modelKey: "opus", avatarSeed: "orla", departmentIds: [DEPT_TEAM], departments: [team], lineManagerId: null, currentTask: null, skills: [{ skillKey: "planning", group: "judgement", displayed: 16 }, { skillKey: "prioritisation", group: "judgement", displayed: 18 }], rating: 8.5, wage: { costMinor: 42_000, capMinor: 60_000, period: "2026-10", label: "Estimate" }, currency: "EUR", tools: ["github", "notion"], form: ["success", "success", "partial", "success", "success"], latestUpdate: { at: "2026-10-07T11:30:00Z", text: "Planned the Thursday cycle" }, health: { lastHeartbeatAt: "2026-10-07T11:59:00Z", errorRate: 0.01 } },
  { id: AGENT_JUNO, name: "Juno", role: "Frontend engineer", agentType: "frontend_engineer", layer: "worker", status: "healthy", modelKey: "sonnet", avatarSeed: "juno", departmentIds: [DEPT_DEV], departments: [dev], lineManagerId: AGENT_PIKE, currentTask: { id: TASK_BUNDLE, title: "Add a bundle picker to the product page", status: "running" }, skills: [{ skillKey: "react", group: "craft", displayed: 14 }, { skillKey: "testing", group: "execution", displayed: 12 }], rating: 6.5, wage: { costMinor: 18_000, capMinor: 30_000, period: "2026-10", label: "Estimate" }, currency: "EUR", tools: [{ connectorKey: "github", tools: ["pr.open"] }, { connectorKey: "e2b" }], form: ["success", "failure", "success", "success", "partial"], latestUpdate: { at: "2026-10-07T11:50:00Z", text: "Picker renders; writing the Playwright test" }, health: { lastHeartbeatAt: "2026-10-07T11:59:30Z", errorRate: 0.04 } },
  { id: AGENT_PIKE, name: "Pike", role: "Engineering lead", agentType: "engineering_lead", layer: "lead", status: "degraded", modelKey: "opus", avatarSeed: "pike", departmentIds: [DEPT_DEV], departments: [dev], lineManagerId: AGENT_COS, currentTask: null, skills: [{ skillKey: "architecture", group: "craft", displayed: 17 }], rating: 8.5, wage: { costMinor: 35_000, capMinor: 50_000, period: "2026-10", label: "Estimate" }, currency: "EUR", tools: ["github"], form: ["success", "partial", "partial", "success", "success"], latestUpdate: { at: "2026-10-07T10:10:00Z", text: "Reviewed the usage index PR" }, health: { lastHeartbeatAt: "2026-10-07T11:40:00Z", errorRate: 0.14, reason: "Error rate 14 % over the last day" } },
  { id: AGENT_MARA, name: "Mara", role: "Email engine", agentType: "channel_email", layer: "worker", status: "injured", modelKey: "sonnet", avatarSeed: "mara", departmentIds: [DEPT_DIST], departments: [dist], lineManagerId: null, currentTask: null, skills: [{ skillKey: "copywriting", group: "craft", displayed: 11 }], rating: 5.5, wage: { costMinor: 9_000, capMinor: 20_000, period: "2026-10", label: "Estimate" }, currency: "EUR", tools: ["sendgrid"], form: ["success", "success", "failure", "failure", "failure"], latestUpdate: { at: "2026-10-06T16:00:00Z", text: "SendGrid credential expired" }, health: { lastHeartbeatAt: "2026-10-06T16:00:00Z", errorRate: 0.6, credentialExpired: true, expectedReturnAt: "2026-10-07T14:00:00Z", reason: "SendGrid credential expired" }, expectedReturnAt: "2026-10-07T14:00:00Z" },
  { id: AGENT_LINK, name: "Linker", role: "Entity linker", agentType: "entity_linker", layer: "utility", status: "idle", modelKey: "haiku", avatarSeed: "linker", departmentIds: [DEPT_TEAM], departments: [team], lineManagerId: null, currentTask: null, skills: [], rating: null, wage: { costMinor: 400, capMinor: 2_000, period: "2026-10", label: "Estimate" }, currency: "EUR", tools: [], form: [], latestUpdate: null, health: { lastHeartbeatAt: "2026-10-07T11:00:00Z", errorRate: 0 } },
];
export const agentsResponse: AgentsListResponse = { agents, templates: ["chief_of_staff", "frontend_engineer"] };
export const emptyAgentsResponse: AgentsListResponse = { agents: [], templates: [] };

export const departments: DepartmentRow[] = [
  { id: DEPT_TEAM, name: "Team", slug: "team", colourToken: "dept-5", position: 0, moduleKeys: ["team"], leadAgentId: AGENT_COS, lead: { id: AGENT_COS, name: "Orla", status: "healthy", avatarSeed: "orla" }, squad: [], tabs: [{ id: "t1", slug: "squad", title: "Squad", position: 0 }, { id: "t2", slug: "recruitment", title: "Recruitment", position: 5 }] },
  { id: DEPT_DEV, name: "Development", slug: "development", colourToken: "dept-2", position: 1, moduleKeys: ["development"], leadAgentId: AGENT_PIKE, lead: { id: AGENT_PIKE, name: "Pike", status: "degraded", avatarSeed: "pike" }, squad: [], tabs: [{ id: "t3", slug: "plan", title: "Plan", position: 0 }] },
  { id: DEPT_DIST, name: "Distribution", slug: "distribution", colourToken: "dept-3", position: 2, moduleKeys: ["distribution"], leadAgentId: null, lead: null, squad: [], tabs: [] },
];

export const humans: MembershipRow[] = [
  { id: "m-1", userId: ME, role: "owner", sectionPermissions: {}, createdAt: "2026-06-01T09:00:00Z" },
  { id: "m-2", userId: USER_ADA, role: "admin", sectionPermissions: { finance: "write", legal: "read" }, email: "ada@northwind.example", entityId: "e0000000-0000-4000-8000-000000000002", createdAt: "2026-08-12T09:00:00Z" },
  { id: "m-3", userId: USER_BEN, role: "advisor", sectionPermissions: { product: "read" }, displayName: "Ben Okafor", createdAt: "2026-09-20T09:00:00Z" },
];

export const me: FounderProfileResponse = { profile: { userId: ME, displayName: "Reid" }, complete: true, email: "reid@northwind.example", memberships: [{ businessId: BID, userId: ME, role: "owner" }] };

export const responsibilities: ResponsibilitiesResponse = {
  decisionTypes: ["spend_above_threshold", "publish_content", "merge_to_main", "sign_contracts", "message_customers", "hire_agents", "change_models"],
  matrix: [
    { decisionType: "spend_above_threshold", handler: { kind: "founder", id: null }, uniform: true },
    { decisionType: "publish_content", handler: { kind: "user", id: USER_ADA }, uniform: true },
    { decisionType: "merge_to_main", handler: { kind: "agent", id: AGENT_PIKE }, uniform: true },
    { decisionType: "sign_contracts", handler: { kind: "founder", id: null }, uniform: true },
    { decisionType: "message_customers", handler: { kind: "founder", id: null }, uniform: false },
    { decisionType: "hire_agents", handler: { kind: "founder", id: null }, uniform: true },
    { decisionType: "change_models", handler: { kind: "founder", id: null }, uniform: true },
  ],
  perDepartment: [
    { departmentId: DEPT_TEAM, rows: [{ decisionType: "publish_content", handler: { kind: "user", id: USER_ADA } }, { decisionType: "merge_to_main", handler: { kind: "agent", id: AGENT_PIKE } }] },
    { departmentId: DEPT_DEV, rows: [{ decisionType: "publish_content", handler: { kind: "user", id: USER_ADA } }, { decisionType: "merge_to_main", handler: { kind: "agent", id: AGENT_PIKE } }] },
    { departmentId: DEPT_DIST, rows: [{ decisionType: "publish_content", handler: { kind: "user", id: USER_ADA } }, { decisionType: "merge_to_main", handler: { kind: "agent", id: AGENT_PIKE } }, { decisionType: "message_customers", handler: { kind: "agent", id: AGENT_MARA } }] },
  ],
};

export const catalogue: TemplateRow[] = [
  { key: "chief_of_staff", name: "Chief of Staff", role: "Assistant manager", family: "assistant", layer: "assistant", module: "team", modelKey: "opus", description: "Plans every cycle, routes work and compiles your notes into plans.", skills: ["planning", "prioritisation"], wageCapMinor: 60_000, wageLabel: "Estimate", traits: ["Asks before spending"] },
  { key: "engineering_lead", name: "Engineering lead", role: "Lead", family: "lead", layer: "lead", module: "development", modelKey: "opus", description: "Breaks the roadmap into tasks, reviews pull requests and keeps the main branch green.", skills: ["architecture", "review"], wageCapMinor: 50_000, wageLabel: "Estimate" },
  { key: "frontend_engineer", name: "Frontend engineer", role: "Worker", family: "worker", layer: "worker", module: "development", modelKey: "sonnet", description: "Builds screens and components with tests first.", skills: ["react", "testing"], wageCapMinor: 30_000, wageLabel: "Estimate", traits: ["Writes tests first"] },
  { key: "newsletter_writer", name: "Newsletter writer", role: "Worker", family: "worker", layer: "worker", module: "distribution", modelKey: "sonnet", description: "Writes the weekly customer newsletter and drafts replies; asks before sending.", skills: ["copywriting", "email"], wageCapMinor: 15_000, wageLabel: "Estimate" },
  { key: "channel_email", name: "Email engine", role: "Channel engine", family: "channel", layer: "worker", module: "distribution", channelKey: "email", modelKey: "sonnet", description: "Runs the e-mail channel: sequences, sends, replies.", skills: ["copywriting"], wageCapMinor: 20_000, wageLabel: "Estimate" },
  { key: "sourcing_specialist", name: "Sourcing specialist", role: "Specialist", family: "specialist", layer: "worker", module: "development", modelKey: "sonnet", description: "Finds suppliers, requests quotes and tracks samples.", skills: ["sourcing"], wageCapMinor: 20_000, wageLabel: "Estimate" },
  { key: "entity_linker", name: "Entity linker", role: "Utility", family: "utility", layer: "utility", module: null, modelKey: "haiku", description: "Links names in agent text to CRM entities.", skills: [], wageCapMinor: 2_000, wageLabel: "Estimate" },
];

export const compareJuno: ModelCompareResponse = {
  current: "sonnet",
  locked: false,
  options: [
    { modelKey: "opus", modelId: "claude-opus", allowed: true, warning: null, predictedWageMinor: 90_000, predictedSkillDelta: null, label: "Estimate" },
    { modelKey: "sonnet", modelId: "claude-sonnet", allowed: true, warning: null, predictedWageMinor: 18_000, predictedSkillDelta: null, label: "Estimate" },
    { modelKey: "haiku", modelId: "claude-haiku", allowed: true, warning: "Workers on Haiku fail hard tasks more often", predictedWageMinor: 4_000, predictedSkillDelta: null, label: "Estimate" },
  ],
};

export const dataResponses: Record<string, unknown> = {
  "team.agents.list": agentsResponse,
  "team.agents.catalogue": catalogue,
  "team.humans.list": humans,
  "team.responsibilities.get": responsibilities,
  "department.list": departments,
  "founder.profile.get": me,
  "agent.model.compare": compareJuno,
};

export const emptyResponses: Record<string, unknown> = {
  "team.agents.list": emptyAgentsResponse,
  "team.agents.catalogue": [],
  "team.humans.list": [],
  "team.responsibilities.get": { matrix: [], perDepartment: [], decisionTypes: responsibilities.decisionTypes },
  "department.list": [],
  "founder.profile.get": me,
};
