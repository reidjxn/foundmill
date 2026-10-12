import { describe, expect, it } from "vitest";
import { TRPCClientError } from "@trpc/client";
import { apiTrpcUrl, createApiLinks, createUntypedApiClient, errorMessage, isStreamingOperation, resolveBearer, STREAMING_PROCEDURES, tierLimitOf, trpcErrorCode, trpcPathPrefix, trpcQueryKey } from "../trpc";
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
