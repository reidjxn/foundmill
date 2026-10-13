/**
 * The API's own model calls reach the business usage ledger (review item 7): `createApiModelClient` books every call
 * made for a business once, in the pricing currency, labelled Estimate; a call with no business (Ideation, Ask on a
 * concept, a logo before commit) books nothing; a call stopped in flight keeps its `aborted` flag; a failed write never
 * fails the call.
 */
import { repos } from "@foundmill/db";
import { meter, MODELS, PRICING_CURRENCY, PlanOutput, type UsageEvent } from "@foundmill/models";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { silentLog } from "../services/log";
import { apiUsageSink, createApiModelClient } from "../services/models";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "usage" });
}, 120_000);
afterAll(() => hz.close());

const ledger = async (businessId: string) => (await repos.usage.list(hz.db, businessId, { limit: 500 })).items;
const ask = { route: "planCompiler" as const, schema: PlanOutput, messages: [{ role: "user" as const, content: "```json\n" + JSON.stringify({ reply: "Pause the ads until Monday", agents: [], action_types: [] }) + "\n```" }] };

describe("createApiModelClient: the usage ledger", () => {
  it("books a call made for a business once, to that business only, in the pricing currency (Estimate)", async () => {
    const models = createApiModelClient({ MODEL_MODE: "mock" }, silentLog(), { db: hz.db });
    const [beforeA, beforeB] = await Promise.all([ledger(hz.A.businessId), ledger(hz.B.businessId)]);
    const result = await models.complete({ ...ask, attribution: { businessId: hz.A.businessId, agentId: hz.A.agentId, kind: "plan_compiler" } });
    const after = await ledger(hz.A.businessId);
    expect(after).toHaveLength(beforeA.length + 1);
    const row = after.find((u) => !beforeA.some((b) => b.id === u.id))!;
    expect(row).toMatchObject({
      agentId: hz.A.agentId,
      kind: "tokens",
      modelKey: result.modelKey,
      quantity: result.usage.inputTokens + result.usage.outputTokens,
      costMinor: result.cost.costMinorInt,
      currency: PRICING_CURRENCY,
      billedTo: "credits",
      details: { service: "api", route: "planCompiler", kind: "plan_compiler", mode: "mock", label: "Estimate", attempt: 0 },
    });
    expect((row.details as { aborted?: boolean }).aborted).toBeUndefined();
    // The exact cost is stored beside its rounding, so calls under half a cent still add up (audit BILL-09).
    expect(Number(row.costMicroMinor)).toBe(result.cost.costMicroMinor);
    expect(await ledger(hz.B.businessId)).toHaveLength(beforeB.length);
  });

  it("books nothing for a call with no business (account-level drafting before a business exists)", async () => {
    const seen: UsageEvent[] = [];
    const models = createApiModelClient({ MODEL_MODE: "mock" }, silentLog(), { db: hz.db, onUsage: (e) => void seen.push(e) });
    const [beforeA, beforeB] = await Promise.all([ledger(hz.A.businessId), ledger(hz.B.businessId)]);
    await models.complete({ ...ask, attribution: { kind: "ideation" } });
    expect(seen).toHaveLength(1);
    expect(await ledger(hz.A.businessId)).toHaveLength(beforeA.length);
    expect(await ledger(hz.B.businessId)).toHaveLength(beforeB.length);
  });

  it("without a database the client meters nothing (logs only)", async () => {
    const before = await ledger(hz.A.businessId);
    await createApiModelClient({ MODEL_MODE: "mock" }, silentLog()).complete({ ...ask, attribution: { businessId: hz.A.businessId, kind: "plan_compiler" } });
    expect(await ledger(hz.A.businessId)).toHaveLength(before.length);
  });
});

describe("apiUsageSink", () => {
  const usage = { inputTokens: 1_200, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
  const event = (attribution: UsageEvent["attribution"], extra: Partial<UsageEvent> = {}): UsageEvent => ({
    route: "logoDesigner",
    model: MODELS.opus,
    modelKey: "opus",
    mode: "live",
    billedTo: "credits",
    usage,
    cost: meter(usage, MODELS.opus),
    attribution,
    durationMs: 900,
    occurredAt: new Date().toISOString(),
    attempt: 0,
    ...extra,
  });

  it("keeps a stopped call's aborted flag: its tokens are an Estimate too", async () => {
    const before = await ledger(hz.B.businessId);
    await apiUsageSink(hz.db, silentLog())(event({ businessId: hz.B.businessId, kind: "logo" }, { aborted: true }));
    const row = (await ledger(hz.B.businessId)).find((u) => !before.some((b) => b.id === u.id))!;
    expect(row).toMatchObject({ quantity: 1_200, currency: PRICING_CURRENCY, details: { route: "logoDesigner", kind: "logo", aborted: true, label: "Estimate" } });
    expect(row.costMinor).toBe(meter(usage, MODELS.opus).costMinorInt);
  });

  it("a ledger write that fails is logged and never fails the call", async () => {
    const warnings: unknown[] = [];
    const log = silentLog();
    log.warn = ((o: unknown) => void warnings.push(o)) as typeof log.warn;
    await expect(apiUsageSink(hz.db, log)(event({ businessId: "not-a-business", kind: "logo" }))).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
  });
});
