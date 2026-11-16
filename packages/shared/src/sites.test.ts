import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";
import { SITE_LIMITS, siteFileType, sitePreviewUrl, siteSlugProblem, sitesDomainProblem, sitesEnabled, siteUrl } from "./sites";

describe("site slugs", () => {
  it("follows the page rule, the reserved words and the preview prefix", () => {
    expect(siteSlugProblem("lunchbox")).toBeNull();
    expect(siteSlugProblem("ab")).not.toBeNull();
    expect(siteSlugProblem("Lunch")).not.toBeNull();
    expect(siteSlugProblem("status")).not.toBeNull();
    expect(siteSlugProblem("admin")).not.toBeNull();
    expect(siteSlugProblem("p-lunch")).not.toBeNull();
    expect(siteSlugProblem("pancakes")).toBeNull();
  });
});

describe("site addresses", () => {
  it("builds https addresses, and http on localhost", () => {
    expect(siteUrl("example-sites.app", "lunchbox")).toBe("https://lunchbox.example-sites.app/");
    expect(sitePreviewUrl("example-sites.app", "a".repeat(32))).toBe(`https://p-${"a".repeat(32)}.example-sites.app/`);
    expect(siteUrl("sites.localhost", "lunchbox")).toBe("http://lunchbox.sites.localhost/");
  });

  it("is off while SITES_DOMAIN is unset", () => {
    expect(sitesEnabled({})).toBe(false);
    expect(sitesEnabled({ SITES_DOMAIN: " " })).toBe(false);
    expect(sitesEnabled({ SITES_DOMAIN: "sites.localhost" })).toBe(true);
  });
});

describe("file types and limits", () => {
  it("serves only the listed types", () => {
    expect(siteFileType("index.html")).toBe("text/html; charset=utf-8");
    expect(siteFileType("img/LOGO.PNG")).toBe("image/png");
    expect(siteFileType("app.js")).toBeNull();
    expect(siteFileType("README")).toBeNull();
    expect(siteFileType("dir.html/file")).toBeNull();
  });

  it("keeps the Estimates", () => {
    expect(SITE_LIMITS).toEqual({ maxFiles: 200, maxTotalBytes: 10 * 1024 * 1024, maxFileBytes: 2 * 1024 * 1024, publishesPerDay: 20 });
  });
});

describe("SITES_DOMAIN beside the product", () => {
  it("refuses the product's host, a subdomain and a parent", () => {
    expect(sitesDomainProblem("foundmill.com", "https://foundmill.com")).not.toBeNull();
    expect(sitesDomainProblem("sites.foundmill.com", "https://foundmill.com")).not.toBeNull();
    expect(sitesDomainProblem("foundmill.com", "https://app.foundmill.com")).not.toBeNull();
    expect(sitesDomainProblem("foundmill.app", "https://foundmill.com")).toBeNull();
  });

  it("is checked when the environment loads outside development and test", () => {
    expect(() => loadEnv({ APP_ENV: "production", APP_URL: "https://foundmill.com", SITES_DOMAIN: "sites.foundmill.com" })).toThrow(/SITES_DOMAIN/);
    expect(loadEnv({ APP_ENV: "production", APP_URL: "https://foundmill.com", SITES_DOMAIN: "Foundmill.App" }).SITES_DOMAIN).toBe("foundmill.app");
    expect(loadEnv({ APP_ENV: "development", SITES_DOMAIN: "sites.localhost" }).SITES_DOMAIN).toBe("sites.localhost");
    expect(() => loadEnv({ SITES_DOMAIN: "not a domain" })).toThrow(/SITES_DOMAIN/);
  });
});
