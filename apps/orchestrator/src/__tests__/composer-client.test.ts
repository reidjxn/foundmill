/**
 * The composer client and the cycle's hand-off to it (audit CML-05): the wait covers a live Opus narration, a timeout
 * or an outage is retried (narrate is idempotent per event set, so a retry gets the note a slow attempt wrote), and a
 * 4xx answer is not retried, since the same request gets the same answer and every attempt paid for the model.
 */
import { LIMITS } from "@foundmill/config";
import { repos } from "@foundmill/db";
import { ApplicationFailure } from "@temporalio/common";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createCycleActivities } from "../activities/cycle";
import { ComposerRequestError, ComposerUnavailableError, createComposerClient, type ComposerClient } from "../composer-client";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.useRealTimers());

describe("composer client", () => {
  it("waits past the old 20 s for a narration (default LIMITS.composerClientTimeoutMs) and reports a replayed answer", async () => {
    vi.useFakeTimers();
    let answer: (res: Response) => void = () => undefined;
    const client = createComposerClient({
      baseUrl: "http://composer.test/",
      fetch: (_url, init) =>
        new Promise<Response>((resolve, reject) => {
          answer = resolve;
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });
    const pending = client.narrate({ businessId: "b", eventIds: ["e"] });
    await vi.advanceTimersByTimeAsync(90_000);
    answer(json({ inboxItemId: "item-1", item: { id: "item-1" }, replayed: true }));
    await expect(pending).resolves.toMatchObject({ inboxItemId: "item-1", replayed: true });
    expect(LIMITS.composerClientTimeoutMs).toBeGreaterThan(LIMITS.composerDeadlineMs);
  });

  it("a timeout and a 5xx are 'unavailable' (retryable); a 4xx is the composer's answer (not retryable)", async () => {
    const hang = createComposerClient({ baseUrl: "http://composer.test", timeoutMs: 20, fetch: (_url, init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))) });
    await expect(hang.narrate({ businessId: "b", eventIds: ["e"] })).rejects.toMatchObject({ name: "ComposerUnavailableError", message: expect.stringMatching(/did not answer within/) });

    const down = createComposerClient({ baseUrl: "http://composer.test", fetch: async () => json({ error: "internal", message: "Internal error" }, 500) });
    await expect(down.narrate({ businessId: "b", eventIds: ["e"] })).rejects.toBeInstanceOf(ComposerUnavailableError);

    const rejected = createComposerClient({ baseUrl: "http://composer.test", fetch: async () => json({ error: "composer_rejected", message: "The composer referenced entities outside the manifest", details: { unknownIds: ["x"] } }, 422) });
    const err = await rejected.narrate({ businessId: "b", eventIds: ["e"] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ComposerRequestError);
    expect(err).not.toBeInstanceOf(ComposerUnavailableError);
    expect(err).toMatchObject({ code: "composer_rejected", status: 422, details: { unknownIds: ["x"] } });
  });
});

describe("narrateCycle", () => {
  let t: OrchestratorTestHarness;
  beforeAll(async () => {
    t = await setupOrchestratorHarness({ prefix: "narrate-cycle" });
  }, 120_000);
  afterAll(() => t?.close());

  const failing = (err: Error): ComposerClient => ({ baseUrl: "http://composer.test", narrate: () => Promise.reject(err), commentary: () => Promise.reject(err), chapterTitle: () => Promise.reject(err) });
  const input = () => ({ businessId: t.businessId, eventIds: [t.fixture.eventIds[0]!], summary: "Cycle 1: done." });

  it("in staging a 4xx is a non-retryable failure, while an outage is rethrown for the activity retry", async () => {
    const staging = { ...t.deps, env: { ...t.deps.env, APP_ENV: "staging" as const } };
    const rejected = await createCycleActivities({ ...staging, composer: failing(new ComposerRequestError("composer_rejected", "rejected after the re-ask", 422)) })
      .narrateCycle(input())
      .catch((e: unknown) => e);
    expect(rejected).toBeInstanceOf(ApplicationFailure);
    expect(rejected).toMatchObject({ type: "ComposerRequestError", nonRetryable: true });
    const outage = await createCycleActivities({ ...staging, composer: failing(new ComposerUnavailableError("Composer /v1/narrate did not answer within 180 s")) })
      .narrateCycle(input())
      .catch((e: unknown) => e);
    expect(outage).toBeInstanceOf(ComposerUnavailableError);
  });

  it("in development a 4xx still ends in the plain cycle update, as an outage does", async () => {
    const before = (await repos.inbox.list(t.db, t.businessId, { limit: 500 })).items.length;
    const out = await createCycleActivities({ ...t.deps, composer: failing(new ComposerRequestError("validation", "Invalid request body", 400)) }).narrateCycle(input());
    expect(out.viaComposer).toBe(false);
    expect(out.inboxItemIds).toHaveLength(1);
    expect((await repos.inbox.list(t.db, t.businessId, { limit: 500 })).items.length).toBe(before + 1);
  });
});
