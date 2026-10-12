/**
 * Business scoping under the service role: every business-scoped list/get in `repos` is called for business A
 * on a service connection (bypasses RLS) and must return only A's rows, even though B has rows in every table.
 * RLS covers user connections; this suite covers the repositories' own `business_id = $1` predicates.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbTx } from "../../client";
import { repos } from "../../repos";
import { day, setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("scope");
  // Rows in every area for both businesses so an unscoped query would leak.
  for (const f of [r.A, r.B]) {
    const bid = f.businessId;
    await repos.inbox.createItem(r.db, bid, { type: "update", from_agent_id: f.agentId, subject: "note", body_md: "body" });
    await repos.plans.create(r.db, bid, { origin: "option", actions: [{ type: "reply_only" }] });
    await repos.channels.upsert(r.db, bid, { channelKey: "seo", line: "defence" });
    await repos.channels.upsertMetric(r.db, bid, { channelId: f.channelId, day: "2026-10-01", spendMinor: 100 });
    await repos.campaigns.createAsset(r.db, bid, { campaignId: f.campaignId, kind: "post" });
    const v = await repos.journeys.upsertVisitor(r.db, bid, { anonId: "anon" });
    await repos.journeys.recordTouch(r.db, bid, { visitorId: v.id, channelKey: "seo" });
    await repos.journeys.create(r.db, bid, { conversionId: f.conversionIds[2]!, matchdayLevel: "friendly" });
    await repos.journeys.createMilestone(r.db, bid, { kind: "launch", label: "Live" });
    await repos.entities.addRole(r.db, bid, f.entityId, { role: "customer" });
    await repos.entities.addNote(r.db, bid, f.entityId, "note");
    await repos.finance.upsertTransactions(r.db, bid, [{ accountId: f.accountId, bookedAt: day("2026-10-01"), amountMinor: -500 }]);
    await repos.finance.upsertSnapshot(r.db, bid, { period: "2026-09", pnl: {} });
    await repos.finance.createForecast(r.db, bid, { scenario: "base" });
    await repos.capTable.createEntry(r.db, bid, { holderEntityId: f.entityId, securityId: f.securityId, quantity: 10 });
    await repos.usage.record(r.db, bid, { kind: "tokens", costMinor: 1 });
    await repos.usage.grantCredits(r.db, bid, "2026-10", 10);
    await repos.legal.createFiling(r.db, bid, { kind: "vat" });
    await repos.legal.createContract(r.db, bid, { kind: "nda" });
    await repos.legal.createCompliance(r.db, bid, { kind: "agm", dueAt: day("2026-12-01") });
    await repos.legal.startIncorporation(r.db, bid, { route: "kit" });
    await repos.integrations.createWebhook(r.db, bid, { integrationId: f.integrationId, connectorKey: "stripe", endpointPath: "/w" });
    await repos.policies.create(r.db, bid, { scope: "business", cedarText: "permit(principal, action, resource);" });
    await repos.approvals.create(r.db, bid, { agentId: f.agentId, tool: "x" });
    await repos.audit.append(r.db, bid, { actorKind: "system", action: "seed" });
    await repos.events.write(r.db, bid, { type: "cycle.started", actor: { kind: "system", id: "test" } });
    await repos.playbooks.create(r.db, bid, { sourceText: "do a thing" });
    await repos.holidays.start(r.db, bid, { untilAt: day("2027-01-01") });
    await repos.skills.createCustomDefinition(r.db, bid, { agentType: "engineer", skillKey: "scoped_skill", name: "S", group: "craft" });
    await repos.training.create(r.db, bid, { agentId: f.agentId });
    await repos.dashboards.create(r.db, bid, { userId: f.ownerId });
    await repos.screens.upsert(r.db, bid, { departmentId: f.departmentId, tabSlug: "overview", title: "Overview" });
  }
});
afterAll(() => r?.close());

type Rows = { businessId: string }[] | { items: { businessId: string }[] };
const rowsOf = (res: Rows) => (Array.isArray(res) ? res : res.items);

const CASES: [string, (tx: DbTx, bid: string) => Promise<Rows>][] = [
  ["memberships.list", (tx, b) => repos.memberships.list(tx, b)],
  ["departments.list", (tx, b) => repos.departments.list(tx, b)],
  ["screens.list", (tx, b) => repos.screens.list(tx, b, r.A.departmentId)],
  ["dashboards.list", (tx, b) => repos.dashboards.list(tx, b, r.A.ownerId)],
  ["agents.list", (tx, b) => repos.agents.list(tx, b)],
  ["agents.listSessions", (tx, b) => repos.agents.listSessions(tx, b)],
  ["skills.listDefinitions", (tx, b) => repos.skills.listDefinitions(tx, b).then((rows) => rows.filter((d) => d.custom) as { businessId: string }[])],
  ["training.list", (tx, b) => repos.training.list(tx, b)],
  ["tasks.list", (tx, b) => repos.tasks.list(tx, b)],
  ["tasks.graph", (tx, b) => repos.tasks.graph(tx, b).then((g) => g.tasks)],
  ["playbooks.list", (tx, b) => repos.playbooks.list(tx, b)],
  ["holidays.list", (tx, b) => repos.holidays.list(tx, b)],
  ["inbox.list", (tx, b) => repos.inbox.list(tx, b)],
  ["plans.list", (tx, b) => repos.plans.list(tx, b)],
  ["channels.list", (tx, b) => repos.channels.list(tx, b)],
  ["channels.metricsRange", (tx, b) => repos.channels.metricsRange(tx, b)],
  ["campaigns.list", (tx, b) => repos.campaigns.list(tx, b)],
  ["campaigns.listAssets", (tx, b) => repos.campaigns.listAssets(tx, b)],
  ["journeys.listTouches", (tx, b) => repos.journeys.listTouches(tx, b)],
  ["journeys.listConversions", (tx, b) => repos.journeys.listConversions(tx, b)],
  ["journeys.list", (tx, b) => repos.journeys.list(tx, b)],
  ["journeys.listMilestones", (tx, b) => repos.journeys.listMilestones(tx, b)],
  ["entities.list", (tx, b) => repos.entities.list(tx, b)],
  ["entities.search", (tx, b) => repos.entities.search(tx, b, { q: "Ada" }).then((s) => s.hits.map((h) => h.entity))],
  ["entities.listByRole", (tx, b) => repos.entities.listByRole(tx, b, "customer")],
  ["entities.listInteractions", (tx, b) => repos.entities.listInteractions(tx, b)],
  ["finance.listAccounts", (tx, b) => repos.finance.listAccounts(tx, b)],
  ["finance.listTransactions", (tx, b) => repos.finance.listTransactions(tx, b)],
  ["finance.listSnapshots", (tx, b) => repos.finance.listSnapshots(tx, b)],
  ["finance.listForecasts", (tx, b) => repos.finance.listForecasts(tx, b)],
  ["capTable.listSecurities", (tx, b) => repos.capTable.listSecurities(tx, b)],
  ["capTable.listEntries", (tx, b) => repos.capTable.listEntries(tx, b)],
  ["usage.list", (tx, b) => repos.usage.list(tx, b)],
  ["usage.listCreditBalances", (tx, b) => repos.usage.listCreditBalances(tx, b)],
  ["legal.listEntities", (tx, b) => repos.legal.listEntities(tx, b)],
  ["legal.listIncorporations", (tx, b) => repos.legal.listIncorporations(tx, b)],
  ["legal.listFilings", (tx, b) => repos.legal.listFilings(tx, b)],
  ["legal.listContracts", (tx, b) => repos.legal.listContracts(tx, b)],
  ["legal.listCompliance", (tx, b) => repos.legal.listCompliance(tx, b)],
  ["integrations.list", (tx, b) => repos.integrations.list(tx, b)],
  ["integrations.listWebhooks", (tx, b) => repos.integrations.listWebhooks(tx, b)],
  ["credentials.listMetadata", (tx, b) => repos.credentials.listMetadata(tx, b)],
  ["policies.list", (tx, b) => repos.policies.list(tx, b)],
  ["approvals.list", (tx, b) => repos.approvals.list(tx, b)],
  ["audit.list", (tx, b) => repos.audit.list(tx, b)],
  ["events.list", (tx, b) => repos.events.list(tx, b)],
  ["events.unnarrated", (tx, b) => repos.events.unnarrated(tx, b)],
  ["events.outboxPending", (tx, b) => repos.events.outboxPending(tx, b)],
];

describe("service-role calls are scoped by the repository", () => {
  it.each(CASES)("%s returns only business A's rows and is non-empty", async (_name, fn) => {
    const rows = rowsOf(await r.svc((tx) => fn(tx, r.A.businessId)));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.businessId === r.A.businessId)).toBe(true);
    const other = rowsOf(await r.svc((tx) => fn(tx, r.B.businessId)));
    expect(other.every((row) => row.businessId === r.B.businessId)).toBe(true);
  });

  it("gets by id refuse another business's id even for the service role", async () => {
    await expect(r.svc((tx) => repos.agents.get(tx, r.A.businessId, r.B.agentId))).rejects.toThrow(/not found/);
    await expect(r.svc((tx) => repos.tasks.get(tx, r.A.businessId, r.B.taskId))).rejects.toThrow(/not found/);
    await expect(r.svc((tx) => repos.inbox.get(tx, r.A.businessId, r.B.inboxItemId))).rejects.toThrow(/not found/);
    await expect(r.svc((tx) => repos.entities.get(tx, r.A.businessId, r.B.entityId))).rejects.toThrow(/not found/);
    await expect(r.svc((tx) => repos.finance.getAccount(tx, r.A.businessId, r.B.accountId))).rejects.toThrow(/not found/);
    await expect(r.svc((tx) => repos.legal.getEntity(tx, r.A.businessId, r.B.legalEntityId))).rejects.toThrow(/not found/);
    await expect(r.svc((tx) => repos.integrations.get(tx, r.A.businessId, r.B.integrationId))).rejects.toThrow(/not found/);
    await expect(r.svc((tx) => repos.credentials.load(tx, r.A.businessId, r.B.credentialId))).rejects.toThrow(/not found/);
    await expect(r.svc((tx) => repos.plans.get(tx, r.A.businessId, r.B.planId))).rejects.toThrow(/not found/);
    await expect(r.svc((tx) => repos.channels.get(tx, r.A.businessId, r.B.channelId))).rejects.toThrow(/not found/);
    await expect(r.svc((tx) => repos.journeys.getConversion(tx, r.A.businessId, r.B.conversionIds[0]!))).rejects.toThrow(/not found/);
    await expect(r.svc((tx) => repos.events.get(tx, r.A.businessId, r.B.eventIds[0]!))).rejects.toThrow(/not found/);
  });

  it("writes that name another business's child rows are refused", async () => {
    await expect(r.svc((tx) => repos.tasks.update(tx, r.A.businessId, r.B.taskId, { title: "hijack" }))).rejects.toThrow(/not found/);
    await expect(r.svc((tx) => repos.agents.setStatus(tx, r.A.businessId, r.B.agentId, "paused"))).rejects.toThrow(/not found/);
    await expect(r.svc((tx) => repos.inbox.archive(tx, r.A.businessId, r.B.inboxItemId))).rejects.toThrow(/not found/);
    await expect(r.svc((tx) => repos.channels.setEnabled(tx, r.A.businessId, r.B.channelId, true))).rejects.toThrow(/not found/);
    await expect(r.svc((tx) => repos.finance.recategorise(tx, r.A.businessId, r.B.accountId, "x"))).rejects.toThrow(/not found/);
    expect(await r.svc((tx) => repos.events.markNarrated(tx, r.A.businessId, r.B.eventIds))).toBe(0);
    // The composer's sweep of rows it never narrates stays inside the business it was called for.
    const bPending = (await r.svc((tx) => repos.events.unnarrated(tx, r.B.businessId, 500))).length;
    expect(bPending).toBeGreaterThan(0);
    expect(await r.svc((tx) => repos.events.markUnnarratable(tx, r.A.businessId, []))).toBeGreaterThan(0);
    expect(await r.svc((tx) => repos.events.unnarrated(tx, r.B.businessId, 500))).toHaveLength(bPending);
    expect(await r.svc((tx) => repos.inbox.bufferMarkServed(tx, r.A.businessId, { candidate: { type: "update", from_agent_id: r.A.agentId, subject: "s", body_md: "b" }, sourceHash: "decision:scoped", priority: 100 }))).toMatchObject({ businessId: r.A.businessId });
    expect((await r.svc((tx) => repos.inbox.bufferServed(tx, r.B.businessId, ["decision:scoped"]))).size).toBe(0);
  });
});
