import { describe, expect, it, vi } from "vitest";
import { endCallOnLeave } from "../end-on-leave";

describe("endCallOnLeave", () => {
  it("sends one keepalive teamCall.end with via left to the page's own origin, with the token read beforehand", () => {
    const fetchImpl = vi.fn(async () => new Response("{}"));
    endCallOnLeave({ businessId: "b1", callId: "c1" }, "tok", fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/trpc/teamCall.end");
    expect(init).toMatchObject({ method: "POST", keepalive: true, headers: { authorization: "Bearer tok", "content-type": "application/json" } });
    expect(JSON.parse(init.body as string)).toEqual({ json: { businessId: "b1", callId: "c1", via: "left" } });
  });
});
