import { describe, expect, it } from "vitest";
import { decideRedirect, isFounderPath, isPublicPath, safeNextPath } from "../auth/redirects";

describe("proxy redirect rules", () => {
  it("sends signed-out visitors to /login with the original path as next", () => {
    expect(decideRedirect({ pathname: "/b/abc/home", search: "?tab=x", authenticated: false })).toEqual({ kind: "redirect", to: "/login?next=%2Fb%2Fabc%2Fhome%3Ftab%3Dx" });
    expect(decideRedirect({ pathname: "/", authenticated: false })).toEqual({ kind: "redirect", to: "/login" });
  });

  it("lets public paths through either way", () => {
    for (const p of ["/login", "/auth/callback", "/auth/dev", "/_next/static/x.js", "/brand/foundmill-wordmark-light.svg", "/icon.svg"]) {
      expect(decideRedirect({ pathname: p, authenticated: false }).kind).toBe("next");
    }
    expect(decideRedirect({ pathname: "/auth/callback", authenticated: true }).kind).toBe("next");
  });

  it("bounces a signed-in visitor off /login to next (clamped)", () => {
    expect(decideRedirect({ pathname: "/login", search: "?next=%2Fb%2Fabc%2Finbox", authenticated: true })).toEqual({ kind: "redirect", to: "/b/abc/inbox" });
    expect(decideRedirect({ pathname: "/login", search: "?next=https%3A%2F%2Fevil.example", authenticated: true })).toEqual({ kind: "redirect", to: "/" });
    expect(decideRedirect({ pathname: "/login", authenticated: true })).toEqual({ kind: "redirect", to: "/" });
  });

  it("passes authenticated app routes", () => {
    expect(decideRedirect({ pathname: "/b/abc/settings/keys", authenticated: true }).kind).toBe("next");
    expect(decideRedirect({ pathname: "/onboarding", authenticated: true }).kind).toBe("next");
  });

  it("clamps next to in-app paths", () => {
    expect(safeNextPath("/b/1/home")).toBe("/b/1/home");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/login?next=/x")).toBe("/");
    expect(safeNextPath(null, "/new")).toBe("/new");
  });

  it("classifies paths", () => {
    expect(isPublicPath("/auth")).toBe(true);
    expect(isPublicPath("/b/x")).toBe(false);
    expect(isFounderPath("/new/ideate")).toBe(true);
    expect(isFounderPath("/login")).toBe(false);
  });
});
