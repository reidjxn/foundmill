/**
 * Speed work on the API that must not change behaviour: membership and business looked up once per HTTP request and
 * user (never shared between requests, never for the in-process caller), `department.list` in three projected queries
 * with the same answer as before, `journey.ribbon`'s slim mode, and gzip on tRPC answers that never touches a stream.
 */
import { repos } from "@foundmill/db";
import { createBusinessFixture } from "@foundmill/db/__tests__/rls/fixtures";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp, isStreamingRequest } from "../app";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "speed" });
}, 120_000);
afterAll(() => hz.close());

/** Deps whose bearer resolves to `userId` (the HTTP path, with a fresh context per request). */
const asUser = (userId: string) => ({ ...hz.deps, auth: { ...hz.deps.auth, resolve: async () => ({ userId, email: null, authenticatedAt: new Date() }) } }) as typeof hz.deps;

/** A batched GET of several procedures, superjson-encoded the way httpBatchLink sends it. */
function batchUrl(calls: { path: string; input: unknown }[]): string {
  const input = Object.fromEntries(calls.map((c, i) => [String(i), { json: c.input }]));
  return `/trpc/${calls.map((c) => c.path).join(",")}?batch=1&input=${encodeURIComponent(JSON.stringify(input))}`;
}

type BatchResult = { result?: { data: { json: unknown } }; error?: { json: { data: { code: string } } } };
const codes = (body: BatchResult[]) => body.map((r) => (r.error ? r.error.json.data.code : "OK"));

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (err) {
    return err instanceof TRPCError ? err.code : `other:${String(err)}`;
  }
};

describe("membership and business lookups (businessProcedure)", () => {
  it("run once per HTTP request for a whole batch, and again for the next request", async () => {
    const access = vi.spyOn(repos.memberships, "access");
    try {
      const app = createApp(asUser(hz.A.ownerId));
      const bid = hz.A.businessId;
      const url = batchUrl([
        { path: "inbox.list", input: { businessId: bid } },
        { path: "department.list", input: { businessId: bid } },
        { path: "business.get", input: { businessId: bid } },
        { path: "finance.overview", input: { businessId: bid } },
      ]);
      const res = await app.request(url, { headers: { authorization: "Bearer x" } });
      expect(res.status).toBe(200);
      expect(codes((await res.json()) as BatchResult[])).toEqual(["OK", "OK", "OK", "OK"]);
      // The middleware reads through the service db (procedures read through their RLS transaction).
      const lookups = (calls: unknown[][]) => calls.filter((c) => c[0] === hz.deps.db && c[1] === bid).length;
      expect(lookups(access.mock.calls)).toBe(1);

      access.mockClear();
      const again = await app.request(url, { headers: { authorization: "Bearer x" } });
      expect(again.status).toBe(200);
      expect(lookups(access.mock.calls)).toBe(1);
    } finally {
      access.mockRestore();
    }
  });

  it("looks up the membership and the business in one statement, never as two lookups", async () => {
    const membership = vi.spyOn(repos.memberships, "get");
    const business = vi.spyOn(repos.businesses, "get");
    try {
      const res = await createApp(asUser(hz.A.ownerId)).request(batchUrl([{ path: "inbox.list", input: { businessId: hz.A.businessId } }]), { headers: { authorization: "Bearer x" } });
      expect(res.status).toBe(200);
      expect(membership).not.toHaveBeenCalled();
      expect(business).not.toHaveBeenCalled();
    } finally {
      membership.mockRestore();
      business.mockRestore();
    }
  });

  it("answers NOT_FOUND to a member of an archived business, as the business lookup did", async () => {
    const archived = await createBusinessFixture(hz.h, "speed-archived");
    await repos.businesses.archive(hz.db, archived.businessId);
    expect(await code(hz.caller({ userId: archived.ownerId }).business.get({ businessId: archived.businessId }))).toBe("NOT_FOUND");
    expect(await code(hz.caller({ userId: hz.A.ownerId }).business.get({ businessId: archived.businessId }))).toBe("FORBIDDEN");
  });

  it("keeps FORBIDDEN per business inside one batch, and a non-member never learns whether a business exists", async () => {
    const app = createApp(asUser(hz.A.ownerId));
    const missing = "00000000-0000-4000-8000-0000000000aa";
    const res = await app.request(
      batchUrl([
        { path: "inbox.list", input: { businessId: hz.A.businessId } },
        { path: "inbox.list", input: { businessId: hz.B.businessId } },
        { path: "department.list", input: { businessId: hz.B.businessId } },
        { path: "inbox.list", input: { businessId: missing } },
      ]),
      { headers: { authorization: "Bearer x" } },
    );
    expect(codes((await res.json()) as BatchResult[])).toEqual(["OK", "FORBIDDEN", "FORBIDDEN", "FORBIDDEN"]);
  });

  it("never reuses one user's lookup for another user's request", async () => {
    const bid = hz.A.businessId;
    const url = batchUrl([{ path: "inbox.list", input: { businessId: bid } }]);
    expect(codes((await (await createApp(asUser(hz.A.ownerId)).request(url, { headers: { authorization: "Bearer x" } })).json()) as BatchResult[])).toEqual(["OK"]);
    expect(codes((await (await createApp(asUser(hz.B.ownerId)).request(url, { headers: { authorization: "Bearer x" } })).json()) as BatchResult[])).toEqual(["FORBIDDEN"]);
  });

  it("the in-process caller looks up on every call, so a membership change is seen at once", async () => {
    const viewer = hz.caller({ userId: hz.A.viewerId });
    expect(await code(viewer.business.pauseCycle({ businessId: hz.A.businessId }))).toBe("FORBIDDEN");
    await repos.memberships.setRole(hz.db, hz.A.businessId, hz.A.viewerId, "admin");
    try {
      expect(await code(viewer.business.pauseCycle({ businessId: hz.A.businessId }))).toBe("OK");
    } finally {
      await repos.memberships.setRole(hz.db, hz.A.businessId, hz.A.viewerId, "viewer");
    }
    expect(await code(viewer.business.pauseCycle({ businessId: hz.A.businessId }))).toBe("FORBIDDEN");
  });
});

describe("department.list", () => {
  it("answers exactly what the per-department version did, with three queries and no screen layouts", async () => {
    const bid = hz.A.businessId;
    const admin = hz.caller({ userId: hz.A.ownerId });
    const created = await admin.department.create({ businessId: bid, name: "Build", moduleKeys: ["development"] });
    await repos.agents.update(hz.db, bid, hz.A.agent2Id, { departmentIds: [created.id, hz.A.departmentId] });

    // The previous implementation, kept here as the oracle.
    const departments = await repos.departments.list(hz.db, bid, { includeHidden: true });
    const agents = await repos.agents.list(hz.db, bid, { limit: 500 });
    const screens = await Promise.all(departments.map((d) => repos.screens.list(hz.db, bid, d.id)));
    const pick = (a: (typeof agents.items)[number]) => ({ id: a.id, name: a.name, role: a.role, status: a.status, modelKey: a.modelKey, avatarSeed: a.avatarSeed, personaKey: a.personaKey, layer: a.layer });
    const expected = departments.map((d, i) => {
      const lead = agents.items.find((a) => a.id === d.leadAgentId);
      return {
        ...d,
        lead: lead ? pick(lead) : null,
        squad: agents.items.filter((a) => a.departmentIds.includes(d.id)).map(pick),
        tabs: (screens[i] ?? []).map((s) => ({ id: s.id, slug: s.tabSlug, title: s.title, position: s.position })),
      };
    });

    const perDepartment = vi.spyOn(repos.screens, "list");
    const fullAgents = vi.spyOn(repos.agents, "list");
    try {
      const got = await admin.department.list({ businessId: bid, includeHidden: true });
      expect(got).toEqual(expected);
      expect(got.find((d) => d.id === created.id)?.tabs.length).toBeGreaterThan(0);
      expect(got.find((d) => d.id === hz.A.departmentId)?.squad.map((a) => a.id)).toContain(hz.A.agent2Id);
      expect(perDepartment).not.toHaveBeenCalled();
      expect(fullAgents).not.toHaveBeenCalled();
    } finally {
      perDepartment.mockRestore();
      fullAgents.mockRestore();
    }
  });
});

describe("journey.ribbon slim", () => {
  it("drops the per-conversion detail and keeps rows, milestones and the conversion count", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const full = await owner.journey.ribbon({ businessId: hz.A.businessId, from, to: today });
    const slim = await owner.journey.ribbon({ businessId: hz.A.businessId, from, to: today, slim: true });
    expect(full.conversions.length).toBe(6);
    expect(full.conversionCount).toBe(6);
    expect(slim.conversions).toEqual([]);
    expect(slim.conversionCount).toBe(6);
    expect(slim.rows).toEqual(full.rows);
    expect(slim.milestones).toEqual(full.milestones);
    expect(slim.chapters).toEqual(full.chapters);
  });
});

describe("compressed tRPC answers", () => {
  const bid = () => hz.A.businessId;
  const headers = (extra: Record<string, string> = {}) => ({ authorization: "Bearer x", origin: "http://localhost:3000", "accept-encoding": "gzip, deflate, br", ...extra });

  it("gzips a batch the client accepts gzip for, keeps CORS and the request id, and decompresses to the same JSON", async () => {
    const app = createApp(asUser(hz.A.ownerId));
    const url = batchUrl([
      { path: "department.list", input: { businessId: bid() } },
      { path: "inbox.list", input: { businessId: bid() } },
    ]);
    const plain = await app.request(url, { headers: headers({ "accept-encoding": "identity" }) });
    expect(plain.headers.get("content-encoding")).toBeNull();
    const plainBody = await plain.text();

    const zipped = await app.request(url, { headers: headers({ "x-request-id": "req-gzip-1234" }) });
    expect(zipped.status).toBe(200);
    expect(zipped.headers.get("content-encoding")).toBe("gzip");
    expect(zipped.headers.get("vary") ?? "").toMatch(/accept-encoding/i);
    expect(zipped.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(zipped.headers.get("x-request-id")).toBe("req-gzip-1234");
    const raw = new Uint8Array(await zipped.arrayBuffer());
    expect(raw.byteLength).toBeLessThan(new TextEncoder().encode(plainBody).byteLength);
    const unzipped = await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    // The answer is the same JSON (timestamps aside, the inbox page is identical between two reads).
    expect(JSON.parse(unzipped)).toEqual(JSON.parse(plainBody));
  });

  it("never compresses a streamed batch (httpBatchStreamLink), which still arrives as chunks", async () => {
    const app = createApp(asUser(hz.A.ownerId));
    const url = batchUrl([
      { path: "department.list", input: { businessId: bid() } },
      { path: "inbox.list", input: { businessId: bid() } },
    ]);
    const res = await app.request(url, { headers: headers({ "trpc-accept": "application/jsonl" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("transfer-encoding")).toBe("chunked");
    const text = await res.text();
    expect(text.trim().split("\n").length).toBeGreaterThan(1);
  });

  it("recognises streaming requests by trpc-accept or accept", () => {
    const h = (init: Record<string, string>) => new Headers(init);
    expect(isStreamingRequest(h({ "trpc-accept": "application/jsonl" }))).toBe(true);
    expect(isStreamingRequest(h({ accept: "application/json, application/jsonl" }))).toBe(true);
    expect(isStreamingRequest(h({ accept: "text/event-stream" }))).toBe(true);
    expect(isStreamingRequest(h({ accept: "application/json" }))).toBe(false);
    expect(isStreamingRequest(h({}))).toBe(false);
  });
});
