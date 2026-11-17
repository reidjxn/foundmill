// @vitest-environment node
/**
 * The web's side of attribution (lib/via.ts, app/onboarding/actions.ts): which `via` is remembered (the first, and only
 * a reference), the cookie it is kept in, what the onboarding hands to the api, and clearing the cookie afterwards.
 */
import { VIA_COOKIE, VIA_MAX_AGE_SECONDS } from "@foundmill/shared/via";
import { beforeEach, describe, expect, it, vi } from "vitest";

let devLike = true;
let jar: Record<string, string> = {};
const set = vi.fn();
vi.mock("@/lib/env", () => ({ isDevLike: () => devLike }));
vi.mock("next/headers", () => ({ cookies: async () => ({ has: (name: string) => name in jar, get: (name: string) => (name in jar ? { name, value: jar[name] } : undefined), set }) }));

const { viaCookie, viaToHandOver, viaToRemember } = await import("../via");
const { forgetVia } = await import("../../app/onboarding/actions");

beforeEach(() => {
  devLike = true;
  jar = {};
  set.mockReset();
});

describe("viaToRemember", () => {
  it("remembers a reference when the visitor carries none", () => {
    expect(viaToRemember({ param: "p.maple-bakes", existing: undefined })).toBe("p.maple-bakes");
    expect(viaToRemember({ param: "u.maya", existing: "" })).toBe("u.maya");
  });

  it("first touch wins: never replaces what the visitor already carries, whatever it is", () => {
    expect(viaToRemember({ param: "p.maple-bakes", existing: "u.maya" })).toBeNull();
    expect(viaToRemember({ param: "p.maple-bakes", existing: "p.maple-bakes" })).toBeNull();
    expect(viaToRemember({ param: "p.maple-bakes", existing: "not a reference" })).toBeNull();
  });

  it("drops anything that is not a reference", () => {
    for (const param of [null, undefined, "", "maple-bakes", "x.maple-bakes", "p.", "P.maple-bakes", "p.Maple", "p.maple bakes", `u.${"a".repeat(41)}`, "<script>"]) expect(viaToRemember({ param, existing: undefined }), String(param)).toBeNull();
  });
});

describe("viaCookie", () => {
  it("is httpOnly, lax, for the whole site, for 30 days, and secure when asked", () => {
    expect(viaCookie("p.maple-bakes", true)).toEqual({ name: VIA_COOKIE, value: "p.maple-bakes", httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: VIA_MAX_AGE_SECONDS });
    expect(viaCookie("p.maple-bakes", false).secure).toBe(false);
  });
});

describe("viaToHandOver", () => {
  it("hands over the cookie's reference, and nothing for a value that is not one", () => {
    expect(viaToHandOver("p.maple-bakes")).toBe("p.maple-bakes");
    expect(viaToHandOver("u.maya")).toBe("u.maya");
    for (const value of [undefined, null, "", "maple-bakes", "p.Maple", `p.${"a".repeat(60)}`]) expect(viaToHandOver(value), String(value)).toBeNull();
  });
});

describe("forgetVia", () => {
  it("expires the cookie with the attributes it was set with", async () => {
    jar = { [VIA_COOKIE]: "p.maple-bakes" };
    await forgetVia();
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ name: VIA_COOKIE, value: "", httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: 0 });
    devLike = false;
    await forgetVia();
    expect(set).toHaveBeenLastCalledWith(expect.objectContaining({ name: VIA_COOKIE, value: "", secure: true, maxAge: 0 }));
  });

  it("sets nothing when there is no cookie", async () => {
    await forgetVia();
    expect(set).not.toHaveBeenCalled();
  });
});
