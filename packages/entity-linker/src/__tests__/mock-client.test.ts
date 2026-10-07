/**
 * The pipeline against the real `MockModelClient` from @foundmill/models (MODEL_MODE=mock, no network).
 *
 * Two things are verified that the stub-based suites cannot: the mock half of AC-11.3.1 with the *actual* mock
 * composer (100 consecutive `inboxComposer` notes validate against the manifest they were given), and that the sweep
 * stays offline-safe when the real mock client answers its `linker` call with a shape it did not ask for (the mock
 * route returns `LinkerOutput`, the client synthesises something schema-shaped, and nothing synthetic may become a link).
 */
import { ComposerOutput, MockModelClient, type ChatMessage } from "@foundmill/models";
import { describe, expect, it } from "vitest";
import { buildManifest, checkComposerText, entityIdsInTree, linkComposerText, sweep, validateMarkup, type LinkerModelClient, type ManifestEntityInput } from "../index";
import { createRng, FIXTURE_IDS, fixtureManifest, uuidFor } from "../testing";

// Compile-time contract: the models package's client is a LinkerModelClient without adapters.
const asLinkerClient = (client: MockModelClient): LinkerModelClient => client;

const AGENT_PRIYA = uuidFor("mock:agent-priya");
const AGENT_TOMAS = uuidFor("mock:agent-tomas");
const EVENT = (i: number): string => uuidFor(`mock:event-${i}`);

const ENTITIES: readonly ManifestEntityInput[] = [
  { id: FIXTURE_IDS.meridian, kind: "organisation", name: "Meridian Labs", aliases: ["Meridian"], role: "supplier" },
  { id: FIXTURE_IDS.saraLindqvist, kind: "person", name: "Sara Lindqvist", aliases: [], role: "procurement lead", org: "Meridian Labs" },
  { id: FIXTURE_IDS.nordicPackaging, kind: "organisation", name: "Nordic Packaging AB", aliases: ["Nordic Packaging", "NPAB"] },
  { id: FIXTURE_IDS.glowCollective, kind: "organisation", name: "Glow Collective", aliases: ["Glow"] },
  { id: AGENT_PRIYA, kind: "agent", name: "Priya Natarajan", aliases: [], role: "Distribution strategist" },
  { id: AGENT_TOMAS, kind: "agent", name: "Tomas Berg", aliases: [], role: "Backend engineer" },
  { id: FIXTURE_IDS.hiddenInvestor, kind: "person", name: "Hidden Investor", aliases: [], visible: false },
];

const manifest = buildManifest(ENTITIES);

/** The convention every mock generator reads: structured inputs as a fenced JSON block in the user message. */
function promptWith(input: Record<string, unknown>): ChatMessage[] {
  return [{ role: "user", content: `Write the note.\n\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\`` }];
}

const EVENT_SHAPES: ReadonlyArray<(i: number) => Record<string, unknown>> = [
  (i) => ({ id: EVENT(i), type: "payment.received", payload: { customer_id: FIXTURE_IDS.glowCollective, amount_minor: 48900 + i * 100, currency: "EUR", channel_key: "email_automation" } }),
  (i) => ({ id: EVENT(i), type: "channel.threshold_breached", payload: { channel_key: "paid_ads", metric: "cpa", value: 30 + i, cap: 25 } }),
  (i) => ({ id: EVENT(i), type: "runway.threshold_crossed", payload: { months: 2.5 } }),
  (i) => ({ id: EVENT(i), type: "task.completed", payload: { agent_id: AGENT_TOMAS, title: `Retail portal checkout ${i}` } }),
  (i) => ({ id: EVENT(i), type: "approval.requested", payload: { agent_id: AGENT_PRIYA, title: "Influencer seeding budget", amount_minor: 120000, currency: "EUR" } }),
  (i) => ({ id: EVENT(i), type: "message.received", payload: { entity_id: FIXTURE_IDS.saraLindqvist, subject: "Wholesale terms" } }),
  (i) => ({ id: EVENT(i), type: "signup.created", payload: { customer_name: "Helios Energy GmbH", channel_key: "seo" } }),
  (i) => ({ id: EVENT(i), type: "contract.signed", payload: { title: "Supply agreement with Meridian Labs", entity_id: FIXTURE_IDS.meridian } }),
  (i) => ({ id: EVENT(i), type: "cycle.completed", payload: { title: `Cycle ${i}` } }),
  // The invisible entity named in an event: the composer may not link it (it is not in the manifest it sees).
  (i) => ({ id: EVENT(i), type: "message.received", payload: { entity_id: FIXTURE_IDS.hiddenInvestor, subject: "Term sheet" } }),
];

function composerInput(i: number): Record<string, unknown> {
  const shape = EVENT_SHAPES[i % EVENT_SHAPES.length] as (n: number) => Record<string, unknown>;
  const fromAgent = i % 2 === 0 ? { id: AGENT_PRIYA, name: "Priya Natarajan", role: "Distribution strategist" } : { id: AGENT_TOMAS, name: "Tomas Berg", role: "Backend engineer" };
  return {
    business: { name: "Northwind Skincare", brief: "Clean skincare for sensitive skin, sold direct and through retail partners." },
    from_agent: fromAgent,
    source_events: i % 7 === 6 ? [] : [shape(i)],
    metrics: [
      { metric: "mrr", value: 12450 + i, source: "stripe.mrr" },
      { metric: "runway_months", value: 14, source: "finance.runway" },
    ],
    named_queries: [{ id: "q_mrr_12w", title: "MRR last twelve weeks", kind: "chart" }],
    // What the composer prompt carries: the visible manifest only (BUILD §11.3), straight from `Manifest.toJSON()`.
    manifest: manifest.toJSON(),
  };
}

describe("AC-11.3.1 (mock half): 100 consecutive notes from the real mock composer", () => {
  it("every note validates, survives the pipeline and renders only visible manifest ids", async () => {
    const client = new MockModelClient();
    const linker = asLinkerClient(client);
    let mentions = 0;
    let reasks = 0;
    for (let i = 0; i < 100; i++) {
      const r = await client.complete({ route: "inboxComposer", messages: promptWith(composerInput(i)), schema: ComposerOutput });
      const body = r.json.body_md;
      const check = checkComposerText(body, manifest, 0);
      if (!check.ok) reasks++;
      expect(check.ok, `note ${i} failed validation: ${JSON.stringify(check.validation)}\n${body}`).toBe(true);
      mentions += check.validation.mentionCount;
      for (const id of check.validation.entityIds) expect(manifest.isVisible(id)).toBe(true);

      const linked = await linkComposerText(body, manifest, linker, { businessId: "biz" });
      expect(validateMarkup(linked.text, manifest).valid, `note ${i} after sweep`).toBe(true);
      for (const id of entityIdsInTree(linked.tree)) expect(manifest.isVisible(id), `note ${i} rendered ${id}`).toBe(true);
      for (const l of linked.sweep.linked) expect(manifest.isVisible(l.id), `note ${i} sweep-linked ${l.id}`).toBe(true);
      expect(linked.text).not.toContain(FIXTURE_IDS.hiddenInvestor);
    }
    expect(reasks).toBe(0);
    expect(mentions).toBeGreaterThan(50);
    // Every model call the sweep made went to the Haiku linker route, and only when something was ambiguous.
    const sweepCalls = client.history.filter((h) => h.route === "linker");
    for (const call of sweepCalls) expect(call.attribution?.kind).toBe("entity_sweep");
  });

  it("the mock composer with an empty manifest writes no markup, and the sweep then drafts the names it used", async () => {
    const client = new MockModelClient();
    const empty = buildManifest([]);
    const input = { ...composerInput(0), manifest: [] };
    const r = await client.complete({ route: "inboxComposer", messages: promptWith(input), schema: ComposerOutput });
    const v = validateMarkup(r.json.body_md, empty);
    expect(v.valid).toBe(true);
    expect(v.mentionCount).toBe(0);
    const linked = await linkComposerText(r.json.body_md, empty, client);
    expect(linked.entityIds).toEqual([]);
    expect(linked.tree.every((n) => n.type !== "entity")).toBe(true);
  });
});

describe("sweep with the real MockModelClient (offline, deterministic)", () => {
  const m = fixtureManifest();

  it("calls the linker route once for ambiguous spans and never accepts a synthetic answer", async () => {
    const client = new MockModelClient();
    const r = await sweep("Sara from Meridian will follow up with Nordic Packaging.", m, client, { attribution: { businessId: "biz" } });
    expect(r.usedModel).toBe(true);
    expect(client.history).toHaveLength(1);
    expect(client.history[0]?.route).toBe("linker");
    expect(client.history[0]?.attribution).toEqual({ businessId: "biz", kind: "entity_sweep" });
    // The mock `linker` route answers with LinkerOutput, not the sweep's resolution schema; whatever the client
    // synthesises cannot name a candidate id, so "Sara" stays ambiguous and nothing is guessed.
    expect(r.modelResolved).toBe(0);
    expect(r.ambiguous.map((a) => a.text)).toEqual(["Sara"]);
    expect(r.linked.map((l) => [l.text, l.id])).toEqual([
      ["Meridian", FIXTURE_IDS.meridian],
      ["Nordic Packaging", FIXTURE_IDS.nordicPackaging],
    ]);
    expect(validateMarkup(r.text, m).valid).toBe(true);
    expect(r.text).toBe(`Sara from [[ent:${FIXTURE_IDS.meridian}|Meridian]] will follow up with [[ent:${FIXTURE_IDS.nordicPackaging}|Nordic Packaging]].`);
  });

  it("is deterministic across clients and does not call the model when nothing is ambiguous", async () => {
    const text = "Sara met Johan at Glow; Acme Robotics Inc. sent samples.";
    const a = await sweep(text, m, new MockModelClient());
    const b = await sweep(text, m, new MockModelClient());
    expect(a).toEqual(b);
    const quiet = new MockModelClient();
    await sweep("Meridian Labs and Stripe replied.", m, quiet);
    expect(quiet.history).toHaveLength(0);
  });

  it("a route failure in the mock client is reported, not thrown, and the spans stay ambiguous", async () => {
    const client = new MockModelClient({ failWith: { linker: new Error("linker route down") } });
    const r = await sweep("Sara will follow up.", m, client);
    expect(r.modelError).toBe("linker route down");
    expect(r.ambiguous).toHaveLength(1);
    expect(r.text).toBe("Sara will follow up.");
  });

  it("meters every linker call through the client's usage sink with the sweep's attribution", async () => {
    const events: Array<{ route: string; kind?: string; businessId?: string }> = [];
    const client = new MockModelClient({ onUsage: (e) => void events.push({ route: e.route, kind: e.attribution?.kind, businessId: e.attribution?.businessId }) });
    const rng = createRng("metering");
    for (let i = 0; i < 5; i++) await sweep(`Sara ${rng.pick(["called", "wrote", "met Johan"])}.`, m, client, { attribution: { businessId: "biz" } });
    expect(events).toHaveLength(5);
    expect(events.every((e) => e.route === "linker" && e.kind === "entity_sweep" && e.businessId === "biz")).toBe(true);
  });
});
