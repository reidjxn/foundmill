import { describe, expect, it } from "vitest";
import { TRPCClientError } from "@trpc/client";
import { apiTrpcUrl, appErrorCode, createApiLinks, createUntypedApiClient, errorMessage, fetchWithTimeout, forbiddenMessage, isNotInvited, NO_ACCESS_PREFIX, isStreamingOperation, RATE_LIMITED_MESSAGE, REQUEST_TIMEOUT_MESSAGE, resolveBearer, STREAMING_PROCEDURES, tierLimitOf, trpcErrorCode, trpcPathPrefix, trpcQueryKey } from "../trpc";
import { makeQueryClient } from "../query-client";
import { routersToInvalidate, withBusiness } from "../widget-data";

describe("trpc helpers", () => {
  it("builds query keys shaped like @trpc/tanstack-react-query so caches are shared", () => {
    expect(trpcQueryKey("inbox.list", { businessId: "b" })).toEqual([["inbox", "list"], { input: { businessId: "b" }, type: "query" }]);
    expect(trpcQueryKey("health")).toEqual([["health"], { type: "query" }]);
    expect(trpcQueryKey("inbox.list", undefined, "any")).toEqual([["inbox", "list"]]);
    expect(trpcPathPrefix("inbox")).toEqual([["inbox"]]);
  });

  it("merges businessId into widget inputs", () => {
    expect(withBusiness("b1", { limit: 4 })).toEqual({ businessId: "b1", limit: 4 });
    expect(withBusiness("b1", undefined)).toEqual({ businessId: "b1" });
  });

  it("invalidates the routers a mutation touches", () => {
    expect(routersToInvalidate("inbox.decide")).toContain("plan");
    expect(routersToInvalidate("keys.revoke")).toEqual(["keys", "integrations", "team"]);
    expect(routersToInvalidate("unknown.thing")).toEqual(["unknown"]);
  });

  it("falls back to the dev bearer only in development/test", async () => {
    expect(await resolveBearer(() => "jwt")).toBe("jwt");
    expect(await resolveBearer(() => null)).toBe("dev"); // vitest runs with NEXT_PUBLIC_APP_ENV=test
  });

  it("reads tRPC error codes and messages", () => {
    const err = new TRPCClientError("Sign in to continue", { result: { error: { code: -32001, message: "x", data: { code: "UNAUTHORIZED", httpStatus: 401 } } } } as never);
    expect(trpcErrorCode(err)).toBe("UNAUTHORIZED");
    expect(errorMessage(err)).toBe("Sign in to continue");
    expect(trpcErrorCode(new Error("x"))).toBeNull();
    expect(errorMessage("weird", "fallback")).toBe("fallback");
  });

  it("reads a plan tier limit refusal (an upgrade prompt), and nothing from other errors", () => {
    const tier = new TRPCClientError("The Free plan holds 1 business", { result: { error: { code: -32003, message: "x", data: { code: "FORBIDDEN", httpStatus: 403, appCode: "tier_limit", details: { limit: "businesses", tier: "free", allowed: 1, used: 1, planBusinessId: "b1" } } } } } as never);
    expect(tierLimitOf(tier)).toEqual({ limit: "businesses", planBusinessId: "b1" });
    const forbidden = new TRPCClientError("Forbidden", { result: { error: { code: -32003, message: "x", data: { code: "FORBIDDEN", httpStatus: 403, appCode: "forbidden" } } } } as never);
    expect(tierLimitOf(forbidden)).toBeNull();
    expect(tierLimitOf(new Error("x"))).toBeNull();
  });

  it("reads the API's own code: not invited (SIGNUP_ALLOWLIST) and rate limits", () => {
    const err = (message: string, code: string, appCode?: string) => new TRPCClientError(message, { result: { error: { code: -32003, message, data: { code, httpStatus: code === "FORBIDDEN" ? 403 : 429, ...(appCode ? { appCode } : {}) } } } } as never);
    const notInvited = err("This address is not on the invite list yet.", "FORBIDDEN", "not_invited");
    expect(appErrorCode(notInvited)).toBe("not_invited");
    expect(isNotInvited(notInvited)).toBe(true);
    expect(isNotInvited(err("You are not a member of this business", "FORBIDDEN"))).toBe(false);
    expect(isNotInvited(new Error("x"))).toBe(false);
    // A rate limit reads as the API's own sentence, or a friendly line when it sent none.
    expect(errorMessage(err("Refresh limit reached. Try again in 2 minutes.", "TOO_MANY_REQUESTS", "rate_limited"))).toBe("Refresh limit reached. Try again in 2 minutes.");
    expect(errorMessage(err("Too Many Requests", "TOO_MANY_REQUESTS"))).toBe(RATE_LIMITED_MESSAGE);
  });

  it("says a refusal in product words, never the API's keys and role names (audit RUI-05)", () => {
    const refused = (message: string) => new TRPCClientError(message, { result: { error: { code: -32003, message, data: { code: "FORBIDDEN", httpStatus: 403 } } } } as never);
    expect(errorMessage(refused("You do not have read access to finance"))).toBe("No access to Finance. Ask an owner or admin if you need it.");
    expect(errorMessage(refused("You do not have read access to crm"))).toBe(`${NO_ACCESS_PREFIX}CRM. Ask an owner or admin if you need it.`);
    expect(errorMessage(refused("You do not have write access to legal"))).toBe("You can read Legal but not change it. Ask an owner or admin for write access.");
    expect(errorMessage(refused("Your role (viewer) cannot perform changes"))).toBe("As a viewer you can follow this business, but not change it.");
    expect(errorMessage(refused("Your role (advisor) cannot perform changes"))).toBe("As an advisor you can follow this business, but not change it.");
    expect(errorMessage(refused("Your role (member) cannot perform administration"))).toBe("Only an owner or admin can do this.");
    expect(errorMessage(refused("Your role (admin) cannot perform owner actions"))).toBe("Only the owner can do this.");
    // The plan refusal already explains itself in words; a sentence the API wrote is kept.
    expect(forbiddenMessage("You do not have write access to finance and legal, and this plan would pay a bill. Someone with that access can decide it.")).toContain("Someone with that access can decide it.");
    expect(errorMessage(refused("You are not a member of this business"))).toBe("You are not a member of this business");
  });

  it("never retries a query the API refused for a rate limit (a retry spends the allowance again)", () => {
    const retry = makeQueryClient().getDefaultOptions().queries?.retry as (count: number, err: unknown) => boolean;
    expect(retry(0, { data: { code: "TOO_MANY_REQUESTS" } })).toBe(false);
    expect(retry(0, { data: { code: "FORBIDDEN" } })).toBe(false);
    expect(retry(0, { data: { code: "INTERNAL_SERVER_ERROR" } })).toBe(true);
  });

  it("never retries a malformed input, which is refused the same way every time (audit WEB-14)", () => {
    const retry = makeQueryClient().getDefaultOptions().queries?.retry as (count: number, err: unknown) => boolean;
    expect(retry(0, { data: { code: "BAD_REQUEST" } })).toBe(false);
    expect(retry(0, { data: { code: "NOT_FOUND" } })).toBe(false);
  });

  it("bounds every plain request: a read that never answers is aborted with a plain sentence (audit RES-13)", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const hang: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        seen.push(init?.signal ?? undefined);
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      });
    const bounded = fetchWithTimeout(hang, { query: 20, mutation: 60 });
    await expect(bounded("http://api/trpc/inbox.list", { method: "GET" })).rejects.toThrow(REQUEST_TIMEOUT_MESSAGE);
    await expect(bounded("http://api/trpc/business.stopAllAgents", { method: "POST" })).rejects.toThrow(REQUEST_TIMEOUT_MESSAGE);
    expect(seen).toHaveLength(2);
  });

  it("keeps the caller's own abort, and leaves an answer that came in time alone", async () => {
    const answer: typeof fetch = (_input, init) =>
      new Promise((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        setTimeout(() => resolve(new Response("{}")), 5);
      });
    const bounded = fetchWithTimeout(answer, { query: 1_000, mutation: 1_000 });
    await expect(bounded("http://api/trpc/inbox.list", { method: "GET" })).resolves.toBeInstanceOf(Response);
    const caller = new AbortController();
    const pending = bounded("http://api/trpc/inbox.list", { method: "GET", signal: caller.signal });
    caller.abort(new Error("unmounted"));
    await expect(pending).rejects.toThrow("unmounted");
  });

  it("derives the tRPC url", () => {
    expect(apiTrpcUrl("https://api.foundmill.com/")).toBe("https://api.foundmill.com/trpc");
  });

  it("sends streaming procedures over the streaming link and everything else over the batch link", () => {
    expect(STREAMING_PROCEDURES.has("idea.draft")).toBe(true);
    expect(isStreamingOperation({ path: "idea.draft" })).toBe(true);
    expect(isStreamingOperation({ path: "idea.generate" })).toBe(false);
    // The logo picker streams each mark as it passes the check (audit P6); `generate` stays a plain answer.
    expect(isStreamingOperation({ path: "idea.logo.stream" })).toBe(true);
    expect(isStreamingOperation({ path: "business.logo.stream" })).toBe(true);
    expect(isStreamingOperation({ path: "business.logo.generate" })).toBe(false);
    expect(isStreamingOperation({ path: "inbox.list" })).toBe(false);
    expect(createApiLinks({ getToken: () => null })).toHaveLength(1);
  });

  it("sends each stream in its own request, so Stop aborts exactly that stream on the API", async () => {
    const urls: string[] = [];
    const fetchSpy = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response("{}", { status: 500, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const client = createUntypedApiClient({ getToken: () => "jwt", url: "http://api.test/trpc", fetch: fetchSpy });
    await Promise.allSettled([client.mutation("idea.draft", { prompt: "a" }), client.mutation("idea.logo.stream", { ideaId: "x" }), client.query("inbox.list", { businessId: "b" }), client.query("cycle.status", { businessId: "b" })]);
    const paths = urls.map((u) => new URL(u).pathname.replace("/trpc/", ""));
    expect(paths.filter((p) => p.includes("idea.draft") || p.includes("idea.logo.stream")).sort()).toEqual(["idea.draft", "idea.logo.stream"]);
    // Plain queries still share one batch.
    expect(paths).toContain("inbox.list,cycle.status");
  });
});
