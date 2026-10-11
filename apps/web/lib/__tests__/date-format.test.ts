import type * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DATE_FORMAT_COOKIE, dateFormatCookieString, dateFormatOwner, decodeDateFormatCookie, encodeDateFormatCookie, readDateFormatCookie } from "../date-format";

const ADA = "6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60";
const BO = "0b2c3d4e-5f60-4a71-8b2c-3d4e5f606f1d";

describe("the date-format cookie", () => {
  it("names its owner and round-trips the choice", () => {
    const v = encodeDateFormatCookie({ date: "day_first", time: "24h" }, ADA);
    expect(v).toBe(`day_first.24h.${ADA}`);
    expect(decodeDateFormatCookie(v, ADA)).toEqual({ date: "day_first", time: "24h" });
    expect(decodeDateFormatCookie("iso.12h.dev", "dev")).toEqual({ date: "iso", time: "12h" });
  });

  it("ignores a cookie that belongs to someone else, is malformed, or has no owner to check against", () => {
    const ada = encodeDateFormatCookie({ date: "iso", time: "24h" }, ADA);
    expect(decodeDateFormatCookie(ada, BO)).toBeNull();
    expect(decodeDateFormatCookie(ada, null)).toBeNull();
    expect(decodeDateFormatCookie("dmy.24h." + ADA, ADA)).toBeNull();
    expect(decodeDateFormatCookie("iso.24." + ADA, ADA)).toBeNull();
    expect(decodeDateFormatCookie("", ADA)).toBeNull();
    expect(decodeDateFormatCookie(undefined, ADA)).toBeNull();
    expect(decodeDateFormatCookie("iso.24h.dev", "not-an-owner")).toBeNull();
  });

  it("knows whose it is from the server's auth facts", () => {
    expect(dateFormatOwner({ userId: ADA, via: "supabase" })).toBe(ADA);
    expect(dateFormatOwner({ userId: null, via: "dev" })).toBe("dev");
    expect(dateFormatOwner({ userId: null, via: "supabase" })).toBeNull();
    expect(dateFormatOwner(null)).toBeNull();
  });

  it("is written for a year on the whole site, secure on https, and read back from document.cookie", () => {
    expect(dateFormatCookieString({ date: "iso", time: "24h" }, "dev", false)).toBe(`${DATE_FORMAT_COOKIE}=iso.24h.dev; path=/; max-age=31536000; samesite=lax`);
    expect(dateFormatCookieString({ date: "iso", time: "24h" }, "dev", true)).toMatch(/; secure$/);
    expect(readDateFormatCookie(`a=1; ${DATE_FORMAT_COOKIE}=us.12h.dev; b=2`)).toBe("us.12h.dev");
    expect(readDateFormatCookie("a=1")).toBeNull();
  });
});

// --- the server's reader -----------------------------------------------------------------------------------------

const cookieJar = new Map<string, string>();
let auth: { token: string; userId: string | null; email: string | null; via: "supabase" | "dev" } | null = null;
const preferencesGet = vi.fn(async () => ({ date: "iso", time: "24h" }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined) }) }));
vi.mock("../trpc-server", () => ({ serverApi: async () => (auth ? { auth, api: { founder: { preferences: { get: { query: preferencesGet } } } } } : null) }));
// React cache() would keep the first answer for the whole test file; each test is its own request here.
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof React>()), cache: <T,>(fn: T) => fn }));

describe("getServerDateFormat", () => {
  afterEach(() => {
    cookieJar.clear();
    preferencesGet.mockClear();
    auth = null;
  });

  it("reads the defaults for a signed-out request, without asking the API", async () => {
    const { getServerDateFormat } = await import("../date-format.server");
    expect(await getServerDateFormat()).toEqual({ prefs: { date: "us", time: "12h" }, owner: "", source: "default" });
    expect(preferencesGet).not.toHaveBeenCalled();
  });

  it("uses the person's own cookie without an API call", async () => {
    auth = { token: "t", userId: ADA, email: null, via: "supabase" };
    cookieJar.set(DATE_FORMAT_COOKIE, `day_first.24h.${ADA}`);
    const { getServerDateFormat } = await import("../date-format.server");
    expect(await getServerDateFormat()).toEqual({ prefs: { date: "day_first", time: "24h" }, owner: ADA, source: "cookie" });
    expect(preferencesGet).not.toHaveBeenCalled();
  });

  it("asks the API when the cookie is missing or someone else's, and falls back to the defaults when it cannot", async () => {
    auth = { token: "t", userId: BO, email: null, via: "supabase" };
    cookieJar.set(DATE_FORMAT_COOKIE, `day_first.24h.${ADA}`);
    const { getServerDateFormat } = await import("../date-format.server");
    expect(await getServerDateFormat()).toEqual({ prefs: { date: "iso", time: "24h" }, owner: BO, source: "api" });
    preferencesGet.mockRejectedValueOnce(new Error("api down"));
    expect(await getServerDateFormat()).toEqual({ prefs: { date: "us", time: "12h" }, owner: BO, source: "default" });
  });
});
