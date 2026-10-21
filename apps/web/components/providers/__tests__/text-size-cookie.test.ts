/**
 * The text-size cookie (components/providers/text-size-cookie.ts): names its owner, ignores anyone else's, and
 * round-trips through the document.cookie string the host writes.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeTextSizeCookie, encodeTextSizeCookie, headTextSize, readTextSizeCookie, TEXT_SIZE_COOKIE, TEXT_SIZE_HEAD_SCRIPT, textSizeCookieString } from "../text-size-cookie";

const USER = "0f7c2d1e-4b1a-4c8e-9a3b-2d5f6e7a8b9c";

describe("text-size cookie", () => {
  it("encodes the choice with its owner and decodes it back for that owner only", () => {
    expect(encodeTextSizeCookie("comfortable", USER)).toBe(`comfortable.${USER}`);
    expect(decodeTextSizeCookie(`comfortable.${USER}`, USER)).toBe("comfortable");
    expect(decodeTextSizeCookie(`standard.${USER.toUpperCase()}`, USER)).toBe("standard");
    expect(decodeTextSizeCookie("comfortable.dev", "dev")).toBe("comfortable");
    // Someone else's, malformed, missing, or no owner at all: nothing.
    expect(decodeTextSizeCookie(`comfortable.${USER}`, "dev")).toBeNull();
    expect(decodeTextSizeCookie("comfortable.1f7c2d1e-4b1a-4c8e-9a3b-2d5f6e7a8b9c", USER)).toBeNull();
    expect(decodeTextSizeCookie("huge.dev", "dev")).toBeNull();
    expect(decodeTextSizeCookie("comfortable", "dev")).toBeNull();
    expect(decodeTextSizeCookie(undefined, "dev")).toBeNull();
    expect(decodeTextSizeCookie("comfortable.dev", null)).toBeNull();
    expect(decodeTextSizeCookie("comfortable.nobody", "nobody")).toBeNull();
  });

  it("writes a year-long, lax, path-wide cookie that the reader finds among others", () => {
    const s = textSizeCookieString("comfortable", "dev", true);
    expect(s).toMatch(new RegExp(`^${TEXT_SIZE_COOKIE}=comfortable\\.dev; path=/; max-age=\\d+; samesite=lax; secure$`));
    expect(textSizeCookieString("standard", "dev", false)).not.toContain("secure");
    expect(readTextSizeCookie(`fm_date_format=us.12h.dev; ${TEXT_SIZE_COOKIE}=comfortable.dev; other=1`)).toBe("comfortable.dev");
    expect(readTextSizeCookie("fm_date_format=us.12h.dev")).toBeNull();
    expect(readTextSizeCookie("")).toBeNull();
  });
});

/** Runs the head script against a fake document holding `cookie`; returns the attribute it left on <html>. */
function runHeadScript(cookie: string): string | null {
  const attrs = new Map<string, string>();
  const documentElement = { setAttribute: (name: string, value: string) => attrs.set(name, value) };
  new Function("document", TEXT_SIZE_HEAD_SCRIPT)({ cookie, documentElement });
  return attrs.get("data-text") ?? null;
}

describe("the head script (review F35, perf audit item 1)", () => {
  it("stamps comfortable text before the first paint when the cookie says so, and nothing otherwise", () => {
    for (const cookie of [`${TEXT_SIZE_COOKIE}=comfortable.dev`, `fm_date_format=us.12h.dev; ${TEXT_SIZE_COOKIE}=comfortable.0f7c2d1e-4b1a-4c8e-9a3b-2d5f6e7a8b9c`]) {
      expect(runHeadScript(cookie), cookie).toBe("comfortable");
      expect(headTextSize(cookie), cookie).toBe("comfortable");
    }
    for (const cookie of ["", `${TEXT_SIZE_COOKIE}=standard.dev`, `x${TEXT_SIZE_COOKIE}=comfortable.dev`, `${TEXT_SIZE_COOKIE}=comfortable`, "other=fm_text_size=comfortable.dev"]) {
      expect(runHeadScript(cookie), cookie).toBeNull();
      expect(headTextSize(cookie), cookie).toBeNull();
    }
  });

  it("never throws, whatever the document", () => {
    expect(() => new Function("document", TEXT_SIZE_HEAD_SCRIPT)(undefined)).not.toThrow();
  });

  it("the root layout reads no cookie and no session on the server, so the static pages stay static", () => {
    const layout = readFileSync(resolve(__dirname, "../../../app/layout.tsx"), "utf8");
    expect(layout).not.toMatch(/\bcookies\(|getServerAuth|headers\(/);
    expect(layout).not.toMatch(/export default async function/);
    expect(layout).toContain("TEXT_SIZE_HEAD_SCRIPT");
    expect(layout).toContain("suppressHydrationWarning");
  });

  it("sign-out clears the cookie, so the next person on this browser starts in standard text", () => {
    const route = readFileSync(resolve(__dirname, "../../../app/auth/signout/route.ts"), "utf8");
    expect(route).toMatch(/name: TEXT_SIZE_COOKIE, value: "", path: "\/", maxAge: 0/);
  });
});
