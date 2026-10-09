/** businessFoundations (audit P3): plan → batches and roadmap at once → apply; a failing step retries alone, then fails readably; a stale attempt is skipped. */
import { ApplicationFailure } from "@temporalio/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Activities } from "../../activities";
import { businessFoundations, FOUNDATIONS_DRAFT_FAILED, FOUNDATIONS_SAVE_FAILED } from "../../workflows";
import { createTemporalRig, wfId, type TemporalRig } from "./temporal";

let rig: TemporalRig;
beforeAll(async () => {
  rig = await createTemporalRig();
}, 120_000);
afterAll(async () => {
  await rig?.teardown();
});

const BUSINESS = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USAGE = { calls: 1, inputTokens: 100, outputTokens: 200, costMinor: 2, model: "claude-opus-5-5", mode: "mock" as const, repaired: false };
const CHUNKS = [["Problem", "Customers"], ["Features", "Pricing"]];

type Mode = "ok" | "unavailable" | "raw" | "stale" | "flaky";

function acts(opts: { plan?: Mode; batch?: Mode; apply?: "ok" | "throws" } = {}) {
  const calls = { plan: 0, sections: [] as string[], roadmap: 0, apply: [] as Record<string, unknown>[], fail: [] as string[] };
  const a: Partial<Activities> = {
    async draftFoundationsPlan() {
      calls.plan++;
      if (opts.plan === "unavailable") throw ApplicationFailure.create({ message: "The model service did not answer. Try again in a few minutes.", type: "FoundationsDraftError", nonRetryable: calls.plan >= 2 });
      // Any other failure (a worker crash, a provider error) carries raw text that must never reach the founder.
      if (opts.plan === "raw") throw ApplicationFailure.create({ message: "upstream 529 overloaded req_abc at 10.0.0.4", type: "ModelUnavailableError", nonRetryable: true });
      if (opts.plan === "stale") return { current: false, door: "ideation" as const, chunks: [], usage: { ...USAGE, calls: 0 } };
      return { current: true, door: "import" as const, chunks: CHUNKS, usage: USAGE };
    },
    async draftFoundationsSections({ sections }) {
      const key = sections.join("+");
      calls.sections.push(key);
      if (key === "Features+Pricing" && opts.batch === "unavailable") throw ApplicationFailure.create({ message: "The model service did not answer. Try again in a few minutes.", type: "FoundationsDraftError", nonRetryable: calls.sections.filter((k) => k === key).length >= 2 });
      if (key === "Features+Pricing" && opts.batch === "flaky" && calls.sections.filter((k) => k === key).length === 1) throw ApplicationFailure.create({ message: "The model service did not answer. Try again in a few minutes.", type: "FoundationsDraftError" });
      return { current: true, usage: USAGE };
    },
    async draftFoundationsRoadmap() {
      calls.roadmap++;
      return { current: true, usage: USAGE };
    },
    async applyFoundations({ model }) {
      calls.apply.push(model);
      if (opts.apply === "throws") throw ApplicationFailure.create({ message: "database gone", nonRetryable: true });
      return { applied: true, inboxItemId: "11111111-1111-4111-8111-111111111111" };
    },
    async failFoundations({ error }) {
      calls.fail.push(error);
      return { failed: true };
    },
  };
  return { a, calls };
}

const run = (m: ReturnType<typeof acts>, attempt: number) => rig.run(m.a, (client, taskQueue) => client.workflow.execute(businessFoundations, { workflowId: wfId("foundations"), taskQueue, args: [{ businessId: BUSINESS, attempt }] }));

describe("businessFoundations workflow (staged)", () => {
  it("the plan, then every batch and the roadmap at once, then one apply: ready with the note and the summed cost", async () => {
    const m = acts();
    expect(await run(m, 1)).toEqual({ status: "ready", inboxItemId: "11111111-1111-4111-8111-111111111111", error: null });
    expect(m.calls).toMatchObject({ plan: 1, sections: expect.arrayContaining(["Problem+Customers", "Features+Pricing"]), roadmap: 1, fail: [] });
    expect(m.calls.sections).toHaveLength(2);
    expect(m.calls.apply).toEqual([{ route: "foundations", model: "claude-opus-5-5", mode: "mock", costMinor: 8, costLabel: "Estimate", repaired: false, runner: "temporal", staged: true, calls: 4 }]);
  });

  it("a batch that fails once is retried on its own; nothing else runs twice", async () => {
    const m = acts({ batch: "flaky" });
    expect(await run(m, 6)).toMatchObject({ status: "ready" });
    expect(m.calls.sections.filter((k) => k === "Features+Pricing")).toHaveLength(2);
    expect(m.calls.sections.filter((k) => k === "Problem+Customers")).toHaveLength(1);
    expect(m.calls).toMatchObject({ plan: 1, roadmap: 1 });
  }, 120_000);

  it("a batch that keeps failing ends failed with its readable reason, after the other steps settled; nothing is applied", async () => {
    const m = acts({ batch: "unavailable" });
    expect(await run(m, 7)).toEqual({ status: "failed", inboxItemId: null, error: "The model service did not answer. Try again in a few minutes." });
    expect(m.calls.roadmap).toBe(1);
    expect(m.calls.apply).toHaveLength(0);
    expect(m.calls.fail).toEqual(["The model service did not answer. Try again in a few minutes."]);
  }, 120_000);

  it("a plan that keeps failing ends failed with the reason the founder reads", async () => {
    const m = acts({ plan: "unavailable" });
    expect(await run(m, 2)).toEqual({ status: "failed", inboxItemId: null, error: "The model service did not answer. Try again in a few minutes." });
    expect(m.calls.plan).toBe(2);
    expect(m.calls).toMatchObject({ sections: [], roadmap: 0, apply: [], fail: ["The model service did not answer. Try again in a few minutes."] });
  }, 120_000);

  it("only a FoundationsDraftError's message is stored: any other failure stores the generic reason (L4)", async () => {
    const m = acts({ plan: "raw" });
    expect(await run(m, 5)).toEqual({ status: "failed", inboxItemId: null, error: FOUNDATIONS_DRAFT_FAILED });
    expect(m.calls.fail).toEqual([FOUNDATIONS_DRAFT_FAILED]);
  });

  it("a save that fails marks the attempt failed; a stale attempt is skipped without writing", async () => {
    const broken = acts({ apply: "throws" });
    expect(await run(broken, 3)).toEqual({ status: "failed", inboxItemId: null, error: FOUNDATIONS_SAVE_FAILED });
    expect(broken.calls.fail).toEqual([FOUNDATIONS_SAVE_FAILED]);

    const stale = acts({ plan: "stale" });
    expect(await run(stale, 4)).toEqual({ status: "skipped", inboxItemId: null, error: null });
    expect(stale.calls).toMatchObject({ sections: [], roadmap: 0, apply: [], fail: [] });
  });
});
