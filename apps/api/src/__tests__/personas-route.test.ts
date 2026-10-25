/**
 * `GET /personas/:style/:key` and `GET /personas/:key` (Anthropomorphic agents, character styles): the stored face of a
 * catalog key in a style (humans for the short route), public like a static asset (no sign-in), served with the stored
 * mime and a one-day cache; a key outside the catalog, a style outside AGENT_STYLES, a face not generated yet and a key
 * that only looks like a path are plain 404s that are not cached.
 */
import { repos } from "@foundmill/db";
import { PERSONAS } from "@foundmill/shared";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { cachedPortraitCount, etagMatches, invalidateStoredPortrait, PORTRAIT_CACHE_MAX, PORTRAIT_CACHE_TTL_MS, PortraitLru, resetPortraitState } from "../services/personas";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
let app: ReturnType<typeof createApp>;
const STORED = PERSONAS[11]!.key;
const MISSING = PERSONAS[12]!.key;
const BYTES = new Uint8Array(Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBPVP8 face", "latin1"));

beforeAll(async () => {
  hz = await createApiHarness({ prefix: "personas-route" });
  app = createApp(hz.deps);
  await repos.personaPortraits.put(hz.db, { key: STORED, mime: "image/webp", content: BYTES, model: "test-image-model" });
}, 120_000);
afterAll(() => hz.close());
beforeEach(() => {
  resetPortraitState();
  vi.restoreAllMocks();
});

const ETAG = `"${createHash("sha256").update(BYTES).digest("hex")}"`;

describe("GET /personas/:key", () => {
  it("serves the stored bytes with the stored mime, no sign-in, and a one-day cache", async () => {
    const res = await app.request(`/personas/${STORED}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-site");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("etag")).toBe(ETAG);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
  });

  it("answers a matching If-None-Match with a 304 and no body, and anything else with the image", async () => {
    for (const inm of [ETAG, `W/${ETAG}`, `"other", ${ETAG}`, "*"]) {
      const res = await app.request(`/personas/${STORED}`, { headers: { "if-none-match": inm } });
      expect(res.status, inm).toBe(304);
      expect(res.headers.get("etag")).toBe(ETAG);
      expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
      expect(res.headers.get("cross-origin-resource-policy")).toBe("same-site");
      expect((await res.arrayBuffer()).byteLength).toBe(0);
    }
    const stale = await app.request(`/personas/${STORED}`, { headers: { "if-none-match": '"not-this-one"' } });
    expect(stale.status).toBe(200);
    expect(new Uint8Array(await stale.arrayBuffer())).toEqual(BYTES);
  });

  it("serves from memory after the first read: the table is read once per key", async () => {
    const get = vi.spyOn(repos.personaPortraits, "get");
    for (let i = 0; i < 4; i++) expect((await app.request(`/personas/${STORED}`)).status).toBe(200);
    expect((await app.request(`/personas/${STORED}`, { headers: { "if-none-match": ETAG } })).status).toBe(304);
    expect(get).toHaveBeenCalledTimes(1);
    expect(cachedPortraitCount()).toBe(1);
    // A missing face is not cached: the next request reads again (it may have been made meanwhile).
    await app.request(`/personas/${MISSING}`);
    await app.request(`/personas/${MISSING}`);
    expect(get).toHaveBeenCalledTimes(3);
    // A new face stored in this process drops the cached one.
    invalidateStoredPortrait(STORED);
    await app.request(`/personas/${STORED}`);
    expect(get).toHaveBeenCalledTimes(4);
  });

  it("holds at most 240 faces (the whole catalog), dropping the least recently used past that", () => {
    expect(PORTRAIT_CACHE_MAX).toBe(240);
    expect(PERSONAS.length).toBeLessThanOrEqual(PORTRAIT_CACHE_MAX);
    const lru = new PortraitLru(2);
    const face = (etag: string) => ({ mime: "image/webp", bytes: new Uint8Array(new ArrayBuffer(1)), etag });
    lru.set("a", face("a"), 0);
    lru.set("b", face("b"), 0);
    expect(lru.get("a", 1)?.etag).toBe("a");
    lru.set("c", face("c"), 1);
    expect(lru.size).toBe(2);
    expect(lru.get("b", 2)).toBeNull();
    expect(lru.get("a", 2)?.etag).toBe("a");
    // An entry past its time is read from the table again.
    expect(lru.get("c", 1 + PORTRAIT_CACHE_TTL_MS)).toBeNull();
  });

  it("etagMatches reads lists, weak tags and *", () => {
    expect(etagMatches(undefined, ETAG)).toBe(false);
    expect(etagMatches("", ETAG)).toBe(false);
    expect(etagMatches(` ${ETAG} `, ETAG)).toBe(true);
    expect(etagMatches('"a", "b"', ETAG)).toBe(false);
  });

  it("serves a png placeholder as image/png", async () => {
    const key = PERSONAS[13]!.key;
    await repos.personaPortraits.put(hz.db, { key, mime: "image/png", content: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), model: "mock-portrait" });
    const res = await app.request(`/personas/${key}`);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("is readable by an <img> from the web origin (CORS for credentialed callers, no cookie needed)", async () => {
    const res = await app.request(`/personas/${STORED}`, { headers: { origin: "http://localhost:3000" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });

  it("is a 404 that is not cached for a catalog key with no portrait yet", async () => {
    const res = await app.request(`/personas/${MISSING}`);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("is a 404 for a key outside the catalog, without touching the table", async () => {
    for (const key of ["not-a-persona", "..%2F..%2Fetc%2Fpasswd", "%00", "A".repeat(400), encodeURIComponent("x' or '1'='1")]) {
      const res = await app.request(`/personas/${key}`);
      expect(res.status, key).toBe(404);
      expect(res.headers.get("cache-control"), key).toBe("no-store");
    }
  });

  it("does not leak a portrait through a case or whitespace variant of the key", async () => {
    for (const key of [STORED.toUpperCase(), ` ${STORED}`, `${STORED}%20`]) expect((await app.request(`/personas/${key}`)).status, key).toBe(404);
  });
});

describe("GET /personas/:style/:key (0069)", () => {
  const KEY = PERSONAS[14]!.key;
  const ELF = new Uint8Array(Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBPVP8 elf", "latin1"));
  const ELF_ETAG = `"${createHash("sha256").update(ELF).digest("hex")}"`;

  beforeAll(async () => {
    await repos.personaPortraits.put(hz.db, { key: KEY, style: "fantasy", mime: "image/webp", content: ELF, model: "test-image-model" });
  });

  it("serves the face of the style named with the same headers, and the human form is the short route", async () => {
    const res = await app.request(`/personas/fantasy/${KEY}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-site");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("etag")).toBe(ELF_ETAG);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(ELF);
    expect((await app.request(`/personas/fantasy/${KEY}`, { headers: { "if-none-match": ELF_ETAG } })).status).toBe(304);
    // The same key as a human is a different face (STORED has one, KEY does not), whichever route names humans.
    const human = await app.request(`/personas/humans/${STORED}`);
    expect(human.status).toBe(200);
    expect(human.headers.get("etag")).toBe(ETAG);
    expect((await app.request(`/personas/${STORED}`)).headers.get("etag")).toBe(ETAG);
    expect((await app.request(`/personas/humans/${KEY}`)).status).toBe(404);
    expect((await app.request(`/personas/${KEY}`)).status).toBe(404);
  });

  it("is a 404 that is not cached for a style with no face yet, and for an unknown style without touching the table", async () => {
    const missing = await app.request(`/personas/cartoon_3d/${KEY}`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("no-store");
    const get = vi.spyOn(repos.personaPortraits, "get");
    for (const style of ["anime", "Fantasy", "humans%20", "fantasy%2F", "x".repeat(200)]) {
      const res = await app.request(`/personas/${style}/${KEY}`);
      expect(res.status, style).toBe(404);
      expect(res.headers.get("cache-control"), style).toBe("no-store");
    }
    expect(get).not.toHaveBeenCalled();
    // An unknown key in a known style is a 404 without a read too.
    expect((await app.request("/personas/fantasy/not-a-persona")).status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });

  it("caches per character: the human and fantasy faces of one key are two entries", async () => {
    resetPortraitState();
    await repos.personaPortraits.put(hz.db, { key: KEY, style: "humans", mime: "image/png", content: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), model: "mock-portrait" });
    const get = vi.spyOn(repos.personaPortraits, "get");
    expect((await app.request(`/personas/fantasy/${KEY}`)).headers.get("content-type")).toBe("image/webp");
    expect((await app.request(`/personas/humans/${KEY}`)).headers.get("content-type")).toBe("image/png");
    expect((await app.request(`/personas/${KEY}`)).headers.get("content-type")).toBe("image/png");
    expect((await app.request(`/personas/fantasy/${KEY}`)).headers.get("content-type")).toBe("image/webp");
    expect(get).toHaveBeenCalledTimes(2);
    expect(cachedPortraitCount()).toBe(2);
    invalidateStoredPortrait(KEY, "fantasy");
    await app.request(`/personas/fantasy/${KEY}`);
    expect(get).toHaveBeenCalledTimes(3);
  });
});
