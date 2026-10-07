/** legal, integrations + webhooks, credentials (ciphertext only), policies, approvals, audit chain, events + outbox. */
import { buildAad, generateMasterKey, LocalVault } from "@founder-manager/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import { credentials } from "../../schema";
import { day, setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("gov");
});
afterAll(() => r?.close());

describe("legal", () => {
  it("entities, incorporations, filings, contracts and compliance round-trip with scoping", async () => {
    const A = r.A.businessId;
    const le = await repos.legal.createEntity(r.db, A, { jurisdiction: "SE", entityType: "AB", legalName: "Northwind Skincare AB", regNo: "559000-0001", status: "forming" });
    expect((await repos.legal.primaryEntity(r.db, A))?.id).toBe(r.A.legalEntityId); // fixture entity is older; neither is active yet
    await repos.legal.updateEntity(r.db, A, le.id, { status: "active" });
    expect((await repos.legal.primaryEntity(r.db, A))?.id).toBe(le.id);

    const inc = await repos.legal.startIncorporation(r.db, A, { legalEntityId: le.id, route: "kit", steps: [{ key: "name_check", done: true }] });
    await expect(repos.legal.startIncorporation(r.db, A, { route: "stripe_atlas" })).rejects.toThrow(/already in progress/);
    await expect(repos.legal.startIncorporation(r.db, A, { route: "kit", legalEntityId: r.B.legalEntityId })).rejects.toThrow(/not a legal entity of this business/);
    const submitted = await repos.legal.updateIncorporation(r.db, A, inc.id, { status: "submitted" });
    expect(submitted.submittedAt).toBeInstanceOf(Date);
    expect((await repos.legal.activeIncorporation(r.db, A))?.id).toBe(inc.id);
    await repos.legal.updateIncorporation(r.db, A, inc.id, { status: "complete" });
    expect(await repos.legal.activeIncorporation(r.db, A)).toBeNull();

    await repos.legal.createFiling(r.db, A, { legalEntityId: le.id, kind: "annual_report", title: "Annual report", dueAt: day("2026-10-20") });
    await repos.legal.createFiling(r.db, A, { kind: "vat", dueAt: day("2026-09-01") });
    await repos.legal.createFiling(r.db, A, { kind: "far_future", dueAt: day("2027-06-01") });
    expect(await repos.legal.rollFilingStatuses(r.db, A, day("2026-10-07"))).toBe(2);
    const filings = await repos.legal.listFilings(r.db, A, {});
    expect(filings.items.map((f) => [f.kind, f.status])).toEqual([
      ["vat", "overdue"],
      ["annual_report", "due"],
      ["far_future", "upcoming"],
    ]);
    const filed = await repos.legal.updateFiling(r.db, A, filings.items[0]!.id, { status: "filed" });
    expect(filed.filedAt).toBeInstanceOf(Date);
    const deadlines = await repos.legal.upcomingDeadlines(r.db, A, 30, day("2026-10-07"));
    expect(deadlines.filings.map((f) => f.kind)).toEqual(["annual_report"]);

    const c = await repos.legal.createContract(r.db, A, { counterpartyEntityId: r.A.entity2Id, kind: "msa", title: "Supply agreement", valueMinor: 1_000_000 });
    await expect(repos.legal.createContract(r.db, A, { counterpartyEntityId: r.B.entityId, kind: "nda" })).rejects.toThrow(/not an entity of this business/);
    await expect(repos.legal.setContractStatus(r.db, A, c.id, "active")).rejects.toThrow(/cannot move/);
    await repos.legal.setContractStatus(r.db, A, c.id, "awaiting_signature");
    const signed = await repos.legal.setContractStatus(r.db, A, c.id, "signed", { signedAt: day("2026-10-05") });
    expect(signed.signedAt?.toISOString()).toBe(day("2026-10-05").toISOString());
    const list = await repos.legal.listContracts(r.db, A, { status: "signed" });
    expect(list.items[0]!.counterparty?.displayName).toContain("Analytical Engines");
    expect((await r.svc((tx) => repos.legal.listContracts(tx, r.B.businessId))).items).toHaveLength(0);

    await repos.legal.createCompliance(r.db, A, { legalEntityId: le.id, kind: "agm", title: "Annual general meeting", dueAt: day("2026-10-15"), recurrence: "yearly" });
    const pending = await repos.legal.listCompliance(r.db, A, { pendingOnly: true });
    expect(pending).toHaveLength(1);
    await repos.legal.completeCompliance(r.db, A, pending[0]!.id);
    expect(await repos.legal.listCompliance(r.db, A, { pendingOnly: true })).toHaveLength(0);
  });
});

describe("integrations and credentials", () => {
  it("upserts per connector key, records health, stores and loads ciphertext only, disconnects", async () => {
    const A = r.A.businessId;
    const gh = await repos.integrations.upsert(r.db, A, { connectorKey: "github", status: "connected", authKind: "app", scopes: ["repo"], accountLabel: "reidjxn", connectedBy: r.A.ownerId });
    const again = await repos.integrations.upsert(r.db, A, { connectorKey: "github", accountLabel: "reidjxn/foundmill" });
    expect(again.id).toBe(gh.id);
    expect(again.scopes).toEqual(["repo"]);
    expect((await repos.integrations.list(r.db, A, { status: "connected" })).map((i) => i.connectorKey)).toEqual(["github"]);
    const degraded = await repos.integrations.recordHealth(r.db, A, gh.id, { ok: false, error: "401 bad credentials" });
    expect(degraded.status).toBe("degraded");
    expect(degraded.lastError).toContain("401");
    expect((await repos.integrations.recordHealth(r.db, A, gh.id, { ok: true })).status).toBe("connected");
    expect((await repos.integrations.recordHealth(r.db, A, r.A.integrationId, { ok: true })).status).toBe("mock");

    const vault = new LocalVault(generateMasterKey());
    const stored = await repos.credentials.store(r.db, A, { integrationId: gh.id, kind: "secret", record: await vault.encrypt("ghp_secret_token", "temporary"), expiresAt: day("2026-10-09") });
    expect(stored).not.toHaveProperty("ciphertext");
    // Re-seal with the row's AAD now that the id exists (how the gateway binds a secret to its row), then load and decrypt.
    const aad = buildAad(A, "credentials", stored.id);
    await repos.credentials.rotate(r.db, A, stored.id, await vault.encrypt("ghp_secret_token", aad));
    const loaded = await repos.credentials.load(r.db, A, stored.id);
    expect(loaded.record.alg).toBe("xchacha20poly1305-ietf");
    expect(new TextDecoder().decode(await vault.decrypt(loaded.record, aad))).toBe("ghp_secret_token");
    expect(JSON.stringify(loaded)).not.toContain("ghp_secret_token");
    const raw = await r.db.select({ c: credentials.ciphertext }).from(credentials).where(eq(credentials.id, stored.id));
    expect(Buffer.from(raw[0]!.c).toString("latin1")).not.toContain("ghp_secret");
    expect((await repos.credentials.latest(r.db, A, gh.id))?.meta.id).toBe(stored.id);
    expect((await repos.credentials.expiring(r.db, A, day("2026-10-10"))).map((c) => c.id)).toEqual([stored.id]);
    await expect(repos.credentials.store(r.db, A, { integrationId: r.B.integrationId, record: await vault.encrypt("x", "a") })).rejects.toThrow(/not an integration of this business/);
    await expect(repos.credentials.store(r.db, A, { integrationId: gh.id, record: { ciphertext: "!!", dataKeyCiphertext: "AA==", kmsKeyId: "k", alg: "xchacha20poly1305-ietf" } })).rejects.toThrow(/Invalid credential/);

    const second = await repos.credentials.store(r.db, A, { integrationId: gh.id, kind: "secret", record: await vault.encrypt("new", "a") });
    expect((await repos.credentials.latest(r.db, A, gh.id))?.meta.id).toBe(second.id);
    await expect(repos.credentials.load(r.db, A, stored.id)).rejects.toThrow(/not found/); // archived by the new store
    expect((await repos.credentials.listMetadata(r.db, A, { integrationId: gh.id, includeArchived: true })).length).toBe(2);
    await expect(repos.credentials.load(r.db, r.B.businessId, second.id)).rejects.toThrow(/not found/);
    await expect(r.as(r.A.ownerId, (tx) => repos.credentials.load(tx, A, second.id))).rejects.toThrow(/permission denied/);

    const wh = await repos.integrations.createWebhook(r.db, A, { integrationId: gh.id, connectorKey: "github", externalId: "hook-1", secretRef: second.id, endpointPath: "/webhooks/github/abc", events: ["push"] });
    await repos.integrations.markWebhookReceived(r.db, A, wh.id);
    expect((await repos.integrations.getWebhook(r.db, A, wh.id)).lastReceivedAt).toBeInstanceOf(Date);
    const off = await repos.integrations.disconnect(r.db, A, gh.id);
    expect(off.status).toBe("disconnected");
    expect(await repos.credentials.latest(r.db, A, gh.id)).toBeNull();
    expect(await repos.integrations.listWebhooks(r.db, A, { integrationId: gh.id })).toHaveLength(0);
    expect((await repos.integrations.listWebhooks(r.db, A, { integrationId: gh.id, includeArchived: true }))[0]!.status).toBe("paused");
  });
});

describe("policies and approvals", () => {
  it("resolves the effective policy set by scope and versions text changes", async () => {
    const A = r.A.businessId;
    const biz = await repos.policies.create(r.db, A, { scope: "business", name: "No weekend sends", cedarText: "forbid(principal, action, resource) when { context.weekend };" });
    const dept = await repos.policies.create(r.db, A, { scope: "department", scopeId: r.A.departmentId, cedarText: "permit(principal, action, resource);" });
    const agent = await repos.policies.create(r.db, A, { scope: "agent", scopeId: r.A.agentId, cedarText: "permit(principal, action, resource);" });
    await repos.policies.create(r.db, A, { scope: "agent", scopeId: r.A.agent2Id, cedarText: "permit(principal, action, resource);" });
    await expect(repos.policies.create(r.db, A, { scope: "agent", cedarText: "permit(principal, action, resource);" })).rejects.toThrow(/Invalid policy/);
    const eff = await repos.policies.effective(r.db, A, { departmentIds: [r.A.departmentId], agentId: r.A.agentId });
    expect(eff.map((p) => p.id)).toEqual([biz.id, dept.id, agent.id]);
    expect((await repos.policies.effective(r.db, A, {})).map((p) => p.id)).toEqual([biz.id]);
    const v2 = await repos.policies.update(r.db, A, biz.id, { cedarText: "forbid(principal, action, resource) when { context.weekend || context.holiday };" });
    expect(v2.version).toBe(2);
    expect((await repos.policies.update(r.db, A, biz.id, { name: "Renamed" })).version).toBe(2);
    await repos.policies.setEnabled(r.db, A, dept.id, false);
    expect((await repos.policies.effective(r.db, A, { departmentIds: [r.A.departmentId] })).map((p) => p.id)).toEqual([biz.id]);
    expect(await repos.policies.list(r.db, r.B.businessId)).toHaveLength(0);
  });

  it("approvals resolve exactly once and expire in bulk", async () => {
    const A = r.A.businessId;
    const a1 = await repos.approvals.create(r.db, A, { planActionId: r.A.planActionId, agentId: r.A.agentId, connectorKey: "sendgrid", tool: "send_mail", args: { to: "x@y.z" }, reasons: ["contactsThirdParty in augmented mode"] });
    const a2 = await repos.approvals.create(r.db, A, { agentId: r.A.agent2Id, connectorKey: "stripe", tool: "create_invoice" });
    expect(await repos.approvals.countPending(r.db, A)).toBe(2);
    expect((await repos.approvals.forPlanAction(r.db, A, r.A.planActionId))?.id).toBe(a1.id);
    const resolved = await repos.approvals.resolve(r.db, A, a1.id, { outcome: "approved", byId: r.A.ownerId });
    expect(resolved.resolvedAt).toBeInstanceOf(Date);
    await expect(repos.approvals.resolve(r.db, A, a1.id, { outcome: "rejected" })).rejects.toThrow(/already resolved \(approved\)/);
    await expect(repos.approvals.resolve(r.db, r.B.businessId, a2.id, { outcome: "approved" })).rejects.toThrow(/not found/);
    expect((await repos.approvals.pending(r.db, A)).map((a) => a.id)).toEqual([a2.id]);
    expect(await repos.approvals.expireBefore(r.db, A, new Date(Date.now() + 60_000))).toBe(1);
    expect((await repos.approvals.list(r.db, A, { outcome: ["expired"] })).items.map((a) => a.id)).toEqual([a2.id]);
    expect((await repos.approvals.list(r.db, A, { pending: false, connectorKey: "sendgrid" })).items).toHaveLength(1);
  });
});

describe("audit chain", () => {
  it("append links each entry to the previous hash and verify passes; tampering is detected", async () => {
    const A = r.A.businessId;
    const e1 = await repos.audit.append(r.db, A, { actorKind: "user", actorId: r.A.ownerId, action: "business.update", target: { id: A }, details: { name: "x" } });
    const e2 = await repos.audit.append(r.db, A, { actorKind: "agent", actorId: r.A.agentId, action: "tool.call", target: { connector: "github", tool: "open_pr" } });
    const [e3, e4] = await repos.audit.appendMany(r.db, A, [
      { actorKind: "system", action: "cycle.started" },
      { actorKind: "webhook", action: "stripe.invoice.paid", details: { amount: 100 } },
    ]);
    expect([e1, e2, e3!, e4!].map((e) => Number(e.seq))).toEqual([1, 2, 3, 4]);
    expect(e1.prevHash).toBeNull();
    expect(e2.prevHash).toBe(e1.hash);
    expect(e3!.prevHash).toBe(e2.hash);
    expect(e4!.prevHash).toBe(e3!.hash);
    for (const e of [e1, e2, e3!, e4!]) {
      expect(e.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(await repos.audit.hashOf(r.db, e)).toBe(e.hash);
    }
    expect(await repos.audit.verify(r.db, A)).toEqual({ ok: true, brokenSeq: null, length: 4 });
    expect((await repos.audit.head(r.db, A))?.id).toBe(e4!.id);

    // Business B's chain is independent and starts at seq 1.
    const b1 = await r.svc((tx) => repos.audit.append(tx, r.B.businessId, { actorKind: "system", action: "cycle.started" }));
    expect(Number(b1.seq)).toBe(1);
    expect(b1.prevHash).toBeNull();

    // A member appends through RLS; the trigger still computes the chain.
    const e5 = await r.as(r.A.memberId, (tx) => repos.audit.append(tx, A, { actorKind: "user", actorId: r.A.memberId, action: "task.create" }));
    expect(e5.prevHash).toBe(e4!.hash);
    await expect(r.as(r.A.viewerId, (tx) => repos.audit.append(tx, A, { actorKind: "user", actorId: r.A.viewerId, action: "sneak" }))).rejects.toThrow(/row-level security/);
    await expect(r.as(r.A.memberId, (tx) => repos.audit.append(tx, r.B.businessId, { actorKind: "user", actorId: r.A.memberId, action: "sneak" }))).rejects.toThrow(/row-level security/);

    const page1 = await repos.audit.list(r.db, A, { limit: 2 });
    expect(page1.items.map((e) => Number(e.seq))).toEqual([5, 4]);
    const page2 = await repos.audit.list(r.db, A, { limit: 2, cursor: page1.nextCursor });
    expect(page2.items.map((e) => Number(e.seq))).toEqual([3, 2]);
    expect((await repos.audit.list(r.db, A, { actionPrefix: "tool." })).items.map((e) => e.id)).toEqual([e2.id]);
    expect((await repos.audit.list(r.db, A, { actorKind: "webhook" })).items).toHaveLength(1);
    expect((await repos.audit.list(r.db, r.B.businessId)).items.map((e) => e.id)).toEqual([b1.id]);

    await r.db.execute(sql`alter table audit_log disable trigger audit_log_immutable`);
    try {
      await r.db.execute(sql`update audit_log set details = '{"amount": 1}'::jsonb where business_id = ${A}::uuid and seq = 4`);
    } finally {
      await r.db.execute(sql`alter table audit_log enable trigger audit_log_immutable`);
    }
    expect(await repos.audit.verify(r.db, A)).toMatchObject({ ok: false, brokenSeq: 4 });
    expect(await repos.audit.hashOf(r.db, e4!)).not.toBe(e4!.hash);
    await expect(repos.audit.append(r.db, A, { actorKind: "user", action: "bad kind" as never, actorId: "nope" as never })).rejects.toThrow(/Invalid audit entry/);
  });
});

describe("events and outbox", () => {
  it("writes through the outbox, orders un-narrated events by priority, de-duplicates by idempotency key", async () => {
    const A = r.A.businessId;
    const actor = { kind: "webhook", id: "stripe" } as const;
    const lead = await repos.events.write(r.db, A, { type: "lead.created", actor, payload: { source: "form" }, occurredAt: day("2026-10-01"), entityIds: [r.A.entityId] });
    const runway = await repos.events.write(r.db, A, { type: "runway.threshold_crossed", actor: { kind: "system", id: "finance" }, payload: { months: 2 }, occurredAt: day("2026-10-03") });
    const pay = await repos.events.write(r.db, A, { type: "payment.received", actor, payload: { amountMinor: 9900 }, occurredAt: day("2026-10-02"), idempotencyKey: "evt_1" });
    const dup = await repos.events.write(r.db, A, { type: "payment.received", actor, payload: { amountMinor: 9900 }, idempotencyKey: "evt_1" });
    expect(dup.id).toBe(pay.id);
    await expect(repos.events.write(r.db, A, { type: "not.an.event" as never, actor, payload: {} })).rejects.toThrow(/Invalid event/);

    const queue = await repos.events.unnarrated(r.db, A);
    const mine = queue.filter((e) => [lead.id, runway.id, pay.id].includes(e.id));
    expect(mine.map((e) => e.id)).toEqual([runway.id, pay.id, lead.id]);
    expect(await repos.events.markNarrated(r.db, A, [runway.id, pay.id])).toBe(2);
    expect(await repos.events.markNarrated(r.db, A, [runway.id])).toBe(0);
    expect((await repos.events.unnarrated(r.db, A)).map((e) => e.id)).not.toContain(runway.id);

    expect((await repos.events.list(r.db, A, { type: "lead.created" })).items.map((e) => e.id)).toEqual([lead.id]);
    expect((await repos.events.list(r.db, A, { entityId: r.A.entityId, narrated: false })).items.map((e) => e.id)).toContain(lead.id);
    expect((await repos.events.list(r.db, A, { from: day("2026-10-02"), to: day("2026-10-04") })).items.map((e) => e.id).sort()).toEqual([pay.id, runway.id].sort());
    expect((await repos.events.latestOfType(r.db, A, "payment.received"))?.id).toBe(pay.id);
    expect(await repos.events.countByType(r.db, A, { from: day("2026-10-01") })).toMatchObject({ "lead.created": 1, "payment.received": 1, "runway.threshold_crossed": 1 });
    expect((await repos.events.byIds(r.db, r.B.businessId, [lead.id, pay.id]))).toHaveLength(0);
    await expect(repos.events.get(r.db, r.B.businessId, lead.id)).rejects.toThrow(/not found/);

    const pending = await repos.events.outboxPending(r.db, A);
    expect(pending.map((p) => p.eventId)).toEqual(expect.arrayContaining([lead.id, runway.id, pay.id]));
    expect(pending.filter((p) => p.eventId === pay.id)).toHaveLength(1);
    expect(await repos.events.outboxCountPending(r.db, A)).toBe(pending.length);
  });
});
