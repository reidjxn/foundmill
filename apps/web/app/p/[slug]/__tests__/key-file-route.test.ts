/** `/p/<slug>/<key>.txt`: the IndexNow key file of a public page. Only the confirmed key is served; everything else is a quiet 404. */
import { beforeEach, describe, expect, it, vi } from "vitest";

// The spy records the calls; the answer comes from a plain function, so a rejection is handled only by the route
// (a rejecting vi.fn leaves a derived promise that vitest reports as an unhandled error).
const publicIndexNowKeyFile = vi.fn<(slug: string, key: string) => void>();
let answer: () => Promise<string | null> = async () => null;
let page: () => Promise<unknown> = async () => null;
vi.mock("@/lib/public-page.server", () => ({
  publicIndexNowKeyFile: (slug: string, key: string) => {
    publicIndexNowKeyFile(slug, key);
    return answer();
  },
  publicProjectPage: () => page(),
  publicProjectStory: async () => ({ milestones: [{ label: "Page live", achievedAt: "2026-10-07T09:00:00Z" }] }),
}));

import { GET } from "../[keyFile]/route";

const KEY = "a1b2c3d4e5f6";
const ask = (keyFile: string, slug = "northwind") => GET(new Request(`http://localhost:3000/p/${slug}/${keyFile}`), { params: Promise.resolve({ slug, keyFile }) });

beforeEach(() => {
  publicIndexNowKeyFile.mockReset();
  answer = async () => null;
  page = async () => null;
});

const PAGE = { slug: "northwind", url: "https://foundmill.com/p/northwind", name: "Northwind", pitch: "Skincare for reactive skin", about: "Made in small batches.", forWhom: "", stage: "idea", publishedAt: "2026-10-07T09:00:00Z", updatedAt: "2026-10-07T09:00:00Z", founderNames: [], story: true };

describe("GET /p/[slug]/index.md and /p/[slug]/llms.txt (WP-08 T7)", () => {
  it("serves the public page as Markdown, never indexed, with the page as canonical; the IndexNow key is not asked", async () => {
    page = async () => PAGE;
    for (const name of ["index.md", "llms.txt"]) {
      const res = await ask(name);
      expect(res.status, name).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
      expect(res.headers.get("x-robots-tag")).toBe("noindex");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("link")).toBe('<https://foundmill.com/p/northwind>; rel="canonical"');
      const text = await res.text();
      expect(text.startsWith("# Northwind\n")).toBe(true);
      expect(text).toContain("- Oct 7, 2026: Page live");
    }
    expect(publicIndexNowKeyFile).not.toHaveBeenCalled();
  });

  it("is the same 404 for a page that is not public, and a 503 when the api cannot be asked", async () => {
    expect((await ask("index.md")).status).toBe(404);
    page = () => Promise.reject(new Error("api down"));
    expect((await ask("llms.txt")).status).toBe(503);
  });
});

describe("GET /p/[slug]/[keyFile]", () => {
  it("serves exactly the key as plain text, uncached", async () => {
    answer = async () => KEY;
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
    answer = async () => null;
    const res = await ask(`${KEY}.txt`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(await res.text()).not.toContain(KEY);
    expect(publicIndexNowKeyFile).toHaveBeenCalledOnce();
  });

  it("is a 503 with a retry hint, and no key, when the api cannot be asked", async () => {
    answer = () => Promise.reject(new Error("api down"));
    const res = await ask(`${KEY}.txt`);
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.text();
    expect(body).not.toContain(KEY);
    expect(body).not.toContain("api down");
  });
});
