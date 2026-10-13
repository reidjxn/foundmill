/**
 * Drafting concepts (audit P2): a short slate first, then one card call per slate item in parallel, each card saved
 * and reported the moment it is ready. `idea.generate` answers with the finished set (Import, older callers);
 * `idea.draft` streams the same draft for the Studio. A failed card is retried on its own; the set must still hold
 * 6-12 concepts (AC-11.1.2); stopping the stream stops the model calls.
 */
import { IDEATION_CARD_MAX_TOKENS, IDEATION_CARD_RESERVE_TOKENS, IDEATION_SLATE_MAX_TOKENS } from "@foundmill/agents";
import { repos } from "@foundmill/db";
import { MockModelClient, ModelAbortedError, ModelBillingError, ModelOutputError, ModelUnavailableError, type CompleteRequest, type ModelClient } from "@foundmill/models";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { SINGLE_CONCEPT_MAX_TOKENS, type DraftEvent } from "../routers/idea";
import { concurrencyLimit, IDEATION_LIMITS, IDEATION_TOO_LONG_MESSAGE, takeIdeationAllowance } from "../services/ideation";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "ideagen" });
}, 120_000);
afterAll(() => hz.close());

const callerFor = async (models: ModelClient, email: string) => {
  const userId = await hz.h.createUser(email);
  const { createCaller } = await import("../router");
  return { userId, caller: createCaller({ ...hz.deps, models }, { userId, email }) };
};

async function collect(stream: AsyncIterable<DraftEvent>): Promise<DraftEvent[]> {
  const out: DraftEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

/** A slate of `n` items (overrides the mock's own slate size, which follows the prompt's seed). */
const slateOf = (n: number) => () => ({ slate: Array.from({ length: n }, (_, i) => ({ id: `concept-${i}`, name: `Concept ${i}`, archetype: "b2b_saas", angle: `Angle ${i}: who it serves and how it wins.` })) });

/** The concept a card request names. */
const conceptOf = (req: CompleteRequest): string => /"name":"([^"]+)"/.exec(req.messages[0]?.content ?? "")?.[1] ?? "";

describe("idea.generate", () => {
  it("drafts a slate, then one card per slate item on the shared cached prefix, and saves 6-12 ideas", async () => {
    const mock = new MockModelClient();
    const createMany = vi.spyOn(repos.ideas, "createMany");
    const create = vi.spyOn(repos.ideas, "create");
    try {
      const { caller } = await callerFor(mock, "ideas@test.local");
      const r = await caller.idea.generate({ prompt: "AI agents that help EU companies expand to the US" });
      expect(r.ideas.length).toBeGreaterThanOrEqual(6);
      expect(r.ideas.length).toBeLessThanOrEqual(12);
      expect(r.costLabel).toBe("Estimate");
      const [slate, ...cards] = mock.history;
      expect(slate!.route).toBe("ideationSlate");
      expect(slate!.maxTokens).toBe(IDEATION_SLATE_MAX_TOKENS);
      expect(cards).toHaveLength(r.ideas.length);
      for (const card of cards) {
        expect(card).toMatchObject({ route: "ideation", maxTokens: IDEATION_CARD_MAX_TOKENS, reserveTokens: IDEATION_CARD_RESERVE_TOKENS, cacheSystem: true });
        expect(card.system).toEqual(slate!.system);
      }
      expect(String(slate!.system)).toMatch(/evidence is at most 25 words/);
      // Every idea is named after its slate item, in slate order.
      expect(r.ideas.map((i) => i.title)).toEqual(cards.map(conceptOf));
      // Saved in batches, never one transaction per card.
      expect(create).not.toHaveBeenCalled();
      expect(createMany.mock.calls.length).toBeLessThan(r.ideas.length);
      for (const idea of r.ideas) expect(idea.current?.id).toBe(idea.currentVersionId);
    } finally {
      createMany.mockRestore();
      create.mockRestore();
    }
  });

  it("drafts a single card for Import's Continue to Commit, without a slate", async () => {
    const mock = new MockModelClient();
    const { caller } = await callerFor(mock, "import@test.local");
    const r = await caller.idea.generate({ prompt: "Import report: Lpgp", archetypeHint: "b2b_saas", single: true });
    expect(r.ideas).toHaveLength(1);
    expect(mock.history).toHaveLength(1);
    expect(mock.history[0]).toMatchObject({ route: "ideation", maxTokens: SINGLE_CONCEPT_MAX_TOKENS });
    expect(mock.history[0]!.messages[0]!.content).toMatch(/Draft exactly one concept card/);
  });

  it("explains a draft that ran out of room instead of showing the model error", async () => {
    // A client that only completes (no streaming), so the slate falls back to `complete` and is cut off there.
    const truncated: ModelClient = {
      mode: hz.deps.models.mode,
      complete: (async () => {
        throw new ModelOutputError('Output truncated at max_tokens=3000 before valid JSON was produced for route "ideationSlate"', {}, "max_tokens");
      }) as ModelClient["complete"],
    };
    const { caller } = await callerFor(truncated, "ideas2@test.local");
    await expect(caller.idea.generate({ prompt: "x" })).rejects.toThrow(IDEATION_TOO_LONG_MESSAGE);
  });

  it("retries a failed card on its own and keeps the rest of the set", async () => {
    const mock = new MockModelClient({ overrides: { ideationSlate: slateOf(8) } });
    let failedOnce = false;
    const flaky: ModelClient = {
      mode: "mock",
      streamStructured: (req) => mock.streamStructured(req),
      complete: ((req: CompleteRequest) => {
        if (req.route === "ideation" && conceptOf(req) === "Concept 3" && !failedOnce) {
          failedOnce = true;
          return Promise.reject(new ModelUnavailableError("overloaded"));
        }
        return mock.complete(req as never);
      }) as ModelClient["complete"],
    };
    const { caller } = await callerFor(flaky, "retry@test.local");
    const events = await collect(await caller.idea.draft({ prompt: "retry one card" }));
    const done = events.at(-1);
    expect(done).toMatchObject({ type: "done", total: 8, failed: 0 });
    expect(events.filter((e) => e.type === "writing" && e.index === 3).map((e) => (e as { attempt: number }).attempt)).toEqual([1, 2]);
    // Only the failed card was asked again: eight cards, nine card calls.
    expect(mock.history.filter((r) => r.route === "ideation")).toHaveLength(8);
    expect(events.filter((e) => e.type === "writing" && e.index !== 3).every((e) => (e as { attempt: number }).attempt === 1)).toBe(true);
  });

  it("fails the draft with the billing message when the model account cannot pay for a card", async () => {
    const mock = new MockModelClient({ overrides: { ideationSlate: slateOf(8) } });
    const asked: string[] = [];
    const broke: ModelClient = {
      mode: "mock",
      streamStructured: (req) => mock.streamStructured(req),
      complete: ((req: CompleteRequest) => {
        if (req.route !== "ideation") return mock.complete(req as never);
        asked.push(conceptOf(req));
        return Promise.reject(new ModelBillingError("credit balance is too low", "credit_balance", "credits", 400));
      }) as ModelClient["complete"],
    };
    const { caller } = await callerFor(broke, "billing@test.local");
    await expect(collect(await caller.idea.draft({ prompt: "no credit" }))).rejects.toMatchObject({ code: "PAYMENT_REQUIRED", message: expect.stringMatching(/out of credit/) });
    // Final at once: no card is asked twice.
    expect(new Set(asked).size).toBe(asked.length);
  });

  it("finishes the set without a card that fails twice, as long as six remain", async () => {
    const mock = new MockModelClient({ overrides: { ideationSlate: slateOf(7) } });
    const broken: ModelClient = {
      mode: "mock",
      streamStructured: (req) => mock.streamStructured(req),
      complete: ((req: CompleteRequest) => (req.route === "ideation" && conceptOf(req) === "Concept 5" ? Promise.reject(new ModelUnavailableError("down")) : mock.complete(req as never))) as ModelClient["complete"],
    };
    const { caller } = await callerFor(broken, "sixleft@test.local");
    const events = await collect(await caller.idea.draft({ prompt: "one card breaks" }));
    expect(events.find((e) => e.type === "card_failed")).toMatchObject({ index: 5, name: "Concept 5" });
    expect(events.at(-1)).toMatchObject({ type: "done", total: 7, failed: 1 });
    expect((events.at(-1) as Extract<DraftEvent, { type: "done" }>).ideas.map((i) => i.title)).toEqual(["Concept 0", "Concept 1", "Concept 2", "Concept 3", "Concept 4", "Concept 6"]);
  });

  it("reports a set that fell below six, keeping the cards it finished", async () => {
    const mock = new MockModelClient({ overrides: { ideationSlate: slateOf(6) } });
    const broken: ModelClient = {
      mode: "mock",
      streamStructured: (req) => mock.streamStructured(req),
      complete: ((req: CompleteRequest) => (req.route === "ideation" && conceptOf(req) === "Concept 2" ? Promise.reject(new ModelUnavailableError("down")) : mock.complete(req as never))) as ModelClient["complete"],
    };
    const { caller, userId } = await callerFor(broken, "fewer@test.local");
    await expect(caller.idea.generate({ prompt: "too few" })).rejects.toThrow(/finished 5 of 6 concepts/);
    const kept = (await repos.ideas.listForUser(hz.db, userId)).items.map((i) => i.title).sort();
    expect(kept).toEqual(["Concept 0", "Concept 1", "Concept 3", "Concept 4", "Concept 5"]);
  });
});

describe("idea.draft limits and errors", () => {
  it("never drafts more than twelve concepts, even when the slate runs on", async () => {
    const mock = new MockModelClient();
    const longSlate: ModelClient = {
      mode: "mock",
      complete: ((req: CompleteRequest) => mock.complete(req as never)) as ModelClient["complete"],
      streamStructured: (async (req: { onElement?: (e: unknown) => Promise<void> | void }) => {
        for (let i = 0; i < 14; i++) await req.onElement?.({ index: i, value: slateOf(14)().slate[i], path: "slate", repaired: false, elapsedMs: 0 });
        throw new ModelOutputError("Model output did not match the schema", {});
      }) as unknown as ModelClient["streamStructured"],
    };
    const { caller } = await callerFor(longSlate, "fourteen@test.local");
    const events = await collect(await caller.idea.draft({ prompt: "too many" }));
    expect(events.filter((e) => e.type === "outline")).toHaveLength(12);
    expect(events.at(-1)).toMatchObject({ type: "done", total: 12, failed: 0 });
    expect(mock.history.filter((r) => r.route === "ideation")).toHaveLength(12);
  });

  it("ends the draft on a refused slate, even after six concepts were named, and saves no card from it", async () => {
    const mock = new MockModelClient({ latencyMs: 20 });
    const refused: ModelClient = {
      mode: "mock",
      complete: ((req: CompleteRequest) => mock.complete(req as never)) as ModelClient["complete"],
      streamStructured: (async (req: { onElement?: (e: unknown) => Promise<void> | void }) => {
        for (let i = 0; i < 6; i++) await req.onElement?.({ index: i, value: slateOf(6)().slate[i], path: "slate", repaired: false, elapsedMs: 0 });
        throw new ModelOutputError("Model refused the request", {}, "refusal");
      }) as unknown as ModelClient["streamStructured"],
    };
    const { caller, userId } = await callerFor(refused, "refused@test.local");
    await expect(collect(await caller.idea.draft({ prompt: "refused brief" }))).rejects.toThrow();
    expect((await repos.ideas.listForUser(hz.deps.db, userId)).items).toHaveLength(0);
  });

  it("maps errors raised inside the stream like any other procedure's", async () => {
    const { caller } = await callerFor(new MockModelClient(), "badjob@test.local");
    await expect(collect(await caller.idea.draft({ prompt: "x", importJobId: "not-a-real-import-job" }))).rejects.toMatchObject({ code: "BAD_REQUEST", message: "That import job cannot be linked to a new business" });
    const tooLong: ModelClient = { mode: "mock", complete: (async () => { throw new ModelOutputError("truncated", {}, "max_tokens"); }) as ModelClient["complete"] };
    const second = await callerFor(tooLong, "toolong@test.local");
    await expect(collect(await second.caller.idea.draft({ prompt: "x" }))).rejects.toMatchObject({ code: "BAD_GATEWAY", message: IDEATION_TOO_LONG_MESSAGE });
  });
});

describe("drafting allowance (security review 2026-10-10)", () => {
  it("bounds drafts per person: past the allowance a draft is refused before any model call; another founder is unaffected", async () => {
    hz.limits.reset();
    const mock = new MockModelClient();
    const { userId, caller } = await callerFor(mock, "ideas-allowance@test.local");
    // A set is a slate plus up to twelve cards (each retried once): every draft must count, streamed or not.
    for (let i = 0; i < IDEATION_LIMITS.hour.limit; i++) await takeIdeationAllowance(hz.limits, userId);
    await expect(caller.idea.generate({ prompt: "x" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    await expect(caller.idea.generate({ prompt: "x", single: true })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    await expect(collect(await caller.idea.draft({ prompt: "x" }))).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS", message: expect.stringMatching(/Drafting limit reached/) });
    expect(mock.history).toHaveLength(0);

    const other = await callerFor(new MockModelClient(), "ideas-allowance-other@test.local");
    expect((await other.caller.idea.generate({ prompt: "x", single: true })).ideas).toHaveLength(1);
    hz.limits.reset();
  });

  it("a draft refused for a bad import job spends no allowance", async () => {
    hz.limits.reset();
    const { userId, caller } = await callerFor(new MockModelClient(), "ideas-allowance-bad@test.local");
    for (let i = 0; i < IDEATION_LIMITS.hour.limit - 1; i++) await takeIdeationAllowance(hz.limits, userId);
    await expect(caller.idea.generate({ prompt: "x", importJobId: "not-a-real-import-job" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // The last draft of the hour is still there.
    expect((await caller.idea.generate({ prompt: "x", single: true })).ideas).toHaveLength(1);
    await expect(caller.idea.generate({ prompt: "x", single: true })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    hz.limits.reset();
  });
});

describe("idea.draft (streamed)", () => {
  it("streams who is drafting, each concept's name, then each card already saved, then done", async () => {
    // A little writing time per slate item, so cards start while the slate is still arriving (as they do live).
    const mock = new MockModelClient({ streamElementMs: 2 });
    const { caller, userId } = await callerFor(mock, "stream@test.local");
    const stream = await caller.idea.draft({ prompt: "bookkeeping for freelancers in the EU" });
    const events: DraftEvent[] = [];
    for await (const e of stream) {
      events.push(e);
      // Saved before it is reported: the idea is already in the founder's deck.
      if (e.type === "idea") expect((await repos.ideas.get(hz.db, userId, e.idea.id)).title).toBe(e.idea.title);
    }
    expect(events[0]).toMatchObject({ type: "started", agent: "Ideation agent", single: false, mode: "mock" });
    const done = events.at(-1) as Extract<DraftEvent, { type: "done" }>;
    expect(done.type).toBe("done");
    expect(done.total).toBeGreaterThanOrEqual(6);
    expect(done.total).toBeLessThanOrEqual(12);
    const outlines = events.filter((e): e is Extract<DraftEvent, { type: "outline" }> => e.type === "outline");
    const ideas = events.filter((e): e is Extract<DraftEvent, { type: "idea" }> => e.type === "idea");
    expect(outlines.map((e) => e.index)).toEqual(outlines.map((_, i) => i));
    expect(ideas).toHaveLength(done.total);
    expect(done.ideas.map((i) => i.id)).toEqual([...ideas].sort((a, b) => a.index - b.index).map((e) => e.idea.id));
    // Each card is reported after its own outline, carrying the outlined name.
    for (const e of ideas) {
      const at = events.indexOf(e);
      const outline = outlines.find((o) => o.index === e.index)!;
      expect(events.indexOf(outline)).toBeLessThan(at);
      expect(e.idea.title).toBe(outline.name);
    }
    // Cards started before the slate was complete (the fan-out overlaps the slate).
    expect(events.findIndex((e) => e.type === "writing")).toBeLessThan(events.findIndex((e) => e.type === "outlined"));
  });

  it("stops the model calls when the stream is left (the Studio's Stop)", async () => {
    const mock = new MockModelClient({ overrides: { ideationSlate: slateOf(9) } });
    const signals: AbortSignal[] = [];
    const hanging: ModelClient = {
      mode: "mock",
      streamStructured: (req) => mock.streamStructured(req),
      complete: ((req: CompleteRequest) => {
        if (req.route !== "ideation") return mock.complete(req as never);
        // A card that only ends when it is aborted.
        signals.push(req.signal!);
        return new Promise((_, reject) => req.signal!.addEventListener("abort", () => reject(new ModelAbortedError()), { once: true }));
      }) as ModelClient["complete"],
    };
    const { caller } = await callerFor(hanging, "stop@test.local");
    const stream = await caller.idea.draft({ prompt: "stop me" });
    const seen: DraftEvent[] = [];
    for await (const e of stream) {
      seen.push(e);
      if (e.type === "outlined") break;
    }
    expect(seen.filter((e) => e.type === "writing")).toHaveLength(6);
    await vi.waitFor(() => expect(signals.length).toBeGreaterThan(0));
    await vi.waitFor(() => expect(signals.every((s) => s.aborted)).toBe(true));
  });
});

describe("idea.draft over HTTP", () => {
  it("answers as a stream of JSON lines (httpBatchStreamLink), never compressed", async () => {
    const userId = await hz.h.createUser("http-draft@test.local");
    const deps = { ...hz.deps, auth: { ...hz.deps.auth, resolve: async () => ({ userId, email: null, authenticatedAt: new Date() }) } } as typeof hz.deps;
    const res = await createApp(deps).request("/trpc/idea.draft?batch=1", {
      method: "POST",
      headers: { authorization: "Bearer x", "content-type": "application/json", "trpc-accept": "application/jsonl", "accept-encoding": "gzip" },
      body: JSON.stringify({ 0: { json: { prompt: "a newsletter for climate operators" } } }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBeNull();
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let chunks = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks++;
      text += decoder.decode(value, { stream: true });
    }
    expect(chunks).toBeGreaterThan(1);
    expect(text).toContain('"type":"started"');
    expect(text).toContain('"type":"idea"');
    expect(text).toContain('"type":"done"');
    expect((await repos.ideas.listForUser(hz.db, userId)).items.length).toBeGreaterThanOrEqual(6);
  });
});

describe("concurrencyLimit", () => {
  it("never runs more than the bound at once, even as slots are handed over", async () => {
    const limit = concurrencyLimit(3);
    let active = 0;
    let peak = 0;
    const tick = () => new Promise((r) => setTimeout(r, 1));
    await Promise.all(
      Array.from({ length: 12 }, () =>
        limit(async () => {
          active++;
          peak = Math.max(peak, active);
          await tick();
          active--;
        }),
      ),
    );
    expect(peak).toBe(3);
  });
});
