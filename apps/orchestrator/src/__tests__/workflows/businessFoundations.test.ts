/** businessFoundations: draft → apply → ready; a draft that keeps failing ends failed with its readable reason; a stale attempt is skipped. */
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
const DRAFT = { vision: { statement: "x", forWhom: "y", problem: "z", whyNow: "w", principles: [], northStar: { metric: "m", definition: "d", target: "t", label: "Forecast" as const } }, sections: [], roadmap: [], openQuestions: [], notes: { missingSections: [], ignoredSections: [], addedSeeds: [], labelledFigures: 0 } };

function acts(opts: { draft?: "ok" | "unavailable" | "raw" | "stale"; apply?: "ok" | "throws" } = {}) {
  const calls = { draft: 0, apply: 0, fail: [] as string[] };
  const a: Partial<Activities> = {
    async draftFoundations() {
      calls.draft++;
      if (opts.draft === "unavailable") throw ApplicationFailure.create({ message: "The model service did not answer. Try again in a few minutes.", type: "FoundationsDraftError", nonRetryable: calls.draft >= 2 });
      // Any other failure (a worker crash, a provider error) carries raw text that must never reach the founder.
      if (opts.draft === "raw") throw ApplicationFailure.create({ message: "upstream 529 overloaded req_abc at 10.0.0.4", type: "ModelUnavailableError", nonRetryable: true });
      if (opts.draft === "stale") return { current: false, draft: null, door: "ideation" as const, model: {} };
      return { current: true, draft: DRAFT, door: "import" as const, model: { route: "foundations" } };
    },
    async applyFoundations() {
      calls.apply++;
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

describe("businessFoundations workflow", () => {
  it("drafts, then applies once: ready with the note", async () => {
    const m = acts();
    const result = await rig.run(m.a, (client, taskQueue) => client.workflow.execute(businessFoundations, { workflowId: wfId("foundations"), taskQueue, args: [{ businessId: BUSINESS, attempt: 1 }] }));
    expect(result).toEqual({ status: "ready", inboxItemId: "11111111-1111-4111-8111-111111111111", error: null });
    expect(m.calls).toMatchObject({ draft: 1, apply: 1, fail: [] });
  });

  it("a draft that keeps failing ends failed with the reason the founder reads", async () => {
    const m = acts({ draft: "unavailable" });
    const result = await rig.run(m.a, (client, taskQueue) => client.workflow.execute(businessFoundations, { workflowId: wfId("foundations"), taskQueue, args: [{ businessId: BUSINESS, attempt: 2 }] }));
    expect(result).toEqual({ status: "failed", inboxItemId: null, error: "The model service did not answer. Try again in a few minutes." });
    expect(m.calls.draft).toBe(2);
    expect(m.calls.apply).toBe(0);
    expect(m.calls.fail).toEqual(["The model service did not answer. Try again in a few minutes."]);
  }, 120_000);

  it("only a FoundationsDraftError's message is stored: any other failure stores the generic reason (L4)", async () => {
    const m = acts({ draft: "raw" });
    const result = await rig.run(m.a, (client, taskQueue) => client.workflow.execute(businessFoundations, { workflowId: wfId("foundations"), taskQueue, args: [{ businessId: BUSINESS, attempt: 5 }] }));
    expect(result).toEqual({ status: "failed", inboxItemId: null, error: FOUNDATIONS_DRAFT_FAILED });
    expect(m.calls.fail).toEqual([FOUNDATIONS_DRAFT_FAILED]);
  });

  it("a save that fails marks the attempt failed; a stale attempt is skipped without writing", async () => {
    const broken = acts({ apply: "throws" });
    const failed = await rig.run(broken.a, (client, taskQueue) => client.workflow.execute(businessFoundations, { workflowId: wfId("foundations"), taskQueue, args: [{ businessId: BUSINESS, attempt: 3 }] }));
    expect(failed).toEqual({ status: "failed", inboxItemId: null, error: FOUNDATIONS_SAVE_FAILED });
    expect(broken.calls.fail).toEqual([FOUNDATIONS_SAVE_FAILED]);

    const stale = acts({ draft: "stale" });
    const skipped = await rig.run(stale.a, (client, taskQueue) => client.workflow.execute(businessFoundations, { workflowId: wfId("foundations"), taskQueue, args: [{ businessId: BUSINESS, attempt: 4 }] }));
    expect(skipped).toEqual({ status: "skipped", inboxItemId: null, error: null });
    expect(stale.calls).toMatchObject({ apply: 0, fail: [] });
  });
});
