/**
 * Social skeleton on PGlite: Personal businesses never appear in /v1/public-profiles (BUILD §7.3, AC-11.12.2 spirit),
 * the view is the only read, the Phase 4 routers answer 501, and the service binds an ephemeral port on "::".
 */
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import { repos, type Db } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, PHASE4_ROUTERS, type SocialApp } from "../app";
import { listen } from "../index";

let h: TestHarness;
let db: Db;
let app: SocialApp;
const ids: Record<"live" | "personal" | "personalCommitted" | "liveDraft" | "liveArchived", string> = { live: "", personal: "", personalCommitted: "", liveDraft: "", liveArchived: "" };
let liveOwner = "";
let personalOwner = "";

async function business(name: string, gameMode: "live" | "personal", ownerId: string, opts: { commit?: boolean; archive?: boolean } = {}) {
  const b = await repos.businesses.create(db, { name, gameMode, createdBy: ownerId, archetype: "b2b_saas" });
  await repos.memberships.add(db, b.id, { userId: ownerId, role: "owner" });
  if (opts.commit) await repos.businesses.commit(db, b.id, { archetype: "b2b_saas" });
  if (opts.archive) await repos.businesses.archive(db, b.id);
  return b.id;
}

beforeAll(async () => {
  h = await createTestDb();
  db = h.db as unknown as Db;
  liveOwner = await h.createUser("live-owner@test.local");
  personalOwner = await h.createUser("personal-owner@test.local");
  ids.live = await business("Zeta Robotics Live", "live", liveOwner, { commit: true });
  ids.personal = await business("Zeta Robotics Personal", "personal", personalOwner);
  ids.personalCommitted = await business("Zeta Robotics Committed Personal", "personal", personalOwner, { commit: true });
  ids.liveDraft = await business("Zeta Robotics Draft", "live", liveOwner);
  ids.liveArchived = await business("Zeta Robotics Archived", "live", liveOwner, { commit: true, archive: true });
  // Founder profiles: the LIVE owner opted in (public); the Personal owner is also "public" but has no LIVE club.
  await repos.founders.upsert(db, liveOwner, { displayName: "Zeta Founder Live", visibility: "public" });
  await repos.founders.upsert(db, personalOwner, { displayName: "Zeta Founder Personal", visibility: "public" });
  app = createApp(db, { env: { APP_ENV: "test", INTEGRATIONS_MODE: "mock", MODEL_MODE: "mock" } });
}, 120_000);

afterAll(async () => {
  await h?.close();
});

const get = (path: string) => app.request(path);

describe("GET /v1/public-profiles", () => {
  it("lists only LIVE, committed, non-archived businesses — Personal businesses never appear (AC-11.12.2 spirit)", async () => {
    const res = await get("/v1/public-profiles?q=Zeta%20Robotics&kind=business&limit=50");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("public_profiles");
    expect(body.label).toBe("On Foundmill");
    const returned = (body.profiles as { businessId: string; displayName: string; kind: string }[]).map((p) => p.businessId);
    expect(returned).toEqual([ids.live]);
    expect(returned).not.toContain(ids.personal);
    expect(returned).not.toContain(ids.personalCommitted);
    expect(returned).not.toContain(ids.liveDraft);
    expect(returned).not.toContain(ids.liveArchived);
  });

  it("exposes only public fields of the business row (no financial or private columns)", async () => {
    const res = await get(`/v1/public-profiles?businessId=${ids.live}`);
    expect(res.status).toBe(200);
    const [profile] = (await res.json()).profiles;
    expect(profile).toMatchObject({ businessId: ids.live, kind: "business", displayName: "Zeta Robotics Live", archetype: "b2b_saas" });
    expect(Object.keys(profile).sort()).toEqual(["archetype", "businessId", "committedAt", "crestUrl", "displayName", "kind", "kitPrimary", "kitSecondary", "region", "slug", "userId"].sort());
  });

  it("a Personal business by id is a 404, as are draft and archived LIVE businesses", async () => {
    for (const id of [ids.personal, ids.personalCommitted, ids.liveDraft, ids.liveArchived]) {
      const res = await get(`/v1/public-profiles?businessId=${id}`);
      expect(res.status, id).toBe(404);
      expect(await res.json()).toMatchObject({ error: "not_found" });
    }
  });

  it("founder profiles appear only through a LIVE club they own or administer", async () => {
    const res = await get("/v1/public-profiles?q=Zeta%20Founder&kind=founder");
    expect(res.status).toBe(200);
    const profiles = (await res.json()).profiles as { displayName: string; userId: string; businessId: string }[];
    expect(profiles.map((p) => p.displayName)).toEqual(["Zeta Founder Live"]);
    expect(profiles[0]).toMatchObject({ userId: liveOwner, businessId: ids.live });
  });

  it("validates the query: q or businessId is required, limit is bounded, kind is an enum", async () => {
    expect((await get("/v1/public-profiles")).status).toBe(400);
    expect((await get("/v1/public-profiles?q=Zeta&limit=1000")).status).toBe(400);
    expect((await get("/v1/public-profiles?q=Zeta&kind=robot")).status).toBe(400);
    expect((await get("/v1/public-profiles?businessId=not-a-uuid")).status).toBe(400);
    const ok = await get("/v1/public-profiles?q=Zeta&limit=1");
    expect(ok.status).toBe(200);
    expect((await ok.json()).profiles.length).toBeLessThanOrEqual(1);
  });
});

describe("Phase 4 routers", () => {
  it("every Phase 4 router answers 501 with the feature name on any method and sub-path", async () => {
    for (const router of PHASE4_ROUTERS) {
      for (const [method, path] of [
        ["GET", router.path],
        ["POST", router.path],
        ["GET", `${router.path}/some-id`],
        ["DELETE", `${router.path}/some-id/members`],
      ] as const) {
        const res = await app.request(path, { method });
        expect(res.status, `${method} ${path}`).toBe(501);
        const body = await res.json();
        expect(body).toMatchObject({ error: "not_implemented", feature: router.feature, phase: 4 });
        expect(String(body.message)).toMatch(/Phase 4/);
      }
    }
    expect(PHASE4_ROUTERS.map((r) => r.feature)).toEqual(["connections", "messages", "communities", "leaderboards", "negotiation"]);
  });

  it("unknown routes are 404 and the root lists the pending routers", async () => {
    const missing = await get("/v1/nope");
    expect(missing.status).toBe(404);
    const root = await (await get("/")).json();
    expect(root).toMatchObject({ name: "Foundmill", service: "social", ok: true });
    expect(root.routers).toHaveLength(5);
  });
});

describe("health and listening", () => {
  it("GET /health reports the service and modes", async () => {
    const res = await get("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, app: "Foundmill", service: "social", env: "test", modes: { integrations: "mock", models: "mock" }, liveMode: false });
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("listens on an ephemeral port on :: (or 0.0.0.0 when IPv6 is unavailable) and serves the same app", async () => {
    const logs: string[] = [];
    const server = await listen(app, 0, { info: (_o, m) => logs.push(m ?? ""), warn: (_o, m) => logs.push(m ?? "") });
    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      expect(port).toBeGreaterThan(0);
      const res = await fetch(`http://127.0.0.1:${port}/v1/public-profiles?q=Zeta%20Robotics&kind=business`);
      expect(res.status).toBe(200);
      expect(((await res.json()).profiles as { businessId: string }[]).map((p) => p.businessId)).toEqual([ids.live]);
      expect(logs.some((m) => m === "social listening")).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
