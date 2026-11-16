/**
 * `gateModelClient` (SEC2): the gate runs before every call, sees its route and attribution, and a gate that throws
 * stops the call before the inner client is asked (nothing spent, no usage event). Streaming goes through the gate too,
 * whether or not the inner client streams.
 */
import { describe, expect, it } from "vitest";
import { gateModelClient, type ModelCallGate } from "./gate";
import { MockModelClient } from "./mock";
import { promptWith } from "./mock/fixtures.test-helpers";
import { ConceptCard, IdeationOutput } from "./schemas";
import { streamStructured } from "./structured-stream";
import type { ModelClient, UsageEvent } from "./types";

const IDEATION_INPUT = { prompt: "A skincare brand for people with eczema who want fragrance-free products", founder: { constraints: ["bootstrapped"] } };
const req = { route: "ideation" as const, system: "Draft cards.", messages: promptWith(IDEATION_INPUT), schema: IdeationOutput };

class Refused extends Error {}

describe("gateModelClient", () => {
  it("asks the gate with the call's route and attribution, then calls the inner client", async () => {
    const seen: Parameters<ModelCallGate>[0][] = [];
    const inner = new MockModelClient();
    const client = gateModelClient(inner, async (call) => void seen.push(call));
    expect(client.mode).toBe("mock");
    const out = await client.complete({ ...req, attribution: { businessId: "b-1", kind: "test" } });
    expect(out.json.concepts.length).toBeGreaterThan(0);
    expect(seen).toEqual([{ route: "ideation", attribution: { businessId: "b-1", kind: "test" } }]);
    expect(inner.history).toHaveLength(1);
  });

  it("a gate that throws refuses the call before it is made: no request, no usage event", async () => {
    const events: UsageEvent[] = [];
    const inner = new MockModelClient({ onUsage: (e) => void events.push(e) });
    const client = gateModelClient(inner, async (call) => {
      if (call.attribution?.businessId === "spent") throw new Refused("credits used up");
    });
    await expect(client.complete({ ...req, attribution: { businessId: "spent" } })).rejects.toBeInstanceOf(Refused);
    await expect(client.streamStructured!({ ...req, attribution: { businessId: "spent" }, elementPath: "concepts", elementSchema: ConceptCard })).rejects.toBeInstanceOf(Refused);
    expect(inner.history).toHaveLength(0);
    expect(events).toHaveLength(0);
    // Another business is not held back.
    const streamed = await client.streamStructured!({ ...req, attribution: { businessId: "fine" }, elementPath: "concepts", elementSchema: ConceptCard });
    expect(streamed.elements.length).toBeGreaterThan(0);
    expect(events.length).toBeGreaterThan(0);
  });

  it("streams for a client that cannot (its complete answers), through the gate once", async () => {
    const mock = new MockModelClient();
    const plain: ModelClient = { mode: "mock", complete: mock.complete.bind(mock) as ModelClient["complete"] };
    let gated = 0;
    const client = gateModelClient(plain, async () => {
      gated += 1;
    });
    const r = await streamStructured(client, { ...req, elementPath: "concepts", elementSchema: ConceptCard });
    expect(r.elements.length).toBeGreaterThan(0);
    expect(gated).toBe(1);
    expect(mock.history).toHaveLength(1);
  });

  it("a gate that says credits are low moves routine work to its lower-cost model and leaves founder-facing work alone", async () => {
    const events: UsageEvent[] = [];
    const inner = new MockModelClient({ onUsage: (e) => void events.push(e) });
    const client = gateModelClient(inner, async (call) => (call.attribution?.businessId === "low" ? { lowCredits: true } : undefined));
    const ask = (route: "worker" | "departmentLead" | "conversation" | "planCompiler", businessId: string) => client.complete({ route, system: "Answer.", messages: [{ role: "user", content: "Summarize the week." }], attribution: { businessId } });
    await ask("worker", "low");
    await ask("departmentLead", "low");
    await ask("conversation", "low");
    await ask("planCompiler", "low");
    await ask("worker", "fine");
    expect(events.map((e) => [e.route, e.modelKey])).toEqual([
      ["worker", "haiku"],
      ["departmentLead", "sonnet"],
      ["conversation", "sonnet"],
      ["planCompiler", "opus"],
      ["worker", "sonnet"],
    ]);
    expect(inner.history.map((r) => r.lowCredits ?? false)).toEqual([true, true, true, true, false]);
  });

  it("keeps its methods on the prototype, as the built-in clients do: a spread with its own complete has no stream of its own", async () => {
    const client = gateModelClient(new MockModelClient(), async () => undefined);
    const overridden: ModelClient = { ...client, complete: (async () => Promise.reject(new Refused("truncated"))) as ModelClient["complete"] };
    expect(overridden.mode).toBe("mock");
    expect(overridden.streamStructured).toBeUndefined();
    await expect(streamStructured(overridden, { ...req, elementPath: "concepts", elementSchema: ConceptCard })).rejects.toBeInstanceOf(Refused);
  });

  it("a client that cannot search stays one that cannot search; one that can keeps its search behind the gate", () => {
    const inner = new MockModelClient();
    const bare = { mode: inner.mode, complete: inner.complete.bind(inner) } as ModelClient;
    expect(gateModelClient(bare, async () => undefined).searchWeb).toBeUndefined();
    expect(typeof gateModelClient(inner, async () => undefined).searchWeb).toBe(typeof inner.searchWeb);
  });
});
