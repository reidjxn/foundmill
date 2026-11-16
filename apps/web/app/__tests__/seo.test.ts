import { APP_ORIGIN } from "@foundmill/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_TRAINING_CRAWLERS, STATIC_SITEMAP_PATHS, indexable, listedPublicPaths, llmsTxt, sitemapEntries } from "@/lib/seo";
import robots from "../robots";
import sitemap from "../sitemap";
import { GET as llms } from "../llms.txt/route";

/** WP-03 T6: what robots.txt, the sitemap and /llms.txt say, open and closed. */
const OPEN = { NEXT_PUBLIC_APP_URL: APP_ORIGIN, SIGNUP_OPEN: "true" };

afterEach(() => vi.unstubAllEnvs());
function stub(env: Record<string, string>) {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
}

describe("indexable", () => {
  it("needs the production origin and open sign-up", () => {
    expect(indexable(OPEN)).toBe(true);
    expect(indexable({ ...OPEN, SIGNUP_OPEN: "" })).toBe(false);
    expect(indexable({ ...OPEN, NEXT_PUBLIC_APP_URL: "https://preview.example.com" })).toBe(false);
    expect(indexable({ SIGNUP_OPEN: "true" })).toBe(true); // no URL set: the apex
  });
});

describe("robots.txt", () => {
  it("is open, names the sitemap and keeps training crawlers off /p/ and /u/ when open", () => {
    stub(OPEN);
    const r = robots();
    expect(r.sitemap).toBe(`${APP_ORIGIN}/sitemap.xml`);
    const rules = r.rules as { userAgent: string | string[]; allow?: string; disallow?: string | string[] }[];
    expect(rules[0]).toMatchObject({ userAgent: "*", allow: "/", disallow: ["/api/", "/b/"] });
    expect(rules[0]!.disallow).not.toContain("/p/");
    expect(rules[1]!.userAgent).toEqual([...AI_TRAINING_CRAWLERS]);
    expect(rules[1]!.disallow).toEqual(["/api/", "/b/", "/p/", "/u/"]);
  });
  it("disallows everything, with no sitemap line, on any other origin or while sign-up is closed", () => {
    for (const env of [{ NEXT_PUBLIC_APP_URL: "https://staging.example.com", SIGNUP_OPEN: "true" }, { NEXT_PUBLIC_APP_URL: APP_ORIGIN, SIGNUP_OPEN: "" }]) {
      vi.unstubAllEnvs();
      stub(env);
      const r = robots();
      expect(r.rules).toEqual({ userAgent: "*", disallow: "/" });
      expect(r.sitemap).toBeUndefined();
    }
  });
});

describe("sitemap.xml", () => {
  it("lists exactly the three static addresses today", async () => {
    expect(await listedPublicPaths()).toEqual([]);
    expect((await sitemap()).map((e) => e.url)).toEqual(STATIC_SITEMAP_PATHS.map((p) => `${APP_ORIGIN}${p}`));
    expect(JSON.stringify(await sitemap())).not.toMatch(/priority|changeFrequency/);
  });
  it("adds listed project pages once a source supplies them, without repeats", () => {
    const at = new Date("2026-11-16T00:00:00Z");
    const entries = sitemapEntries([{ path: "/p/sole-revival", lastModified: at }, { path: "/p/sole-revival", lastModified: at }, { path: "/terms", lastModified: at }]);
    expect(entries.map((e) => e.url)).toEqual([`${APP_ORIGIN}/`, `${APP_ORIGIN}/terms`, `${APP_ORIGIN}/privacy`, `${APP_ORIGIN}/p/sole-revival`]);
    expect(entries[3]!.lastModified).toBe(at);
  });
});

describe("llms.txt", () => {
  it("is plain text and says the example projects are examples, not customers", async () => {
    const res = llms();
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toContain("examples, not customers");
  });
  it("drops the let-in-slowly line once sign-up is open", () => {
    expect(llmsTxt({ signupOpen: false })).toContain("New people are let in a few at a time.");
    expect(llmsTxt({ signupOpen: true })).not.toContain("let in a few at a time");
    expect(llmsTxt({ signupOpen: true })).toContain(`${APP_ORIGIN.replace("https://", "")}/p/<name>`);
  });
});
