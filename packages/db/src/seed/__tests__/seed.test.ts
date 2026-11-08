/**
 * The demo seed on PGlite (BUILD §17.2): two businesses, departments per archetype (renamed for Northwind),
 * two years of journey_daily rows, inbox items of every type with valid entity links, LIVE extras for Ledgerly,
 * RLS (the demo owner sees both businesses, a stranger none) and idempotent, deterministic re-runs.
 */
import { CHANNEL_KEYS, INBOX_ITEM_TYPES, VestingSchedule, pickPersonaKeys, readVesting } from "@foundmill/shared";
import { projectForecast, type ForecastDrivers } from "@foundmill/shared/forecast";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// Not a declared dependency of @foundmill/db (docs/NEEDED_DEPS.md); the validator is pure so the source import is safe.
import { buildManifest, validateMarkup, type ManifestEntityInput } from "../../../../entity-linker/src/index";
import type { Db } from "../../client";
import { repos } from "../../repos";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { startedBefore } from "../context";
import { BOOTSTRAPPED_COMMUNITY_SLUG, deleteDemoBusinesses, demoSeedState, LEDGERLY_BUSINESS_ID, LEDGERLY_COMMUNITY_SLUG, NORTHWIND_BUSINESS_ID, SEED_COMMUNITY_SLUGS, seedDemo, type SeedDemoResult } from "../index";

const TODAY = new Date("2026-10-07T12:00:00.000Z");
const SEED_OPTS = { today: TODAY, days: 730, volumeScale: 0.3 };

let h: TestHarness;
let db: Db;
let result: SeedDemoResult;

beforeAll(async () => {
  h = await createTestDb();
  db = h.db as unknown as Db;
  result = await seedDemo(db, SEED_OPTS);
}, 600_000);

afterAll(async () => {
  await h?.close();
});

const count = async (table: { businessId: unknown }, businessId: string): Promise<number> => {
  const rows = await db.execute(sql`select count(*)::int as n from ${table as never} where business_id = ${businessId}::uuid`);
  return Number((rows as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0);
};

describe("seedDemo on PGlite", () => {
  it("creates exactly the two demo businesses with fixed ids and the demo owner", async () => {
    const all = await db.select().from(s.businesses);
    expect(all.map((b) => b.slug).sort()).toEqual(["ledgerly", "northwind-skincare"]);
    expect(result.businesses.northwind.id).toBe(NORTHWIND_BUSINESS_ID);
    expect(result.businesses.ledgerly.id).toBe(LEDGERLY_BUSINESS_ID);
    const northwind = all.find((b) => b.slug === "northwind-skincare")!;
    const ledgerly = all.find((b) => b.slug === "ledgerly")!;
    expect([northwind.gameMode, northwind.businessMode, northwind.archetype]).toEqual(["personal", "assisted", "dtc_physical"]);
    expect([ledgerly.gameMode, ledgerly.businessMode, ledgerly.archetype]).toEqual(["live", "automated", "b2b_saas"]);
    expect(northwind.committedAt).toBeInstanceOf(Date);
    expect(await repos.founders.get(db, result.owner.userId)).not.toBeNull();
  });

  it("gives every demo agent a persona key, unique in its business, in the business's own seeded order (0067)", async () => {
    for (const bid of [NORTHWIND_BUSINESS_ID, LEDGERLY_BUSINESS_ID]) {
      const agents = await db.select({ k: s.agents.personaKey }).from(s.agents).where(eq(s.agents.businessId, bid)).orderBy(s.agents.createdAt, s.agents.id);
      expect(agents.length).toBeGreaterThan(0);
      const keys = agents.map((a) => a.k);
      expect(new Set(keys).size).toBe(keys.length);
      // Independent of the other demo business: the same keys whichever was seeded first.
      expect(new Set(keys)).toEqual(new Set(pickPersonaKeys(keys.length, { seed: bid })));
    }
  });

  it("builds the departments of each archetype, renamed for Northwind, each with its module tabs", async () => {
    const nw = await repos.departments.list(db, NORTHWIND_BUSINESS_ID);
    const lg = await repos.departments.list(db, LEDGERLY_BUSINESS_ID);
    expect(nw).toHaveLength(7);
    expect(lg).toHaveLength(6);
    expect(nw.map((d) => d.name)).toEqual(expect.arrayContaining(["Formulation Lab", "Retail Partnerships", "Product", "Development", "Finance", "Team", "Legal"]));
    expect(nw.find((d) => d.name === "Formulation Lab")?.slug).toBe("operations");
    for (const d of [...nw, ...lg]) {
      expect(d.leadAgentId).toBeTruthy();
      const screens = await repos.screens.list(db, d.businessId, d.id);
      // Operations runs on the development module but only needs its Specialists and Plan tabs (DB-11).
      expect(screens.length).toBeGreaterThanOrEqual(d.slug === "operations" ? 2 : 5);
      expect(screens.every((sc) => (sc.layout.widgets[0] as { key: string }).key.startsWith("module:"))).toBe(true);
    }
    // The Formulation Lab does not duplicate Development's six tabs.
    const labScreens = await repos.screens.list(db, NORTHWIND_BUSINESS_ID, nw.find((d) => d.slug === "operations")!.id);
    expect(labScreens.map((s) => s.tabSlug)).toEqual(["specialists", "plan"]);
    // Formulation Lab holds the sourcing and formulation specialists.
    const lab = nw.find((d) => d.slug === "operations")!;
    const labAgents = await repos.agents.list(db, NORTHWIND_BUSINESS_ID, { departmentId: lab.id, limit: 50 });
    expect(labAgents.items.map((a) => a.agentType)).toEqual(expect.arrayContaining(["sourcing_manufacturing", "formulation_chemist"]));
  });

  it("hires every agent from a template with a live version and baseline skills", async () => {
    for (const businessId of [NORTHWIND_BUSINESS_ID, LEDGERLY_BUSINESS_ID]) {
      const agents = await repos.agents.list(db, businessId, { limit: 200 });
      expect(agents.items.length).toBeGreaterThan(20);
      for (const a of agents.items.slice(0, 8)) {
        expect(a.currentVersionId).toBeTruthy();
        const skills = await repos.skills.listForAgent(db, businessId, a.id);
        expect(skills.length).toBeGreaterThanOrEqual(10);
        expect(skills.every((k) => k.displayed >= 1 && k.displayed <= 20)).toBe(true);
      }
      expect(await repos.agents.chiefOfStaff(db, businessId)).not.toBeNull();
    }
    const statuses = await repos.agents.countByStatus(db, LEDGERLY_BUSINESS_ID);
    expect(statuses.injured).toBe(1);
  });

  it("writes two years of journey data: >= 700 journey_daily rows per business, journeys with weights, xC and commentary, milestones", async () => {
    for (const businessId of [NORTHWIND_BUSINESS_ID, LEDGERLY_BUSINESS_ID]) {
      const daily = await repos.journeys.dailyRange(db, businessId, {});
      expect(daily.length).toBeGreaterThanOrEqual(700);
      const days = new Set(daily.map((r) => r.day));
      expect(days.size).toBeGreaterThanOrEqual(700);
      expect(daily.some((r) => Number(r.agentHours) > 0)).toBe(true);
      expect(daily.some((r) => Number(r.revenueMinor) > 0)).toBe(true);
      const journeys = await repos.journeys.list(db, businessId, { limit: 20 });
      expect(journeys.items.length).toBeGreaterThan(0);
      for (const j of journeys.items.slice(0, 5)) {
        const sumWeights = Object.values(j.weights).reduce((a, b) => a + b, 0);
        expect(j.touchIds.length).toBeGreaterThan(0);
        expect(Math.abs(sumWeights - 1)).toBeLessThan(1e-6);
        expect(j.xcSeries.length).toBeGreaterThan(0);
        expect(j.commentary.length).toBeGreaterThanOrEqual(3);
        expect((j.commentary.at(-1) as { highlight: boolean }).highlight).toBe(true);
      }
      const milestones = await repos.journeys.listMilestones(db, businessId);
      expect(milestones.some((m) => (m.ref as { trophyKey?: string | null } | null)?.trophyKey === "customer_1")).toBe(true);
      expect(milestones.some((m) => m.kind === "launch")).toBe(true);
      expect(await count(s.touches, businessId)).toBeGreaterThan(1000);
      expect(await count(s.conversions, businessId)).toBeGreaterThan(300);
      expect(await count(s.channelMetrics, businessId)).toBeGreaterThan(500);
    }
    const customers = await repos.entities.list(db, NORTHWIND_BUSINESS_ID, { limit: 5 });
    expect(customers.items.length).toBe(5);
  });

  it("seeds inbox items of every type with valid [[ent:id|Name]] links", async () => {
    for (const businessId of [NORTHWIND_BUSINESS_ID, LEDGERLY_BUSINESS_ID]) {
      const items = (await repos.inbox.list(db, businessId, { limit: 50 })).items;
      const types = new Set(items.map((i) => i.type));
      for (const t of INBOX_ITEM_TYPES) expect(types.has(t), `${businessId} has a ${t} item`).toBe(true);
      const entities = await db.select({ id: s.entities.id, kind: s.entities.kind, displayName: s.entities.displayName, aliases: s.entities.aliases }).from(s.entities).where(eq(s.entities.businessId, businessId));
      // Agents are in the manifest by their own id too, as the Composer lists them: a server-written note (an approval)
      // names its agent as [[ent:<agent id>|<stored name>]] (One name everywhere, Nov 8, 2026).
      const agentRows = await db.select({ id: s.agents.id, name: s.agents.name }).from(s.agents).where(eq(s.agents.businessId, businessId));
      const agentIds = new Set(agentRows.map((a) => a.id));
      const manifest = buildManifest([...entities.map((e): ManifestEntityInput => ({ id: e.id, kind: e.kind, name: e.displayName, aliases: e.aliases })), ...agentRows.map((a): ManifestEntityInput => ({ id: a.id, kind: "agent", name: a.name, aliases: [] }))], { strictKinds: false });
      let mentions = 0;
      for (const item of items) {
        const v = validateMarkup(item.bodyMd, manifest);
        expect(v.valid, `${item.subject}: ${JSON.stringify(v.problems)}`).toBe(true);
        mentions += v.mentionCount;
        for (const id of v.entityIds) if (!agentIds.has(id)) expect(item.entityIds).toContain(id);
      }
      expect(mentions).toBeGreaterThan(5);
      const decision = items.find((i) => i.type === "decision" && i.state === "unread")!;
      expect((decision.decision as { options: unknown[] }).options.length).toBeGreaterThanOrEqual(2);
      const won = items.find((i) => i.type === "customer_won")!;
      expect(won.sourceEventIds.length).toBeGreaterThan(0);
    }
    // Since Nov 7, 2026 (0071) only a hard stop holds Continue, in the demo as in a real business (audit OL-32): the
    // open decision and the open win wait in the Inbox while the team works.
    expect(await repos.inbox.countBlocking(db, NORTHWIND_BUSINESS_ID)).toBe(0);
    for (const id of [NORTHWIND_BUSINESS_ID, LEDGERLY_BUSINESS_ID]) {
      const open = (await repos.inbox.list(db, id, { limit: 100 })).items.filter((i) => (i.type === "decision" || i.type === "customer_won") && (i.state === "unread" || i.state === "read"));
      expect(open.length).toBeGreaterThan(0);
      for (const i of open) expect(i.blocksContinue, `${i.type}: ${i.subject}`).toBe(false);
    }
  });

  it("counts a lead for every lead record: the Leads tab lists the leads who have not paid (audit GTM-02)", async () => {
    for (const businessId of [LEDGERLY_BUSINESS_ID, NORTHWIND_BUSINESS_ID]) {
      const counted = (await repos.channels.metricsSummary(db, businessId, { from: "2000-01-01", to: "2100-01-01" })).channels.reduce((n, c) => n + c.leads, 0);
      const records = Number(
        ((await db.execute(sql`select count(*)::int as n from entity_roles where business_id = ${businessId}::uuid and role = 'lead'`)) as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0,
      );
      expect(records).toBe(counted);
      const open = await repos.entities.listByRole(db, businessId, "lead", { limit: 500 });
      // Open leads are the ones who never paid; a lead who paid became a customer and its lead role ended then.
      for (const lead of open.items) expect(lead.role.stage).toBe("qualified");
      if (records > 0) expect(open.items.length).toBeGreaterThan(0);
    }
  });

  it("fills the modules: channels, campaigns, spec, roadmap, tasks with sessions, finance, legal, integrations, dashboards", async () => {
    const nwChannels = await repos.channels.list(db, NORTHWIND_BUSINESS_ID);
    expect(nwChannels).toHaveLength(CHANNEL_KEYS.length);
    expect(nwChannels.filter((c) => c.enabled).map((c) => c.channelKey).sort()).toEqual(["email_automation", "influencer", "paid_ads", "social"]);
    const lgChannels = await repos.channels.list(db, LEDGERLY_BUSINESS_ID);
    expect(lgChannels.filter((c) => c.enabled)).toHaveLength(7);
    expect(lgChannels.filter((c) => c.kitMode).length).toBeGreaterThanOrEqual(3);
    expect((await repos.campaigns.list(db, LEDGERLY_BUSINESS_ID, { limit: 50 })).items.length).toBeGreaterThan(5);

    const blocks = await repos.product.listBlocks(db, NORTHWIND_BUSINESS_ID);
    expect(blocks.map((b) => b.section)).toEqual(expect.arrayContaining(["Formulation / BOM", "Manufacturing", "Packaging", "Compliance", "Fulfillment"]));
    expect((await repos.product.listRoadmap(db, LEDGERLY_BUSINESS_ID)).length).toBe(8);

    // AC-11.5.2 needs one open proposal with three hunks and an interview source behind it (e2e/tests/golden-path.spec.ts).
    const nwSources = await repos.product.listSources(db, NORTHWIND_BUSINESS_ID, { limit: 50 });
    expect(nwSources.items.length).toBe(result.businesses.northwind.counts.sources);
    const interview = nwSources.items.find((x) => x.kind === "transcript")!;
    expect(interview).toBeTruthy();
    const proposals = await repos.product.listProposals(db, NORTHWIND_BUSINESS_ID, { limit: 50 });
    expect(proposals.items.length).toBe(result.businesses.northwind.counts.proposals);
    expect(proposals.items).toHaveLength(1);
    const proposal = await repos.product.getProposal(db, NORTHWIND_BUSINESS_ID, proposals.items[0]!.id);
    expect(proposal.status).toBe("open");
    expect(proposal.evidence).toEqual([interview.id]);
    expect(proposal.hunks).toHaveLength(3);
    expect(result.businesses.northwind.counts.proposalHunks).toBe(3);
    expect(proposal.hunks.map((h) => h.position)).toEqual([0, 1, 2]);
    for (const h of proposal.hunks) {
      expect(h.decision).toBe("pending");
      expect(h.roadmapItemId).toBeNull();
      const block = blocks.find((b) => b.id === h.specBlockId)!;
      expect(block, `hunk ${h.position} targets a Northwind spec block`).toBeTruthy();
      // base and ours are the block as it stands; theirs differs, so the three-way diff has something to show.
      expect(h.base).toEqual(block.content);
      expect(h.ours).toEqual(block.content);
      expect(h.theirs).not.toEqual(block.content);
    }
    expect(new Set(proposal.hunks.map((h) => h.specBlockId)).size).toBe(3);
    expect(await repos.product.listProposals(db, LEDGERLY_BUSINESS_ID, { limit: 50 })).toMatchObject({ items: [] });

    // Seeded sources read as the Source Watcher writes them (summary, linked blocks of the business, topics), so the
    // Sources table and Research coverage are filled (packages/modules product/sources/kinds.ts).
    for (const businessId of [NORTHWIND_BUSINESS_ID, LEDGERLY_BUSINESS_ID]) {
      const blockIds = new Set((await repos.product.listBlocks(db, businessId)).map((b) => b.id));
      for (const src of (await repos.product.listSources(db, businessId, { limit: 50 })).items) {
        const rel = src.relevance as { summary?: unknown; blocks?: { blockId: string; score: number }[]; topics?: unknown[] };
        expect(typeof rel.summary, src.title).toBe("string");
        expect(rel.blocks?.length, src.title).toBeGreaterThan(0);
        for (const b of rel.blocks!) expect(blockIds.has(b.blockId), `${src.title} links a block of its business`).toBe(true);
        expect(rel.topics?.length, src.title).toBeGreaterThan(0);
      }
    }

    const tasks = await repos.tasks.list(db, LEDGERLY_BUSINESS_ID, { limit: 500 });
    const statuses = new Set(tasks.items.map((t) => t.status));
    for (const st of ["running", "review", "blocked", "merging", "done", "ready", "planned", "stopped"]) expect(statuses.has(st as never), `task status ${st}`).toBe(true);
    const recorded = await db.select({ n: sql<number>`count(*)::int` }).from(s.agentSessions).where(sql`${s.agentSessions.businessId} = ${LEDGERLY_BUSINESS_ID}::uuid and ${s.agentSessions.recordingRef} is not null`);
    expect(Number(recorded[0]?.n)).toBeGreaterThanOrEqual(5);
    const open = await repos.agents.listSessions(db, LEDGERLY_BUSINESS_ID, { openOnly: true });
    expect(open.items.length).toBeGreaterThan(0);

    for (const businessId of [NORTHWIND_BUSINESS_ID, LEDGERLY_BUSINESS_ID]) {
      const accounts = await repos.finance.listAccounts(db, businessId);
      expect(accounts).toHaveLength(1);
      expect(accounts[0]!.balanceMinor).toBeGreaterThan(0);
      expect(await count(s.transactions, businessId)).toBeGreaterThan(100);
      expect(Object.keys(await repos.finance.latestForecasts(db, businessId)).sort()).toEqual(["base", "downside", "upside"]);
      expect(await repos.legal.primaryEntity(db, businessId)).not.toBeNull();
      expect((await repos.legal.listCompliance(db, businessId)).length).toBeGreaterThanOrEqual(3);
      const integrations = await repos.integrations.list(db, businessId);
      expect(integrations.length).toBeGreaterThanOrEqual(4);
      expect(integrations.every((i) => i.status === "mock" || i.status === "degraded")).toBe(true);
      const dashboard = await repos.dashboards.active(db, businessId, result.owner.userId);
      expect(dashboard?.preset).toBe("founder");
      // Ribbon, status strip, team pulse, inbox and the first-week checklist (docs/UX_AUDIT_AND_PLAN.md §6.2), plus a
      // department card for each visible department.
      const departments = await repos.departments.list(db, businessId);
      expect(dashboard?.layout.widgets.filter((w) => (w as { key: string }).key === "department_card")).toHaveLength(departments.length);
      expect(dashboard?.layout.widgets.filter((w) => (w as { key: string }).key === "first_week_checklist")).toHaveLength(1);
      expect(dashboard?.layout.widgets.length).toBe(departments.length + 5);
      expect(await count(s.usageLedger, businessId)).toBeGreaterThan(0);
    }
    const nwLegal = (await repos.legal.primaryEntity(db, NORTHWIND_BUSINESS_ID))!;
    expect([nwLegal.jurisdiction, nwLegal.entityType]).toEqual(["GB", "private_limited_company"]);
    const suppliers = await repos.entities.listByRole(db, NORTHWIND_BUSINESS_ID, "supplier");
    expect(suppliers.items.length).toBe(6);
    expect((await repos.entities.listRelationships(db, NORTHWIND_BUSINESS_ID, suppliers.items[0]!.id)).length).toBeGreaterThan(0);
    // The CRM list's "kind:organization role:supplier" (crm.entity.list): the same six, each with its role and stage.
    const listed = await repos.entities.listWithRoles(db, NORTHWIND_BUSINESS_ID, { kind: "organisation", role: "supplier", limit: 500 });
    expect(listed.items.map((e) => e.id).sort()).toEqual(suppliers.items.map((e) => e.id).sort());
    expect(listed.items.every((e) => e.roles.some((r) => r.role === "supplier" && !!r.stage && !!r.ownerRef))).toBe(true);
    // "customers": every active customer counts, not just the first page.
    const customerRoles = await db.execute(sql`select count(distinct r.entity_id)::int as n from entity_roles r join entities e on e.id = r.entity_id where r.business_id = ${NORTHWIND_BUSINESS_ID}::uuid and r.role = 'customer' and r.ended_at is null and e.archived_at is null and e.merged_into_id is null`);
    const customerCount = Number((customerRoles as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0);
    const customerPage = await repos.entities.listWithRoles(db, NORTHWIND_BUSINESS_ID, { role: "customer", limit: 5 });
    expect(customerCount).toBeGreaterThan(5);
    expect(customerPage.total).toBe(customerCount);
    expect(customerPage.items.every((e) => e.roles.some((r) => r.role === "customer"))).toBe(true);
  }, 600_000); // the role-filtered CRM page scans every seeded customer on PGlite (slow, not wrong)

  it("gives Ledgerly its LIVE extras: holiday, GitHub repo, Stripe payments, cap table with two SAFEs, community, leaderboard, training", async () => {
    // The vacation runs eleven days past the seed's own today, so "current" is read as of that day, not the real clock.
    const holiday = await repos.holidays.current(db, LEDGERLY_BUSINESS_ID, TODAY);
    expect(holiday).not.toBeNull();
    expect(holiday!.untilAt!.getTime()).toBeGreaterThan(TODAY.getTime());
    expect(holiday!.reportInboxItemId).toBeTruthy();
    expect(await repos.holidays.current(db, NORTHWIND_BUSINESS_ID, TODAY)).toBeNull();
    const github = await repos.integrations.getByKey(db, LEDGERLY_BUSINESS_ID, "github");
    expect((github?.settings as { repo?: string }).repo).toBe("foundmill-demo/ledgerly");
    const stripeEvents = await repos.events.list(db, LEDGERLY_BUSINESS_ID, { type: "payment.received" });
    expect(stripeEvents.items.every((e) => (e.payload as { provider?: string }).provider === "stripe")).toBe(true);
    expect(stripeEvents.items.length).toBeGreaterThan(0);
    const securities = await repos.capTable.listSecurities(db, LEDGERLY_BUSINESS_ID);
    expect(securities.map((x) => x.kind).sort()).toEqual(["common", "option", "safe", "safe"]);
    expect(securities.filter((x) => x.kind === "safe").every((x) => (x.terms as { postMoney?: boolean }).postMoney === true)).toBe(true);
    const summary = await repos.capTable.summary(db, LEDGERLY_BUSINESS_ID);
    expect(summary.byHolder.length).toBeGreaterThanOrEqual(5);
    const community = await repos.social.getCommunityBySlug(db, LEDGERLY_COMMUNITY_SLUG);
    expect(community?.ownerBusinessId).toBe(LEDGERLY_BUSINESS_ID);
    // Two posts in the feed (one with a reply), and a second public community nobody has joined yet.
    const feed = await repos.social.listPosts(db, community!.id);
    expect(feed.items).toHaveLength(2);
    expect((await repos.social.replyCounts(db, feed.items.map((p) => p.id))).size).toBe(1);
    expect(await repos.social.getCommunityBySlug(db, BOOTSTRAPPED_COMMUNITY_SLUG)).toMatchObject({ visibility: "public", memberCount: 0, ownerBusinessId: null });
    // Verified metrics only: Ledgerly is first on both of its boards.
    const positions = await repos.social.positionsForBusiness(db, LEDGERLY_BUSINESS_ID);
    expect(positions.map((p) => [p.board.boardKind, p.position]).sort()).toEqual([["customers_won", 1], ["growth", 1]]);
    expect(await repos.approvals.countPending(db, LEDGERLY_BUSINESS_ID)).toBe(1);
    const backend = (await repos.agents.list(db, LEDGERLY_BUSINESS_ID, { agentType: "backend_engineer" })).items[0]!;
    expect((await repos.agents.listVersions(db, LEDGERLY_BUSINESS_ID, backend.id)).length).toBe(2);
    expect((await repos.training.latestForAgent(db, LEDGERLY_BUSINESS_ID, backend.id))?.decision).toBe("promoted");
  });

  it("each business's billing tells one story: usage billed the way it pays for models, credits only for credits, no key connection without a key (BILL-05, DB-16)", async () => {
    for (const businessId of [NORTHWIND_BUSINESS_ID, LEDGERLY_BUSINESS_ID]) {
      const business = await repos.businesses.get(db, businessId);
      const usage = await db.select().from(s.usageLedger).where(eq(s.usageLedger.businessId, businessId));
      expect(usage.length).toBeGreaterThan(0);
      expect(new Set(usage.map((u) => u.billedTo))).toEqual(new Set([business.modelBilling]));
      const balances = await db.select().from(s.creditBalances).where(eq(s.creditBalances.businessId, businessId));
      expect(balances.length > 0).toBe(business.modelBilling === "credits");
      // A BYOK connection exists only with a stored credential behind it: the demo seeds none, so none runs on its own key.
      const anthropic = (await db.select().from(s.integrations).where(eq(s.integrations.businessId, businessId))).filter((i) => i.connectorKey === "anthropic");
      const keys = await db.select().from(s.credentials).where(eq(s.credentials.businessId, businessId));
      if (business.modelBilling === "byok" || anthropic.length > 0) expect(keys.length).toBeGreaterThan(0);
    }
    expect((await repos.businesses.get(db, LEDGERLY_BUSINESS_ID)).modelBilling).toBe("credits");
  });

  it("keeps the demo data consistent: nothing dated after the seed, CRM stages backed by wins, one record per email or domain, renewals as revenue (audit #159 #331)", async () => {
    // The `n` of a single-row `select count(*)::int as n ...`.
    const scalar = async (q: string): Promise<number> => Number(((await db.execute(sql.raw(q))) as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0);
    const now = TODAY.toISOString();
    for (const businessId of [NORTHWIND_BUSINESS_ID, LEDGERLY_BUSINESS_ID]) {
      // No touch, conversion or agent session is later than the instant the seed ran at.
      for (const [table, column] of [["touches", "occurred_at"], ["conversions", "occurred_at"], ["agent_sessions", "started_at"]] as const) {
        const n = await scalar(`select count(*)::int as n from ${table} where business_id = '${businessId}' and ${column} > '${now}'`);
        expect(n, `${table} after the seed in ${businessId}`).toBe(0);
      }
      // A customer or churned stage has a first payment; an activated one has an activation win.
      const noPayment = await scalar(`select count(*)::int as n from entity_roles r where r.business_id = '${businessId}' and r.role = 'customer' and r.stage in ('customer','churned') and exists (select 1 from conversions c where c.entity_id = r.entity_id and c.kind = 'signup') and not exists (select 1 from conversions c where c.entity_id = r.entity_id and c.kind = 'payment' and c.first_payment)`);
      expect(noPayment, `customer stages without a payment in ${businessId}`).toBe(0);
      const noActivation = await scalar(`select count(*)::int as n from entity_roles r where r.business_id = '${businessId}' and r.role = 'customer' and r.stage = 'activated' and exists (select 1 from conversions c where c.entity_id = r.entity_id and c.kind = 'signup') and not exists (select 1 from conversions c where c.entity_id = r.entity_id and c.kind = 'activation')`);
      expect(noActivation, `activated stages without an activation in ${businessId}`).toBe(0);
      // A strong identifier belongs to one live record.
      const sharedEmail = await scalar(`select count(*)::int as n from (select identifiers->>'email' as e from entities where business_id = '${businessId}' and identifiers ? 'email' and archived_at is null group by 1 having count(*) > 1) d`);
      expect(sharedEmail, `shared emails in ${businessId}`).toBe(0);
      const sharedDomain = await scalar(`select count(*)::int as n from (select identifiers->>'domain' as d from entities where business_id = '${businessId}' and identifiers ? 'domain' and archived_at is null group by 1 having count(*) > 1) d`);
      expect(sharedDomain, `shared domains in ${businessId}`).toBe(0);
    }
    // The subscription business's renewals are payments that are not new customers: its revenue is the records' revenue.
    const renewals = await scalar(`select count(*)::int as n from conversions where business_id = '${LEDGERLY_BUSINESS_ID}' and kind = 'payment' and not first_payment`);
    expect(renewals).toBeGreaterThan(0);
    // Northwind has no subscriptions: its "MRR" milestones are trailing 30-day revenue and say Estimate.
    const mrr = await db.select().from(s.milestones).where(eq(s.milestones.businessId, NORTHWIND_BUSINESS_ID));
    for (const m of mrr.filter((x) => String((x.ref as Record<string, unknown>)?.trophyKey ?? "").startsWith("mrr_"))) expect(m.ref).toMatchObject({ estimate: true });
  }, 120_000);

  it("keeps the demo cap table honest: SAFEs are not shares, the pool reserve is unissued, grants vest on a real schedule (#168, #169, #346, #170)", async () => {
    const securities = await repos.capTable.listSecurities(db, LEDGERLY_BUSINESS_ID);
    const entries = await repos.capTable.listEntries(db, LEDGERLY_BUSINESS_ID);
    const summary = await repos.capTable.summary(db, LEDGERLY_BUSINESS_ID);
    const options = securities.find((x) => x.kind === "option")!;
    // the 950,000 reserve is authorized but unissued; only the grant to a person is an issuance
    expect(Number(options.authorisedQuantity)).toBe(1_000_000);
    const optionEntries = entries.filter((e) => e.securityId === options.id);
    expect(optionEntries.map((e) => Number(e.quantity))).toEqual([50_000]);
    expect(entries.some((e) => e.holder.displayName.toLowerCase().includes("option pool"))).toBe(false);
    expect(summary.byClass.find((c) => c.securityId === options.id)).toMatchObject({ quantity: 50_000, authorisedQuantity: 1_000_000 });
    // SAFEs carry a principal, not shares: out of the fully diluted total and the percentages
    expect(summary.totalQuantity).toBe(8_050_000);
    expect(summary.byClass.filter((c) => c.convertible).every((c) => c.fullyDilutedPct === null)).toBe(true);
    expect(summary.byHolder.filter((h) => h.fullyDilutedPct !== null).reduce((n, h) => n + (h.fullyDilutedPct ?? 0), 0)).toBeGreaterThan(99.9);
    // prices are in the class's currency
    expect(entries.every((e) => e.currency === securities.find((x) => x.id === e.securityId)!.currency)).toBe(true);
    expect(entries.every((e) => e.currency === "GBP")).toBe(true);
    // vesting is the shared shape
    for (const e of entries.filter((x) => x.vesting)) expect(VestingSchedule.safeParse(e.vesting).success).toBe(true);
    const grant = optionEntries[0]!;
    expect(readVesting(grant.vesting as Record<string, unknown>, grant.issuedAt)).toMatchObject({ months: 48, cliffMonths: 12 });
    // nominal £0.0001 × 8,000,000 ordinary shares
    const legal = await repos.legal.primaryEntity(db, LEDGERLY_BUSINESS_ID);
    expect(legal!.shareCapitalMinor).toBe(80_000);
  });

  it("stores forecasts in the drivers contract, projected from this month by the function every screen uses (#173)", async () => {
    for (const businessId of [LEDGERLY_BUSINESS_ID, NORTHWIND_BUSINESS_ID]) {
      const forecasts = await repos.finance.listForecasts(db, businessId);
      expect(forecasts.map((f) => f.scenario).sort()).toEqual(["base", "downside", "upside"]);
      for (const f of forecasts) {
        const d = f.drivers as Record<string, number | null>;
        expect(d).not.toHaveProperty("monthlyOutflowMinor");
        expect(d).not.toHaveProperty("mrrMinorNow");
        expect(d.horizonMonths).toBe(24);
        expect(d.monthlyCostsMinor).toBeGreaterThan(0);
        const series = f.series as { month: string; cashMinor: number }[];
        expect(series).toHaveLength(24);
        expect(series[0]!.month).toBe("2026-10"); // this month, not next
        const projection = projectForecast(d as unknown as ForecastDrivers, "2026-10");
        expect(series.map((p) => p.cashMinor)).toEqual(projection.series.map((p) => p.cashMinor));
        expect(d.runway_months ?? null).toBe(projection.runwayMonths);
      }
    }
  });

  it("books the bank's revenue from the series the milestones and the Inbox's MRR come from, so Finance's MRR and the Inbox describe one business (#355)", async () => {
    const bankRows = await db.execute(sql`
      select to_char(date_trunc('month', t.booked_at), 'YYYY-MM') as month, sum(t.amount_minor)::bigint as bank
      from transactions t where t.business_id = ${LEDGERLY_BUSINESS_ID}::uuid and t.category = 'revenue' and t.amount_minor > 0 group by 1`);
    const bank = new Map((bankRows as unknown as { rows: { month: string; bank: string }[] }).rows.map((r) => [r.month, Number(r.bank)]));
    // Finance's MRR: the last three full months of revenue ÷ 3, gross of the processor's 2.9%
    const financeMrr = (["2026-07", "2026-08", "2026-09"].reduce((n, m) => n + (bank.get(m) ?? 0), 0) / 3) / 0.971;
    const notes = await db.execute(sql`select body_md from inbox_items where business_id = ${LEDGERLY_BUSINESS_ID}::uuid and body_md like '%MRR £%'`);
    const figures = (notes as unknown as { rows: { body_md: string }[] }).rows.map((r) => /MRR £([\d,]+(?:\.\d+)?)/.exec(r.body_md)?.[1]).filter((x): x is string => !!x).map((x) => Number(x.replace(/,/g, "")) * 100);
    expect(figures.length).toBeGreaterThan(0);
    for (const inbox of figures) {
      // the trailing three-month average of a growing MRR sits a little under today's MRR, never a fifth of it
      expect(financeMrr / inbox).toBeGreaterThan(0.6);
      expect(financeMrr / inbox).toBeLessThan(1.05);
    }
  });

  it("RLS: the demo owner sees both businesses and their journey_daily rows; a stranger sees none", async () => {
    const stranger = await h.createUser("stranger@test.local");
    const mine = await h.asUser(result.owner.userId).run((tx) => repos.businesses.listForUser(tx, result.owner.userId));
    expect(mine.map((b) => b.slug).sort()).toEqual(["ledgerly", "northwind-skincare"]);
    expect(mine.every((b) => b.role === "owner")).toBe(true);
    const theirs = await h.asUser(stranger).run((tx) => repos.businesses.listForUser(tx, stranger));
    expect(theirs).toHaveLength(0);
    const visible = await h.asUser(stranger).run((tx) => tx.select({ id: s.businesses.id }).from(s.businesses));
    expect(visible).toHaveLength(0);
    const ownerDaily = await h.asUser(result.owner.userId).execute<{ n: number }>(sql`select count(*)::int as n from journey_daily where business_id = ${NORTHWIND_BUSINESS_ID}::uuid`);
    expect(Number(ownerDaily[0]?.n)).toBeGreaterThanOrEqual(700);
    const strangerDaily = await h.asUser(stranger).execute<{ n: number }>(sql`select count(*)::int as n from journey_daily`);
    expect(Number(strangerDaily[0]?.n)).toBe(0);
    const ownerInbox = await h.asUser(result.owner.userId).run((tx) => repos.inbox.list(tx, LEDGERLY_BUSINESS_ID));
    expect(ownerInbox.items.length).toBeGreaterThan(5);
    const strangerInbox = await h.asUser(stranger).run((tx) => repos.inbox.list(tx, LEDGERLY_BUSINESS_ID));
    expect(strangerInbox.items).toHaveLength(0);
  });

  it("re-running is idempotent and deterministic: same ids, same owner, same conversions; SEED_OWNER_PROFILE=0 removes the demo owner's profile", async () => {
    const before = await db.select({ id: s.conversions.id, amountMinor: s.conversions.amountMinor }).from(s.conversions).where(eq(s.conversions.businessId, NORTHWIND_BUSINESS_ID)).orderBy(s.conversions.id);
    const beforeAgents = await count(s.agents, LEDGERLY_BUSINESS_ID);
    const beforeProposals = await count(s.changeProposals, NORTHWIND_BUSINESS_ID);
    expect(beforeProposals).toBe(1);
    expect(await repos.founders.get(db, result.owner.userId)).not.toBeNull();

    // Real founders use the public seed communities, and a real business keeps its own audit chain (#232).
    const fintech = (await repos.social.getCommunityBySlug(db, LEDGERLY_COMMUNITY_SLUG))!;
    const bootstrapped = (await repos.social.getCommunityBySlug(db, BOOTSTRAPPED_COMMUNITY_SLUG))!;
    const real = await h.createUser("real-founder@test.local");
    await repos.social.joinCommunity(db, real, bootstrapped.id);
    await repos.social.joinCommunity(db, real, fintech.id);
    const realPost = await repos.social.createPost(db, { communityId: bootstrapped.id, authorUserId: real, bodyMd: "We bootstrapped to our first 40 customers on founder-led sales." });
    const demoPost = (await repos.social.listPosts(db, fintech.id)).items.find((p) => p.authorUserId === result.owner.userId && /first-touch to outbound/.test(p.bodyMd))!;
    const realReply = await repos.social.createPost(db, { communityId: fintech.id, authorUserId: real, parentPostId: demoPost.id, bodyMd: "Same for us in the Nordics." });
    const [realBusiness] = await db.insert(s.businesses).values({ name: "Real Co", slug: "real-co", createdBy: real, archetype: "b2b_saas" }).returning({ id: s.businesses.id });
    await repos.audit.append(db, realBusiness!.id, { actorKind: "user", actorId: real, action: "business.create" });

    // ownerProfile: false (SEED_OWNER_PROFILE=0) leaves the demo owner without a profile, even one an earlier seed created.
    const again = await seedDemo(db, { ...SEED_OPTS, refreshDaily: false, ownerProfile: false });

    // The communities, the real founder's memberships, post and reply survive; the demo founder's posts are the same
    // rows again (re-attached to the rebuilt Ledgerly), not copies.
    expect((await repos.social.getCommunityBySlug(db, LEDGERLY_COMMUNITY_SLUG))?.id).toBe(fintech.id);
    expect((await repos.social.getCommunityBySlug(db, BOOTSTRAPPED_COMMUNITY_SLUG))).toMatchObject({ id: bootstrapped.id, memberCount: 1 });
    expect((await repos.social.getCommunityBySlug(db, LEDGERLY_COMMUNITY_SLUG))?.memberCount).toBe(2);
    expect(await repos.social.isMember(db, real, bootstrapped.id)).toBe(true);
    expect(await repos.social.isMember(db, real, fintech.id)).toBe(true);
    expect(await repos.social.isMember(db, again.owner.userId, fintech.id)).toBe(true);
    const survivors = await db.select({ id: s.posts.id }).from(s.posts).where(eq(s.posts.authorUserId, real));
    expect(survivors.map((p) => p.id).sort()).toEqual([realPost.id, realReply.id].sort());
    const demoPosts = await db.select({ id: s.posts.id, businessId: s.posts.businessId }).from(s.posts).where(eq(s.posts.authorUserId, again.owner.userId));
    expect(demoPosts).toHaveLength(3);
    expect(demoPosts.map((p) => p.id)).toContain(demoPost.id);
    expect(demoPosts.every((p) => p.businessId === LEDGERLY_BUSINESS_ID)).toBe(true);
    expect((await repos.audit.list(db, realBusiness!.id)).items.map((e) => e.action)).toEqual(["business.create"]);
    // The rebuild named each demo business to the audit trigger; it never disabled the trigger for everyone.
    const trigger = await db.execute(sql`select tgenabled from pg_trigger where tgname = 'audit_log_immutable'`);
    expect((trigger as unknown as { rows: { tgenabled: string }[] }).rows[0]?.tgenabled).toBe("O");
    expect(await demoSeedState(db)).toEqual({ present: ["northwind-skincare", "ledgerly"], complete: true });
    expect(again.owner.userId).toBe(result.owner.userId);
    expect(await repos.founders.get(db, result.owner.userId)).toBeNull();
    expect(await count(s.changeProposals, NORTHWIND_BUSINESS_ID)).toBe(beforeProposals);
    expect(await count(s.proposalHunks, NORTHWIND_BUSINESS_ID)).toBe(3);
    const all = await db.select({ slug: s.businesses.slug, id: s.businesses.id }).from(s.businesses);
    expect(all.map((b) => b.slug).sort()).toEqual(["ledgerly", "northwind-skincare", "real-co"]);
    expect(all.find((b) => b.slug === "ledgerly")?.id).toBe(LEDGERLY_BUSINESS_ID);
    const after = await db.select({ id: s.conversions.id, amountMinor: s.conversions.amountMinor }).from(s.conversions).where(eq(s.conversions.businessId, NORTHWIND_BUSINESS_ID)).orderBy(s.conversions.id);
    expect(after).toEqual(before);
    expect(await count(s.agents, LEDGERLY_BUSINESS_ID)).toBe(beforeAgents);
    for (const slug of SEED_COMMUNITY_SLUGS) {
      const communities = await db.select({ id: s.communities.id }).from(s.communities).where(eq(s.communities.slug, slug));
      expect(communities, slug).toHaveLength(1);
    }
    const owners = await db.select({ id: s.memberships.id }).from(s.memberships).where(eq(s.memberships.userId, result.owner.userId));
    expect(owners).toHaveLength(2);
  }, 600_000);

  // Last: it deletes Ledgerly. Every table, trigger and foreign key of a fully seeded business, not a hand-made fixture.
  it("the scheduled business deletion purges a fully seeded business, its audit chain included, and leaves the other whole (audit MLSL-20)", async () => {
    const tables = ((await db.execute(sql`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'business_id' and table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') order by table_name`)) as unknown as { rows: { table_name: string }[] }).rows.map((r) => r.table_name);
    const counts = async (businessId: string) => {
      const out: Record<string, number> = {};
      for (const t of tables) out[t] = Number(((await db.execute(sql.raw(`select count(*)::int as n from "${t}" where business_id = '${businessId}'`))) as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0);
      return out;
    };
    const ledgerly = await counts(LEDGERLY_BUSINESS_ID);
    expect(ledgerly.audit_log).toBeGreaterThan(0);
    expect(ledgerly.cap_table_entries).toBeGreaterThan(0);
    const northwind = await counts(NORTHWIND_BUSINESS_ID);

    expect(await repos.businesses.purge(db, LEDGERLY_BUSINESS_ID)).toBe(true);
    const after = await counts(LEDGERLY_BUSINESS_ID);
    expect(Object.entries(after).filter(([, n]) => n > 0)).toEqual([]);
    expect(await counts(NORTHWIND_BUSINESS_ID)).toEqual(northwind);
    // The real business an earlier test made is not Ledgerly's and stays too.
    expect((await db.select({ slug: s.businesses.slug }).from(s.businesses)).map((b) => b.slug).sort()).toEqual(["northwind-skincare", "real-co"]);
  });

  it("never builds over a real business that took a demo slug while the demo was absent (#232)", async () => {
    // The purge test above removed Ledgerly: build the pair again, then delete it, as a demo that was absent.
    await seedDemo(db, { ...SEED_OPTS, days: 30, refreshDaily: false });
    expect(await deleteDemoBusinesses(db)).toBe(2);
    expect(await demoSeedState(db)).toEqual({ present: [], complete: false });
    const squatter = await h.createUser("squatter@test.local");
    const [taken] = await db.insert(s.businesses).values({ name: "Ledgerly Accounting", slug: "ledgerly", createdBy: squatter, archetype: "b2b_saas" }).returning({ id: s.businesses.id });
    await expect(seedDemo(db, { ...SEED_OPTS, days: 30, refreshDaily: false })).rejects.toThrow(/"ledgerly" belongs to a real business/);
    expect(await deleteDemoBusinesses(db)).toBe(0);
    expect((await db.select({ id: s.businesses.id }).from(s.businesses).where(eq(s.businesses.slug, "ledgerly")))[0]?.id).toBe(taken!.id);
  }, 120_000);
});

describe("startedBefore: nothing running starts after the seed ran (the 9 AM start of a session that is running now)", () => {
  it("keeps a start that has happened and moves a later one back before now, whatever the hour of the seed", () => {
    const nine = new Date("2026-10-15T09:20:00Z");
    expect(startedBefore(nine, new Date("2026-10-15T12:00:00Z"))).toEqual(nine);
    for (const hour of [0, 6, 8, 9]) {
      const now = new Date(Date.UTC(2026, 9, 15, hour, 10));
      const started = startedBefore(nine, now);
      expect(started.getTime(), `seeded at ${hour}:10`).toBeLessThanOrEqual(now.getTime() - 30 * 60_000);
    }
  });
});
