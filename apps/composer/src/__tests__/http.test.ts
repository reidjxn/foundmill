/**
 * HTTP surface on an ephemeral port: /health, /v1/narrate, /v1/refresh, /v1/commentary, /v1/chapter-title,
 * /v1/exhibits, validation and error mapping, and the credits gate's 402. The server is stopped after the suite.
 */
import { spendAllCredits } from "@foundmill/db/testing/credits";
import { serve } from "@hono/node-server";
import { periodOf, repos } from "@foundmill/db";
import { validateMarkup } from "@foundmill/entity-linker";
import { gateModelClient } from "@foundmill/models";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { parseQuarter, provisionalTitle, quarterOf, titleAcceptable, type QuarterFacts } from "../chapter";
import { createComposerService } from "../service";
import { creditsGate } from "../usage";
import { createComposerHarness, type ComposerHarness } from "./harness";

let hz: ComposerHarness;
let base = "";
let server: ReturnType<typeof serve>;

beforeAll(async () => {
  hz = await createComposerHarness("http");
  const app = createApp(hz.service(), { env: { APP_ENV: "test", INTEGRATIONS_MODE: "mock", MODEL_MODE: "mock" } });
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info: AddressInfo) => {
      base = `http://127.0.0.1:${info.port}`;
      resolve();
    });
  });
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await hz.close();
});

const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("composer HTTP", () => {
  it("GET /health reports the database and modes", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, service: "composer", db: true, modes: { integrations: "mock", models: "mock" } });
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("GET /health answers 503 without a database (Railway's healthcheck holds traffic on the previous deployment)", async () => {
    // The harness's service, with a database that does not answer.
    const service: ReturnType<typeof hz.service> = Object.assign(Object.create(hz.service()), { healthy: async () => false });
    const down = createApp(service, { env: { APP_ENV: "test", INTEGRATIONS_MODE: "mock", MODEL_MODE: "mock" } });
    const res = await down.request("/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, service: "composer", db: false });
  });

  it("POST /v1/narrate writes one item and returns it with its id", async () => {
    const event = await hz.writeEvent(hz.A.businessId, "payment.received", { amount: { amountMinor: 2500, currency: "EUR" } }, [hz.A.entityId]);
    const res = await post("/v1/narrate", { businessId: hz.A.businessId, eventIds: [event.id] });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { inboxItemId: string; item: { id: string; type: string; sourceEventIds: string[] }; cost: { label: string } };
    expect(json.item.id).toBe(json.inboxItemId);
    expect(json.item.sourceEventIds).toEqual([event.id]);
    expect(json.cost.label).toBe("Estimate");
    expect((await repos.inbox.get(hz.db, hz.A.businessId, json.inboxItemId)).id).toBe(json.inboxItemId);
    // A retry of the same narration (the orchestrator's activity retry) gets the same note back, marked replayed.
    const retry = await post("/v1/narrate", { businessId: hz.A.businessId, eventIds: [event.id] });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ inboxItemId: json.inboxItemId, replayed: true, cost: { amountMinor: 0, label: "Estimate" } });
  });

  it("POST /v1/refresh returns exactly one item", async () => {
    const before = (await repos.inbox.list(hz.db, hz.A.businessId, { limit: 500 })).items.length;
    const res = await post("/v1/refresh", { businessId: hz.A.businessId });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { inboxItemId: string; slot: string; source: string; debounced: boolean };
    expect(["events", "insight", "decision"]).toContain(json.slot);
    expect(json.debounced).toBe(false);
    expect((await repos.inbox.list(hz.db, hz.A.businessId, { limit: 500 })).items.length).toBe(before + 1);
  });

  it("validates bodies (400), maps not-found (404) and composer errors, and answers JSON 404 on unknown routes", async () => {
    expect((await post("/v1/narrate", { businessId: "nope", eventIds: [] })).status).toBe(400);
    // Parked tasks (WP-05 T18): at most three, each a short title.
    const tooMany = Array.from({ length: 4 }, (_, i) => ({ title: `Task ${i}` }));
    expect((await post("/v1/narrate", { businessId: hz.A.businessId, eventIds: [hz.A.eventIds[0]], parked: tooMany })).status).toBe(400);
    expect((await post("/v1/narrate", { businessId: hz.A.businessId, eventIds: [hz.A.eventIds[0]], parked: [{ title: "" }] })).status).toBe(400);
    expect((await fetch(`${base}/v1/refresh`, { method: "POST", body: "{not json", headers: { "content-type": "application/json" } })).status).toBe(400);
    const missing = await post("/v1/narrate", { businessId: hz.A.businessId, eventIds: [crypto.randomUUID()] });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: "not_found" });
    const cross = await post("/v1/narrate", { businessId: hz.A.businessId, eventIds: [hz.B.eventIds[0]] });
    expect(cross.status).toBe(404);
    const nope = await fetch(`${base}/nope`);
    expect(nope.status).toBe(404);
    expect(await nope.json()).toMatchObject({ error: "not_found" });
  });

  it("GET /v1/exhibits lists the registry; GET /v1/exhibits/:id runs a named query for a business", async () => {
    const list = (await (await fetch(`${base}/v1/exhibits`)).json()) as { queries: { id: string }[] };
    expect(list.queries.map((q) => q.id)).toContain("conversions_30d");
    const data = await fetch(`${base}/v1/exhibits/conversions_30d?businessId=${hz.A.businessId}`);
    expect(data.status).toBe(200);
    expect(await data.json()).toMatchObject({ id: "conversions_30d", kind: "chart" });
    expect((await fetch(`${base}/v1/exhibits/made_up?businessId=${hz.A.businessId}`)).status).toBe(404);
    expect((await fetch(`${base}/v1/exhibits/conversions_30d`)).status).toBe(400);
  });

  it("POST /v1/commentary writes one validated line per touch plus the goal, persisted on the journey", async () => {
    const touches = await repos.journeys.recordTouches(hz.db, hz.A.businessId, [
      { entityId: hz.A.entityId, channelKey: "seo", kind: "visit", occurredAt: new Date(Date.now() - 3 * 86_400_000), source: { agentId: hz.A.agent2Id } },
      { entityId: hz.A.entityId, channelKey: "email_automation", kind: "email_open", occurredAt: new Date(Date.now() - 86_400_000), campaignId: hz.A.campaignId },
      { entityId: hz.A.entityId, channelKey: "events", kind: "checkout", occurredAt: new Date() },
    ]);
    const journey = await repos.journeys.create(hz.db, hz.A.businessId, {
      conversionId: hz.A.conversionIds[2]!,
      touchIds: touches.map((t) => t.id),
      weights: Object.fromEntries(touches.map((t, i) => [t.id, [0.4, 0.2, 0.4][i]!])),
      matchdayLevel: "cup",
      agents: [{ agentId: hz.A.agent2Id, name: "Engineer", contribution: 0.4 }],
    });
    const res = await post("/v1/commentary", { businessId: hz.A.businessId, journeyId: journey.id });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { headline: string; lines: { text: string; touchId: string | null; touchIndex: number | null; tone: string; highlight: boolean }[]; stripped: number };
    expect(json.headline.length).toBeGreaterThan(0);
    expect(json.lines.length).toBeGreaterThanOrEqual(touches.length);
    expect(json.lines.some((l) => l.highlight)).toBe(true);
    const manifest = await hz.manifest(hz.A.businessId);
    for (const line of json.lines) {
      expect(validateMarkup(line.text, manifest).valid).toBe(true);
      if (line.touchIndex !== null) expect(line.touchId).toBe(touches[line.touchIndex]!.id);
    }
    const stored = await repos.journeys.get(hz.db, hz.A.businessId, journey.id);
    expect(stored.commentary).toHaveLength(json.lines.length);
    expect((stored.commentary[0] as { text: string }).text).toBe(json.lines[0]!.text);
    expect((await post("/v1/commentary", { businessId: hz.B.businessId, journeyId: journey.id })).status).toBe(404);
  });

  it("POST /v1/chapter-title names the quarter from real facts (model answer or the provisional fallback)", async () => {
    const quarter = quarterOf(new Date());
    const res = await post("/v1/chapter-title", { businessId: hz.A.businessId, quarter });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { quarter: string; label: string; title: string; mood: string; source: string; facts: QuarterFacts };
    expect(json.quarter).toBe(quarter);
    expect(json.label).toBe(parseQuarter(quarter).label);
    expect(["model", "provisional"]).toContain(json.source);
    expect(titleAcceptable(json.title, json.facts)).toBe(true);
    expect(json.facts.customersWon).toBe((await repos.journeys.countConversions(hz.db, hz.A.businessId, parseQuarter(quarter))).payment);
    const byChapterId = await post("/v1/chapter-title", { businessId: hz.A.businessId, chapterId: "2025-Q1" });
    expect(((await byChapterId.json()) as { quarter: string }).quarter).toBe("2025-Q1");
    expect((await post("/v1/chapter-title", { businessId: hz.A.businessId, quarter: "Q3" })).status).toBe(400);
  });
});

describe("the credits gate (SEC2 S2)", () => {
  it("a note for a business whose credits are used up is refused with 402 credits_exhausted before any model call; nothing is booked", async () => {
    const B = hz.B.businessId;
    const gated = createComposerService({ db: hz.db, models: gateModelClient(hz.models, creditsGate(hz.db, false)), log: hz.log }, { debounceMs: 0, persistDrafts: false });
    const app = createApp(gated, { env: { APP_ENV: "test", INTEGRATIONS_MODE: "mock", MODEL_MODE: "mock" } });
    const narrate = async (eventId: string) => app.request("/v1/narrate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ businessId: B, eventIds: [eventId] }) });
    // While credits are left the note is written and booked.
    const first = await hz.writeEvent(B, "payment.received", { amount: { amountMinor: 900, currency: "EUR" } }, [hz.B.entityId]);
    expect((await narrate(first.id)).status).toBe(200);

    await spendAllCredits(hz.db, B, periodOf(new Date()));
    const booked = hz.usage.length;
    const notes = (await repos.inbox.list(hz.db, B, { limit: 500 })).items.length;
    const event = await hz.writeEvent(B, "payment.received", { amount: { amountMinor: 1200, currency: "EUR" } }, [hz.B.entityId]);
    const res = await narrate(event.id);
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: "credits_exhausted", message: expect.stringMatching(/^The team is resting: this month's team budget is used/), details: { reason: "exhausted", businessId: B } });
    expect(hz.usage.length).toBe(booked);
    expect((await repos.inbox.list(hz.db, B, { limit: 500 })).items.length).toBe(notes);
  });
});

describe("chapter title rules", () => {
  const facts: QuarterFacts = { quarter: "2026-Q3", label: "Q3 2026", from: "2026-07-01", to: "2026-09-30", signups: 12, activations: 4, customersWon: 3, milestones: ["First customer"], decisionsMade: 2, events: 40, inboxItems: 9 };
  it("accepts 3–6 word titles without hype or invented numbers", () => {
    expect(titleAcceptable("First customers won", facts)).toBe(true);
    expect(titleAcceptable("Three customers and twelve signups", facts)).toBe(true);
    expect(titleAcceptable("Won", facts)).toBe(false);
    expect(titleAcceptable("A revolutionary quarter for us", facts)).toBe(false);
    expect(titleAcceptable("Fifty customers won: 50", facts)).toBe(false);
    expect(titleAcceptable("Three customers won in Q3.", facts)).toBe(false);
  });
  it("the provisional title is deterministic and grounded", () => {
    expect(provisionalTitle(facts)).toMatchObject({ title: "A chapter of firsts", mood: "breakthrough" });
    expect(provisionalTitle({ ...facts, milestones: [] }).title).toBe("First customers won");
    expect(provisionalTitle({ ...facts, milestones: [], customersWon: 0, signups: 0, activations: 0, decisionsMade: 0, events: 0 }).title).toBe("A quiet opening chapter");
    expect(titleAcceptable(provisionalTitle(facts).title, facts)).toBe(true);
    const quiet = { ...facts, milestones: [], customersWon: 0, signups: 0, activations: 0, decisionsMade: 0, events: 0 };
    expect(provisionalTitle({ ...quiet, signups: 2 }).title).toBe("First names through the door");
    expect(provisionalTitle({ ...quiet, events: 5 }).title).toBe("Building the foundations");
    // Sentence case (DESIGN §4, §10): only the first word is capitalized.
    for (const f of [facts, { ...facts, milestones: [] }, { ...quiet, signups: 2 }, { ...quiet, events: 5 }, quiet]) expect(provisionalTitle(f).title.split(" ").slice(1).every((w) => w === w.toLowerCase())).toBe(true);
  });
});
