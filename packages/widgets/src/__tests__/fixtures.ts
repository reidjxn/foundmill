/** Deterministic API fixtures for every path the gallery widgets query. */
import type { FakeResponse } from "../testing";
import { addDays, dayKey, lastDays } from "../shared/time";
import type { ChannelMetricRow, ChannelsListResponse, CommunityPostRow, CommunityRow, ComplianceResponse, CustomMetricResult, DepartmentRow, FinanceOverview, InboxListResponse, LeaderboardEntryRow, LeaderboardPositionRow, LeaderboardRow, Page, RibbonResponse, RoadmapListResponse, TaskRow, TeamAgentRow } from "../shared/types";
import type { SessionRow } from "../widgets/squad-pulse";

export const BID = "11111111-1111-4111-8111-111111111111";
export const TODAY = dayKey();
const uuid = (n: number, block = "a") => `${block}${block}${block}${block}${block}${block}${block}${block}-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const DEPT = { product: uuid(1, "d"), development: uuid(2, "d"), distribution: uuid(3, "d"), finance: uuid(4, "d"), team: uuid(5, "d"), legal: uuid(6, "d") };
export const AGENT = { atlas: uuid(1, "e"), beacon: uuid(2, "e"), cove: uuid(3, "e"), delta: uuid(4, "e"), ember: uuid(5, "e"), flint: uuid(6, "e") };
export const ENTITY = { nordic: uuid(7, "f") };

export const departments: DepartmentRow[] = [
  {
    id: DEPT.development,
    name: "Development",
    slug: "development",
    colourToken: "dept-1",
    position: 0,
    leadAgentId: AGENT.atlas,
    moduleKeys: ["development"],
    lead: { id: AGENT.atlas, name: "Atlas", status: "healthy", avatarSeed: "atlas", role: "Engineering lead" },
    squad: [
      { id: AGENT.atlas, name: "Atlas", role: "Engineering lead", status: "healthy", modelKey: "opus", avatarSeed: "atlas" },
      { id: AGENT.beacon, name: "Beacon", role: "Backend", status: "healthy", modelKey: "sonnet", avatarSeed: "beacon" },
      { id: AGENT.cove, name: "Cove", role: "Frontend", status: "idle", modelKey: "sonnet", avatarSeed: "cove" },
    ],
    tabs: [
      { id: uuid(1, "b"), slug: "training-ground", title: "Live sessions", position: 0 },
      { id: uuid(2, "b"), slug: "plan", title: "Plan", position: 1 },
    ],
  },
  {
    id: DEPT.distribution,
    name: "Distribution",
    slug: "distribution",
    colourToken: "dept-3",
    position: 1,
    leadAgentId: AGENT.delta,
    moduleKeys: ["distribution"],
    lead: { id: AGENT.delta, name: "Delta", status: "degraded", avatarSeed: "delta", role: "Growth lead" },
    squad: [
      { id: AGENT.delta, name: "Delta", role: "Growth lead", status: "degraded", modelKey: "opus", avatarSeed: "delta" },
      { id: AGENT.ember, name: "Ember", role: "SEO", status: "healthy", modelKey: "haiku", avatarSeed: "ember" },
    ],
    tabs: [
      { id: uuid(3, "b"), slug: "formation", title: "Formation", position: 0 },
      { id: uuid(4, "b"), slug: "channels", title: "Channels", position: 1 },
    ],
  },
  {
    id: DEPT.finance,
    name: "Finance",
    slug: "finance",
    colourToken: "dept-2",
    position: 2,
    leadAgentId: AGENT.flint,
    moduleKeys: ["finance"],
    lead: { id: AGENT.flint, name: "Flint", status: "healthy", avatarSeed: "flint", role: "Finance lead" },
    squad: [{ id: AGENT.flint, name: "Flint", role: "Finance lead", status: "healthy", modelKey: "sonnet", avatarSeed: "flint" }],
    tabs: [
      { id: uuid(5, "b"), slug: "overview", title: "Overview", position: 0 },
      { id: uuid(6, "b"), slug: "runway", title: "Runway", position: 3 },
    ],
  },
];

export function ribbon(days = 60): RibbonResponse {
  const keys = lastDays(days, TODAY);
  const rows: RibbonResponse["rows"] = [];
  const conversions: RibbonResponse["conversions"] = [];
  keys.forEach((day, i) => {
    for (const d of departments) rows.push({ day, departmentId: d.id, agentHours: 2 + (i % 5), tasksDone: i % 3, spendMinor: d.id === DEPT.distribution ? 5_000 : 0, revenueMinor: 0, signups: 0, activations: 0, payments: 0, decisions: 0 });
    const payments = i % 4 === 0 ? 1 : 0;
    rows.push({ day, departmentId: null, agentHours: 0, tasksDone: 0, spendMinor: 5_000, revenueMinor: payments * 49_00, signups: 2, activations: 1, payments, decisions: i % 7 === 0 ? 1 : 0 });
    if (payments) conversions.push({ id: uuid(i + 1, "c"), entityId: ENTITY.nordic, kind: "payment", amountMinor: 49_00, currency: "EUR", occurredAt: `${day}T10:00:00.000Z`, firstPayment: true, entityName: "Nordic Beauty AB" });
  });
  return {
    rows,
    conversions,
    milestones: [
      { id: uuid(1, "9"), kind: "customer", label: "First customer", achievedAt: `${addDays(TODAY, -40)}T10:00:00.000Z`, trophyKey: "customer_1", ref: { customerName: "Nordic Beauty AB", permission: true, amountMinor: 49_00 }, visibility: "public" },
      { id: uuid(2, "9"), kind: "revenue", label: "First €1,000 MRR", achievedAt: `${addDays(TODAY, -12)}T10:00:00.000Z`, trophyKey: "mrr_1k", ref: {}, visibility: "private" },
    ],
    chapters: [{ id: "2026-Q4", index: 0, year: 2026, quarter: 4, startsOn: addDays(TODAY, -60), endsOn: addDays(TODAY, 30), status: "current", title: null, provisionalTitle: "Chapter 1" }],
    kickoff: keys[0]!,
    today: TODAY,
    forecastLabel: "Forecast",
  };
}

export const finance: FinanceOverview = {
  cash: { amountMinor: 18_250_000, currency: "EUR", accounts: 2, asOf: `${TODAY}T06:00:00.000Z`, label: "Cash in bank" },
  burn: { netBurnMinor: 2_100_000, grossBurnMinor: 2_600_000, months: 3, label: "Estimate", definition: "Operating outflows minus operating inflows, trailing 3-month average, financing excluded" },
  runway: { months: 8.7, label: "Estimate", warnings: [12, 9], blocksContinue: false },
  revenue: {
    monthly: Array.from({ length: 6 }, (_, i) => {
      const d = new Date(`${TODAY}T00:00:00.000Z`);
      d.setUTCMonth(d.getUTCMonth() - (5 - i));
      return { month: d.toISOString().slice(0, 7), inflowMinor: 300_000 + i * 50_000, outflowMinor: 800_000, netMinor: 300_000 + i * 50_000 - 800_000, count: 20 };
    }),
    basis: "cash",
    label: "Management P&L, unaudited, cash basis",
  },
  customers30d: 7,
  forecasts: {
    base: { id: uuid(1, "4"), scenario: "base", currency: "EUR", label: "Forecast", series: Array.from({ length: 6 }, (_, i) => ({ day: addDays(TODAY, 30 * (i + 1)), revenueMinor: 400_000 + i * 60_000, cashMinor: 18_000_000 - i * 1_500_000 })) },
    upside: { id: uuid(2, "4"), scenario: "upside", currency: "EUR", label: "Forecast", series: Array.from({ length: 6 }, (_, i) => ({ day: addDays(TODAY, 30 * (i + 1)), revenueMinor: 450_000 + i * 90_000, cashMinor: 18_000_000 - i * 1_000_000 })) },
    downside: { id: uuid(3, "4"), scenario: "downside", currency: "EUR", label: "Forecast", series: Array.from({ length: 6 }, (_, i) => ({ day: addDays(TODAY, 30 * (i + 1)), revenueMinor: 350_000 + i * 30_000, cashMinor: 18_000_000 - i * 2_000_000 })) },
  },
};

export const inbox: InboxListResponse = {
  items: [
    { id: uuid(1, "1"), type: "decision", fromAgentId: AGENT.atlas, subject: "Approve the schema change for usage index", bodyMd: "Atlas needs a yes. The migration touches [[ent:" + ENTITY.nordic + "|Nordic Beauty AB]] data.", blocksContinue: true, entityIds: [ENTITY.nordic], state: "unread", createdAt: `${TODAY}T08:00:00.000Z` },
    { id: uuid(2, "1"), type: "customer_won", fromAgentId: AGENT.delta, subject: "Nordic Beauty AB paid €49", bodyMd: "A cup tie. SEO assisted.", blocksContinue: false, entityIds: [ENTITY.nordic], state: "unread", createdAt: `${TODAY}T07:00:00.000Z` },
    { id: uuid(3, "1"), type: "update", fromAgentId: AGENT.beacon, subject: "Webhook retry merged", bodyMd: "PR #42 merged after the flaky test was fixed.", blocksContinue: false, entityIds: [], state: "read", createdAt: `${addDays(TODAY, -1)}T18:00:00.000Z` },
    { id: uuid(4, "1"), type: "report", fromAgentId: null, fromUserId: null, subject: "Weekly round-up", bodyMd: "Seven matches this week.", blocksContinue: false, entityIds: [], state: "read", createdAt: `${addDays(TODAY, -2)}T18:00:00.000Z` },
  ],
  nextCursor: null,
  counts: { all: 4 },
  blocking: 1,
};

export const channels: ChannelsListResponse = {
  channels: [
    { id: uuid(1, "5"), channelKey: "seo", enabled: true, line: "defence", fit: 16, potential: 80, recommended: true, budgetMinor: 100_000, currency: "EUR", meta: { label: "SEO", line: "defence", coreMetric: "organic signups" }, form: { channelId: uuid(1, "5"), channelKey: "seo", line: "defence", spendMinor: 40_000, impressions: 12_000, leads: 400, signups: 80, activations: 40, customers: 10, days: 35 } },
    { id: uuid(2, "5"), channelKey: "paid_ads", enabled: true, line: "attack", fit: 11, potential: 60, recommended: false, budgetMinor: 300_000, currency: "EUR", meta: { label: "Paid advertising", line: "attack", coreMetric: "CPA" }, form: { channelId: uuid(2, "5"), channelKey: "paid_ads", line: "attack", spendMinor: 250_000, impressions: 90_000, leads: 900, signups: 120, activations: 50, customers: 12, days: 35 } },
    { id: uuid(3, "5"), channelKey: "print", enabled: false, line: "wings", fit: 4, potential: 20, recommended: false, budgetMinor: 0, currency: "EUR", meta: { label: "Print", line: "wings", coreMetric: "code redemptions" }, form: null },
  ],
  lines: { attack: ["paid_ads"], midfield: [], defence: ["seo"], wings: ["print"] },
  blended: { spendMinor: 290_000, impressions: 102_000, leads: 1_300, signups: 200, activations: 90, customers: 22, days: 35 },
};

export const channelMetrics: ChannelMetricRow[] = lastDays(35, TODAY).flatMap((day, i) => [
  { channelId: uuid(1, "5"), day, spendMinor: 1_200, customers: i % 3 === 0 ? 1 : 0 },
  { channelId: uuid(2, "5"), day, spendMinor: 7_000 + (i % 7) * 500, customers: i % 4 === 0 ? 1 : 0 },
]);

export const roadmap: RoadmapListResponse = {
  items: [
    { id: uuid(1, "6"), title: "Usage-based billing", horizon: "now", targetStart: addDays(TODAY, -10), targetEnd: addDays(TODAY, 12), confidence: 4, status: "in_progress", position: 0, tasks: [{ id: uuid(1, "7"), title: "Usage index", status: "done", progress: 1 }, { id: uuid(2, "7"), title: "Invoice lines", status: "running", progress: 0.4 }] },
    { id: uuid(2, "6"), title: "Team seats", horizon: "now", targetStart: null, targetEnd: addDays(TODAY, 20), confidence: 3, status: "blocked", position: 1, tasks: [] },
    { id: uuid(3, "6"), title: "Annual plans", horizon: "next", targetStart: null, targetEnd: addDays(TODAY, 45), confidence: 3, status: "planned", position: 0, tasks: [] },
    { id: uuid(4, "6"), title: "Public API", horizon: "later", targetStart: null, targetEnd: null, confidence: 2, status: "planned", position: 0, tasks: [] },
    { id: uuid(5, "6"), title: "Onboarding checklist", horizon: "now", targetStart: null, targetEnd: addDays(TODAY, -2), confidence: 5, status: "done", position: 2, tasks: [{ id: uuid(3, "7"), title: "Checklist UI", status: "done", progress: 1 }] },
  ],
  dependencies: [],
};

export const tasks: Page<TaskRow> = {
  items: [
    { id: uuid(2, "7"), kind: "code", title: "Invoice lines", departmentId: DEPT.development, assigneeAgentId: AGENT.beacon, status: "running", progress: 0.4, phase: "implementing", startedAt: `${TODAY}T07:30:00.000Z`, roadmapItemId: uuid(1, "6") },
    { id: uuid(4, "7"), kind: "code", title: "Rate-limit the webhook receiver", departmentId: DEPT.development, assigneeAgentId: AGENT.atlas, status: "review", progress: 0.8, phase: "review", startedAt: `${TODAY}T05:00:00.000Z` },
    { id: uuid(5, "7"), kind: "code", title: "Seat invitations", departmentId: DEPT.development, assigneeAgentId: null, status: "ready", progress: 0 },
    { id: uuid(1, "7"), kind: "code", title: "Usage index", departmentId: DEPT.development, assigneeAgentId: AGENT.beacon, status: "done", progress: 1, startedAt: `${addDays(TODAY, -1)}T09:00:00.000Z`, endedAt: `${addDays(TODAY, -1)}T11:00:00.000Z` },
    { id: uuid(6, "7"), kind: "channel", title: "Draft the October newsletter", departmentId: DEPT.distribution, assigneeAgentId: AGENT.ember, status: "blocked", progress: 0.2 },
  ],
  nextCursor: null,
};

export const sessions: Page<SessionRow> = {
  items: [
    { id: uuid(1, "8"), agentId: AGENT.beacon, startedAt: `${TODAY}T07:30:00.000Z`, endedAt: `${TODAY}T09:15:00.000Z` },
    { id: uuid(2, "8"), agentId: AGENT.atlas, startedAt: `${addDays(TODAY, -1)}T05:00:00.000Z`, endedAt: `${addDays(TODAY, -1)}T06:00:00.000Z` },
    { id: uuid(3, "8"), agentId: AGENT.ember, startedAt: `${addDays(TODAY, -2)}T13:00:00.000Z`, endedAt: `${addDays(TODAY, -2)}T13:30:00.000Z` },
  ],
  nextCursor: null,
};

export const team: TeamAgentRow[] = [
  { id: AGENT.atlas, name: "Atlas", role: "Engineering lead", status: "healthy", modelKey: "opus", avatarSeed: "atlas", departmentIds: [DEPT.development], departments: [{ id: DEPT.development, name: "Development", colourToken: "dept-1" }], currentTask: tasks.items[1]!, skills: [{ displayed: 16 }, { displayed: 14 }], rating: 7.5, wage: { costMinor: 42_000, capMinor: 80_000, period: TODAY.slice(0, 7), label: "Estimate" }, form: ["success", "success", "partial", "success", "success"] },
  { id: AGENT.beacon, name: "Beacon", role: "Backend", status: "healthy", modelKey: "sonnet", avatarSeed: "beacon", departmentIds: [DEPT.development], departments: [{ id: DEPT.development, name: "Development", colourToken: "dept-1" }], currentTask: tasks.items[0]!, skills: [{ displayed: 13 }], rating: 6.5, wage: { costMinor: 12_000, capMinor: null, period: TODAY.slice(0, 7), label: "Estimate" }, form: ["success", "failure", "success", "success", "success"] },
  { id: AGENT.ember, name: "Ember", role: "SEO", status: "healthy", modelKey: "haiku", avatarSeed: "ember", departmentIds: [DEPT.distribution], departments: [{ id: DEPT.distribution, name: "Distribution", colourToken: "dept-3" }], currentTask: null, skills: [{ displayed: 18 }], rating: 9, wage: { costMinor: 3_000, capMinor: null, period: TODAY.slice(0, 7), label: "Estimate" }, form: ["success", "success", "success", "success", "partial"] },
];

export const compliance: ComplianceResponse = {
  events: [],
  deadlines: [{ id: uuid(1, "3"), title: "VAT return", kind: "vat", dueAt: `${addDays(TODAY, 19)}T00:00:00.000Z`, status: "upcoming" }],
  filings: [{ id: uuid(2, "3"), kind: "annual_report", title: "Annual report", dueAt: `${addDays(TODAY, 120)}T00:00:00.000Z`, filedAt: null, status: "upcoming" }],
};

export const leaderboards: LeaderboardRow[] = [{ id: uuid(1, "2"), period: "2026-10", boardKind: "mrr_growth", division: "Division 2", title: "MRR growth", metricLabel: "MRR Δ" }];
export const leaderboardEntries: LeaderboardEntryRow[] = Array.from({ length: 12 }, (_, i) => ({ leaderboardId: uuid(1, "2"), businessId: i === 7 ? BID : uuid(i + 1, "0"), position: i + 1, movement: i % 3 === 0 ? 2 : i % 3 === 1 ? -1 : 0, metricValue: 12_000 - i * 700, businessName: i === 7 ? "Ledgerly" : `Club ${i + 1}` }));
export const positions: LeaderboardPositionRow[] = [{ ...leaderboardEntries[7]!, board: leaderboards[0]! }];

export const communities: CommunityRow[] = [{ id: uuid(1, "e"), name: "B2B SaaS founders", slug: "b2b-saas", memberCount: 128 }];
export const posts: Page<CommunityPostRow> = {
  items: [
    { id: uuid(1, "f"), communityId: uuid(1, "e"), authorUserId: uuid(1, "0"), authorName: "Mara", bodyMd: "Anyone running annual-plan discounts through Stripe checkout? Curious about churn.", createdAt: `${TODAY}T06:30:00.000Z`, replyCount: 3 },
    { id: uuid(2, "f"), communityId: uuid(1, "e"), authorUserId: uuid(2, "0"), authorName: "Jonas", bodyMd: "Shipped usage-based billing this week.", createdAt: `${addDays(TODAY, -1)}T12:00:00.000Z` },
  ],
  nextCursor: null,
};

export const customMetric: CustomMetricResult = { value: 125_000, currency: "EUR", format: "money", label: "MRR", asOf: `${TODAY}T06:00:00.000Z`, provenance: "Stripe subscriptions, active", series: [9, 10, 11, 12.5] };

/** Every path with data: the "data" state of each widget. */
export function dataResponses(): Record<string, FakeResponse> {
  return {
    "department.list": departments,
    "journey.ribbon": ribbon(),
    "product.roadmap.list": roadmap,
    "finance.overview": finance,
    "dev.tasks.list": (input: Record<string, unknown> | undefined) => {
      const status = input?.status;
      const wanted = Array.isArray(status) ? new Set(status as string[]) : typeof status === "string" ? new Set([status]) : null;
      return { ...tasks, items: tasks.items.filter((t) => (!input?.departmentId || t.departmentId === input.departmentId) && (!wanted || wanted.has(t.status))) };
    },
    "dev.sessions.list": sessions,
    "inbox.list": inbox,
    "distribution.channels.list": channels,
    "distribution.channels.metrics": channelMetrics,
    "legal.compliance.list": compliance,
    "team.agents.list": team,
    "live.leaderboards.list": leaderboards,
    "live.leaderboards.entries": leaderboardEntries,
    "live.leaderboards.positions": positions,
    "live.communities.list": communities,
    "live.communities.posts": posts,
    "dashboard.customMetric.get": customMetric,
  };
}

/** Every path answering "nothing yet": the "empty" state of each widget. */
export function emptyResponses(): Record<string, FakeResponse> {
  const emptyRibbon: RibbonResponse = { rows: [], conversions: [], milestones: [], chapters: [], kickoff: TODAY, today: TODAY };
  return {
    "department.list": [],
    "journey.ribbon": emptyRibbon,
    "product.roadmap.list": { items: [], dependencies: [] },
    "finance.overview": { ...finance, cash: { ...finance.cash, accounts: 0, amountMinor: 0 }, revenue: { ...finance.revenue, monthly: [] }, forecasts: {}, runway: { months: null, label: "Estimate", warnings: [], blocksContinue: false } },
    "dev.tasks.list": { items: [], nextCursor: null },
    "dev.sessions.list": { items: [], nextCursor: null },
    "inbox.list": { items: [], nextCursor: null, counts: {}, blocking: 0 },
    "distribution.channels.list": { channels: [], lines: { attack: [], midfield: [], defence: [], wings: [] }, blended: { spendMinor: 0, impressions: 0, leads: 0, signups: 0, activations: 0, customers: 0, days: 0 } },
    "distribution.channels.metrics": [],
    "legal.compliance.list": { events: [], deadlines: [], filings: [] },
    "team.agents.list": [],
    "live.leaderboards.list": [],
    "live.leaderboards.entries": [],
    "live.leaderboards.positions": [],
    "live.communities.list": [],
    "live.communities.posts": { items: [], nextCursor: null },
    "dashboard.customMetric.get": { value: null },
  };
}
