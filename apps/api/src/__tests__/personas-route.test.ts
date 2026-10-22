/**
 * `GET /personas/:key` (Anthropomorphic agents): the stored face of a catalog key, public like a static asset (no sign-in),
 * served with the stored mime and a one-day cache; a key outside the catalog, a face not generated yet and a
 * key that only looks like a path are plain 404s that are not cached.
 */
import { repos } from "@foundmill/db";
import { PERSONAS } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
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

describe("GET /personas/:key", () => {
  it("serves the stored bytes with the stored mime, no sign-in, and a one-day cache", async () => {
    const res = await app.request(`/personas/${STORED}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
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
