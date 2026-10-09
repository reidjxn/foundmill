/**
 * Logo sets as four parallel single-mark calls (audit P6): one call per direction (monogram, geometric, negative space,
 * abstract), each mark checked and handed over the moment its call ends, a failed or refused mark losing only its own
 * slot, and the streamed procedures (`idea.logo.stream`, `business.logo.stream`) reporting slots, marks and the set.
 * One set still spends one allowance.
 */
import { prompts } from "@foundmill/agents";
import { repos } from "@foundmill/db";
import { LIMITS } from "@foundmill/config";
import { MockModelClient, ModelAbortedError, ModelOutputError, ModelUnavailableError, type CompleteRequest, type ModelClient } from "@foundmill/models";
import { AppError } from "@foundmill/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emptyLogoSpend, generateLogoOptions, logoLimiter, logoSlots, type LogoBrief, type LogoEvent, type LogoOption } from "../services/logo";
import { createApiHarness, type ApiHarness } from "./harness";

const brief: LogoBrief = { businessName: "Ledgerly", pitch: "Bookkeeping that closes itself for freelancers.", archetype: "b2b_saas", colours: { primary: "#1f6f5f", secondary: "#e8c56b" }, round: 0 };
const opts = { scope: "test", attribution: { kind: "logo" } };
const directionOf = (req: CompleteRequest): string => /"direction":"([a-z_]+)"/.exec(req.messages[0]?.content ?? "")?.[1] ?? "";

/** A client whose calls wait until the test releases them, one direction at a time. */
function gatedClient(inner = new MockModelClient()) {
  const gates = new Map<string, () => void>();
  const started: string[] = [];
  const client: ModelClient = {
    mode: "mock",
    complete: (async (req: CompleteRequest) => {
      const direction = directionOf(req);
      started.push(direction);
      await new Promise<void>((resolve) => gates.set(direction, resolve));
      // A released gate is a response that already arrived: the inner mock answers even if the set was stopped meanwhile
      // (the mock itself honours an aborted signal, as the live client does).
      return inner.complete({ ...req, signal: undefined } as never);
    }) as ModelClient["complete"],
  };
  const release = async (direction: string) => {
    for (let i = 0; i < 50 && !gates.has(direction); i++) await new Promise((r) => setTimeout(r, 1));
    gates.get(direction)!();
    await new Promise((r) => setTimeout(r, 5));
  };
  return { client, started, release };
}

describe("generateLogoOptions (four parallel single-mark calls)", () => {
  it("asks for one mark per direction, all at once, on the logo_mark prompt with the brief only as data", async () => {
    const mock = new MockModelClient();
    const { set, usage } = await generateLogoOptions(mock, brief, opts);
    expect(set.options).toHaveLength(LIMITS.logoOptionsPerSet);
    expect(new Set(set.options.map((o) => o.id)).size).toBe(4);
    expect(set).toMatchObject({ dropped: 0, failed: 0, mode: "mock", cost: { label: "Estimate", currency: "USD" } });
    expect(mock.history).toHaveLength(4);
    expect(mock.history.map(directionOf)).toEqual(["monogram", "geometric", "negative_space", "abstract"]);
    for (const req of mock.history) {
      expect(req).toMatchObject({ route: "logoDesigner", maxTokens: prompts.LOGO_MARK_MAX_TOKENS, reserveTokens: prompts.LOGO_MARK_RESERVE_TOKENS, scope: "test" });
      expect(String(req.system)).toContain("Draw one logo mark");
      expect(String(req.system)).not.toContain("Ledgerly");
    }
    expect(usage.tokens).toBeGreaterThan(0);
    expect(usage.modelKey).toBe("opus");
  });

  it("hands each mark over as soon as its call ends, before the slower calls finish", async () => {
    const { client, started, release } = gatedClient();
    const got: { index: number; option: LogoOption }[] = [];
    const run = generateLogoOptions(client, brief, { ...opts, onOption: (option, slot) => void got.push({ index: slot.index, option }) });
    for (let i = 0; i < 50 && started.length < 4; i++) await new Promise((r) => setTimeout(r, 1));
    // All four calls are in flight before any has answered.
    expect(started.sort()).toEqual(["abstract", "geometric", "monogram", "negative_space"]);
    expect(got).toHaveLength(0);
    await release("negative_space");
    expect(got.map((g) => g.index)).toEqual([2]);
    await release("monogram");
    expect(got.map((g) => g.index)).toEqual([2, 0]);
    await release("abstract");
    await release("geometric");
    const { set } = await run;
    expect(got.map((g) => g.index)).toEqual([2, 0, 3, 1]);
    // The set itself is in slot order.
    expect(set.options.map((o) => o.id)).toEqual([0, 1, 2, 3].map((i) => got.find((g) => g.index === i)!.option.id));
  });

  it("a failed call or a refused mark loses only its own slot", async () => {
    const inner = new MockModelClient({ overrides: {} });
    const client: ModelClient = {
      mode: "mock",
      complete: (async (req: CompleteRequest) => {
        const direction = directionOf(req);
        if (direction === "geometric") throw new ModelOutputError("bad json");
        const result = await inner.complete(req as never);
        if (direction === "abstract") return { ...result, json: { marks: [{ name: "Broken", concept: "x", svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><script>alert(1)</script><g></svg>' }] } };
        return result;
      }) as ModelClient["complete"],
    };
    const failed: number[] = [];
    const { set } = await generateLogoOptions(client, brief, { ...opts, onFailed: (slot) => failed.push(slot.index) });
    expect(set.options).toHaveLength(2);
    expect(set).toMatchObject({ failed: 1, dropped: 1 });
    expect(failed.sort()).toEqual([1, 3]);
  });

  it("gives back the model's own error when nothing was spent, and logo_generation_failed once tokens were", async () => {
    const unavailable: ModelClient = { mode: "live", complete: (async () => { throw new ModelUnavailableError("down"); }) as ModelClient["complete"] };
    await expect(generateLogoOptions(unavailable, brief, opts)).rejects.toBeInstanceOf(ModelUnavailableError);
    const broken: ModelClient = { mode: "live", complete: (async () => { throw new ModelOutputError("bad json"); }) as ModelClient["complete"] };
    await expect(generateLogoOptions(broken, brief, opts)).rejects.toMatchObject({ code: "logo_generation_failed" });
    const inner = new MockModelClient();
    const refused: ModelClient = {
      mode: "mock",
      complete: (async (req: CompleteRequest) => ({ ...(await inner.complete(req as never)), json: { marks: [{ name: "x", concept: "x", svg: "<svg/>" }] } })) as ModelClient["complete"],
    };
    const spend = emptyLogoSpend();
    const err = await generateLogoOptions(refused, brief, { ...opts, spend }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).message).toMatch(/None of the generated marks could be used/);
    expect(spend.calls).toBe(4);
  });

  it("stops every call when the signal aborts, and meters the calls that ended", async () => {
    const { client, release } = gatedClient();
    const controller = new AbortController();
    const spend = emptyLogoSpend();
    const run = generateLogoOptions(client, brief, { ...opts, signal: controller.signal, spend }).catch((e: unknown) => e);
    await release("monogram");
    controller.abort();
    for (const d of ["geometric", "negative_space", "abstract"]) await release(d);
    expect(await run).toBeInstanceOf(ModelAbortedError);
    expect(spend.calls).toBe(4);
  });

  it("has four fixed slots by default, labelled for the picker", () => {
    expect(logoSlots().map((s) => [s.direction, s.label])).toEqual([
      ["monogram", "Monogram"],
      ["geometric", "Geometric"],
      ["negative_space", "Negative space"],
      ["abstract", "Abstract"],
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The streamed procedures
// ---------------------------------------------------------------------------------------------------------------------

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "logostream" });
}, 120_000);
afterAll(() => hz.close());
beforeEach(() => logoLimiter.reset());

async function collect(stream: AsyncIterable<LogoEvent>): Promise<LogoEvent[]> {
  const out: LogoEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

const callerWith = async (models: ModelClient, email: string) => {
  const userId = await hz.h.createUser(email);
  const { createCaller } = await import("../router");
  return { userId, caller: createCaller({ ...hz.deps, models }, { userId, email }) };
};

describe("idea.logo.stream / business.logo.stream", () => {
  it("streams the slots, each mark as it passes, then the set; one allowance for the whole set", async () => {
    const userId = await hz.h.createUser("logo-stream@test.local");
    const caller = hz.caller({ userId });
    const idea = (await caller.idea.generate({ prompt: "bookkeeping for freelancers" })).ideas[0]!;

    const events = await collect(await caller.idea.logo.stream({ ideaId: idea.id, name: "Ledgerly", colours: { primary: "#1f6f5f", secondary: "#e8c56b" } }));
    expect(events[0]).toMatchObject({ type: "started", total: 4, mode: "mock" });
    expect((events[0] as Extract<LogoEvent, { type: "started" }>).slots.map((s) => s.label)).toEqual(["Monogram", "Geometric", "Negative space", "Abstract"]);
    const options = events.filter((e): e is Extract<LogoEvent, { type: "option" }> => e.type === "option");
    expect(options).toHaveLength(4);
    expect(new Set(options.map((o) => o.index))).toEqual(new Set([0, 1, 2, 3]));
    for (const o of options) expect(o.option.dataUrl.startsWith("data:image/svg+xml;base64,")).toBe(true);
    const done = events.at(-1) as Extract<LogoEvent, { type: "done" }>;
    expect(done.type).toBe("done");
    expect(done.set.options).toHaveLength(4);
    expect(done.set.cost.label).toBe("Estimate");
    expect(done.set.remaining).toBe(LIMITS.logoSetsPerUserPerHour - 1);
  });

  it("Settings: meters one usage row and one audit entry per streamed set", async () => {
    const { businessId, ownerId } = hz.B;
    const owner = hz.caller({ userId: ownerId });
    const events = await collect(await owner.business.logo.stream({ businessId, colours: { primary: "#1f6f5f", secondary: "#e8c56b" } }));
    expect(events.filter((e) => e.type === "option")).toHaveLength(4);
    expect(events.at(-1)).toMatchObject({ type: "done", set: { remaining: LIMITS.logoSetsPerUserPerHour - 1 } });
    const usage = await repos.usage.list(hz.db, businessId, {});
    const rows = usage.items.filter((u) => (u.details as { purpose?: string }).purpose === "logo");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.details).toMatchObject({ calls: 4, label: "Estimate" });
    const audit = await repos.audit.list(hz.db, businessId, { action: "business.logo.generate" });
    expect(audit.items[0]!.details).toMatchObject({ options: 4, failed: 0, stopped: false, costLabel: "Estimate" });
    // Viewers cannot stream a set either.
    await expect((async () => collect(await hz.caller({ userId: hz.B.viewerId }).business.logo.stream({ businessId })))()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("gives the allowance back when the designer is unavailable, and maps the error", async () => {
    const down: ModelClient = { mode: "live", complete: (async () => { throw new ModelUnavailableError("down"); }) as ModelClient["complete"] };
    const { caller, userId } = await callerWith(down, "logo-stream-down@test.local");
    const idea = (await hz.caller({ userId }).idea.generate({ prompt: "a bakery" })).ideas[0]!;
    for (let i = 0; i < LIMITS.logoSetsPerUserPerHour + 1; i++) {
      await expect(collect(await caller.idea.logo.stream({ ideaId: idea.id, name: "Crumb", colours: { primary: "#1f6f5f", secondary: "#e8c56b" } }))).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    }
    // Never charged: a working designer can still draw a set.
    const events = await collect(await hz.caller({ userId }).idea.logo.stream({ ideaId: idea.id, name: "Crumb", colours: { primary: "#1f6f5f", secondary: "#e8c56b" } }));
    expect(events.at(-1)?.type).toBe("done");
  });
});
