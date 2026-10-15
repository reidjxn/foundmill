// @vitest-environment node
/**
 * A server render's reads are bounded by `SERVER_LIMITS` (audit F3): a stalled API ends a read after 8 s, so the layout
 * renders its unreachable page instead of a blank tab for the browser's 45 s. A server render's query cache keeps no
 * timers (TanStack's own default there), while the browser keeps a left screen's data for `BROWSER_GC_MS`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/server", () => ({ getServerAuth: vi.fn(async () => null) }));

import type { ServerAuth } from "../auth/server";
import { makeQueryClient } from "../query-client";
import { QUERY_TIMEOUT_MS, REQUEST_TIMEOUT_MESSAGE, SERVER_LIMITS, SERVER_QUERY_TIMEOUT_MS } from "../trpc";
import { createServerClient } from "../trpc-server";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("server-side reads", () => {
  it("are bounded well below the browser's limit", () => {
    expect(SERVER_LIMITS.query).toBe(SERVER_QUERY_TIMEOUT_MS);
    expect(SERVER_QUERY_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
    expect(SERVER_QUERY_TIMEOUT_MS).toBeLessThan(QUERY_TIMEOUT_MS);
  });

  it("give up on an API that never answers after SERVER_QUERY_TIMEOUT_MS, uncached", async () => {
    vi.useFakeTimers();
    const seen: RequestInit[] = [];
    vi.stubGlobal("fetch", (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init ?? {});
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    });
    const auth: ServerAuth = { userId: "u1", email: "a@example.com", token: "jwt", via: "dev" };
    const api = createServerClient(auth);
    const read = api.founder.profile.get.query().then(
      () => null,
      (err: unknown) => err as Error,
    );
    await vi.advanceTimersByTimeAsync(SERVER_QUERY_TIMEOUT_MS - 1);
    let done = false;
    void read.then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect((await read)?.message).toBe(REQUEST_TIMEOUT_MESSAGE);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.cache).toBe("no-store");
  });

  it("keep no garbage-collection timers in a server render's query cache", () => {
    expect(makeQueryClient().getDefaultOptions().queries?.gcTime).toBeUndefined();
  });
});
