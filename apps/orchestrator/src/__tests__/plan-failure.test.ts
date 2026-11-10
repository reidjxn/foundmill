/**
 * A cycle that cannot be planned (audit BILL-06) on PGlite: a model account that cannot pay, a missing or refused key and
 * any refused request end planning at once with a readable reason (non-retryable `CyclePlanFailure`), a transient
 * failure is left to Temporal's retries, and `notePlanFailure` tells the founder in the Inbox through the outbox.
 */
import { repos } from "@foundmill/db";
import { ModelBillingError, ModelRequestError, ModelUnavailableError, type ModelClient } from "@foundmill/models";
import { ApplicationFailure } from "@temporalio/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBriefActivities } from "../activities/brief";
import { createCycleActivities, planFailure } from "../activities/cycle";
import { CYCLE_PLAN_FAILURE } from "../cycle-contract";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "planfail" });
});
afterAll(async () => {
  await t?.close();
});

const failingModels = (err: Error): ModelClient => ({ ...t.deps.models, complete: async () => Promise.reject(err) }) as ModelClient;

async function planWith(err: Error): Promise<unknown> {
  const brief = await createBriefActivities(t.deps).loadBrief({ businessId: t.businessId });
  const cycle = createCycleActivities({ ...t.deps, models: failingModels(err) });
  return cycle.planCycle({ businessId: t.businessId, cycleNumber: 1, trigger: "continue", brief }).then(
    () => null,
    (e: unknown) => e,
  );
}

describe("planCycle failures", () => {
  it("the platform's model account out of credit is final at once, with the founder's sentence and the facts", async () => {
    const err = await planWith(new ModelBillingError("refused", "credit_balance", "credits", 400, "invalid_request_error"));
    expect(err).toBeInstanceOf(ApplicationFailure);
    const failure = err as ApplicationFailure;
    expect(failure.type).toBe(CYCLE_PLAN_FAILURE);
    expect(failure.nonRetryable).toBe(true);
    expect(failure.message).toMatch(/^This cycle's plan could not run: the model account that runs .+ is out of credit\. Our team has been alerted/);
    expect(failure.details?.[0]).toEqual({ kind: "billing", billedTo: "credits", reason: "credit_balance" });
  });

  it("a business's own key at its spend limit asks the founder to raise it", () => {
    const failure = planFailure(new ModelBillingError("refused", "spend_limit", "byok", 429, "rate_limit_error")) as ApplicationFailure;
    expect(failure.message).toMatch(/your Anthropic account has reached its spend limit\. Raise the limit in the Anthropic Console/);
    expect(failure.details?.[0]).toMatchObject({ kind: "billing", billedTo: "byok" });
  });

  it("a missing or refused key is final too; an outage or a rate limit is left to the retries", async () => {
    const missing = (await planWith(new ModelRequestError("no key", undefined, "missing_api_key"))) as ApplicationFailure;
    expect(missing).toMatchObject({ type: CYCLE_PLAN_FAILURE, nonRetryable: true });
    expect(missing.message).toMatch(/none is stored\. Add one in Settings › Keys/);
    expect(missing.details?.[0]).toEqual({ kind: "credential", billedTo: "byok" });
    const refused = planFailure(new ModelRequestError("bad key", 401, "authentication_error"), "byok") as ApplicationFailure;
    expect(refused.details?.[0]).toEqual({ kind: "credential", billedTo: "byok" });
    expect(refused.message).toMatch(/Anthropic refused the key\. Check the key in Settings › Keys/);
    // A business on credits has no key to check (Nov 9, 2026: Commutair read "check the key in Settings › Keys" when the
    // platform key was the one Anthropic refused): it hears the platform's account refused, as the billing sentence says.
    const platformRefused = planFailure(new ModelRequestError("bad key", 401, "authentication_error"), "credits") as ApplicationFailure;
    expect(platformRefused.details?.[0]).toEqual({ kind: "credential", billedTo: "credits" });
    expect(platformRefused.message).toMatch(/^This cycle's plan could not run: the model account that runs .+ refused its key\. Our team has been alerted, and nothing was charged to your credits\./);
    expect(platformRefused.message).not.toMatch(/Settings › Keys/);
    // Through planCycle the routed client says whose key it was: the harness business runs on credits.
    const viaPlan = (await planWith(new ModelRequestError("bad key", 401, "authentication_error"))) as ApplicationFailure;
    expect(viaPlan.details?.[0]).toEqual({ kind: "credential", billedTo: "credits" });
    expect(viaPlan.message).not.toMatch(/Settings › Keys/);
    const outage = new ModelUnavailableError("Anthropic unavailable");
    expect(planFailure(outage)).toBe(outage);
    expect(await planWith(outage)).toBe(outage);
  });
});

describe("notePlanFailure", () => {
  it("posts one warning from the Chief of Staff through the outbox and audits it", async () => {
    const cycle = createCycleActivities(t.deps);
    const message = "This cycle's plan could not run: the model account that runs Foundmill is out of credit.";
    const out = await cycle.notePlanFailure({ businessId: t.businessId, cycleNumber: 4, message, details: { kind: "billing", billedTo: "credits", reason: "credit_balance" } });
    expect(out.inboxItemIds).toHaveLength(1);
    const item = await repos.inbox.get(t.db, t.businessId, out.inboxItemIds[0]!);
    expect(item).toMatchObject({ type: "warning", fromAgentId: t.chiefId, subject: "The team could not start work", blocksContinue: false });
    expect(item.bodyMd).toContain(message);
    // Founder words (Nov 8, 2026): no cycle number in what everyone reads.
    expect(`${item.subject} ${item.bodyMd}`).not.toMatch(/cycle \d/i);
    const created = (await repos.events.list(t.db, t.businessId, { type: "inbox.item_created", limit: 50 })).items.find((e) => (e.payload as { inboxItemId: string }).inboxItemId === item.id);
    expect(created).toBeDefined();
    const audit = await repos.audit.list(t.db, t.businessId, { action: "cycle.plan_failed", limit: 5 });
    expect(audit.items[0]?.details).toMatchObject({ cycleNumber: 4, kind: "billing", billedTo: "credits" });
  });
});
