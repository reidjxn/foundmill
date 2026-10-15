/**
 * The browser Supabase client bounds its token requests (audit C5): a refresh that hangs is cut after
 * `SUPABASE_FETCH_TIMEOUT_MS` (auth-js then retries it) instead of holding the session lock, and every API request
 * waiting on it, for up to 30 s. Other requests (sending a sign-in link) keep the browser's own limits.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetPublicEnvCache } from "../env";
import { fetchWithTokenTimeout, isTokenRequest, SUPABASE_FETCH_TIMEOUT_MS } from "../supabase/client";

const created = vi.hoisted(() => ({ options: [] as unknown[] }));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: (_url: string, _key: string, options: unknown) => {
    created.options.push(options);
    return { auth: {} };
  },
}));

/** A fetch that never answers on its own; it rejects with the abort reason when its signal fires. */
function hanging() {
  const seen: (AbortSignal | undefined)[] = [];
  const fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      seen.push(init?.signal ?? undefined);
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
    })) as typeof globalThis.fetch;
  return { seen, fetch };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  resetPublicEnvCache();
});

describe("browser Supabase client", () => {
  it("knows a token request (a refresh, a code exchange) from the others", () => {
    expect(isTokenRequest("https://ref.supabase.co/auth/v1/token?grant_type=refresh_token")).toBe(true);
    expect(isTokenRequest(new URL("https://ref.supabase.co/auth/v1/token?grant_type=pkce"))).toBe(true);
    expect(isTokenRequest(new Request("https://ref.supabase.co/auth/v1/token"))).toBe(true);
    expect(isTokenRequest("https://ref.supabase.co/auth/v1/otp")).toBe(false);
    expect(isTokenRequest("https://ref.supabase.co/auth/v1/logout?scope=local")).toBe(false);
    expect(isTokenRequest("https://ref.supabase.co/auth/v1/tokens")).toBe(false);
  });

  it("cuts a token request that hangs, and leaves the others alone", async () => {
    vi.useFakeTimers();
    const { seen, fetch } = hanging();
    const bounded = fetchWithTokenTimeout(SUPABASE_FETCH_TIMEOUT_MS, fetch);
    const refresh = bounded("https://ref.supabase.co/auth/v1/token?grant_type=refresh_token", { method: "POST" }).then(
      () => null,
      (err: unknown) => err as Error,
    );
    const otp = bounded("https://ref.supabase.co/auth/v1/otp", { method: "POST" });
    await vi.advanceTimersByTimeAsync(SUPABASE_FETCH_TIMEOUT_MS);
    expect((await refresh)?.name).toBe("TimeoutError");
    // The sign-in link request got no signal of ours: it keeps the browser's own limits.
    expect(seen[1]).toBeUndefined();
    void otp.catch(() => undefined);
  });

  it("keeps the caller's own abort on a token request", async () => {
    const { fetch } = hanging();
    const caller = new AbortController();
    const pending = fetchWithTokenTimeout(1_000, fetch)("https://ref.supabase.co/auth/v1/token?grant_type=refresh_token", { signal: caller.signal });
    caller.abort(new Error("stopped"));
    await expect(pending).rejects.toThrow("stopped");
  });

  it("builds the client with the bounded fetch", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    resetPublicEnvCache();
    vi.resetModules();
    const { createClient } = await import("../supabase/client");
    await createClient();
    const options = created.options.at(-1) as { global?: { fetch?: unknown } } | undefined;
    expect(typeof options?.global?.fetch).toBe("function");
  });
});
