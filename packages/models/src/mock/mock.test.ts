import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ModelOutputError } from "../errors";
import { ROUTES, type RouteKey } from "../routing";
import { ClassifierOutput } from "../schemas";
import type { UsageEvent } from "../types";
import { MOCK_ROUTES, MockModelClient, listMockRoutes } from "./index";
import { AGENTS, COMPOSER_INPUT, MANIFEST, ORG_ALDER, PERSON_MARA, promptWith } from "./fixtures.test-helpers";

/** Realistic inputs per route. */
const SAMPLE_INPUT: Record<RouteKey, Record<string, unknown>> = {
  inboxComposer: COMPOSER_INPUT,
  planCompiler: { reply: "spend up to €500 on LinkedIn ads targeting fintech CFOs next week", manifest: MANIFEST, agents: AGENTS },
  chiefOfStaff: {
    business_name: "Northwind Skincare",
    max_agents: 3,
    budget_remaining_minor: 250000,
    tasks: [
      { id: "t1", title: "Fix checkout bug for retail customers", kind: "code", status: "ready", department_id: "dept-eng" },
      { id: "t2", title: "Draft Q4 newsletter", kind: "channel", status: "planned", department_id: "dept-dist" },
      { id: "t3", title: "Polish settings page", kind: "code", status: "planned", department_id: "dept-eng" },
      { id: "t4", title: "Supplier RFQ round two", kind: "specialist", status: "blocked", department_id: "dept-ops" },
    ],
    agents: AGENTS,
  },
  departmentLead: {
    department: { id: "dept-eng", name: "Engineering" },
    goal: "Ship the retail portal",
    tasks: [
      { id: "t1", title: "Fix checkout bug", kind: "code", status: "ready", department_id: "dept-eng" },
      { id: "t5", title: "Write the onboarding email sequence", kind: "channel", status: "ready", department_id: "dept-eng" },
    ],
    agents: AGENTS,
  },
  planner: { roadmap_items: [{ id: "r1", title: "Retail partner portal", description: "A page where retail partners place orders and see invoices" }, { id: "r2", title: "Stripe payment webhooks", description: "Record invoice.paid events" }] },
  codeReview: { diff: "diff --git a/apps/api/src/routers/orders.ts b/apps/api/src/routers/orders.ts\n--- a/apps/api/src/routers/orders.ts\n+++ b/apps/api/src/routers/orders.ts\n@@ -1,3 +1,6 @@\n+const rows = await db.select().from(orders);\n+console.log(rows);\n+const key = process.env.STRIPE_KEY;\n" },
  ideation: { prompt: "A skincare brand for people with eczema who want fragrance-free products", founder: { skills: { engineering: 8, sales: 14, design: 12, finance: 9, domain: 16 }, constraints: ["bootstrapped"] } },
  skillGrader: { rubric: ["Tests pass", "Follows the design system", "Explains trade-offs"], deterministic: [{ criterion: "Tests pass", passed: true }], output: "Implemented the widget with Dugout components, tests pass, trade-offs documented in the PR." },
  coach: { instructions: { role: "Backend engineer", goals: ["Ship reliable APIs"], rules: ["Ask before schema changes"], playbook: ["Read the task"], tone: "Precise", examples: [] }, skill_results: [{ skill: "Testing", tested: 9, proven: 7 }, { skill: "Communication", tested: 11 }], focus_skills: ["Testing", "Communication", "Cost efficiency"] },
  worker: { task: { id: "t1", title: "Fix checkout bug for retail customers", kind: "code" } },
  journeyCommentary: {
    customer: { id: ORG_ALDER, name: "Alder & Finch" },
    conversion_kind: "payment",
    touches: [{ channel_key: "seo", kind: "visit" }, { channel_key: "email_automation", kind: "open", campaign: "Welcome series" }, { channel_key: "email_automation", kind: "click" }],
    manifest: MANIFEST,
  },
  nightlyBatch: { job: "journeyDailyRefresh", items: [{ id: "j1", title: "Journey 1" }, { id: "j2", title: "Journey 2" }] },
  linker: { text: "Met Mara at Alder & Finch yesterday; Northwind is growing and Zed Corp is new.", manifest: MANIFEST },
  classifier: { labels: ["billing", "bug", "feature_request"], text: "The invoice total is wrong and I was charged twice" },
  categoriser: { transactions: [{ id: "tx1", description: "AWS EMEA", amount_minor: -12050 }, { id: "tx2", description: "STRIPE PAYOUT", amount_minor: 48900 }, { id: "tx3", description: "Google Ads", amount_minor: -30000 }] },
  quarantinedReader: { fields: ["price", "moq", "lead_time_days"], content: "Unit price: €4.20 per unit. MOQ 500 units. Lead time 21 days." },
  moderation: { kind: "email", text: "Subject: Welcome\n\nThanks for joining Northwind. Sent by the team at Northwind Skincare Ltd. Unsubscribe any time." },
};

describe("MockModelClient", () => {
  it("lists every route with its resolved model and a description", () => {
    const routes = listMockRoutes();
    expect(routes.map((r) => r.route).sort()).toEqual(Object.keys(ROUTES).sort());
    expect(routes.find((r) => r.route === "inboxComposer")).toMatchObject({ model: "claude-opus-5-5", locked: true });
    expect(routes.find((r) => r.route === "nightlyBatch")).toMatchObject({ batch: true, modelKey: "sonnet" });
    for (const r of routes) expect(r.description.length).toBeGreaterThan(20);
  });

  it("every route returns output valid for its default schema with realistic inputs", async () => {
    const client = new MockModelClient();
    for (const route of Object.keys(MOCK_ROUTES) as RouteKey[]) {
      const def = MOCK_ROUTES[route];
      const result = await client.complete({ route, system: "You are an agent.", messages: promptWith(SAMPLE_INPUT[route]), schema: def.schema });
      expect(result.json, route).toBeDefined();
      expect(def.schema.safeParse(result.json).success, route).toBe(true);
      expect(result.repaired, `${route} should come from its handcrafted generator`).toBe(false);
      expect(result.mode).toBe("mock");
      expect(result.stopReason).toBe("end_turn");
      expect(result.usage.inputTokens).toBeGreaterThan(0);
      expect(result.usage.outputTokens).toBeGreaterThan(0);
      expect(result.cost.label).toBe("Estimate");
    }
  });

  it("every route also copes with prose-only prompts (no JSON inputs)", async () => {
    const client = new MockModelClient();
    for (const route of Object.keys(MOCK_ROUTES) as RouteKey[]) {
      const def = MOCK_ROUTES[route];
      const result = await client.complete({ route, messages: [{ role: "user", content: "Please do the thing for Northwind Skincare and report back." }], schema: def.schema });
      expect(def.schema.safeParse(result.json).success, route).toBe(true);
    }
  });

  it("is deterministic: same input → identical output; different input → different output", async () => {
    const a = new MockModelClient();
    const b = new MockModelClient();
    const req = { route: "ideation" as const, messages: promptWith(SAMPLE_INPUT.ideation), schema: MOCK_ROUTES.ideation.schema };
    const r1 = await a.complete(req);
    const r2 = await b.complete(req);
    expect(r1.text).toBe(r2.text);
    const r3 = await a.complete({ ...req, messages: promptWith({ prompt: "A B2B SaaS for freight forwarders" }) });
    expect(r3.text).not.toBe(r1.text);
  });

  it("falls back to a schema-driven synthesis for schemas the generator does not know", async () => {
    const Custom = z.object({
      headline: z.string().min(5).max(60),
      bullets: z.array(z.string().min(3)).min(3).max(5),
      score: z.int().min(1).max(10),
      tags: z.array(z.enum(["growth", "risk", "ops"])).min(1),
      owner: z.object({ id: z.string().uuid(), email: z.string().email() }),
      due: z.iso.datetime().nullable(),
      notes: z.string().optional(),
    });
    const client = new MockModelClient();
    const result = await client.complete({ route: "worker", messages: [{ role: "user", content: "Summarise the sourcing situation for Northwind." }], schema: Custom });
    expect(result.repaired).toBe(true);
    expect(Custom.safeParse(result.json).success).toBe(true);
    expect(result.json.bullets.length).toBeGreaterThanOrEqual(3);
    expect(result.json.score).toBeGreaterThanOrEqual(1);
    expect(result.json.score).toBeLessThanOrEqual(10);
  });

  it("supports route overrides, failure injection and records history", async () => {
    const boom = new Error("simulated outage");
    const client = new MockModelClient({ overrides: { classifier: () => ({ label: "forced", confidence: 0.99, reasons: ["override"] }) }, failWith: { moderation: boom } });
    const r = await client.complete({ route: "classifier", messages: [{ role: "user", content: "x" }], schema: ClassifierOutput });
    expect(r.json.label).toBe("forced");
    await expect(client.complete({ route: "moderation", messages: [{ role: "user", content: "x" }] })).rejects.toBe(boom);
    expect(client.history).toHaveLength(2);
  });

  it("emits usage events with metered cost and counts a repeated cached system prompt as a cache read", async () => {
    const events: UsageEvent[] = [];
    const client = new MockModelClient({ onUsage: (e) => void events.push(e) });
    const system = "Club rules. ".repeat(200);
    const req = { route: "worker" as const, system, messages: [{ role: "user" as const, content: "go" }], cacheSystem: true, scope: "s1", attribution: { agentId: "a1" } };
    const first = await client.complete(req);
    const second = await client.complete(req);
    expect(first.usage.cacheCreationInputTokens).toBeGreaterThan(0);
    expect(first.usage.cacheReadInputTokens).toBe(0);
    expect(second.usage.cacheReadInputTokens).toBe(first.usage.cacheCreationInputTokens);
    expect(second.usage.cacheCreationInputTokens).toBe(0);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ route: "worker", mode: "mock", scope: "s1", attribution: { agentId: "a1" }, model: "claude-sonnet-5-5" });
    expect(events[0]!.cost.costMicroMinor).toBeGreaterThan(0);
    expect(second.cost.costMicroMinor).toBeLessThan(first.cost.costMicroMinor);
  });

  it("honours locked routes and warns", async () => {
    const warnings: string[] = [];
    const client = new MockModelClient({ logger: { debug() {}, info() {}, warn: (_o, m) => void warnings.push(m ?? ""), error() {} } });
    const r = await client.complete({ route: "inboxComposer", modelOverride: "haiku", messages: promptWith(COMPOSER_INPUT) });
    expect(r.model).toBe("claude-opus-5-5");
    expect(r.warning).toMatch(/locked/);
    expect(warnings).toHaveLength(1);
  });

  it("throws ModelOutputError for a schema it cannot satisfy", async () => {
    const Impossible = z.object({ x: z.string() }).refine(() => false, { message: "never" });
    const client = new MockModelClient();
    await expect(client.complete({ route: "worker", messages: [{ role: "user", content: "x" }], schema: Impossible })).rejects.toBeInstanceOf(ModelOutputError);
  });

  it("returns raw objects as json when no schema is given", async () => {
    const client = new MockModelClient();
    const r = await client.complete({ route: "linker", messages: promptWith({ text: `Call ${"Mara"} tomorrow`, manifest: MANIFEST }) });
    expect(r.json).toBeDefined();
    expect((r.json as { mentions: Array<{ entity_id: string | null }> }).mentions.some((m) => m.entity_id === PERSON_MARA)).toBe(true);
    expect(() => JSON.parse(r.text)).not.toThrow();
  });
});
