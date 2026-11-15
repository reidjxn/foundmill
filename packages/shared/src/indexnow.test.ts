import { describe, expect, it } from "vitest";
import { hostedKeyFileUrl, hostedPageCovers, hostedPagesHost, isIndexNowKey, keyFromKeyFileName } from "./indexnow";

const APP = "https://foundmill.test.app";
const KEY = "a1b2c3d4e5f6";

describe("isIndexNowKey", () => {
  it("accepts 8 to 128 letters, digits and dashes", () => {
    for (const ok of ["abcdefgh", "ABCdef-123", "a".repeat(128), KEY]) expect(isIndexNowKey(ok), ok).toBe(true);
  });
  it("refuses anything else", () => {
    for (const bad of ["", "short", "a".repeat(7), "a".repeat(129), "has space1", "under_score1", "dot.dot.dot", "../etc/passwd", "abcdefgh\n", "ünïcödé123"]) expect(isIndexNowKey(bad), bad).toBe(false);
    for (const bad of [undefined, null, 12345678, {}, []]) expect(isIndexNowKey(bad)).toBe(false);
  });
});

describe("hostedPagesHost", () => {
  it("returns the lowercase host, with its port", () => {
    expect(hostedPagesHost("https://Foundmill.Test.App")).toBe("foundmill.test.app");
    expect(hostedPagesHost("http://localhost:3000/anything")).toBe("localhost:3000");
  });
  it("is null when APP_URL is not a URL", () => {
    expect(hostedPagesHost("")).toBeNull();
    expect(hostedPagesHost("not a url")).toBeNull();
  });
});

describe("hostedKeyFileUrl", () => {
  it("is <APP_URL>/p/<slug>/<key>.txt", () => {
    expect(hostedKeyFileUrl(APP, "northwind", KEY)).toBe(`${APP}/p/northwind/${KEY}.txt`);
    expect(hostedKeyFileUrl(`${APP}/`, "northwind", KEY)).toBe(`${APP}/p/northwind/${KEY}.txt`);
  });
});

describe("keyFromKeyFileName", () => {
  it("returns the key of a <key>.txt name", () => {
    expect(keyFromKeyFileName(`${KEY}.txt`)).toBe(KEY);
    expect(keyFromKeyFileName("abcdefgh.txt")).toBe("abcdefgh");
  });
  it("refuses sub-pages, short names, path-like names and other extensions", () => {
    for (const bad of ["story", "roles", "x.txt", "abcdefg.txt", ".txt", "", `${KEY}`, `${KEY}.html`, `${KEY}.TXT`, `${KEY}.txt.txt`, `../${KEY}.txt`, `a/${KEY}.txt`, `${KEY}%2e.txt`, `${KEY}.txt\n`, `${KEY}.txt/`]) {
      expect(keyFromKeyFileName(bad), bad).toBeNull();
    }
  });
});

describe("hostedPageCovers", () => {
  const covers = (url: string) => hostedPageCovers(APP, "northwind", url);
  it("covers the page itself and anything under it", () => {
    expect(covers(`${APP}/p/northwind`)).toBe(true);
    expect(covers(`${APP}/p/northwind/`)).toBe(true);
    expect(covers(`${APP}/p/northwind/story`)).toBe(true);
    expect(covers(`${APP}/p/northwind/a/b?x=1#y`)).toBe(true);
  });
  it("does not cover a look-alike slug, another slug or the host's other paths", () => {
    expect(covers(`${APP}/p/northwind-two`)).toBe(false);
    expect(covers(`${APP}/p/northwind-two/story`)).toBe(false);
    expect(covers(`${APP}/p/northwindx`)).toBe(false);
    expect(covers(`${APP}/p/other`)).toBe(false);
    expect(covers(`${APP}/p`)).toBe(false);
    expect(covers(`${APP}/`)).toBe(false);
  });
  it("does not cover another origin, scheme or port", () => {
    expect(covers("https://evil.example/p/northwind")).toBe(false);
    expect(covers("http://foundmill.test.app/p/northwind")).toBe(false);
    expect(covers("https://foundmill.test.app:8443/p/northwind")).toBe(false);
    expect(covers("https://foundmill.test.app.evil.example/p/northwind")).toBe(false);
  });
  it("does not cover an address with credentials in it", () => {
    expect(covers("https://user@foundmill.test.app/p/northwind")).toBe(false);
    expect(covers("https://user:pass@foundmill.test.app/p/northwind/story")).toBe(false);
  });
  it("does not let .. climb out of the page", () => {
    expect(covers(`${APP}/p/northwind/../other`)).toBe(false);
    expect(covers(`${APP}/p/northwind/%2e%2e/other`)).toBe(false);
    // An encoded slash stays inside one path segment, so it still sits under the page.
    expect(covers(`${APP}/p/northwind/..%2fother`)).toBe(true);
  });
  it("is false for something that is not a URL", () => {
    expect(covers("northwind")).toBe(false);
    expect(covers("")).toBe(false);
    expect(hostedPageCovers("nope", "northwind", `${APP}/p/northwind`)).toBe(false);
  });
});
