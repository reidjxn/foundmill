/**
 * business.logo.* and idea.logo.* (BUILD §11.1 Commit screen, §11.15 Settings › Business): owners and admins set,
 * replace and remove the logo, every change is audited, everything stored passes the logo check (rasters by magic
 * bytes, size and dimensions; SVG through the sanitiser), generation is sanitised, metered and rate-limited, and the
 * chosen logo travels with idea.commit.
 */
import { repos } from "@foundmill/db";
import { LIMITS } from "@foundmill/config";
import { bytesToBase64, isLogoDataUrl, sanitiseSvg } from "@foundmill/shared/logo";
import { makeJpeg, makePng } from "@foundmill/shared/testing/logo-fixtures";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { logoLimiter, takeLogoAllowance } from "../services/logo";
import { SlidingWindowLimiter } from "../services/rate-limit";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "logo" });
}, 120_000);
afterAll(() => hz.close());
beforeEach(() => logoLimiter.reset());

const pngUrl = (size = 512) => `data:image/png;base64,${bytesToBase64(makePng(size, size))}`;
const svgUrl = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
const HOSTILE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100" onload="alert(1)"><script>alert(2)</script><foreignObject><iframe src="javascript:alert(3)"/></foreignObject><use xlink:href="https://evil.example/x.svg#a"/><image href="data:image/png;base64,AAAA"/><style>rect{fill:url(https://evil.example/t.png)}</style><rect width="100" height="100" rx="22" fill="#1f6f5f"/><circle cx="50" cy="50" r="20" fill="#e8c56b"/></svg>';
const decodeSvg = (dataUrl: string) => Buffer.from(dataUrl.split(",")[1]!, "base64").toString("utf8");
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (err) {
    return err instanceof TRPCError ? err.code : String(err);
  }
};

describe("business.logo.* (owner/admin, audited)", () => {
  it("an owner uploads a raster; business.get carries only the metadata and logo.get the image", async () => {
    const { businessId, ownerId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const before = await owner.business.get({ businessId });
    expect(before.logo).toBeNull();

    const res = await owner.business.logo.upload({ businessId, source: "upload", dataUrl: pngUrl() });
    expect(res.logo).toMatchObject({ source: "upload", mime: "image/png", width: 512, height: 512 });

    const got = await owner.business.get({ businessId });
    expect(got.logo).toMatchObject({ sha256: res.logo.sha256, mime: "image/png", bytes: res.logo.bytes });
    // The image is not in business.get: its JSON stays small whatever the logo weighs.
    expect(JSON.stringify(got)).not.toContain("data:image");
    const image = await owner.business.logo.get({ businessId, version: res.logo.sha256 });
    expect(isLogoDataUrl(image?.dataUrl)).toBe(true);

    const audit = await repos.audit.list(hz.db, businessId, { action: "business.logo.set" });
    expect(audit.items[0]).toMatchObject({ actorKind: "user", actorId: ownerId, details: expect.objectContaining({ source: "upload", mime: "image/png", sha256: res.logo.sha256, previousSha256: null }) });
  });

  it("an admin replaces it with an SVG, which is stored sanitised (the audit names what was removed)", async () => {
    const { businessId, adminId } = hz.A;
    const admin = hz.caller({ userId: adminId });
    const previous = (await admin.business.get({ businessId })).logo!;
    const res = await admin.business.logo.upload({ businessId, source: "upload", dataUrl: svgUrl(HOSTILE_SVG) });
    expect(res.logo.mime).toBe("image/svg+xml");
    const stored = decodeSvg((await admin.business.logo.get({ businessId }))!.dataUrl);
    expect(stored).not.toMatch(/script|onload|foreignObject|iframe|javascript|evil|<image|<use|<style|url\(/);
    expect(stored).toContain('fill="#1f6f5f"');
    expect(sanitiseSvg(stored)).toMatchObject({ ok: true, svg: stored });
    const audit = await repos.audit.list(hz.db, businessId, { action: "business.logo.set" });
    expect(audit.items[0]!.details).toMatchObject({ previousSha256: previous.sha256, sanitised: expect.arrayContaining(["attribute:onload", "element:script", "element:foreignObject", "element:image", "element:style"]) });
  });

  it("members, viewers and other businesses' owners cannot set, generate or remove it; members can read it", async () => {
    const { businessId, memberId, viewerId } = hz.A;
    for (const userId of [memberId, viewerId, hz.B.ownerId]) {
      const c = hz.caller({ userId });
      expect(await code(c.business.logo.upload({ businessId, source: "upload", dataUrl: pngUrl(64) }))).toBe("FORBIDDEN");
      expect(await code(c.business.logo.generate({ businessId }))).toBe("FORBIDDEN");
      expect(await code(c.business.logo.remove({ businessId }))).toBe("FORBIDDEN");
    }
    expect(await hz.caller({ userId: viewerId }).business.logo.get({ businessId })).not.toBeNull();
    expect(await code(hz.caller({ userId: hz.B.ownerId }).business.logo.get({ businessId }))).toBe("FORBIDDEN");
  });

  it("refuses what the check refuses: a JPEG called PNG, HTML called PNG, oversize images, non-image data URLs", async () => {
    const { businessId, ownerId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const sha = (await owner.business.get({ businessId })).logo!.sha256;
    const bad = [
      `data:image/png;base64,${bytesToBase64(makeJpeg(512, 512))}`,
      `data:image/png;base64,${Buffer.from("<html><script>alert(1)</script></html>").toString("base64")}`,
      `data:image/png;base64,${bytesToBase64(makePng(2048, 2048))}`,
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "https://evil.example/logo.png",
      svgUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script>alert(1)</script></svg>'),
      svgUrl('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><text>&x;</text></svg>'),
    ];
    for (const dataUrl of bad) expect(await code(owner.business.logo.upload({ businessId, source: "upload", dataUrl }))).toBe("BAD_REQUEST");
    expect((await owner.business.get({ businessId })).logo!.sha256).toBe(sha);
  });

  it("prepare checks without storing and returns the cleaned preview with colour suggestions", async () => {
    const { businessId, ownerId } = hz.B;
    const owner = hz.caller({ userId: ownerId });
    const prepared = await owner.business.logo.prepare({ businessId, dataUrl: svgUrl(HOSTILE_SVG) });
    expect(prepared).toMatchObject({ mime: "image/svg+xml", width: 512, height: 512, colours: ["#1f6f5f", "#e8c56b"] });
    expect(decodeSvg(prepared.dataUrl)).not.toMatch(/script|onload/);
    expect(await repos.logos.getMeta(hz.db, businessId)).toBeNull();
  });

  it("removes the logo (audited) and business.get falls back to null", async () => {
    const { businessId, ownerId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    expect(await owner.business.logo.remove({ businessId })).toEqual({ removed: true });
    expect((await owner.business.get({ businessId })).logo).toBeNull();
    expect(await owner.business.logo.get({ businessId })).toBeNull();
    expect(await owner.business.logo.remove({ businessId })).toEqual({ removed: false });
    const audit = await repos.audit.list(hz.db, businessId, { action: "business.logo.remove" });
    expect(audit.items).toHaveLength(1);
  });

  it("business.update no longer writes crest_url (a legacy column that could point anywhere)", async () => {
    const { businessId, ownerId } = hz.A;
    await hz.caller({ userId: ownerId }).business.update({ businessId, name: "Alpha Renamed", crestUrl: "https://evil.example/pixel.png" } as never);
    const b = await repos.businesses.get(hz.db, businessId);
    expect(b.name).toBe("Alpha Renamed");
    expect(b.crestUrl).toBeNull();
  });
});

describe("business.logo.generate (Opus, sanitised, metered, rate-limited)", () => {
  it("returns four distinct sanitised marks with an Estimate cost, books the usage and audits the call", async () => {
    const { businessId, ownerId } = hz.B;
    const owner = hz.caller({ userId: ownerId });
    const set = await owner.business.logo.generate({ businessId, colours: { primary: "#1f6f5f", secondary: "#e8c56b" } });
    expect(set.options).toHaveLength(LIMITS.logoOptionsPerSet);
    expect(new Set(set.options.map((o) => o.id)).size).toBe(set.options.length);
    expect(set.cost).toMatchObject({ currency: "USD", label: "Estimate" });
    expect(set.mode).toBe("mock");
    for (const o of set.options) {
      expect(isLogoDataUrl(o.dataUrl)).toBe(true);
      expect(o.dataUrl.startsWith("data:image/svg+xml;base64,")).toBe(true);
      const svg = decodeSvg(o.dataUrl);
      expect(sanitiseSvg(svg)).toMatchObject({ ok: true, svg });
      expect(o.colours.length).toBeGreaterThan(0);
    }
    const again = await owner.business.logo.generate({ businessId, colours: { primary: "#1f6f5f", secondary: "#e8c56b" }, round: 1 });
    expect(again.options.map((o) => o.id)).not.toEqual(set.options.map((o) => o.id));

    const usage = await repos.usage.list(hz.db, businessId, {});
    expect(usage.items.filter((u) => (u.details as { purpose?: string }).purpose === "logo")).toHaveLength(2);
    const audit = await repos.audit.list(hz.db, businessId, { action: "business.logo.generate" });
    expect(audit.items[0]!.details).toMatchObject({ options: 4, costLabel: "Estimate", mode: "mock", round: 1 });

    // Picking a generated mark stores it as a generated logo.
    const picked = await owner.business.logo.upload({ businessId, source: "generated", dataUrl: set.options[2]!.dataUrl });
    expect(picked.logo).toMatchObject({ source: "generated", mime: "image/svg+xml" });
  });

  it("is limited per business per day and per user per hour", async () => {
    const { businessId, ownerId, adminId } = hz.B;
    const owner = hz.caller({ userId: ownerId });
    for (let i = 0; i < LIMITS.logoSetsPerUserPerHour; i++) await owner.business.logo.generate({ businessId, round: i });
    expect(await code(owner.business.logo.generate({ businessId, round: 99 }))).toBe("TOO_MANY_REQUESTS");
    // Another admin has their own hourly allowance...
    await hz.caller({ userId: adminId }).business.logo.generate({ businessId, round: 100 });
    // ...until the business's daily allowance runs out, whoever asks.
    const used = LIMITS.logoSetsPerUserPerHour + 1;
    for (let i = used; i < LIMITS.logoSetsPerBusinessPerDay; i++) takeLogoAllowance({ userId: `someone-${i}`, businessId });
    expect(() => takeLogoAllowance({ userId: "someone-else", businessId })).toThrow(/Logo generation limit reached/);
    expect(await code(hz.caller({ userId: adminId }).business.logo.generate({ businessId, round: 101 }))).toBe("TOO_MANY_REQUESTS");
    // A different business is unaffected.
    expect(() => takeLogoAllowance({ userId: "someone-else", businessId: hz.A.businessId })).not.toThrow();
  });
});

describe("idea.logo.* and idea.commit with a logo", () => {
  it("generates for the founder's idea, refuses someone else's idea, and commits the chosen mark", async () => {
    const userId = await hz.h.createUser("logo-founder@test.local");
    const caller = hz.caller({ userId });
    await caller.founder.profile.update({ displayName: "Reid", experience: "first-time", skills: { engineering: 14 }, targetMarkets: ["EU"], riskAppetite: "medium" });
    const idea = (await caller.idea.generate({ prompt: "bookkeeping for freelancers" })).ideas[0]!;

    const set = await caller.idea.logo.generate({ ideaId: idea.id, name: "Ledgerly", colours: { primary: "#1f6f5f", secondary: "#e8c56b" } });
    expect(set.options).toHaveLength(4);
    expect(set.cost.label).toBe("Estimate");
    const stranger = hz.caller({ userId: hz.A.memberId });
    expect(await code(stranger.idea.logo.generate({ ideaId: idea.id, name: "x", colours: { primary: "#1f6f5f", secondary: "#e8c56b" } }))).toBe("NOT_FOUND");

    // A bad logo fails the commit before anything is created.
    expect(await code(caller.idea.commit({ ideaId: idea.id, name: "Ledgerly Bad", archetype: "b2b_saas", logo: { source: "upload", dataUrl: `data:image/png;base64,${bytesToBase64(makeJpeg(64, 64))}` } }))).toBe("BAD_REQUEST");
    expect((await caller.idea.get({ ideaId: idea.id })).idea.committedAt).toBeNull();

    const result = await caller.idea.commit({ ideaId: idea.id, name: "Ledgerly Logo", archetype: "b2b_saas", kit: { primary: "#1F6F5F", secondary: "#E8C56B" }, logo: { source: "generated", dataUrl: set.options[0]!.dataUrl } });
    const bid = result.business.id;
    const meta = await repos.logos.getMeta(hz.db, bid);
    expect(meta).toMatchObject({ source: "generated", mime: "image/svg+xml" });
    expect((await caller.business.get({ businessId: bid })).logo?.sha256).toBe(meta!.sha256);
    const audit = await repos.audit.list(hz.db, bid, { action: "idea.commit" });
    expect(audit.items[0]!.details).toMatchObject({ logo: { source: "generated", mime: "image/svg+xml", sha256: meta!.sha256 } });
  });

  it("prepare cleans an SVG upload before commit; commit without a logo leaves the initials mark", async () => {
    const userId = await hz.h.createUser("logo-founder-2@test.local");
    const caller = hz.caller({ userId });
    await caller.founder.profile.update({ displayName: "Ana", experience: "operator", skills: { sales: 12 }, targetMarkets: ["EU"], riskAppetite: "low" });
    const prepared = await caller.idea.logo.prepare({ dataUrl: svgUrl(HOSTILE_SVG) });
    expect(decodeSvg(prepared.dataUrl)).not.toMatch(/script|onload|evil/);
    const idea = (await caller.idea.generate({ prompt: "a newsletter" })).ideas[0]!;
    const result = await caller.idea.commit({ ideaId: idea.id, name: "Plain Name", archetype: "content_media" });
    expect(await repos.logos.getMeta(hz.db, result.business.id)).toBeNull();
  });
});

describe("SlidingWindowLimiter", () => {
  it("allows `limit` hits per window per key, takes all keys or none, and frees up as the window slides", () => {
    let now = 0;
    const l = new SlidingWindowLimiter(() => now);
    const rule = { limit: 2, windowMs: 1000 };
    expect(l.takeAll([{ key: "u", rule }])).toEqual({ ok: true, remaining: 1 });
    now = 100;
    expect(l.takeAll([{ key: "u", rule }])).toEqual({ ok: true, remaining: 0 });
    expect(l.takeAll([{ key: "u", rule }])).toEqual({ ok: false, retryAfterMs: 900 });
    // Two keys: the full one blocks the other, which records nothing.
    expect(l.takeAll([{ key: "b", rule }, { key: "u", rule }])).toMatchObject({ ok: false });
    expect(l.peek("b", rule)).toEqual({ ok: true, remaining: 2 });
    now = 1001;
    expect(l.takeAll([{ key: "u", rule }])).toEqual({ ok: true, remaining: 0 });
    l.refund(["u"]);
    expect(l.peek("u", rule)).toEqual({ ok: true, remaining: 1 });
  });

  it("keeps at most maxKeys keys", () => {
    const l = new SlidingWindowLimiter(() => 0, 3);
    for (const k of ["a", "b", "c", "d"]) l.takeAll([{ key: k, rule: { limit: 1, windowMs: 1000 } }]);
    expect(l.peek("a", { limit: 1, windowMs: 1000 })).toEqual({ ok: true, remaining: 1 });
    expect(l.peek("d", { limit: 1, windowMs: 1000 })).toMatchObject({ ok: false });
  });
});
