/** `/p/<slug>/<key>.txt`: the IndexNow key file of a public page. Only the confirmed key is served; everything else is a quiet 404. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const publicIndexNowKeyFile = vi.fn<(slug: string, key: string) => Promise<string | null>>();
vi.mock("@/lib/public-page.server", () => ({ publicIndexNowKeyFile: (slug: string, key: string) => publicIndexNowKeyFile(slug, key) }));

import { GET } from "../[keyFile]/route";

const KEY = "a1b2c3d4e5f6";
const ask = (keyFile: string, slug = "northwind") => GET(new Request(`http://localhost:3000/p/${slug}/${keyFile}`), { params: Promise.resolve({ slug, keyFile }) });

beforeEach(() => publicIndexNowKeyFile.mockReset());

describe("GET /p/[slug]/[keyFile]", () => {
  it("serves exactly the key as plain text, uncached", async () => {
    publicIndexNowKeyFile.mockResolvedValue(KEY);
    const res = await ask(`${KEY}.txt`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(KEY);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(publicIndexNowKeyFile).toHaveBeenCalledExactlyOnceWith("northwind", KEY);
  });

  it("is a 404 without asking the api for a name that is not a key file", async () => {
    for (const name of ["story", "roles", "x.txt", "abcdefg.txt", `${KEY}.html`, `${KEY}`, "../secret.txt", "a%2Fb-12345678.txt", ".txt"]) {
      const res = await ask(name);
      expect(res.status, name).toBe(404);
      expect(res.headers.get("content-type"), name).toBe("text/plain; charset=utf-8");
      expect(res.headers.get("cache-control"), name).toBe("no-store");
    }
    expect(publicIndexNowKeyFile).not.toHaveBeenCalled();
  });

  it("is the same 404 when the api answers null (wrong key, unknown or unpublished page, not connected)", async () => {
    publicIndexNowKeyFile.mockResolvedValue(null);
    const res = await ask(`${KEY}.txt`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(await res.text()).not.toContain(KEY);
    expect(publicIndexNowKeyFile).toHaveBeenCalledOnce();
  });

  it("is a 503 with a retry hint, and no key, when the api cannot be asked", async () => {
    publicIndexNowKeyFile.mockRejectedValue(new Error("fetch failed"));
    const res = await ask(`${KEY}.txt`);
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.text();
    expect(body).not.toContain(KEY);
    expect(body).not.toContain("fetch failed");
  });
});
