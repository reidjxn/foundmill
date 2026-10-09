/** The business logo (0017): `set` checks before it stores, one row per business, members read, only the service writes. */
import { bytesToBase64, checkLogo, isLogoDataUrl } from "@foundmill/shared/logo";
import { makePng } from "@foundmill/shared/testing/logo-fixtures";
import { ValidationError } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import { eq } from "drizzle-orm";
import { businessLogos, businesses } from "../../schema";
import { RLS_DENIED } from "../rls/fixtures";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("logo");
});
afterAll(() => r?.close());

const png = (size = 64) => ({ mime: "image/png" as const, base64: bytesToBase64(makePng(size, size)) });
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onload="alert(1)"><script>alert(2)</script><rect width="100" height="100" rx="20" fill="#1b4fd8"/></svg>';

describe("logos", () => {
  it("stores a checked raster, reads it back as a data URL and reports metadata without the bytes", async () => {
    const { businessId, ownerId } = r.A;
    expect(await repos.logos.getMeta(r.db, businessId)).toBeNull();
    const { meta, previous } = await r.svc((tx) => repos.logos.set(tx, businessId, { source: "upload", logo: png(64), createdBy: ownerId }));
    expect(previous).toBeNull();
    expect(meta).toMatchObject({ source: "upload", mime: "image/png", width: 64, height: 64 });
    expect(meta.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(meta.bytes).toBeGreaterThan(40);
    expect(await repos.logos.getMeta(r.db, businessId)).toEqual({ ...meta, updatedAt: expect.any(Date) });
    const image = await repos.logos.get(r.db, businessId);
    expect(isLogoDataUrl(image?.dataUrl)).toBe(true);
    expect(image?.dataUrl).toBe(`data:image/png;base64,${png(64).base64}`);
  });

  it("replaces the logo in place and stores SVG only after sanitising", async () => {
    const { businessId } = r.A;
    const before = await repos.logos.getMeta(r.db, businessId);
    const { meta, previous, checked } = await r.svc((tx) => repos.logos.set(tx, businessId, { source: "generated", logo: { mime: "image/svg+xml", svg: SVG } }));
    expect(previous?.sha256).toBe(before?.sha256);
    expect(meta).toMatchObject({ source: "generated", mime: "image/svg+xml", width: 512, height: 512 });
    expect(checked.removed).toEqual(["attribute:onload", "element:script"]);
    const rows = await r.db.select({ id: businessLogos.id }).from(businessLogos);
    expect(rows.filter(Boolean).length).toBeGreaterThanOrEqual(1);
    const stored = Buffer.from((await repos.logos.get(r.db, businessId))!.dataUrl.split(",")[1]!, "base64").toString("utf8");
    expect(stored).not.toMatch(/script|onload/);
    expect(stored).toContain('fill="#1b4fd8"');
  });

  it("refuses what the check refuses (wrong magic bytes, oversize, hostile SVG with nothing left)", async () => {
    const { businessId } = r.B;
    await expect(r.svc((tx) => repos.logos.set(tx, businessId, { source: "upload", logo: { mime: "image/png", base64: bytesToBase64(new TextEncoder().encode("<html><script>alert(1)</script></html>")) } }))).rejects.toThrow(ValidationError);
    await expect(r.svc((tx) => repos.logos.set(tx, businessId, { source: "upload", logo: { mime: "image/svg+xml", svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script>alert(1)</script></svg>' } }))).rejects.toThrow(/Nothing drawable/);
    await expect(r.svc((tx) => repos.logos.set(tx, businessId, { source: "upload", logo: { mime: "image/png", base64: bytesToBase64(makePng(2000, 2000)) } }))).rejects.toThrow(/larger than/);
    expect(await repos.logos.getMeta(r.db, businessId)).toBeNull();
  });

  it("is read by members and written by no app role, not even the owner (the api writes after its checks)", async () => {
    const { businessId, ownerId, viewerId } = r.A;
    expect(await r.as(viewerId, (tx) => repos.logos.getMeta(tx, businessId))).not.toBeNull();
    expect(await r.as(r.B.ownerId, (tx) => repos.logos.getMeta(tx, businessId))).toBeNull();
    await expect(r.as(ownerId, (tx) => repos.logos.set(tx, businessId, { source: "upload", logo: png(32) }))).rejects.toThrow(RLS_DENIED);
    expect(await r.as(ownerId, (tx) => repos.logos.remove(tx, businessId).then(() => repos.logos.getMeta(tx, businessId)))).not.toBeNull();
  });

  it("stores a result checkLogo returned without checking again, and refuses a look-alike object outright", async () => {
    const { businessId } = r.B;
    const check = checkLogo(png(48));
    if (!check.ok) throw new Error(check.reason);
    // The result is frozen, but its byte array cannot be: storage writes the bytes decoded from the frozen base64.
    const checkedDataUrl = check.logo.dataUrl;
    check.logo.bytes.fill(0);
    const { meta } = await r.svc((tx) => repos.logos.set(tx, businessId, { source: "upload", logo: check.logo }));
    expect(meta).toMatchObject({ width: 48, height: 48 });
    expect((await repos.logos.get(r.db, businessId))!.dataUrl).toBe(checkedDataUrl);
    // A hand-built object with the same shape (a copy, or a forgery) is not trusted, and is not mistaken for raw input.
    const forged = { ...check.logo, mime: "image/svg+xml" as const, bytes: new TextEncoder().encode("<svg onload=alert(1)>") };
    for (const lookAlike of [forged, { ...check.logo }]) {
      const attempt = r.svc((tx) => repos.logos.set(tx, businessId, { source: "upload", logo: lookAlike as never }));
      await expect(attempt).rejects.toBeInstanceOf(ValidationError);
      await expect(attempt).rejects.toThrow(/not produced by the logo check/);
    }
    await r.svc((tx) => repos.logos.remove(tx, businessId));
  });

  it("crest_url is retired: emptied, and a check refuses any value, even from the service role", async () => {
    const { businessId, ownerId } = r.A;
    await expect(r.svc((tx) => tx.update(businesses).set({ crestUrl: "https://evil.example/pixel.png" }).where(eq(businesses.id, businessId)))).rejects.toThrow(/businesses_crest_url_retired|check constraint/);
    await expect(r.as(ownerId, (tx) => tx.update(businesses).set({ crestUrl: "javascript:alert(1)" }).where(eq(businesses.id, businessId)))).rejects.toThrow(/businesses_crest_url_retired|check constraint/);
    expect((await repos.businesses.get(r.db, businessId)).crestUrl).toBeNull();
    // The repo inputs no longer take it.
    await repos.businesses.update(r.db, businessId, { name: "Still fine", crestUrl: "https://evil.example/x.png" } as never);
    expect((await repos.businesses.get(r.db, businessId)).crestUrl).toBeNull();
  });

  it("removes the logo", async () => {
    const { businessId } = r.A;
    const removed = await r.svc((tx) => repos.logos.remove(tx, businessId));
    expect(removed?.mime).toBe("image/svg+xml");
    expect(await repos.logos.getMeta(r.db, businessId)).toBeNull();
    expect(await r.svc((tx) => repos.logos.remove(tx, businessId))).toBeNull();
  });
});
