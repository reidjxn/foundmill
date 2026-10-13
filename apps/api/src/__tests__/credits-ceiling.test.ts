/**
 * The credits ceiling on the API's own platform-key calls (BUILD §10.4, §10.5; DECISIONS 2026-10-12): once a business
 * has used up this month's credits, a call made for it (a conversation reply, a plan compile, the in-process composer)
 * is refused before it is sent, with the way back. Nothing is booked for a refused call; a call with no business and a
 * business with credits left are never refused. A business on its own key pays for these platform-key calls with its
 * credits too (SEC2 S2), so it is refused alike, and told its agents keep working on its key.
 */
import { includedCreditsMinor } from "@foundmill/config";
import { assertPlatformCredits, periodOf, repos } from "@foundmill/db";
import { PlanOutput } from "@foundmill/models";
import { CreditsExhaustedError } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { silentLog } from "../services/log";
import { createApiModelClient } from "../services/models";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "ceiling" });
}, 120_000);
afterAll(() => hz.close());

const period = () => periodOf(new Date());
const ledger = async (businessId: string) => (await repos.usage.list(hz.db, businessId, { limit: 500 })).items.length;
const ask = { route: "planCompiler" as const, schema: PlanOutput, messages: [{ role: "user" as const, content: "```json\n" + JSON.stringify({ reply: "Pause the ads until Monday", agents: [], action_types: [] }) + "\n```" }] };
/** Uses up this month's credits of a business on credits (the included credits first, as the first charge would). */
const useUp = async (businessId: string) => {
  const { balance } = await repos.usage.ensurePeriodCredits(hz.db, businessId, period(), includedCreditsMinor("free"));
  await repos.usage.chargeCredits(hz.db, businessId, period(), Number(balance.balanceMinor));
};

describe("the API's platform-key calls stop when the credits do", () => {
  it("a business with credits left runs; once they are used up the call is refused before it is sent, and nothing is booked", async () => {
    const models = createApiModelClient({ MODEL_MODE: "mock" }, silentLog(), { db: hz.db });
    const A = hz.A.businessId;
    await models.complete({ ...ask, attribution: { businessId: A, kind: "plan_compiler" } });
    await expect(assertPlatformCredits(hz.db, A, { live: false })).resolves.toMatchObject({ ok: true });

    await useUp(A);
    const before = await ledger(A);
    const refused = await models.complete({ ...ask, attribution: { businessId: A, kind: "plan_compiler" } }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(CreditsExhaustedError);
    expect(refused).toMatchObject({ code: "credits_exhausted", status: 402, details: { reason: "exhausted", businessId: A, period: period(), balanceMinor: 0 } });
    expect((refused as Error).message).toMatch(/Top up in Settings › Billing/);
    expect(await ledger(A)).toBe(before);

    // Account-level calls (no business yet) are not the business's to pay for.
    await expect(models.complete({ ...ask, attribution: { kind: "ideation" } })).resolves.toBeDefined();

    // A top-up puts the business back on credits it can spend.
    await repos.usage.grantCredits(hz.db, A, period(), 200);
    await expect(models.complete({ ...ask, attribution: { businessId: A, kind: "plan_compiler" } })).resolves.toBeDefined();
  });

  it("a conversation at an agent's desk is refused with PAYMENT_REQUIRED and the way back", async () => {
    const A = hz.A.businessId;
    await useUp(A);
    hz.limits.reset();
    const owner = hz.caller({ userId: hz.A.ownerId });
    await expect(owner.agent.conversation.send({ businessId: A, subject: { kind: "agent", id: hz.A.agentId }, text: "Is the supplier invoice due?" })).rejects.toMatchObject({
      code: "PAYMENT_REQUIRED",
      message: expect.stringMatching(/used up/),
      cause: { code: "credits_exhausted" },
    });
  });

  it("a business on its own key is refused alike, and told its agents keep working", async () => {
    const B = hz.B.businessId;
    await useUp(B);
    await repos.businesses.update(hz.db, B, { modelBilling: "byok" });
    try {
      await expect(assertPlatformCredits(hz.db, B, { live: false })).rejects.toThrow(/Your agents keep working on your own Anthropic key/);
      const models = createApiModelClient({ MODEL_MODE: "mock" }, silentLog(), { db: hz.db });
      await expect(models.complete({ ...ask, attribution: { businessId: B, kind: "plan_compiler" } })).rejects.toBeInstanceOf(CreditsExhaustedError);
    } finally {
      await repos.businesses.update(hz.db, B, { modelBilling: "credits" });
    }
    await expect(assertPlatformCredits(hz.db, B, { live: false })).rejects.toBeInstanceOf(CreditsExhaustedError);
  });
});
