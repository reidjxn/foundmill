/**
 * Who pays decides the model on the api's client (WP-13): a free business, a person before commit and a signed-out
 * visitor run on Haiku 5.5; a paid plan runs as routed; a free business on its own key runs as its plan says, since
 * the api cannot use that key until WP-13 T11. The real client and the real database, in mock model mode.
 */
import { repos } from "@foundmill/db";
import { MODELS, type UsageEvent } from "@foundmill/models";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiModelClient } from "../services/models";
import { toTRPCError } from "../trpc";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
const events: UsageEvent[] = [];
const log = { debug() {}, info() {}, warn() {}, error() {} } as never;

beforeAll(async () => {
  hz = await createApiHarness({ prefix: "freeplan" });
});
afterAll(async () => {
  await hz?.close();
});

describe("the api's model client chooses by who pays (WP-13)", () => {
  it("runs a free business, a person before commit and a signed-out visitor on Haiku 5.5, and a paid plan as routed", async () => {
    const client = createApiModelClient({ MODEL_MODE: "mock", ANTHROPIC_API_KEY: undefined }, log, { db: hz.db, onUsage: (e) => void events.push(e) });
    const ask = (attribution: { businessId?: string; userId?: string } | undefined) => client.complete({ route: "planCompiler", attribution: { ...attribution, kind: "test" }, messages: [{ role: "user", content: "Pause the ads" }] });

    await repos.businesses.update(hz.db, hz.A.businessId, { planTier: "free", modelBilling: "credits" });
    await ask({ businessId: hz.A.businessId });
    await ask({ userId: hz.A.ownerId });
    await ask(undefined);
    await repos.businesses.update(hz.db, hz.B.businessId, { planTier: "pro", modelBilling: "credits" });
    await ask({ businessId: hz.B.businessId });
    await ask({ userId: hz.B.ownerId });
    expect(events.map((e) => e.model)).toEqual([MODELS.haiku, MODELS.haiku, MODELS.haiku, MODELS.opus, MODELS.opus]);
  });

  it("runs a free business on its own key on the free plan's model: the api never uses that key, nor a model the founder has not paid for", async () => {
    events.length = 0;
    const client = createApiModelClient({ MODEL_MODE: "mock", ANTHROPIC_API_KEY: undefined }, log, { db: hz.db, onUsage: (e) => void events.push(e) });
    await repos.businesses.update(hz.db, hz.A.businessId, { planTier: "free", modelBilling: "byok" });
    await client.complete({ route: "conversation", attribution: { businessId: hz.A.businessId, kind: "test" }, messages: [{ role: "user", content: "hi" }] });
    expect(events.map((e) => [e.model, e.billedTo])).toEqual([[MODELS.haiku, "credits"]]);
  });
});

describe("the month's free-plan cap (WP-13 T6)", () => {
  it("at the cap a free call is refused before the model, as a wait with the day free AI is back; a paid plan runs on", async () => {
    events.length = 0;
    const client = createApiModelClient({ MODEL_MODE: "mock", ANTHROPIC_API_KEY: undefined, FREE_PLAN_MONTHLY_CAP_CENTS: 0 }, log, { db: hz.db, onUsage: (e) => void events.push(e) });
    const ask = (businessId: string) => client.complete({ route: "planCompiler", attribution: { businessId, kind: "test" }, messages: [{ role: "user", content: "Pause the ads" }] });
    await repos.businesses.update(hz.db, hz.A.businessId, { planTier: "free", modelBilling: "credits" });
    await repos.businesses.update(hz.db, hz.B.businessId, { planTier: "pro", modelBilling: "credits" });
    const held = await ask(hz.A.businessId).catch((err: unknown) => err);
    expect(toTRPCError(held)).toMatchObject({ code: "TOO_MANY_REQUESTS", message: expect.stringMatching(/^Foundmill's included AI is used up for this month! It is back on [A-Z][a-z]{2} 1\. To keep going now, connect your own Anthropic key\.$/) });
    await ask(hz.B.businessId);
    expect(events.map((e) => e.model)).toEqual([MODELS.opus]);
  });
});
