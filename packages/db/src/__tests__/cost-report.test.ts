/** costReportRepo (WP-02 T11): a7 Appendix B queries on a PGlite fixture with a real and a demo project. */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COST_QUERIES, costReportRepo, renderCostQuery, type CostReport } from "../repos/cost-report";
import * as s from "../schema";
import { createTestDb, type TestHarness } from "../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "./rls/fixtures";

let h: TestHarness;
let real: BusinessFixture;
let demo: BusinessFixture;
let blockedSessionId: string;
let report: CostReport;

const created = new Date("2026-11-02T10:00:00Z");
const at = (hours: number) => new Date(created.getTime() + hours * 3_600_000);
const thisMonth = new Date().toISOString().slice(0, 7);

async function seed(b: BusinessFixture, isDemo: boolean): Promise<string> {
  const db = h.db;
  await db.update(s.businesses).set({ createdAt: created, isDemo }).where(eq(s.businesses.id, b.businessId));
  const [session] = await db
    .insert(s.agentSessions)
    .values({ businessId: b.businessId, agentId: b.agentId, modelKey: "opus", startedAt: at(1), endedAt: at(2), tokensIn: 5000, tokensOut: 800, costMinor: 37, outcome: "blocked" })
    .returning({ id: s.agentSessions.id });
  const sessionId = session!.id;
  await db.insert(s.usageLedger).values([
    // Foundations, exact micro cost: $0.012345 (1,234,500 millionths of a cent).
    { businessId: b.businessId, agentId: b.agentId, kind: "tokens", modelKey: "haiku", quantity: 1000, costMinor: 1, costMicroMinor: 1_234_500, occurredAt: at(1), details: { route: "foundations", model: "haiku" } },
    // Pre-0039 row: no micro cost, counted as cost_minor × 1,000,000 ($0.25).
    { businessId: b.businessId, agentId: b.agentId, kind: "tokens", modelKey: "sonnet", quantity: 2000, costMinor: 25, costMicroMinor: null, occurredAt: at(3), details: { route: "inboxComposer", model: "sonnet" } },
    // The blocked session's model cost: $0.37, from the Agent SDK, no route.
    { businessId: b.businessId, agentId: b.agentId, sessionId, kind: "tokens", modelKey: "opus", quantity: 5800, costMinor: 37, costMicroMinor: 37_000_000, occurredAt: at(2), details: { source: "claude-agent-sdk", model: "opus" } },
    // Sandbox time on day two: $0.10, outside the first 24 hours.
    { businessId: b.businessId, kind: "sandbox", quantity: 60, unit: "seconds", costMinor: 10, costMicroMinor: 10_000_000, occurredAt: at(30), details: {} },
  ]);
  await db.insert(s.events).values({
    businessId: b.businessId,
    type: "task.blocked",
    occurredAt: at(2),
    actor: { kind: "agent", id: b.agentId },
    payload: { taskId: b.taskId, kind: "build", title: "Ship it", assigneeAgentId: b.agentId, sessionId, reason: "credential", detail: "No key.", approvalId: null, occurrence: 1 },
    idempotencyKey: `task.blocked:${sessionId}`,
  });
  await db.insert(s.trainingRuns).values({ businessId: b.businessId, agentId: b.agentId, status: "done", costMinor: 1278, createdAt: at(5) });
  await db.insert(s.creditBalances).values({ businessId: b.businessId, period: thisMonth, grantedMinor: 500, spentMinor: 480, balanceMinor: 20 }).onConflictDoUpdate({
    target: [s.creditBalances.businessId, s.creditBalances.period],
    set: { grantedMinor: 500, spentMinor: 480, balanceMinor: 20 },
  });
  return sessionId;
}

beforeAll(async () => {
  h = await createTestDb();
  real = await createBusinessFixture(h, "cost-real");
  demo = await createBusinessFixture(h, "cost-demo");
  blockedSessionId = await seed(real, false);
  await seed(demo, true);
  report = await costReportRepo.run(h.db);
});
afterAll(() => h?.close());

describe("costReportRepo.run", () => {
  it("prices routes exactly, counting pre-0039 rows at cost_minor, and leaves the demo project out", () => {
    const byRoute = Object.fromEntries(report.byRoute.map((r) => [r.route, r]));
    expect(Object.keys(byRoute).sort()).toEqual(["foundations", "inboxComposer"]);
    expect(byRoute.foundations).toMatchObject({ model: "haiku", billedTo: "credits", calls: 1, tokens: 1000, usd: 0.0123 });
    expect(byRoute.inboxComposer).toMatchObject({ calls: 1, tokens: 2000, usd: 0.25 });
  });

  it("reports sessions by model and outcome", () => {
    expect(report.sessionsByModelAndOutcome).toEqual([{ modelKey: "opus", outcome: "blocked", sessions: 1, avgTokensIn: 5000, avgTokensOut: 800, avgUsd: 0.37, usd: 0.37 }]);
  });

  it("splits the first day by what it paid for, with the median and p90 across projects", () => {
    expect(report.firstDayPerProject.rows).toHaveLength(1);
    expect(report.firstDayPerProject.rows[0]).toMatchObject({ businessId: real.businessId, usd: 0.632, foundations: 0.012, sessions: 0.37, notesAndReplies: 0.25 });
    expect(report.firstDayPerProject.projects).toBe(1);
    expect(report.firstDayPerProject.median.total).toBe(0.632);
    expect(report.firstDayPerProject.p90.sessions).toBe(0.37);
  });

  it("totals project-weeks to the cent, with who paid", () => {
    const total = report.projectWeeks.rows.reduce((sum, r) => sum + r.usd, 0);
    expect(Math.round(total * 100) / 100).toBe(0.73);
    expect(report.projectWeeks.rows.every((r) => r.businessId === real.businessId && r.billedTo === "credits")).toBe(true);
    expect(report.projectWeeks.distribution).toMatchObject({ projectWeeks: 1, projects: 1, p50: 0.732, p90: 0.732, max: 0.732 });
  });

  it("groups model cost by agent family", () => {
    const usd = report.byAgentFamily.reduce((sum, r) => sum + r.usd, 0);
    expect(Math.round(usd * 1000) / 1000).toBe(0.632);
    expect(report.byAgentFamily.reduce((n, r) => n + r.sessions, 0)).toBe(1);
  });

  it("reads the blocked reason from the task.blocked event keyed by session", () => {
    expect(report.blockedSessions).toEqual([{ modelKey: "opus", reason: "credential", sessions: 1, usd: 0.37 }]);
    expect(blockedSessionId).toBeTruthy();
  });

  it("reports training runs and this month's credits for real projects only", () => {
    expect(report.trainingRuns).toEqual([{ status: "done", runs: 1, avgUsd: 12.78, maxUsd: 12.78 }]);
    expect(report.creditsThisMonth.map((c) => c.businessId)).toEqual([real.businessId]);
    expect(report.creditsThisMonth[0]).toMatchObject({ period: thisMonth, grantedMinor: 500, spentMinor: 480, balanceMinor: 20, planTier: "free", modelBilling: "credits" });
  });

  it("always lists what is not measured", () => {
    expect(report.notMeasured).toEqual([
      "Model calls before a project exists (ideas, compare, logo) are not in the ledger (A7-02)",
      "The gateway's reader and web search are not booked (A7-03)",
    ]);
  });

  it("applies the date range", async () => {
    const later = await costReportRepo.run(h.db, { from: at(24) });
    expect(later.byRoute).toEqual([]);
    expect(later.projectWeeks.rows.reduce((sum, r) => sum + r.usd, 0)).toBe(0.1);
    expect(later.firstDayPerProject.rows).toEqual([]);
    expect(later.sessionsByModelAndOutcome).toEqual([]);
    expect(later.notMeasured).toHaveLength(2);
  });

  it("reads in a read-only transaction, so Postgres refuses any write", () => {
    expect(report.readOnly).toBe(true);
    for (const q of COST_QUERIES) expect(q.text).toMatch(/^(select|with)\b/);
  });

  it("prints the SQL that runs, every query excluding demo projects", () => {
    expect(COST_QUERIES.map((q) => q.name)).toEqual(["projects", "byRoute", "sessionsByModelAndOutcome", "firstDayPerProject", "projectWeeks", "projectWeekDistribution", "byAgentFamily", "blockedSessions", "trainingRuns", "creditsThisMonth"]);
    for (const q of COST_QUERIES) expect(q.text).toMatch(/is_demo = false/);
    const text = renderCostQuery(COST_QUERIES.find((q) => q.name === "byRoute")!, { from: new Date("2026-11-01T00:00:00Z") });
    expect(text).toContain("u.occurred_at >= '2026-11-01T00:00:00.000Z'::timestamptz");
    expect(text).not.toContain("{range");
  });
});
