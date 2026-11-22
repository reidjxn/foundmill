/**
 * Model calls before a project exists are booked and capped per account (WP-09 T2): every procedure a signed-in person
 * can reach without a business sends their `userId` with the call; a live call is booked to `account_usage` at its
 * exact cost (a mock call books nothing); and past the day's or the 30 days' ceiling the next call is refused before
 * it is made (`precommit_ceiling`, 429).
 */
import { repos } from "@foundmill/db";
import { gateModelClient, meter, MockModelClient, MODELS, type CompleteRequest, type UsageEvent } from "@foundmill/models";
import { AppError } from "@foundmill/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCaller } from "../router";
import { screenText } from "../services/live";
import { silentLog } from "../services/log";
import { apiCreditsGate, apiUsageSink, PRECOMMIT_DAY_SENTENCE, PRECOMMIT_MONTH_SENTENCE } from "../services/models";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "precommit" });
}, 120_000);
afterAll(() => hz.close());
beforeEach(() => hz.limits.reset());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const noBusiness = (calls: readonly CompleteRequest[]) => calls.filter((c) => !c.attribution?.businessId);

describe("every call before a business carries the person (the nine call sites)", () => {
  it("Ideation's set, single card and own card, Import, Ask, compare, a logo before commit and a post's screen", async () => {
    const models = new MockModelClient();
    const userId = await hz.h.createUser("precommit-sites@test.local");
    const as = createCaller({ ...hz.deps, models }, { userId, email: "precommit-sites@test.local" });
    await as.founder.profile.update({ confirmAdult: true, displayName: "Ana", experience: "operator", skills: { sales: 12 }, targetMarkets: ["EU"], riskAppetite: "low" });

    const kinds = new Set<string>();
    const step = async (run: () => Promise<unknown>) => {
      const from = models.history.length;
      await run();
      const calls = noBusiness(models.history.slice(from));
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) {
        expect(c.attribution?.userId).toBe(userId);
        kinds.add(c.attribution?.kind ?? "");
      }
    };

    let ideas: { id: string }[] = [];
    await step(async () => (ideas = (await as.idea.generate({ prompt: "a newsletter" })).ideas));
    await step(() => as.idea.generate({ prompt: "one card", single: true }));
    await step(() => as.idea.write({ title: "Tutorlane", pitch: "Lesson notes for independent tutors", archetype: "b2b_saas" }));
    await step(() => as.idea.ask({ ideaId: ideas[0]!.id, question: "Who pays?" }));
    await step(() => as.idea.compare({ ideaIds: ideas.slice(0, 2).map((i) => i.id) }));
    await step(() => as.idea.logo.generate({ ideaId: ideas[0]!.id, name: "Ledgerly", colours: { primary: "#1f6f5f", secondary: "#e8c56b" } }));
    await step(async () => {
      const job = await as.import.start({ sources: [{ key: "github", value: "acme/ledgerly" }], stepMs: 1 });
      await sleep(30);
      await as.import.continue({ jobId: job.job.id });
    });
    await step(() => screenText({ models, log: silentLog() }, { text: "Hello, I make lesson notes.", kind: "community_post", communityName: "Tutors", userId }));
    expect([...kinds].sort()).toEqual(["ideation", "ideation_ask", "ideation_compare", "ideation_slate", "logo", "moderation"]);
  });
});

describe("apiUsageSink before a business", () => {
  const usage = { inputTokens: 1_200, outputTokens: 300, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
  const event = (userId: string, mode: "live" | "mock"): UsageEvent => ({
    route: "ideation",
    model: MODELS.opus,
    modelKey: "opus",
    mode,
    billedTo: "credits",
    usage,
    cost: meter(usage, MODELS.opus),
    attribution: { userId, kind: "ideation" },
    durationMs: 900,
    occurredAt: new Date().toISOString(),
    attempt: 0,
  });

  it("books one row per live call at the exact cost; a mock call books none", async () => {
    const userId = await hz.h.createUser("precommit-sink@test.local");
    const since = new Date(Date.now() - 60_000);
    await apiUsageSink(hz.db, silentLog())(event(userId, "mock"));
    expect(await repos.accountUsage.spentMicro(hz.db, userId, since)).toBe(0);
    await apiUsageSink(hz.db, silentLog())(event(userId, "live"));
    expect(await repos.accountUsage.spentMicro(hz.db, userId, since)).toBe(meter(usage, MODELS.opus).costMicroMinor);
  });
});

describe("apiCreditsGate: the ceilings before commit", () => {
  const ceilings = { dailyCents: 200, monthlyCents: 500 };
  const draft = (userId: string): CompleteRequest & { schema?: undefined } => ({ route: "ideation", messages: [{ role: "user", content: "a card" }], attribution: { userId, kind: "ideation" } });
  const book = (userId: string, cents: number, at = new Date()) =>
    repos.accountUsage.record(hz.db, { userId, kind: "ideation", route: "ideation", modelKey: "opus", quantity: 1, costMicroMinor: cents * 1_000_000, occurredAt: at, details: {} });
  const refusal = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (err) {
      return err instanceof AppError ? { code: err.code, status: err.status, message: err.message } : err;
    }
  };

  it("a loop of drafts stops at the day's line with no model call made past it", async () => {
    const userId = await hz.h.createUser("precommit-day@test.local");
    const inner = new MockModelClient();
    const models = gateModelClient(inner, apiCreditsGate(hz.db, true, ceilings));
    let made = 0;
    for (let i = 0; i < 10; i++) {
      const r = await refusal(models.complete(draft(userId)));
      if (r) {
        expect(r).toEqual({ code: "precommit_ceiling", status: 429, message: PRECOMMIT_DAY_SENTENCE });
        break;
      }
      made += 1;
      await book(userId, 60); // what the live call would have cost
    }
    // 0, 60, 120 and 180 cents are under $2.00; at 240 the fifth draft is refused.
    expect(made).toBe(4);
    expect(inner.history).toHaveLength(4);
  });

  it("refuses past the 30 days' line with its own sentence, even with nothing spent today", async () => {
    const userId = await hz.h.createUser("precommit-month@test.local");
    for (const days of [3, 9, 15, 21, 27]) await book(userId, 100, new Date(Date.now() - days * 86_400_000));
    const inner = new MockModelClient();
    expect(await refusal(gateModelClient(inner, apiCreditsGate(hz.db, true, ceilings)).complete(draft(userId)))).toEqual({ code: "precommit_ceiling", status: 429, message: PRECOMMIT_MONTH_SENTENCE });
    expect(inner.history).toHaveLength(0);
  });

  it("mock calls, calls for a business and calls with no person are not capped here", async () => {
    const userId = await hz.h.createUser("precommit-free@test.local");
    await book(userId, 1_000);
    const inner = new MockModelClient();
    await gateModelClient(inner, apiCreditsGate(hz.db, false, ceilings)).complete(draft(userId));
    await gateModelClient(inner, apiCreditsGate(hz.db, true, ceilings)).complete({ ...draft(userId), attribution: { kind: "ideation" } });
    expect(inner.history).toHaveLength(2);
  });
});
