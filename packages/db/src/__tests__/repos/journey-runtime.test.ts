/**
 * 0028 journey runtime: milestones awarded from real payments (once each, whoever writes first), leads the engines write
 * where the Leads tab reads, CRM deletion requests (suppressed at once, purged when due), the schedules' business and
 * engine lists, and the purge of a business whose scheduled deletion came due.
 */
import { CHANNEL_META } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { awardMilestonesForConversion, catchUpMilestones } from "../../milestones";
import { BUSINESS_DELETION_CANCEL_ACTION, BUSINESS_DELETION_REQUEST_ACTION, repos, suppressionHash } from "../../repos";
import { rowsOf } from "../../repos/_shared";
import { day, setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("jrt");
});
afterAll(() => r?.close());

const newBusiness = async (name: string, options: { committed?: boolean } = {}) => {
  const b = await repos.businesses.create(r.db, { name, archetype: "b2b_saas" });
  if (options.committed !== false) await repos.businesses.commit(r.db, b.id, { archetype: "b2b_saas" });
  return b.id;
};

const payment = (businessId: string, at: string, amountMinor: number, options: { firstPayment?: boolean; currency?: string; entityId?: string | null } = {}) =>
  repos.journeys.recordConversion(r.db, businessId, { kind: "payment", amountMinor, currency: options.currency ?? "USD", occurredAt: new Date(at), firstPayment: options.firstPayment ?? true, entityId: options.entityId ?? null });

/** The message of an error and of every cause under it (drizzle wraps the driver's error). */
const errorChain = (e: unknown): string => {
  const parts: string[] = [];
  for (let cur = e as { message?: string; cause?: unknown } | null | undefined, n = 0; cur && n < 5; cur = cur.cause as typeof cur, n++) parts.push(String(cur.message ?? cur));
  return parts.join(" | ");
};

const keys = async (businessId: string) => (await repos.journeys.awardedTrophyKeys(r.db, businessId)).sort();

describe("milestones from real payments", () => {
  it("the first payment awards First customer once, with the payment's time and ids", async () => {
    const B = await newBusiness("Milestone One");
    const p = await payment(B, "2026-10-01T10:00:00Z", 4_900);
    const first = await awardMilestonesForConversion(r.db, B, p.id);
    expect(first.map((m) => m.label)).toEqual(["First customer"]);
    expect(first[0]!.achievedAt.toISOString()).toBe("2026-10-01T10:00:00.000Z");
    expect(first[0]!.ref).toMatchObject({ trophyKey: "customer_1", conversionId: p.id, amountMinor: 4_900 });
    // A retried delivery, the journey build and the nightly sweep award nothing more.
    expect(await awardMilestonesForConversion(r.db, B, p.id)).toEqual([]);
    expect(await catchUpMilestones(r.db, B)).toEqual([]);
    expect(await keys(B)).toEqual(["customer_1"]);
  });

  it("a second writer racing for the same trophy is a no-op (unique trophy key per business)", async () => {
    const B = await newBusiness("Milestone Race");
    const award = () => repos.journeys.awardMilestone(r.db, B, { kind: "customer", label: "First customer", ref: { trophyKey: "customer_1" } });
    const [a, b] = await Promise.all([award(), award()]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect((await repos.journeys.listMilestones(r.db, B)).length).toBe(1);
  });

  it("repeat payments add revenue (MRR, labeled Estimate) but no customers; other kinds award nothing", async () => {
    const B = await newBusiness("Milestone Revenue");
    const p1 = await payment(B, "2026-09-01T09:00:00Z", 60_000);
    await awardMilestonesForConversion(r.db, B, p1.id);
    const renewal = await payment(B, "2026-09-15T09:00:00Z", 50_000, { firstPayment: false });
    const awarded = await awardMilestonesForConversion(r.db, B, renewal.id);
    expect(awarded.map((m) => m.ref)).toEqual([expect.objectContaining({ trophyKey: "mrr_1k", estimate: true, basis: "trailing_30_day_revenue" })]);
    expect(awarded[0]!.label).toBe("First $1K MRR");
    const signup = await repos.journeys.recordConversion(r.db, B, { kind: "signup" });
    expect(await awardMilestonesForConversion(r.db, B, signup.id)).toEqual([]);
    expect(await keys(B)).toEqual(["customer_1", "mrr_1k"]);
  });

  it("revenue older than 30 days does not count toward MRR", async () => {
    const B = await newBusiness("Milestone Window");
    await payment(B, "2026-08-01T09:00:00Z", 60_000);
    const late = await payment(B, "2026-09-15T09:00:00Z", 50_000);
    expect((await awardMilestonesForConversion(r.db, B, late.id)).map((m) => m.ref?.trophyKey)).toEqual([]);
  });

  it("the nightly catch-up awards what the live path missed, at the payment that reached it", async () => {
    const B = await newBusiness("Milestone Catch-up");
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push((await payment(B, `2026-09-${String(i + 1).padStart(2, "0")}T12:00:00Z`, i === 4 ? 1_200_000 : 1_000)).id);
    const found = await catchUpMilestones(r.db, B, { until: day("2026-10-01") });
    const byKey = Object.fromEntries(found.map((m) => [m.ref?.trophyKey, m]));
    expect(Object.keys(byKey).sort()).toEqual(["customer_1", "customer_10", "first_enterprise_contract", "mrr_10k", "mrr_1k"].sort());
    expect(byKey.customer_10!.ref).toMatchObject({ conversionId: ids[9] });
    expect(byKey.first_enterprise_contract!.ref).toMatchObject({ conversionId: ids[4] });
    expect(byKey.customer_1!.achievedAt.toISOString()).toBe("2026-09-01T12:00:00.000Z");
    expect(await catchUpMilestones(r.db, B, { until: day("2026-10-01") })).toEqual([]);
  });
});

describe("leads", () => {
  it("an engine's lead becomes a CRM record with a lead role the Leads tab lists; the same email is one record", async () => {
    const A = r.A.businessId;
    const first = await repos.entities.upsertLead(r.db, A, { displayName: "Grace Hopper", email: "Grace@Example.com", company: "Navy Labs", source: "lead_generation", lawfulBasis: "legitimate_interest", ownerAgentId: r.A.agentId });
    expect(first.status).toBe("created");
    expect(first.roleCreated).toBe(true);
    const again = await repos.entities.upsertLead(r.db, A, { displayName: "G. Hopper", email: "grace@example.com", source: "content" });
    expect(again).toMatchObject({ status: "existing", roleCreated: false });
    expect(again.entity?.id).toBe(first.entity?.id);
    const leads = await repos.entities.listByRole(r.db, A, "lead", {});
    const row = leads.items.find((l) => l.id === first.entity?.id);
    expect(row).toMatchObject({ source: "lead_generation", lawfulBasis: "legitimate_interest", identifiers: { email: "grace@example.com", company: "Navy Labs" } });
    expect(row?.role).toMatchObject({ role: "lead", stage: "new", ownerRef: { kind: "agent", id: r.A.agentId } });
    // Tenancy: business B sees none of it.
    expect((await repos.entities.listByRole(r.db, r.B.businessId, "lead", {})).items.find((l) => l.id === first.entity?.id)).toBeUndefined();
  });

  it("a suppressed address is never imported", async () => {
    const A = r.A.businessId;
    await repos.channels.addSuppression(r.db, A, { emailHash: suppressionHash("email", "nope@example.com"), reason: "unsubscribed" });
    const out = await repos.entities.upsertLead(r.db, A, { displayName: "No Pe", email: "NOPE@example.com", source: "lead_generation" });
    expect(out.status).toBe("suppressed");
    expect(await repos.entities.findByIdentifier(r.db, A, "email", "nope@example.com")).toBeNull();
  });
});

describe("CRM deletion requests", () => {
  it("suppress the person at once, then purge the record and what is only about them when due", async () => {
    const A = r.A.businessId;
    const person = await repos.entities.create(r.db, A, { kind: "person", displayName: "Erase Me", identifiers: { email: "erase@example.com", phone: "+44 20 7946 0000" } });
    const twin = await repos.entities.create(r.db, A, { kind: "person", displayName: "E. Me", identifiers: { email: "erase.me@example.com" } });
    await repos.entities.merge(r.db, A, person.id, twin.id);
    await repos.entities.addRole(r.db, A, person.id, { role: "lead", stage: "new" });
    const onlyThem = await repos.entities.addNote(r.db, A, person.id, "Called about pricing");
    const shared = await repos.entities.createInteraction(r.db, A, { kind: "meeting", entityIds: [person.id, r.A.entity2Id], summary: "Intro" });
    const paid = await repos.journeys.recordConversion(r.db, A, { kind: "payment", amountMinor: 1_000, entityId: person.id });

    const requested = await repos.entities.requestDeletion(r.db, A, person.id, { requestedAt: day("2026-10-01") });
    expect(requested).toMatchObject({ already: false, suppressed: 3 });
    expect(requested.entity.deletionDueAt?.toISOString()).toBe(day("2026-10-08").toISOString());
    expect(requested.entity.identifiers).toMatchObject({ suppressed: "true", suppression_reason: "Deletion requested" });
    for (const [kind, value] of [["email", "ERASE@example.com"], ["phone", "+442079460000"], ["email", "erase.me@example.com"]] as const) {
      expect(await repos.channels.isSuppressed(r.db, A, { [kind === "email" ? "emailHash" : "phoneHash"]: suppressionHash(kind, value) })).toBe(true);
    }
    expect((await repos.entities.listRoles(r.db, A, person.id)).find((x) => x.role === "lead")?.stage).toBe("suppressed");
    expect((await repos.entities.manifest(r.db, A)).some((m) => m.id === person.id)).toBe(false);
    expect((await repos.entities.requestDeletion(r.db, A, person.id)).already).toBe(true);
    // Re-import is refused.
    expect((await repos.entities.upsertLead(r.db, A, { displayName: "Erase Me", email: "erase@example.com", source: "events" })).status).toBe("suppressed");

    expect((await repos.entities.deletionsDue(r.db, day("2026-10-07"))).some((d) => d.entityId === person.id)).toBe(false);
    const due = await repos.entities.deletionsDue(r.db, day("2026-10-09"));
    expect(due).toContainEqual(expect.objectContaining({ businessId: A, entityId: person.id }));

    const purged = await repos.entities.purge(r.db, A, person.id);
    expect(purged.purged.sort()).toEqual([person.id, twin.id].sort());
    await expect(repos.entities.get(r.db, A, person.id)).rejects.toThrow();
    await expect(repos.entities.get(r.db, A, twin.id)).rejects.toThrow();
    const notes = await repos.entities.listInteractions(r.db, A, { limit: 200 });
    expect(notes.items.some((i) => i.id === onlyThem.id)).toBe(false);
    expect(notes.items.find((i) => i.id === shared.id)?.entityIds).toEqual([r.A.entity2Id]);
    expect((await repos.journeys.getConversion(r.db, A, paid.id)).entityId).toBeNull();
    // The suppression entries stay.
    expect(await repos.channels.isSuppressed(r.db, A, { emailHash: suppressionHash("email", "erase@example.com") })).toBe(true);
    expect((await repos.entities.deletionsDue(r.db, day("2026-10-09"))).some((d) => d.entityId === person.id)).toBe(false);
  });

  it("never purges a record nobody asked to delete", async () => {
    expect(await repos.entities.purge(r.db, r.A.businessId, r.A.entity2Id)).toEqual({ purged: [], blocked: "no deletion was requested" });
  });
});

describe("schedule inputs", () => {
  it("lists committed, live businesses; runnable leaves stopped ones out", async () => {
    const live = await newBusiness("Schedules Live");
    const stopped = await newBusiness("Schedules Stopped");
    const draft = await newBusiness("Schedules Draft", { committed: false });
    const archived = await newBusiness("Schedules Archived");
    await repos.businesses.setAgentsStopped(r.db, stopped, { reason: "kill_switch" });
    await repos.businesses.archive(r.db, archived);
    const all = await repos.businesses.listForSchedules(r.db);
    expect(all).toEqual(expect.arrayContaining([live, stopped]));
    expect(all).not.toContain(draft);
    expect(all).not.toContain(archived);
    const runnable = await repos.businesses.listForSchedules(r.db, { runnable: true });
    expect(runnable).toContain(live);
    expect(runnable).not.toContain(stopped);
  });

  it("lists the enabled channels of runnable businesses for the engine reconciler", async () => {
    const live = await newBusiness("Engines Live");
    const stopped = await newBusiness("Engines Stopped");
    const on = await repos.channels.upsert(r.db, live, { channelKey: "seo", line: CHANNEL_META.seo.line, enabled: true });
    await repos.channels.upsert(r.db, live, { channelKey: "pr", line: CHANNEL_META.pr.line, enabled: false });
    await repos.channels.upsert(r.db, stopped, { channelKey: "seo", line: CHANNEL_META.seo.line, enabled: true });
    await repos.businesses.setAgentsStopped(r.db, stopped, { reason: "kill_switch" });
    const list = await repos.channels.listForEngines(r.db);
    expect(list.filter((c) => c.businessId === live)).toEqual([{ businessId: live, channelId: on.id, channelKey: "seo", engineWorkflowId: null }]);
    expect(list.some((c) => c.businessId === stopped)).toBe(false);
  });

  it("knows whether a channel ever launched a campaign", async () => {
    const B = await newBusiness("Launches");
    const ch = await repos.channels.upsert(r.db, B, { channelKey: "social", line: CHANNEL_META.social.line, enabled: true });
    const c = await repos.campaigns.create(r.db, B, { channelId: ch.id, name: "Week 1" });
    expect(await repos.campaigns.channelHasLaunched(r.db, B, ch.id)).toBe(false);
    await repos.campaigns.setStatus(r.db, B, c.id, "live", { force: true });
    expect(await repos.campaigns.channelHasLaunched(r.db, B, ch.id)).toBe(true);
  });
});

describe("scheduled business deletion", () => {
  it("is due once its date passes, unless it was canceled", async () => {
    const B = await newBusiness("Deletion Due");
    const C = await newBusiness("Deletion Canceled");
    for (const id of [B, C]) await repos.audit.append(r.db, id, { actorKind: "user", action: BUSINESS_DELETION_REQUEST_ACTION, target: { kind: "business", id }, details: { scheduledFor: day("2026-10-08").toISOString() } });
    await repos.audit.append(r.db, C, { actorKind: "user", action: BUSINESS_DELETION_CANCEL_ACTION, target: { kind: "business", id: C }, details: {} });
    expect((await repos.businesses.deletionsDue(r.db, day("2026-10-07"))).some((d) => d.businessId === B)).toBe(false);
    const due = await repos.businesses.deletionsDue(r.db, day("2026-10-09"));
    expect(due.map((d) => d.businessId)).toContain(B);
    expect(due.map((d) => d.businessId)).not.toContain(C);
  });

  it("only the service role may purge: an owner's own session is refused", async () => {
    const refused = await r.as(r.B.ownerId, (tx) => repos.businesses.purge(tx, r.B.businessId)).then(
      () => null,
      (e: { message: string; cause?: { message?: string } }) => e,
    );
    expect(errorChain(refused)).toMatch(/permission denied/);
    expect(await repos.businesses.get(r.db, r.B.businessId)).toBeTruthy();
  });

  it("purges every row of the business, its audit chain included, and nothing of another", async () => {
    const A = r.A.businessId;
    const B = r.B.businessId;
    const count = async (table: string, businessId: string) => Number(rowsOf<{ n: number }>(await r.db.execute(sql.raw(`select count(*)::int as n from ${table} where business_id = '${businessId}'`)))[0]?.n ?? 0);
    await repos.capTable.createEntry(r.db, A, { holderEntityId: r.A.entityId, securityId: r.A.securityId, quantity: 100 });
    for (const id of [A, B]) await repos.audit.append(r.db, id, { actorKind: "user", action: BUSINESS_DELETION_REQUEST_ACTION, target: { kind: "business", id }, details: {} });
    const before = { tasks: await count("tasks", B), audit: await count("audit_log", B), entities: await count("entities", B) };
    expect(await count("audit_log", A)).toBeGreaterThan(0);
    expect(await repos.businesses.purge(r.db, A)).toBe(true);
    for (const table of ["tasks", "agents", "entities", "conversions", "channels", "campaigns", "audit_log", "events", "memberships", "cap_table_entries"]) expect(await count(table, A)).toBe(0);
    expect({ tasks: await count("tasks", B), audit: await count("audit_log", B), entities: await count("entities", B) }).toEqual(before);
    expect(await repos.businesses.purge(r.db, A)).toBe(false);
    // The audit chain of every other business stays append-only.
    const refused = await r.db.execute(sql`delete from audit_log where business_id = ${B}::uuid`).then(
      () => null,
      (e: { message: string; cause?: { message?: string } }) => e,
    );
    expect(errorChain(refused)).toMatch(/append-only/);
  });
});
