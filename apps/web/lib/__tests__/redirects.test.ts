import { describe, expect, it } from "vitest";
import { lastBusinessHome, parseLastBusinessId, staleBusinessPath } from "../auth/last-business";
import { decideRedirect, isFounderPath, isPublicPath, safeNextPath, signedInDestination } from "../auth/redirects";

const LAST = "b1e5e5e5-0000-4000-8000-000000000001";

describe("proxy redirect rules", () => {
  it("sends signed-out visitors to /login with the original path as next", () => {
    expect(decideRedirect({ pathname: "/b/abc/home", search: "?tab=x", authenticated: false })).toEqual({ kind: "redirect", to: "/login?next=%2Fb%2Fabc%2Fhome%3Ftab%3Dx" });
    expect(decideRedirect({ pathname: "/", authenticated: false })).toEqual({ kind: "next" }); // the landing page
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

  it("sends a signed-in `/` straight to the last business's Home when the cookie names one (audit topology F4, WEB-4)", () => {
    expect(decideRedirect({ pathname: "/", authenticated: true, lastBusinessId: LAST })).toEqual({ kind: "redirect", to: `/b/${LAST}/home` });
    // The landing page's deep link means nothing to a signed-in founder (the index redirected them before too).
    expect(decideRedirect({ pathname: "/", search: "?example=northwind", authenticated: true, lastBusinessId: LAST })).toEqual({ kind: "redirect", to: `/b/${LAST}/home` });
    // Without a usable cookie the index page picks (profile gate, newest business, New business).
    for (const cookie of [undefined, null, "", "not-a-uuid", `${LAST}x`, "../../evil"]) {
      expect(decideRedirect({ pathname: "/", authenticated: true, lastBusinessId: cookie }), String(cookie)).toEqual({ kind: "next" });
    }
    // Signed out, the cookie changes nothing: the landing page.
    expect(decideRedirect({ pathname: "/", authenticated: false, lastBusinessId: LAST })).toEqual({ kind: "next" });
    // Only `/`: every other signed-in path renders as asked.
    expect(decideRedirect({ pathname: "/new", authenticated: true, lastBusinessId: LAST })).toEqual({ kind: "next" });
  });

  it("bounces a signed-in visitor off /login to the last business when next names nothing else", () => {
    expect(decideRedirect({ pathname: "/login", authenticated: true, lastBusinessId: LAST })).toEqual({ kind: "redirect", to: `/b/${LAST}/home` });
    expect(decideRedirect({ pathname: "/login", search: "?next=https%3A%2F%2Fevil.example", authenticated: true, lastBusinessId: LAST })).toEqual({ kind: "redirect", to: `/b/${LAST}/home` });
    expect(decideRedirect({ pathname: "/login", search: "?next=%2Fb%2Fabc%2Finbox", authenticated: true, lastBusinessId: LAST })).toEqual({ kind: "redirect", to: "/b/abc/inbox" });
    expect(signedInDestination("/", LAST)).toBe(`/b/${LAST}/home`);
    expect(signedInDestination("/", "nope")).toBe("/");
    expect(signedInDestination("/new", LAST)).toBe("/new");
  });

  it("a stale cookie (the layout found its business gone) is forgotten and `/` picks again, so it cannot loop", () => {
    const stale = staleBusinessPath(LAST);
    expect(stale).toBe(`/?stale=${LAST}`);
    const [pathname, search] = [stale.slice(0, 1), stale.slice(1)];
    // The cookie still names that business: clear it, render the index (no redirect back to the same business).
    expect(decideRedirect({ pathname, search, authenticated: true, lastBusinessId: LAST })).toEqual({ kind: "next", forgetLastBusiness: true });
    // Another tab already moved the cookie on: keep the newer one, still no fast path on this request.
    const other = "b1e5e5e5-0000-4000-8000-000000000002";
    expect(decideRedirect({ pathname, search, authenticated: true, lastBusinessId: other })).toEqual({ kind: "next", forgetLastBusiness: false });
    expect(decideRedirect({ pathname, search, authenticated: true, lastBusinessId: null })).toEqual({ kind: "next", forgetLastBusiness: false });
    // Signed out it is just the landing page.
    expect(decideRedirect({ pathname, search, authenticated: false, lastBusinessId: LAST })).toEqual({ kind: "next" });
  });

  it("reads the cookie strictly as a business id", () => {
    expect(parseLastBusinessId(LAST)).toBe(LAST);
    expect(parseLastBusinessId(LAST.toUpperCase())).toBe(LAST.toUpperCase());
    for (const bad of [null, undefined, "", "------------------------------------", `${LAST}/../x`]) expect(parseLastBusinessId(bad), String(bad)).toBeNull();
    expect(lastBusinessHome(LAST)).toBe(`/b/${LAST}/home`);
    expect(lastBusinessHome("x")).toBeNull();
  });

  it("passes authenticated app routes", () => {
    expect(decideRedirect({ pathname: "/b/abc/settings/keys", authenticated: true }).kind).toBe("next");
    expect(decideRedirect({ pathname: "/onboarding", authenticated: true }).kind).toBe("next");
  });

  it("keeps the LIVE pages signed-in only: never public, sent to /login with next when signed out", () => {
    for (const p of ["/network", "/communities", "/communities/3f1c0e9e-1111-4222-8333-944445555666", "/leaderboards", "/leaderboards/aae7068c-fd0f-4615-9534-8da4cd7e35e0", "/profiles/founder/3f1c0e9e-1111-4222-8333-944445555666", "/profiles/business/3f1c0e9e-1111-4222-8333-944445555666"]) {
      expect(isPublicPath(p), p).toBe(false);
      expect(isFounderPath(p), p).toBe(true);
      expect(decideRedirect({ pathname: p, authenticated: false }), p).toEqual({ kind: "redirect", to: `/login?next=${encodeURIComponent(p)}` });
      expect(decideRedirect({ pathname: p, authenticated: true }), p).toEqual({ kind: "next" });
    }
    expect(isFounderPath("/networking")).toBe(false);
  });

  it("clamps next to in-app paths", () => {
    expect(safeNextPath("/b/1/home")).toBe("/b/1/home");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/login?next=/x")).toBe("/");
    expect(safeNextPath(null, "/new")).toBe("/new");
  });

  it("refuses paths that a URL parser resolves off-site (backslashes, tabs, newlines)", () => {
    // `new URL("/\\evil.example", base)` is https://evil.example/: browsers and Node read "\" as "/" and drop tabs and
    // newlines, so these passed the old checks and /auth/callback or the proxy redirected a founder off-site.
    for (const raw of ["/\\evil.example", "/\\/evil.example", "/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "\\\\evil.example", "/%5Cevil.example".replace("%5C", "\\")]) {
      expect(safeNextPath(raw), JSON.stringify(raw)).toBe("/");
      expect(new URL(safeNextPath(raw), "https://foundmill.com/auth/callback").origin, JSON.stringify(raw)).toBe("https://foundmill.com");
    }
    expect(decideRedirect({ pathname: "/login", search: "?next=%2F%5Cevil.example", authenticated: true })).toEqual({ kind: "redirect", to: "/" });
    expect(decideRedirect({ pathname: "/login", search: "?next=%2F%09%2Fevil.example", authenticated: true })).toEqual({ kind: "redirect", to: "/" });
    // In-app paths with a query keep working, spaces included (searchParams.get decodes %20; the answer re-encodes it).
    expect(safeNextPath("/b/abc/inbox?q=a b")).toBe("/b/abc/inbox?q=a%20b");
    expect(safeNextPath("/b/abc/team/agents")).toBe("/b/abc/team/agents");
    expect(safeNextPath("/b/abc/crm/x#notes")).toBe("/b/abc/crm/x#notes");
  });

  it("refuses paths whose dot segments collapse into a protocol-relative path (audit PAS-1)", () => {
    // `new URL("/.//evil.com", base).pathname` is "//evil.com": returning the raw string let the proxy answer
    // Location https://foundmill.com//evil.com, which Next relativizes to "//evil.com" and the browser follows off-site.
    for (const raw of ["/.//evil.com", "/..//evil.com", "/.//evil.com/phish", "/%2e%2e//evil.com", "/%2E//evil.com", "/a/..//evil.com/phish?a=1", "/././/evil.com"]) {
      expect(safeNextPath(raw), raw).toBe("/");
      expect(new URL(safeNextPath(raw), "https://foundmill.com/login").origin, raw).toBe("https://foundmill.com");
    }
    for (const search of ["?next=/.//evil.com/phish", "?next=%2F..%2F%2Fevil.com%2Fphish%3Fa%3D1", "?next=/%2e%2e//evil.com"]) {
      expect(decideRedirect({ pathname: "/login", search, authenticated: true }), search).toEqual({ kind: "redirect", to: "/" });
    }
    // Harmless dot segments still land on the page they name, normalized.
    expect(safeNextPath("/b/abc/./inbox")).toBe("/b/abc/inbox");
    expect(safeNextPath("/b/abc/x/../inbox?tab=1")).toBe("/b/abc/inbox?tab=1");
    // Encoded slashes are path characters, not a host: they stay on the site.
    expect(safeNextPath("/%2f%2fevil.com")).toBe("/%2f%2fevil.com");
    // A dot segment cannot smuggle the sign-in page back in either.
    expect(safeNextPath("/b/../login?next=/x")).toBe("/");
    expect(safeNextPath("/loginx")).toBe("/loginx");
  });

  it("classifies paths", () => {
    expect(isPublicPath("/auth")).toBe(true);
    expect(isPublicPath("/b/x")).toBe(false);
    expect(isFounderPath("/new/ideate")).toBe(true);
    expect(isFounderPath("/login")).toBe(false);
  });
});
