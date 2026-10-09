/**
 * Mock parity for `streamStructured`: the same fixture as `complete()`, delivered element by element, paced only when
 * MOCK_MODEL_LATENCY_MS / MOCK_MODEL_STREAM_MS (or the client options) ask for it.
 */
import { resetEnvCache } from "@foundmill/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createModelClient } from "../client";
import { ModelAbortedError } from "../errors";
import { ConceptCard, FoundationsOutput, FoundationsSection, FoundationsSkeletonOutput, IdeationOutput, IdeationSlateItem, IdeationSlateOutput, LogoDesignOutput, LogoMarkDraft } from "../schemas";
import { streamStructured } from "../structured-stream";
import type { UsageEvent } from "../types";
import { promptWith } from "./fixtures.test-helpers";
import { MockModelClient } from "./index";

const IDEATION_INPUT = { prompt: "A skincare brand for people with eczema who want fragrance-free products", founder: { constraints: ["bootstrapped"] } };
const FOUNDATIONS_INPUT = {
  business: { name: "Ledgerly", archetype: "b2b_saas", currency: "EUR" },
  door: "ideation",
  outline: [{ section: "Problem" }, { section: "Customers" }, { section: "Features" }, { section: "Pricing" }],
  idea: { title: "Ledgerly", pitch: "Ledgerly helps independent accountants cut a weekly chore to minutes." },
};

describe("MockModelClient.streamStructured", () => {
  it("streams the same concepts complete() returns, one element at a time and in order", async () => {
    const events: UsageEvent[] = [];
    const client = new MockModelClient({ onUsage: (e) => void events.push(e) });
    const req = { route: "ideation" as const, system: "Draft cards.", messages: promptWith(IDEATION_INPUT), schema: IdeationOutput };
    const whole = await client.complete(req);
    const seen: number[] = [];
    const streamed = await client.streamStructured({ ...req, elementPath: "concepts", elementSchema: ConceptCard, onElement: (e) => void seen.push(e.index) });
    expect(streamed.json).toEqual(whole.json);
    expect(streamed.elements).toEqual(whole.json.concepts);
    expect(seen).toEqual(whole.json.concepts.map((_, i) => i));
    expect(streamed.mode).toBe("mock");
    expect(streamed.calls).toBe(1);
    expect(streamed.repaired).toBe(false);
    expect(streamed.usage).toEqual(whole.usage);
    expect(streamed.cost.label).toBe("Estimate");
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ route: "ideation", mode: "mock", streamed: true, attempt: 0 });
    expect(client.history).toHaveLength(2);
  });

  it("is instant by default and paces the stream when latency and per-element time are set", async () => {
    const log: string[] = [];
    const sleep = async (ms: number) => void log.push(`sleep:${ms}`);
    const client = new MockModelClient({ latencyMs: 900, streamElementMs: 150, sleep });
    const r = await client.streamStructured({
      route: "logoDesigner",
      messages: promptWith({ business_name: "Northwind Skincare", count: 3, brand_colours: { primary: "#1b4fd8", secondary: "#f5c400" } }),
      schema: LogoDesignOutput,
      elementPath: "marks",
      elementSchema: LogoMarkDraft,
      onElement: (e) => void log.push(`mark:${e.index}`),
      onPartial: (p) => {
        if (p.phase === "streaming" && p.elementsEmitted === 0 && !log.includes("first-text")) log.push("first-text");
      },
    });
    const marks = r.json.marks.length;
    expect(marks).toBeGreaterThan(0);
    const expected = ["sleep:900", "first-text"];
    for (let i = 0; i < marks; i++) expected.push("sleep:150", `mark:${i}`);
    expect(log).toEqual(expected);

    const instant: string[] = [];
    const fast = new MockModelClient({ sleep: async (ms) => void instant.push(`sleep:${ms}`) });
    await fast.streamStructured({ route: "logoDesigner", messages: promptWith({ business_name: "Northwind Skincare" }), schema: LogoDesignOutput, elementPath: "marks", elementSchema: LogoMarkDraft });
    expect(instant).toEqual([]);
  });

  it("streams foundations sections and the new draft routes with valid fixtures", async () => {
    const client = new MockModelClient();
    const sections: string[] = [];
    const f = await client.streamStructured({ route: "foundations", messages: promptWith(FOUNDATIONS_INPUT), schema: FoundationsOutput, elementPath: "sections", elementSchema: FoundationsSection, onElement: (e) => void sections.push(e.value.section) });
    expect(sections).toEqual(f.json.sections.map((s) => s.section));
    expect(sections.length).toBeGreaterThanOrEqual(4);

    const skeleton = await client.complete({ route: "foundationsSkeleton", messages: promptWith(FOUNDATIONS_INPUT), schema: FoundationsSkeletonOutput });
    expect(skeleton.repaired).toBe(false);
    expect(skeleton.json.sections.map((s) => s.section)).toEqual(f.json.sections.map((s) => s.section));
    expect(skeleton.json.vision.statement).toBe(f.json.vision.statement);
    for (const s of skeleton.json.sections) expect(s.thesis.length).toBeGreaterThan(10);

    const slate = await client.streamStructured({ route: "ideationSlate", messages: promptWith(IDEATION_INPUT), schema: IdeationSlateOutput, elementPath: "slate", elementSchema: IdeationSlateItem });
    expect(slate.repaired).toBe(false);
    expect(slate.elements.length).toBeGreaterThanOrEqual(6);
    expect(new Set(slate.elements.map((s) => s.name)).size).toBe(slate.elements.length);
  });

  it("honours the abort signal", async () => {
    const controller = new AbortController();
    const client = new MockModelClient();
    const run = client.streamStructured({
      route: "ideation",
      messages: promptWith(IDEATION_INPUT),
      schema: IdeationOutput,
      elementPath: "concepts",
      elementSchema: ConceptCard,
      signal: controller.signal,
      onElement: (e) => {
        if (e.index === 1) controller.abort();
      },
    });
    await expect(run).rejects.toBeInstanceOf(ModelAbortedError);
  });

  it("is what streamStructured(client, req) uses for the mock client", async () => {
    const client = new MockModelClient();
    const seen: number[] = [];
    const r = await streamStructured(client, { route: "ideation", messages: promptWith(IDEATION_INPUT), schema: IdeationOutput, elementPath: "concepts", elementSchema: ConceptCard, onElement: (e) => void seen.push(e.index) });
    expect(seen).toHaveLength(r.elements.length);
    expect(client.history).toHaveLength(1);
  });
});

describe("createModelClient (mock) reads the simulated latency from the environment", () => {
  afterEach(() => {
    delete process.env.MOCK_MODEL_LATENCY_MS;
    delete process.env.MOCK_MODEL_STREAM_MS;
    resetEnvCache();
  });

  it("defaults to no waiting and applies MOCK_MODEL_LATENCY_MS / MOCK_MODEL_STREAM_MS when set", async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => void sleeps.push(ms);
    resetEnvCache();
    const plain = createModelClient({ mode: "mock", mock: { sleep } });
    await plain.complete({ route: "classifier", messages: promptWith({ labels: ["a", "b"], text: "a" }) });
    expect(sleeps).toEqual([]);

    process.env.MOCK_MODEL_LATENCY_MS = "400";
    process.env.MOCK_MODEL_STREAM_MS = "50";
    resetEnvCache();
    const slow = createModelClient({ mode: "mock", mock: { sleep } });
    const r = await streamStructured(slow, { route: "logoDesigner", messages: promptWith({ business_name: "Northwind Skincare", count: 2 }), schema: LogoDesignOutput, elementPath: "marks", elementSchema: LogoMarkDraft });
    expect(sleeps[0]).toBe(400);
    expect(sleeps.slice(1)).toEqual(r.elements.map(() => 50));

    process.env.MOCK_MODEL_LATENCY_MS = "not a number";
    resetEnvCache();
    const tolerant = createModelClient({ mode: "mock", mock: { sleep: async (ms) => void sleeps.push(-ms) } });
    await tolerant.complete({ route: "classifier", messages: promptWith({ labels: ["a"], text: "a" }) });
    expect(sleeps.filter((ms) => ms < 0)).toEqual([]);
  });
});

describe("MockModelClient.complete honours the abort signal (live parity)", () => {
  it("makes no call for an aborted request and answers nothing when aborted during the simulated wait", async () => {
    const pre = new AbortController();
    pre.abort();
    const idle = new MockModelClient();
    await expect(idle.complete({ route: "worker", messages: [{ role: "user", content: "go" }], signal: pre.signal })).rejects.toBeInstanceOf(ModelAbortedError);
    expect(idle.history).toHaveLength(0);

    const during = new AbortController();
    let usage = 0;
    const slow = new MockModelClient({ latencyMs: 50, sleep: async () => void during.abort(), onUsage: () => void usage++ });
    await expect(slow.complete({ route: "worker", messages: [{ role: "user", content: "go" }], signal: during.signal })).rejects.toBeInstanceOf(ModelAbortedError);
    expect(usage).toBe(0);
  });
});
