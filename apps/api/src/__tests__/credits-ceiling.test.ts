/**
 * The credits ceiling on the API's own platform-key calls (BUILD §10.4, §10.5; DECISIONS 2026-10-12): once a business
 * on credits has used up this month's, a call made for it (a conversation reply, a plan compile, the in-process
 * composer) is refused before it is sent, with the way back for its tier. Nothing is booked for a refused call; a call
 * with no business, a business on its own key and a business with credits left are never refused.
 */
import { includedCreditsMinor } from "@foundmill/config";
import { assertCreditsAvailable, periodOf, repos } from "@foundmill/db";
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
    await expect(assertCreditsAvailable(hz.db, A)).resolves.toBeUndefined();

    await useUp(A);
    const before = await ledger(A);
    const refused = await models.complete({ ...ask, attribution: { businessId: A, kind: "plan_compiler" } }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(CreditsExhaustedError);
    expect(refused).toMatchObject({ code: "credits_exhausted", status: 402, details: { tier: "free", period: period(), balanceMinor: 0, currency: "USD" } });
    expect((refused as Error).message).toMatch(/free plan includes \$5\.00 of model use a month/);
    expect((refused as Error).message).toMatch(/own Anthropic key in Settings → Keys/);
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

  it("a business on its own key is never refused here (its platform-key calls are metered, not charged)", async () => {
    const B = hz.B.businessId;
    await useUp(B);
    await repos.businesses.update(hz.db, B, { modelBilling: "byok" });
    try {
      await expect(assertCreditsAvailable(hz.db, B)).resolves.toBeUndefined();
      const models = createApiModelClient({ MODEL_MODE: "mock" }, silentLog(), { db: hz.db });
      await expect(models.complete({ ...ask, attribution: { businessId: B, kind: "plan_compiler" } })).resolves.toBeDefined();
    } finally {
      await repos.businesses.update(hz.db, B, { modelBilling: "credits" });
    }
    // Back on credits, the used-up month applies again; an unknown business is nobody's to refuse.
    await expect(assertCreditsAvailable(hz.db, B)).rejects.toBeInstanceOf(CreditsExhaustedError);
    await expect(assertCreditsAvailable(hz.db, crypto.randomUUID())).resolves.toBeUndefined();
    await expect(assertCreditsAvailable(hz.db, "not-a-business")).resolves.toBeUndefined();
  });

  it("on a paid tier the refusal offers a top-up or the founder's own key", async () => {
    const B = hz.B.businessId;
    await repos.businesses.update(hz.db, B, { planTier: "pro" });
    try {
      await expect(assertCreditsAvailable(hz.db, B)).rejects.toThrow(/Top up in Settings → Billing, or bring your own Anthropic key/);
    } finally {
      await repos.businesses.update(hz.db, B, { planTier: "free" });
    }
  });
});
