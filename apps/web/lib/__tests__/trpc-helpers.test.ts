import { describe, expect, it } from "vitest";
import { TRPCClientError } from "@trpc/client";
import { apiTrpcUrl, errorMessage, resolveBearer, trpcErrorCode, trpcPathPrefix, trpcQueryKey } from "../trpc";
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

  it("derives the tRPC url", () => {
    expect(apiTrpcUrl("https://api.foundmill.com/")).toBe("https://api.foundmill.com/trpc");
  });
});
