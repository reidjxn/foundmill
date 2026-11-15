/**
 * The nightly numbers' fixture (WP-02 T10): one demo project, the house project, and two real projects: Alpha, whose
 * founder published the page (and republished it a week later), and Bravo, with only a simulated `mail.sent` and a
 * Simulate-panel payment. The snapshot is for Nov 14, 2026 (windows end Nov 15, 00:00 UTC). `withDemo: false` builds
 * the same database without the demo project's rows, for demo-isolation.test.ts.
 */
import { HOUSE_BUSINESS_ID } from "@foundmill/config";
import { sql } from "drizzle-orm";
import { repos } from "../repos";
import * as s from "../schema";
import type { TestHarness } from "../testing/pglite";

export const AS_OF = new Date("2026-11-14T18:00:00Z");
const t = (iso: string) => new Date(iso);
const page = { pitch: "Candles that smell like a walk in the woods", about: "Small batches.", forWhom: "People in small apartments", stage: "building", showFounders: false, followForm: true } as const;

export interface MetricsFixture {
  alpha: string;
  bravo: string;
  demo: string | null;
  alice: string;
  bob: string;
}

async function user(h: TestHarness, email: string, createdAt: string, lastSignInAt: string | null = null): Promise<string> {
  const id = await h.createUser(email);
  await h.db.execute(sql`update auth.users set created_at = ${createdAt}::timestamptz, last_sign_in_at = ${lastSignInAt}::timestamptz where id = ${id}`);
  return id;
}

async function business(h: TestHarness, o: { id?: string; slug: string; owner: string; isDemo?: boolean; createdAt: string; committedAt: string | null }): Promise<string> {
  const res = (await h.db.execute(sql`insert into businesses (id, name, slug, created_by, is_demo, created_at, committed_at)
    values (coalesce(${o.id ?? null}::uuid, gen_random_uuid()), ${o.slug.toUpperCase()}, ${o.slug}, ${o.owner}, ${o.isDemo ?? false}, ${o.createdAt}::timestamptz, ${o.committedAt}::timestamptz) returning id`)) as unknown as { rows: { id: string }[] };
  const id = res.rows[0]!.id;
  await h.db.execute(sql`insert into memberships (business_id, user_id, role) values (${id}, ${o.owner}, 'owner')`);
  return id;
}

type Actor = { kind: string; id: string };
async function event(h: TestHarness, businessId: string, type: string, at: string, actor: Actor, payload: Record<string, unknown> = {}): Promise<void> {
  await h.db.insert(s.events).values({ businessId, type, occurredAt: t(at), actor: actor as never, payload });
}

async function accountEvent(h: TestHarness, userId: string, type: string, at: string, payload: Record<string, unknown>): Promise<void> {
  await h.db.execute(sql`insert into account_events (user_id, type, occurred_at, actor, payload) values (${userId}, ${type}, ${at}::timestamptz, ${JSON.stringify({ kind: "user", id: userId })}::jsonb, ${JSON.stringify(payload)}::jsonb)`);
}

/** Agent work in one project: four ended sessions (one done, two blocked, one failed) and one still running. */
async function agentWork(h: TestHarness, businessId: string, day: string): Promise<void> {
  const [agent] = await h.db.insert(s.agents).values({ businessId, name: "Engineer", agentType: "engineer", layer: "worker" }).returning({ id: s.agents.id });
  const [version] = await h.db.insert(s.agentVersions).values({ businessId, agentId: agent!.id, version: 1, state: "live" }).returning({ id: s.agentVersions.id });
  const ended = t(`${day}T12:00:00Z`);
  await h.db.insert(s.agentSessions).values([
    { businessId, agentId: agent!.id, versionId: version!.id, endedAt: ended, outcome: "done" },
    { businessId, agentId: agent!.id, versionId: version!.id, endedAt: ended, outcome: "blocked" },
    { businessId, agentId: agent!.id, versionId: version!.id, endedAt: ended, outcome: "blocked" },
    { businessId, agentId: agent!.id, versionId: version!.id, endedAt: ended, outcome: "failed" },
    { businessId, agentId: agent!.id, versionId: version!.id },
  ]);
  const system = { kind: "system", id: "orchestrator" };
  await event(h, businessId, "task.blocked", `${day}T12:00:00Z`, system);
  await event(h, businessId, "task.blocked", `${day}T12:01:00Z`, system);
  await event(h, businessId, "task.completed", `${day}T12:02:00Z`, system);
  await event(h, businessId, "approval.requested", `${day}T12:03:00Z`, system, { tool: "launch_campaign" });
  await event(h, businessId, "approval.requested", `${day}T12:04:00Z`, system, { tool: "merge_pr" });
  await event(h, businessId, "approval.resolved", `${day}T12:05:00Z`, system, { outcome: "approved" });
  // Open since Nov 1: more than nine days, and a stale launch approval (T4's honesty count).
  await h.db.insert(s.approvals).values({ businessId, tool: "launch_campaign", requestedAt: t("2026-11-01T09:00:00Z") });
  await h.db.insert(s.approvals).values({ businessId, tool: "merge_pr", requestedAt: t(`${day}T12:03:00Z`), resolvedAt: t(`${day}T13:00:00Z`), outcome: "approved" });
  // Raw, to date it: the chain trigger still links it (repos.audit.append stamps the clock's time).
  await h.db.execute(sql`insert into audit_log (business_id, actor_kind, action, created_at) values (${businessId}, 'system', 'cycle.tool_missing_stopped', ${`${day}T12:06:00Z`}::timestamptz)`);
}

export async function buildMetricsFixture(h: TestHarness, opts: { withDemo: boolean }): Promise<MetricsFixture> {
  const houseOwner = await user(h, "house@test.local", "2026-09-01T00:00:00Z");
  const alice = await user(h, "alice@test.local", "2026-11-05T06:00:00Z", "2026-11-12T08:00:00Z");
  const bob = await user(h, "bob@test.local", "2026-11-11T08:00:00Z", "2026-11-11T08:00:00Z");
  await user(h, "early@test.local", "2026-10-01T00:00:00Z");
  // The seed's own account, which owns the demo (production's seeded owners are auth users too, and are counted as
  // accounts like any other): present with or without the demo project, so demo isolation compares project rows.
  const demoOwner = await user(h, "demo@test.local", "2026-09-01T00:00:00Z");

  // Account facts (WP-02 T9) and the gate.
  await h.db.execute(sql`insert into founder_profiles (user_id, display_name, created_at) values
    (${alice}, 'Alice', '2026-11-05T07:00:00Z'), (${bob}, 'Bob', '2026-11-11T09:00:00Z')`);
  await accountEvent(h, alice, "account.admitted", "2026-11-05T07:00:00Z", { how: "open" });
  await accountEvent(h, alice, "profile.created", "2026-11-05T07:00:00Z", { client: "web" });
  await accountEvent(h, alice, "idea.drafted", "2026-11-05T07:30:00Z", { source: "set", cards: 3 });
  await accountEvent(h, bob, "account.admitted", "2026-11-11T09:00:00Z", { how: "invitation" });
  await accountEvent(h, bob, "profile.created", "2026-11-11T09:00:00Z", { client: "app" });
  await h.db.execute(sql`insert into account_admissions (user_id, how, created_at) values (${alice}, 'open', '2026-11-05T07:00:00Z'), (${bob}, 'invitation', '2026-11-11T09:00:00Z')`);
  await h.db.execute(sql`insert into waitlist_entries (email, created_at) values ('wait@test.local', '2026-11-02T00:00:00Z')`);
  await h.db.execute(sql`insert into idea_drafts (token_hash, card, model_mode, expires_at, created_at, claimed_at, claimed_by) values
    (${"a".repeat(64)}, '{}'::jsonb, 'mock', '2026-11-20T00:00:00Z', '2026-11-04T10:00:00Z', '2026-11-05T07:30:00Z', ${alice}),
    (${"b".repeat(64)}, '{}'::jsonb, 'mock', '2026-11-20T00:00:00Z', '2026-11-13T10:00:00Z', null, null)`);

  const house = await business(h, { id: HOUSE_BUSINESS_ID, slug: "foundmill", owner: houseOwner, createdAt: "2026-09-01T00:00:00Z", committedAt: "2026-09-01T00:00:00Z" });
  const alpha = await business(h, { slug: "alpha", owner: alice, createdAt: "2026-11-05T08:00:00Z", committedAt: "2026-11-05T08:00:00Z" });
  const bravo = await business(h, { slug: "bravo", owner: bob, createdAt: "2026-11-11T10:00:00Z", committedAt: "2026-11-11T10:00:00Z" });
  await h.db.execute(sql`insert into invitations (business_id, token_hash, role, email, expires_at, created_at) values (${alpha}, ${"c".repeat(64)}, 'cofounder', 'invitee@test.local', '2026-11-20T00:00:00Z', '2026-11-06T00:00:00Z')`);

  // Alpha: the founder published the page two hours after commit, and republished it the next week (no second outcome).
  await repos.pages.publish(h.db, alpha, { content: page, slug: "alpha-page", userId: alice, at: t("2026-11-05T10:00:00Z") });
  await event(h, alpha, "page.published", "2026-11-05T10:00:00Z", { kind: "user", id: alice }, { pageId: alpha, slug: "alpha-page" });
  await event(h, alpha, "page.published", "2026-11-12T10:00:00Z", { kind: "user", id: alice }, { pageId: alpha, slug: "alpha-page" });
  await event(h, alpha, "cycle.started", "2026-11-05T10:30:00Z", { kind: "user", id: alice });
  await event(h, alpha, "cycle.started", "2026-11-08T10:30:00Z", { kind: "system", id: "autopilot" });
  await h.db.execute(sql`insert into inbox_items (business_id, type, subject, created_at) values
    (${alpha}, 'update', 'Welcome', '2026-11-05T09:00:00Z'), (${alpha}, 'update', 'First round', '2026-11-05T20:00:00Z'), (${alpha}, 'update', 'Later', '2026-11-07T09:00:00Z')`);
  await h.db.execute(sql`insert into founder_visit_days (user_id, business_id, day, first_at, last_at) values
    (${alice}, ${alpha}, '2026-11-05', '2026-11-05T08:00:00Z', '2026-11-05T09:00:00Z'), (${alice}, ${alpha}, '2026-11-06', '2026-11-06T08:00:00Z', '2026-11-06T09:00:00Z')`);
  await agentWork(h, alpha, "2026-11-10");

  // Bravo: a draft page, nothing published, and only simulated results.
  await repos.pages.saveDraft(h.db, bravo, { draft: page, slug: "bravo-page", userId: bob });
  await event(h, bravo, "mail.sent", "2026-11-12T10:00:00Z", { kind: "agent", id: bravo }, { simulated: true, channelKey: "email_automation" });
  await event(h, bravo, "payment.received", "2026-11-12T11:00:00Z", { kind: "system", id: "simulate" }, { amount: { amountMinor: 4900, currency: "USD" }, firstPayment: true });
  await event(h, bravo, "cycle.started", "2026-11-11T10:30:00Z", { kind: "user", id: bob });
  await event(h, bravo, "cycle.started", "2026-11-11T12:30:00Z", { kind: "system", id: "autopilot" });
  await h.db.execute(sql`insert into founder_visit_days (user_id, business_id, day, first_at, last_at) values (${bob}, ${bravo}, '2026-11-12', '2026-11-12T08:00:00Z', '2026-11-12T09:00:00Z')`);

  // The house: a real page and a real follow, never in the north star (it is not an outside project).
  await event(h, house, "page.published", "2026-11-12T09:00:00Z", { kind: "user", id: houseOwner }, { pageId: house, slug: "foundmill" });
  await event(h, house, "page.followed", "2026-11-12T09:30:00Z", { kind: "system", id: "public-page" }, { pageId: house });

  let demo: string | null = null;
  if (opts.withDemo) {
    // The demo: every kind of row the numbers read, each of which must count for nothing.
    demo = await business(h, { slug: "northwind-demo", owner: demoOwner, isDemo: true, createdAt: "2026-11-06T00:00:00Z", committedAt: "2026-11-06T00:00:00Z" });
    await h.db.execute(sql`insert into memberships (business_id, user_id, role, source) values (${demo}, ${alice}, 'viewer', 'example')`);
    await event(h, demo, "page.published", "2026-11-06T02:00:00Z", { kind: "user", id: demoOwner }, { pageId: demo });
    await event(h, demo, "payment.received", "2026-11-07T02:00:00Z", { kind: "webhook", id: "stripe" }, { amount: { amountMinor: 9900, currency: "USD" } });
    await event(h, demo, "mail.sent", "2026-11-07T03:00:00Z", { kind: "agent", id: demo }, { simulated: true });
    await event(h, demo, "cycle.started", "2026-11-06T03:00:00Z", { kind: "user", id: demoOwner });
    await h.db.execute(sql`insert into inbox_items (business_id, type, subject, created_at) values (${demo}, 'update', 'Sample', '2026-11-06T04:00:00Z')`);
    await h.db.execute(sql`insert into founder_visit_days (user_id, business_id, day, first_at, last_at) values (${alice}, ${demo}, '2026-11-09', '2026-11-09T08:00:00Z', '2026-11-09T09:00:00Z')`);
    await h.db.execute(sql`insert into invitations (business_id, token_hash, role, email, expires_at, created_at) values (${demo}, ${"d".repeat(64)}, 'cofounder', 'invitee@test.local', '2026-11-20T00:00:00Z', '2026-11-06T00:00:00Z')`);
    await h.db.insert(s.integrations).values({ businessId: demo, connectorKey: "stripe", status: "mock", authKind: "api_key" });
    await agentWork(h, demo, "2026-11-07");
  }
  return { alpha, bravo, demo, alice, bob };
}
