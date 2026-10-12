/**
 * The composer HTTP client (audit CML-04): a cold Refresh is a live Opus call, so the api waits for it (well past the
 * old 5 s) instead of answering 503 while the composer goes on to write the note; a composer that answers is quoted,
 * not reported as "unavailable"; and nothing is composed in-process while the service may still be writing.
 */
import { LIMITS } from "@foundmill/config";
import { createModelClient } from "@foundmill/models";
import { AppError } from "@foundmill/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ComposerTimeoutError, ComposerUnavailableError, createComposerClient } from "../services/composer";
import { silentLog } from "../services/log";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "composer-client" });
}, 120_000);
afterAll(() => hz.close());
afterEach(() => vi.useRealTimers());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A composer that answers only when told to (or never), and gives up when the client aborts. */
function slowComposer() {
  let answer: (res: Response) => void = () => undefined;
  let calls = 0;
  const fetch: typeof globalThis.fetch = (_url, init) =>
    new Promise<Response>((resolve, reject) => {
      calls += 1;
      answer = resolve;
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
  return { fetch, answer: (res: Response) => answer(res), calls: () => calls };
}

describe("composer client", () => {
  it("waits for a slow composer well past five seconds by default (a cold Refresh is one Opus call)", async () => {
    vi.useFakeTimers();
    const composer = slowComposer();
    const client = createComposerClient({ url: "http://composer.test", db: hz.db, models: createModelClient({ mode: "mock" }), log: silentLog(), allowFallback: false, fetch: composer.fetch });
    const pending = client.refresh(hz.A.businessId);
    await vi.advanceTimersByTimeAsync(60_000);
    composer.answer(json({ inboxItemId: hz.A.inboxItemId, item: { id: hz.A.inboxItemId }, slot: "events" }));
    vi.useRealTimers();
    const result = await pending;
    expect(result).toMatchObject({ source: "composer", slot: "events" });
    expect(result.item.id).toBe(hz.A.inboxItemId);
    expect(LIMITS.composerClientTimeoutMs).toBeGreaterThan(LIMITS.composerDeadlineMs);
  });

  it("a composer that does not answer in time is a 504 timeout, never 'unavailable', and nothing is composed in-process", async () => {
    const composer = slowComposer();
    const models = createModelClient({ mode: "mock" });
    const complete = vi.spyOn(models, "complete");
    const client = createComposerClient({ url: "http://composer.test", db: hz.db, models, log: silentLog(), allowFallback: true, timeoutMs: 30, fetch: composer.fetch });
    const err = await client.refresh(hz.A.businessId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ComposerTimeoutError);
    expect(err).not.toBeInstanceOf(ComposerUnavailableError);
    expect(err).toMatchObject({ code: "composer_timeout", status: 504 });
    expect((err as Error).message).toMatch(/will appear in your Inbox/);
    expect(complete).not.toHaveBeenCalled();
  });

  it("passes the composer's own error through (its 504 deadline, a 409) instead of 503 'unavailable'", async () => {
    const answers = [
      json({ error: "composer_timeout", message: "The note took longer than 150 seconds to write, so nothing was added. Try again.", details: { deadlineMs: 150_000 } }, 504),
      json({ error: "no_agents", message: "The business has no agents to write from", details: null }, 409),
    ];
    const client = createComposerClient({ url: "http://composer.test", db: hz.db, models: createModelClient({ mode: "mock" }), log: silentLog(), allowFallback: false, fetch: async () => answers.shift()! });
    const late = await client.refresh(hz.A.businessId).catch((e: unknown) => e);
    expect(late).toBeInstanceOf(AppError);
    expect(late).toMatchObject({ code: "composer_timeout", status: 504, message: expect.stringMatching(/nothing was added/) });
    const none = await client.narrate(hz.A.businessId, [hz.A.eventIds[0]!]).catch((e: unknown) => e);
    expect(none).toMatchObject({ code: "no_agents", status: 409 });
  });

  it("only an unreachable composer is 'unavailable' (503) outside development and test", async () => {
    const client = createComposerClient({ url: "http://composer.test", db: hz.db, models: createModelClient({ mode: "mock" }), log: silentLog(), allowFallback: false, fetch: async () => { throw new Error("ECONNREFUSED"); } });
    const err = await client.refresh(hz.A.businessId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ComposerUnavailableError);
    expect(err).toMatchObject({ code: "composer_unavailable", status: 503 });
  });
});
