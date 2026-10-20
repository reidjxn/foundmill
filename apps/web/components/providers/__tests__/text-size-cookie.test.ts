/**
 * The text-size cookie (components/providers/text-size-cookie.ts): names its owner, ignores anyone else's, and
 * round-trips through the document.cookie string the host writes.
 */
import { describe, expect, it } from "vitest";
import { decodeTextSizeCookie, encodeTextSizeCookie, readTextSizeCookie, TEXT_SIZE_COOKIE, textSizeCookieString } from "../text-size-cookie";

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
