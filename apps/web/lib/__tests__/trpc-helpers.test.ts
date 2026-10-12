import { describe, expect, it } from "vitest";
import { TRPCClientError } from "@trpc/client";
import { apiTrpcUrl, appErrorCode, createApiLinks, createUntypedApiClient, errorMessage, isNotInvited, isStreamingOperation, RATE_LIMITED_MESSAGE, resolveBearer, STREAMING_PROCEDURES, trpcErrorCode, trpcPathPrefix, trpcQueryKey } from "../trpc";
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

  it("never retries a query the API refused for a rate limit (a retry spends the allowance again)", () => {
    const retry = makeQueryClient().getDefaultOptions().queries?.retry as (count: number, err: unknown) => boolean;
    expect(retry(0, { data: { code: "TOO_MANY_REQUESTS" } })).toBe(false);
    expect(retry(0, { data: { code: "FORBIDDEN" } })).toBe(false);
    expect(retry(0, { data: { code: "INTERNAL_SERVER_ERROR" } })).toBe(true);
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
