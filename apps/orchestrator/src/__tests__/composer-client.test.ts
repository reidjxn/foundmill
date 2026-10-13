/**
 * The composer client and the cycle's hand-off to it (audit CML-05): the wait covers a live Opus narration, a timeout
 * or an outage is retried (narrate is idempotent per event set, so a retry gets the note a slow attempt wrote), and a
 * 4xx answer is not retried, since the same request gets the same answer and every attempt paid for the model.
 */
import { LIMITS } from "@foundmill/config";
import { repos } from "@foundmill/db";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createCycleActivities } from "../activities/cycle";
import { createJourneyActivities } from "../activities/journey";
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

describe("narrateCycle and the journey commentary", () => {
  let t: OrchestratorTestHarness;
  beforeAll(async () => {
    t = await setupOrchestratorHarness({ prefix: "narrate-cycle" });
  }, 120_000);
  afterAll(() => t?.close());

  const failing = (err: Error): ComposerClient => ({ baseUrl: "http://composer.test", narrate: () => Promise.reject(err), commentary: () => Promise.reject(err), chapterTitle: () => Promise.reject(err) });
  const input = () => ({ businessId: t.businessId, eventIds: [t.fixture.eventIds[0]!], summary: "Cycle 1: done." });

  const staging = () => ({ ...t.deps, env: { ...t.deps.env, APP_ENV: "staging" as const } });
  const itemBody = async (id: string) => (await repos.inbox.get(t.db, t.businessId, id)).bodyMd;

  it("in staging a 4xx is not retried: the founder gets the plain cycle update (no outage notice), while an outage is rethrown for the activity retry", async () => {
    const rejected = await createCycleActivities({ ...staging(), composer: failing(new ComposerRequestError("composer_rejected", "rejected after the re-ask", 422)) }).narrateCycle({ ...input(), summary: "Cycle 2: 1 session dispatched." });
    expect(rejected.viaComposer).toBe(false);
    expect(rejected.inboxItemIds).toHaveLength(1);
    const body = await itemBody(rejected.inboxItemIds[0]!);
    expect(body).toBe("Cycle 2: 1 session dispatched.");
    expect(body).not.toMatch(/unavailable/i);
    const outage = await createCycleActivities({ ...staging(), composer: failing(new ComposerUnavailableError("Composer /v1/narrate did not answer within 180 s")) })
      .narrateCycle(input())
      .catch((e: unknown) => e);
    expect(outage).toBeInstanceOf(ComposerUnavailableError);
  });

  it("a cycle that finished no session gets a normal update from its summary, without calling the composer (audit FR-13, OL-09, O-21)", async () => {
    const narrate = vi.fn(() => Promise.reject(new ComposerRequestError("validation", "Invalid request body", 400)));
    const composer: ComposerClient = { ...failing(new Error("unused")), narrate };
    const out = await createCycleActivities({ ...staging(), composer }).narrateCycle({ businessId: t.businessId, eventIds: [], summary: "Nothing could run.\n\nCycle 3: 0 sessions dispatched, 0 finished, 0 blocked.", fallbackSubject: "Cycle 3 waiting" });
    expect(narrate).not.toHaveBeenCalled();
    expect(out.inboxItemIds).toHaveLength(1);
    const item = await repos.inbox.get(t.db, t.businessId, out.inboxItemIds[0]!);
    expect(item.subject).toBe("Cycle 3 waiting");
    expect(item.bodyMd).toBe("Nothing could run.\n\nCycle 3: 0 sessions dispatched, 0 finished, 0 blocked.");
    expect(item.blocksContinue).toBe(false);
  });

  it(`a cycle with more than ${LIMITS.narrateMaxEvents} events is narrated in calls of at most ${LIMITS.narrateMaxEvents}, every event once`, async () => {
    const ids = Array.from({ length: LIMITS.narrateMaxEvents * 2 + 3 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
    const calls: string[][] = [];
    const composer: ComposerClient = { ...failing(new Error("unused")), narrate: async ({ eventIds }) => (calls.push(eventIds), { inboxItemId: `item-${calls.length}`, replayed: false }) };
    const out = await createCycleActivities({ ...staging(), composer }).narrateCycle({ businessId: t.businessId, eventIds: [...ids, ids[0]!], summary: "Busy cycle." });
    expect(calls.map((c) => c.length)).toEqual([LIMITS.narrateMaxEvents, LIMITS.narrateMaxEvents, 3]);
    expect(calls.flat()).toEqual(ids);
    expect(out).toEqual({ inboxItemIds: ["item-1", "item-2", "item-3"], viaComposer: true });
  });

  it("a journey stands without commentary when the composer turns the request down (4xx), and the win is still announced", async () => {
    const rejected = createJourneyActivities({ ...t.deps, composer: failing(new ComposerRequestError("not_found", "journey not found", 404)) });
    const entityId = t.fixture.entityId;
    const conversion = await repos.journeys.recordConversion(t.db, t.businessId, { entityId, kind: "payment", amountMinor: 4_900, currency: "EUR", occurredAt: new Date(t.clock.nowMs() - 60_000) });
    const result = await rejected.buildJourneyRecord({ businessId: t.businessId, conversionId: conversion.id });
    expect(result.journeyId).toBeTruthy();
    expect((await repos.events.get(t.db, t.businessId, result.eventId!)).type).toBe("customer.converted");
  });

  it("in development a 4xx ends in the plain cycle update without an outage notice; an outage's plain update says so", async () => {
    const before = (await repos.inbox.list(t.db, t.businessId, { limit: 500 })).items.length;
    const out = await createCycleActivities({ ...t.deps, composer: failing(new ComposerRequestError("validation", "Invalid request body", 400)) }).narrateCycle(input());
    expect(out.viaComposer).toBe(false);
    expect(out.inboxItemIds).toHaveLength(1);
    expect(await itemBody(out.inboxItemIds[0]!)).toBe("Cycle 1: done.");
    const down = await createCycleActivities({ ...t.deps, composer: failing(new ComposerUnavailableError("Composer /v1/narrate unreachable")) }).narrateCycle(input());
    expect(await itemBody(down.inboxItemIds[0]!)).toMatch(/without the Inbox Composer \(service unavailable\)/);
    expect((await repos.inbox.list(t.db, t.businessId, { limit: 500 })).items.length).toBe(before + 2);
  });
});
