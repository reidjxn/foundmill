/** Deterministic rows for the development screen tests, shaped like the apps/api responses. */
import type { AgentSessionEvent } from "@foundmill/dugout";
import type { DepartmentRow } from "@foundmill/widgets";
import type { AgentRow, AgentsListResponse, MergedPrRow, OpenPrRow, PrsListResponse, RoadmapListResponse, SessionRow, SessionsListResponse, TaskRow, TasksListResponse } from "../types";

export const BID = "00000000-0000-4000-8000-000000000001";
export const AGENT_JUNO = "10000000-0000-4000-8000-000000000001";
export const AGENT_PIKE = "10000000-0000-4000-8000-000000000002";
export const AGENT_WREN = "10000000-0000-4000-8000-000000000003";
export const TASK_BUNDLE = "20000000-0000-4000-8000-000000000001";
export const TASK_INDEX = "20000000-0000-4000-8000-000000000002";
export const TASK_PLAYWRIGHT = "20000000-0000-4000-8000-000000000003";
export const TASK_RATE = "20000000-0000-4000-8000-000000000004";
export const TASK_SOURCING = "20000000-0000-4000-8000-000000000005";
export const TASK_DONE = "20000000-0000-4000-8000-000000000006";
export const SESSION_BUNDLE = "30000000-0000-4000-8000-000000000001";
export const SESSION_INDEX = "30000000-0000-4000-8000-000000000002";
export const SESSION_SOURCING = "30000000-0000-4000-8000-000000000005";
export const ROADMAP_ITEM = "40000000-0000-4000-8000-000000000001";

export const agents: AgentRow[] = [
  { id: AGENT_JUNO, name: "Juno", role: "Frontend engineer", status: "healthy", modelKey: "sonnet", avatarSeed: "juno", departments: [{ id: "d-dev", name: "Development", colourToken: "dept-2" }] },
  { id: AGENT_PIKE, name: "Pike", role: "Backend engineer", status: "healthy", modelKey: "opus", avatarSeed: "pike", departments: [{ id: "d-dev", name: "Development", colourToken: "dept-2" }] },
  { id: AGENT_WREN, name: "Wren", role: "Sourcing specialist", status: "healthy", modelKey: "sonnet", avatarSeed: "wren", departments: [{ id: "d-ops", name: "Operations", colourToken: "dept-6" }] },
];
export const agentsResponse: AgentsListResponse = { agents, templates: [] };

export const tasks: TaskRow[] = [
  { id: TASK_BUNDLE, kind: "code", title: "Add a bundle picker to the product page", status: "running", progress: "0.3500", phase: "implementing", assigneeAgentId: AGENT_JUNO, fileScope: ["apps/web/app/product"], acceptance: ["Picker renders", "Playwright passes"], priority: 0, startedAt: "2026-10-07T09:40:00Z", createdAt: "2026-10-07T09:00:00Z" },
  { id: TASK_INDEX, kind: "code", title: "Usage index for the Ledgerly dashboard", status: "review", progress: "0.7000", phase: "review", assigneeAgentId: AGENT_PIKE, fileScope: ["packages/db"], acceptance: ["Index exists"], priority: 10, startedAt: "2026-10-07T09:10:00Z", createdAt: "2026-10-07T09:00:00Z" },
  { id: TASK_PLAYWRIGHT, kind: "code", title: "Playwright coverage for checkout", status: "ready", progress: "0", phase: null, assigneeAgentId: AGENT_JUNO, fileScope: ["e2e"], acceptance: [], priority: 0, startedAt: null, createdAt: "2026-10-07T09:00:00Z" },
  { id: TASK_RATE, kind: "code", title: "Rate-limit the public API", status: "planned", progress: "0", phase: null, assigneeAgentId: null, fileScope: ["apps/api"], acceptance: [], priority: 0, startedAt: null, createdAt: "2026-10-07T09:00:00Z" },
  { id: TASK_SOURCING, kind: "specialist", title: "Supplier brief for the serum pump", status: "running", progress: "0.2000", phase: "implementing", assigneeAgentId: AGENT_WREN, fileScope: [], acceptance: ["Three quotes"], priority: 0, startedAt: "2026-10-07T09:20:00Z", createdAt: "2026-10-07T09:00:00Z" },
  { id: TASK_DONE, kind: "code", title: "Sitemap and canonical fixes", status: "done", progress: "1", phase: "done", assigneeAgentId: AGENT_PIKE, fileScope: ["apps/web"], acceptance: ["Sitemap valid"], priority: 0, startedAt: "2026-10-06T14:00:00Z", endedAt: "2026-10-06T15:00:00Z", createdAt: "2026-10-06T13:00:00Z" },
];

export const edges = [
  { fromTask: TASK_BUNDLE, toTask: TASK_PLAYWRIGHT },
  { fromTask: TASK_INDEX, toTask: TASK_RATE },
];

export const tasksResponse: TasksListResponse = { items: tasks, nextCursor: null, edges, counts: { running: 2, review: 1, ready: 1, planned: 1, done: 1 } };
export const liveTasksResponse: TasksListResponse = { items: tasks.filter((t) => ["running", "paused", "blocked", "review", "merging"].includes(t.status)), nextCursor: null, edges, counts: tasksResponse.counts };
export const emptyTasksResponse: TasksListResponse = { items: [], nextCursor: null, edges: [], counts: {} };

export const sessions: SessionRow[] = [
  { id: SESSION_BUNDLE, agentId: AGENT_JUNO, taskId: TASK_BUNDLE, modelKey: "sonnet", startedAt: "2026-10-07T09:40:00Z", endedAt: null, tokensIn: 30_000, tokensOut: 12_000, costMinor: 240, currency: "EUR", recordingRef: null },
  { id: SESSION_INDEX, agentId: AGENT_PIKE, taskId: TASK_INDEX, modelKey: "opus", startedAt: "2026-10-07T09:10:00Z", endedAt: null, tokensIn: 80_000, tokensOut: 20_000, costMinor: 910, currency: "EUR", recordingRef: null },
  { id: SESSION_SOURCING, agentId: AGENT_WREN, taskId: TASK_SOURCING, modelKey: "sonnet", startedAt: "2026-10-07T09:20:00Z", endedAt: null, tokensIn: 10_000, tokensOut: 4_000, costMinor: 80, currency: "EUR", recordingRef: null },
];
export const sessionsResponse: SessionsListResponse = { items: sessions, nextCursor: null };

export const departments: DepartmentRow[] = [
  { id: "d-dev", name: "Development", slug: "development", colourToken: "dept-2", position: 1, moduleKeys: ["development"], lead: null, squad: [], tabs: [{ id: "t1", slug: "training-ground", title: "Training Ground", position: 0 }, { id: "t2", slug: "plan", title: "Plan", position: 1 }] },
];

export const openPrs: OpenPrRow[] = [
  { taskId: TASK_INDEX, title: "Usage index for the Ledgerly dashboard", status: "review", branch: `agent/${TASK_INDEX}`, agentId: AGENT_PIKE },
  { taskId: TASK_BUNDLE, title: "Add a bundle picker to the product page", status: "merging", branch: `agent/${TASK_BUNDLE}`, agentId: AGENT_JUNO },
];
export const mergedPrs: MergedPrRow[] = [
  { eventId: "50000000-0000-4000-8000-000000000001", occurredAt: "2026-10-06T15:05:00Z", taskId: TASK_DONE, repo: "northwind/storefront", prNumber: 41, title: "Sitemap and canonical fixes", branch: `agent/${TASK_DONE}`, baseBranch: "main", mergeCommitSha: "a1b2c3d4e5f6a7b8", mergedBy: { kind: "agent", id: AGENT_PIKE, name: "Pike (integration agent)" }, additions: 120, deletions: 14, filesChanged: 6, url: "https://github.com/northwind/storefront/pull/41" },
];
export const prsResponse: PrsListResponse = { open: openPrs, merged: mergedPrs };
export const emptyPrsResponse: PrsListResponse = { open: [], merged: [] };

export const roadmapResponse: RoadmapListResponse = { items: [{ id: ROADMAP_ITEM, title: "Bundles and gifting", horizon: "now", position: 0 }] };

export const planTier = { tier: "pro" as const };

/** A short stream for the bundle session: a phase change, a stdout line, a progress tick and a shout. */
export function bundleEvents(): AgentSessionEvent[] {
  return [
    { kind: "phase_changed", at: "2026-10-07T09:41:00Z", from: "planning", to: "implementing" },
    { kind: "stdout", at: "2026-10-07T09:42:00Z", channel: "stdout", text: "pnpm test --filter web" },
    { kind: "progress", at: "2026-10-07T09:43:00Z", progress: 0.633, planStepsDone: 4, planSteps: 6, acceptanceTestsPassing: 2, acceptanceTests: 2, reviewPassed: false, merged: false, etaAt: "2026-10-07T10:20:00Z" },
    { kind: "note", at: "2026-10-07T09:44:00Z", level: "info", source: "shout", text: "Focus on tests" },
  ];
}

export function sourcingEvents(): AgentSessionEvent[] {
  return [
    { kind: "note", at: "2026-10-07T09:21:00Z", source: "agent", text: 'specialist:{"type":"rfq","stages":[{"id":"identified","label":"Identified","count":40},{"id":"contacted","label":"RFQ sent","count":22},{"id":"quoted","label":"Quoted","count":5}]}' },
    { kind: "note", at: "2026-10-07T09:22:00Z", source: "agent", text: 'specialist:{"type":"quote","quote":{"id":"q-1","supplier":"Baltic Pack OÜ","country":"EE","unitPrice":{"amountMinor":42,"currency":"EUR"},"moq":1000,"leadTimeDays":28,"score":15,"status":"shortlisted"}}' },
    { kind: "note", at: "2026-10-07T09:23:00Z", source: "agent", text: 'specialist:{"type":"sample","sample":{"id":"s-1","supplier":"Baltic Pack OÜ","stage":"shipped","etaAt":"2026-10-12T00:00:00Z"}}' },
    { kind: "note", at: "2026-10-07T09:24:00Z", source: "agent", text: 'specialist:{"type":"shipment","shipment":{"id":"sh-1","ref":"NWS-2026-017","carrier":"DSV","from":"Tallinn","to":"Stockholm","status":"in_transit","cost":{"amountMinor":48000,"currency":"EUR"}}}' },
  ];
}

/** The relay's raw `{ kind, json }` frame for an event (what apps/stream forwards). */
export function rawFrame(event: AgentSessionEvent): { kind: string; json: string } {
  return { kind: event.kind, json: JSON.stringify(event) };
}

/** Every response the Training Ground needs, with live tasks. */
export function trainingGroundResponses() {
  return {
    "dev.tasks.list": (input: Record<string, unknown> | undefined) => (Array.isArray(input?.status) ? liveTasksResponse : tasksResponse),
    "dev.sessions.list": sessionsResponse,
    "team.agents.list": agentsResponse,
    "billing.plan": planTier,
    "department.list": departments,
    "dev.sessions.replay": (input: Record<string, unknown> | undefined) => ({ session: sessions.find((s) => s.id === input?.sessionId) ?? sessions[0], recordingRef: null, channel: `as:${String(input?.sessionId)}` }),
    "dev.tasks.openInClaudeCode": (input: Record<string, unknown> | undefined) => ({ branch: `agent/${String(input?.taskId)}`, checkout: `git fetch origin agent/${String(input?.taskId)} && git checkout agent/${String(input?.taskId)}`, contextMd: "# Task\n\nGoal", agent: { id: AGENT_JUNO, name: "Juno", modelKey: "sonnet" } }),
  };
}
