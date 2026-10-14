/**
 * Request bounds on /trpc/* (audit RA-12): a body over 2 MB (6 MB for a request that uploads a logo) is refused with
 * 413 before tRPC reads it, and one request carries at most `LIMITS.trpcMaxBatchSize` procedure calls.
 */
import { LIMITS } from "@foundmill/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, trpcBodyLimitFor, trpcPaths } from "../app";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "limits" });
}, 120_000);
afterAll(() => hz.close());

const signedIn = () => ({ ...hz.deps, auth: { ...hz.deps.auth, resolve: async () => ({ userId: hz.A.ownerId, email: null, authenticatedAt: new Date() }) } }) as typeof hz.deps;
const post = (path: string, body: string, headers: Record<string, string> = {}) => createApp(signedIn()).request(path, { method: "POST", body, headers: { authorization: "Bearer x", "content-type": "application/json", ...headers } });

describe("body limit", () => {
  it("refuses a body over 2 MB with 413 before parsing it", async () => {
    const big = JSON.stringify({ json: { businessId: hz.A.businessId, pad: "x".repeat(LIMITS.trpcMaxBodyBytes) } });
    const res = await post("/trpc/business.continue", big);
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toBe("payload_too_large");
  });

  it("a chunked body without a Content-Length is counted as it arrives", async () => {
    const chunk = new TextEncoder().encode("x".repeat(512 * 1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 6) return controller.close();
        sent += 1;
        controller.enqueue(chunk);
      },
    });
    const res = await createApp(signedIn()).request("/trpc/business.continue", { method: "POST", body: stream, headers: { authorization: "Bearer x", "content-type": "application/json" }, duplex: "half" } as RequestInit);
    expect(res.status).toBe(413);
  });

  it("lets a logo upload through up to 6 MB, and still refuses past it", async () => {
    const svg = `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg">${"<g/>".repeat(700_000)}</svg>`).toString("base64")}`;
    expect(svg.length).toBeGreaterThan(LIMITS.trpcMaxBodyBytes);
    const res = await post("/trpc/business.logo.prepare", JSON.stringify({ json: { businessId: hz.A.businessId, dataUrl: svg } }));
    expect(res.status).not.toBe(413);
    const over = await post("/trpc/business.logo.prepare", JSON.stringify({ json: { businessId: hz.A.businessId, dataUrl: "x".repeat(LIMITS.trpcMaxLogoBodyBytes) } }));
    expect(over.status).toBe(413);
  });

  it("picks the limit from the procedures a request names", () => {
    expect(trpcPaths("/trpc/inbox.list,cycle.status")).toEqual(["inbox.list", "cycle.status"]);
    expect(trpcPaths("/trpc/inbox.list%2Ccycle.status")).toEqual(["inbox.list", "cycle.status"]);
    expect(trpcBodyLimitFor("/trpc/business.continue")).toBe(LIMITS.trpcMaxBodyBytes);
    expect(trpcBodyLimitFor("/trpc/inbox.list,idea.commit")).toBe(LIMITS.trpcMaxLogoBodyBytes);
    expect(trpcBodyLimitFor("/trpc/business.logo.upload")).toBe(LIMITS.trpcMaxLogoBodyBytes);
  });
});

describe("batch limit", () => {
  it("answers a batch of up to the limit and refuses a longer one with 400", async () => {
    const batch = (n: number) => {
      const paths = Array.from({ length: n }, () => "founder.preferences.get").join(",");
      const input = Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i), { json: null }]));
      return createApp(signedIn()).request(`/trpc/${paths}?batch=1&input=${encodeURIComponent(JSON.stringify(input))}`, { headers: { authorization: "Bearer x" } });
    };
    const ok = await batch(LIMITS.trpcMaxBatchSize);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as unknown[]).length).toBe(LIMITS.trpcMaxBatchSize);
    const refused = await batch(LIMITS.trpcMaxBatchSize + 1);
    expect(refused.status).toBe(400);
  });
});
