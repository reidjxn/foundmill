/** Procedures the wave-2 consumers call that the API lacked: product.sources, crm.entity.list/requestDeletion, finance.accounts.list, dashboard metrics, dev.sessions.replay events. */
import { repos, suppressionHash } from "@foundmill/db";
import { MemoryRedis, publishSessionEvent } from "@foundmill/events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { METRIC_IDS, matchMetric, totalInOneCurrency } from "../services/metrics";
import type { RecordingLike } from "../services/replay";
import { createApiHarness, type ApiHarness } from "./harness";

const RECORDING: RecordingLike = {
  key: "ledgerly-webhook-retry",
  title: "Retry failed Stripe webhook deliveries with backoff",
  summary: "An engineer agent adds exponential backoff.",
  outcome: "done",
  events: [
    { tMs: 0, event: { kind: "phase_changed", from: null, to: "planning", reason: "Reading the handler" } },
    { tMs: 1500, event: { kind: "note", text: "Tests are red: two retries missing", level: "info", source: "agent" } },
    { tMs: 4000, event: { kind: "progress", progress: 0.4, planStepsDone: 2, planSteps: 5, acceptanceTestsPassing: 1, acceptanceTests: 3, reviewPassed: false, merged: false, etaAt: null } },
    { tMs: 9000, event: { kind: "nonsense" } },
  ],
};

describe("consumer procedure gaps", () => {
  let hz: ApiHarness;
  const redis = new MemoryRedis();
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "gaps", redis, recordings: async (ref) => (ref === RECORDING.key ? RECORDING : null) });
  }, 120_000);
  afterAll(() => hz.close());

  it("product.sources.add/list/get/remove with the module's input shape; viewers cannot add", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    const added = await owner.product.sources.add({ businessId, kind: "competitor", uri: "https://competitor.example/pricing", title: "", relevance: { summary: "Their pricing page" } });
    expect(added.title).toBe("https://competitor.example/pricing");
    expect(added.kind).toBe("competitor");
    expect((added.relevance as { summary: string; addedBy: string })).toMatchObject({ summary: "Their pricing page", addedBy: "user" });
    await expect(owner.product.sources.add({ businessId, kind: "doc", uri: null, title: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const list = await owner.product.sources.list({ businessId, limit: 200 });
    expect(list.items.map((s) => s.id)).toContain(added.id);
    expect(list.nextCursor).toBeNull();
    const only = await owner.product.sources.list({ businessId, kind: "competitor", limit: 200 });
    expect(only.items.every((s) => s.kind === "competitor")).toBe(true);
    expect((await owner.product.sources.get({ businessId, sourceId: added.id })).id).toBe(added.id);
    await expect(hz.caller({ userId: hz.A.viewerId }).product.sources.add({ businessId, kind: "doc", uri: "https://x.example", title: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hz.caller({ userId: hz.B.ownerId }).product.sources.list({ businessId, limit: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const removed = await owner.product.sources.remove({ businessId, sourceId: added.id });
    expect(removed.archivedAt).not.toBeNull();
    expect((await owner.product.sources.list({ businessId, limit: 200 })).items.map((s) => s.id)).not.toContain(added.id);
    const audit = await repos.audit.list(hz.db, businessId, { action: ["product.sources.add", "product.sources.remove"] });
    expect(audit.items).toHaveLength(2);
  });

  it("crm.entity.list pages the CRM; crm.entity.requestDeletion suppresses the person at once and schedules the purge", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId, entityId } = hz.A;
    const list = await owner.crm.entity.list({ businessId, limit: 500 });
    expect(list.items.map((e) => e.id)).toContain(entityId);
    expect(list.items.every((e) => e.businessId === businessId)).toBe(true);
    const people = await owner.crm.entity.list({ businessId, kind: "person", limit: 10 });
    expect(people.items.every((e) => e.kind === "person")).toBe(true);

    const before = await repos.entities.get(hz.db, businessId, entityId);
    const req = await owner.crm.entity.requestDeletion({ businessId, entityId, reason: "GDPR request by email" });
    expect(req.status).toBe("requested");
    expect(req.delayDays).toBe(7);
    expect(Date.parse(req.earliestAt) - Date.parse(req.requestedAt)).toBe(7 * 86_400_000);
    // Nothing is deleted now; the record is flagged for the nightly purge and its address is suppressed at once.
    const entity = await repos.entities.get(hz.db, businessId, entityId);
    expect(entity.archivedAt).toBeNull();
    expect(entity.deletionDueAt?.toISOString()).toBe(req.earliestAt);
    expect(req.suppressed).toBeGreaterThan(0);
    const email = String((before.identifiers as { email?: string }).email);
    expect(await repos.channels.isSuppressed(hz.db, businessId, { emailHash: suppressionHash("email", email) })).toBe(true);
    expect((await repos.entities.deletionsDue(hz.db, new Date(Date.parse(req.earliestAt) + 1_000))).some((d) => d.entityId === entityId)).toBe(true);
    const notes = await owner.crm.notes.list({ businessId, entityId });
    expect(JSON.stringify(notes)).toMatch(/Deletion requested by/);
    const audit = await repos.audit.list(hz.db, businessId, { action: "crm.entity.request_deletion" });
    expect(audit.items).toHaveLength(1);
    // Asking again keeps the first dates and adds no second note or audit entry.
    const again = await owner.crm.entity.requestDeletion({ businessId, entityId });
    expect(again).toMatchObject({ already: true, earliestAt: req.earliestAt });
    expect((await repos.audit.list(hz.db, businessId, { action: "crm.entity.request_deletion" })).items).toHaveLength(1);
    await expect(hz.caller({ userId: hz.A.viewerId }).crm.entity.requestDeletion({ businessId, entityId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("finance.accounts.list returns the connected accounts (read-only)", async () => {
    const accounts = await hz.caller({ userId: hz.A.ownerId }).finance.accounts.list({ businessId: hz.A.businessId });
    expect(accounts.map((a) => a.id)).toEqual([hz.A.accountId]);
    // The fixture writes the account without a currency: it takes the business's own (0025; USD by default).
    expect(accounts[0]).toMatchObject({ provider: "mock_bank", name: "Main", currency: "USD" });
    await expect(hz.caller({ userId: hz.B.ownerId }).finance.accounts.list({ businessId: hz.A.businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("dashboard.customMetric.list/get and compileMetric: catalogue queries only, never founder SQL (AC-11.2.5)", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    const catalogue = await owner.dashboard.customMetric.list({ businessId });
    expect(catalogue.map((m) => m.id)).toEqual(METRIC_IDS);
    const customers = await owner.dashboard.customMetric.get({ businessId, queryId: "customers_30d" });
    // The fixture recorded two payments moments ago.
    expect(customers).toMatchObject({ value: 2, format: "integer", label: "Customers won, last 30 days", estimate: null });
    const cash = await owner.dashboard.customMetric.get({ businessId, queryId: "cash" });
    expect(cash).toMatchObject({ value: 0, currency: "USD", format: "money" });
    // Model spend is metered in the pricing currency, whatever the business uses.
    expect(await owner.dashboard.customMetric.get({ businessId, queryId: "spend_30d" })).toMatchObject({ currency: "USD", estimate: "estimate" });
    const runway = await owner.dashboard.customMetric.get({ businessId, queryId: "runway_months" });
    expect(runway.value).toBeNull();
    expect(runway.estimate).toBe("estimate");

    // Amounts in several currencies are never added together (revenue used to sum GBP and EUR under one label).
    expect(totalInOneCurrency([{ amountMinor: 500, currency: "GBP" }, { amountMinor: 700, currency: "EUR" }, { amountMinor: 300, currency: "GBP" }], "GBP")).toEqual({ value: 800, currency: "GBP", leftOut: true });
    expect(totalInOneCurrency([{ amountMinor: 700, currency: "EUR" }, { amountMinor: 100, currency: "EUR" }], "GBP")).toEqual({ value: 800, currency: "EUR", leftOut: false });
    expect(totalInOneCurrency([], "USD")).toEqual({ value: 0, currency: "USD", leftOut: false });
    const revenue = await owner.dashboard.customMetric.get({ businessId, queryId: "revenue_30d" });
    expect(revenue).toMatchObject({ format: "money", currency: expect.stringMatching(/^[A-Z]{3}$/) });

    expect(matchMetric("How much cash do we have in the bank?")?.queryId).toBe("cash");
    expect(matchMetric("customers won in the last 30 days")?.queryId).toBe("customers_30d");
    expect(matchMetric("what is our runway")?.queryId).toBe("runway_months");
    const compiled = await owner.dashboard.compileMetric({ businessId, sentence: "sign-ups this month" });
    expect(compiled.queryId).toBe("signups_30d");
    expect(compiled.sql).toMatch(/^select /);
    expect(compiled.preview.value).toBe(2);
    // The compiled sql round-trips; anything else is refused without touching the database.
    const bySql = await owner.dashboard.customMetric.get({ businessId, sql: compiled.sql });
    expect(bySql.value).toBe(2);
    await expect(owner.dashboard.customMetric.get({ businessId, sql: "select count(*) from businesses" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(owner.dashboard.customMetric.get({ businessId, sql: "delete from tasks" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(owner.dashboard.customMetric.get({ businessId, queryId: "nope" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(owner.dashboard.compileMetric({ businessId, sentence: "zebras per fortnight" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("custom metrics follow section permissions (RA-02): staff walled from Finance get no cash, burn, runway or spend", async () => {
    const { businessId } = hz.A;
    await repos.memberships.setSectionPermissions(hz.db, businessId, hz.A.memberId, { finance: "none", development: "none", distribution: "none" });
    try {
      const member = hz.caller({ userId: hz.A.memberId });
      await expect(member.finance.overview({ businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
      for (const queryId of ["cash", "net_burn", "runway_months", "revenue_30d", "spend_30d", "tasks_running", "tasks_done", "cpa_blended", "channels_enabled", "customers_30d"]) {
        await expect(member.dashboard.customMetric.get({ businessId, queryId }), queryId).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      // The catalogue SQL text is the same metric: no way around the wall.
      const cashSql = (await hz.caller({ userId: hz.A.ownerId }).dashboard.compileMetric({ businessId, sentence: "cash in bank" })).sql;
      await expect(member.dashboard.customMetric.get({ businessId, sql: cashSql })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(member.dashboard.compileMetric({ businessId, sentence: "cash in bank" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(member.dashboard.compileMetric({ businessId, sentence: "agent spend cost" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      // What the member may read still works, and the catalogue offers only that.
      expect((await member.dashboard.customMetric.list({ businessId })).map((m) => m.id)).toEqual(["agents_active"]);
      expect((await member.dashboard.customMetric.get({ businessId, queryId: "agents_active" })).format).toBe("integer");
      // Read access is enough to read (a viewer reads everything by default).
      await repos.memberships.setSectionPermissions(hz.db, businessId, hz.A.memberId, { finance: "read" });
      expect((await member.dashboard.customMetric.get({ businessId, queryId: "cash" })).label).toBe("Cash in bank");
      expect((await hz.caller({ userId: hz.A.viewerId }).dashboard.customMetric.list({ businessId })).map((m) => m.id)).toEqual(METRIC_IDS);
    } finally {
      await repos.memberships.setSectionPermissions(hz.db, businessId, hz.A.memberId, {});
    }
  });

  it("dev.sessions.replay returns the recorded events: from the session stream when Redis has them, else from the mock recording", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId, sessionId, agent2Id, taskId } = hz.A;
    // Stream path: the orchestrator published two events for the fixture session.
    await publishSessionEvent(redis, sessionId, { kind: "note", text: "Starting on the task", level: "info", source: "agent" });
    await publishSessionEvent(redis, sessionId, { kind: "phase_changed", from: "planning", to: "implementing", reason: null });
    const streamed = await owner.dev.sessions.replay({ businessId, sessionId });
    expect(streamed.source).toBe("stream");
    expect(streamed.events.map((e) => e.kind)).toEqual(["note", "phase_changed"]);
    expect(streamed.channel).toBe(`as:${sessionId}`);
    expect(streamed.live).toBe(true);
    const onlyNotes = await owner.dev.sessions.replay({ businessId, sessionId, kinds: ["note"] });
    expect(onlyNotes.events).toHaveLength(1);

    // Recording path: a finished mock session with a recording_ref and nothing on the stream.
    const startedAt = new Date("2026-10-01T09:00:00.000Z");
    const recorded = await repos.agents.createSession(hz.db, businessId, { agentId: agent2Id, taskId, modelKey: "sonnet", startedAt, recordingRef: RECORDING.key });
    await repos.agents.endSession(hz.db, businessId, recorded.id, { endedAt: new Date(startedAt.getTime() + 10_000), outcome: "done", recordingRef: RECORDING.key });
    const replayed = await owner.dev.sessions.replay({ businessId, sessionId: recorded.id });
    expect(replayed.source).toBe("recording");
    expect(replayed.recording?.key).toBe(RECORDING.key);
    expect(replayed.total).toBe(4);
    // The invalid entry is skipped; `at` is placed on the session's timeline.
    expect(replayed.events.map((e) => e.kind)).toEqual(["phase_changed", "note", "progress"]);
    expect(replayed.events[1]!.at).toBe(new Date(startedAt.getTime() + 1500).toISOString());
    expect(replayed.live).toBe(false);

    // Unknown recording → empty with a reason; other tenants cannot read it.
    const unknown = await repos.agents.createSession(hz.db, businessId, { agentId: agent2Id, taskId, modelKey: "sonnet", recordingRef: "not-bundled" });
    const none = await owner.dev.sessions.replay({ businessId, sessionId: unknown.id });
    expect(none.source).toBe("none");
    expect(none.events).toEqual([]);
    expect(none.reason).toMatch(/not bundled/);
    await expect(hz.caller({ userId: hz.B.ownerId }).dev.sessions.replay({ businessId: hz.B.businessId, sessionId: recorded.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
