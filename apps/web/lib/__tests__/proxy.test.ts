// @vitest-environment node
import { VIA_COOKIE, VIA_MAX_AGE_SECONDS, VIA_POST_COOKIE, VIA_POST_MAX_AGE_SECONDS } from "@foundmill/shared/via";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "../../proxy";
import { DEV_AUTH_COOKIE, LAST_BUSINESS_COOKIE } from "../auth/constants";
import { resetPublicEnvCache } from "../env";

/** A signed-in request (the development bypass cookie; vitest runs with NEXT_PUBLIC_APP_ENV=test and no Supabase). */
function signedIn(url: string, extraCookie = ""): NextRequest {
  return new NextRequest(url, { headers: { cookie: `${DEV_AUTH_COOKIE}=1${extraCookie ? `; ${extraCookie}` : ""}` } });
}

const LAST = "b1e5e5e5-0000-4000-8000-000000000001";

describe("proxy redirects", () => {
  it("keeps a signed-in founder on the site whatever next says (audit PAS-1)", async () => {
    for (const next of ["/.//evil.com/phish", "%2F..%2F%2Fevil.com%2Fphish%3Fa%3D1", "/%2e%2e//evil.com", "//evil.com", "https://evil.com"]) {
      const res = await proxy(signedIn(`http://localhost:3000/login?next=${next}`));
      expect(res.status, next).toBe(307);
      const location = new URL(res.headers.get("location") ?? "", "http://localhost:3000");
      expect(location.origin, next).toBe("http://localhost:3000");
      // Next relativizes a same-host Location, so a path starting with "//" would leave the site: the path must not.
      expect(location.pathname, next).toBe("/");
    }
  });

  it("still sends a signed-in founder to the in-app page next names", async () => {
    const res = await proxy(signedIn("http://localhost:3000/login?next=%2Fb%2Fabc%2Finbox%3Ftab%3Dnotes"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/b/abc/inbox?tab=notes");
  });

  it("answers a signed-in `/` with the last business's Today itself, with no render and no API call (audit WEB-4)", async () => {
    const res = await proxy(signedIn("http://localhost:3000/", `${LAST_BUSINESS_COOKIE}=${LAST}`));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`http://localhost:3000/b/${LAST}/today`);
    // Without the cookie the signed-in index renders under `/` and picks.
    const index = await proxy(signedIn("http://localhost:3000/"));
    expect(index.headers.get("location")).toBeNull();
    expect(index.headers.get("x-middleware-rewrite")).toBe("http://localhost:3000/start");
  });

  it("serves a signed-out `/` as the prerendered landing page, and a deep link from its business's page", async () => {
    const landing = await proxy(new NextRequest("http://localhost:3000/"));
    expect(landing.headers.get("x-middleware-next")).toBe("1");
    const deep = await proxy(new NextRequest("http://localhost:3000/?example=glitchwick"));
    expect(deep.headers.get("x-middleware-rewrite")).toBe("http://localhost:3000/examples/glitchwick");
  });

  it("clears a stale last-business cookie and lets the index pick, instead of sending the founder back to it", async () => {
    const res = await proxy(signedIn(`http://localhost:3000/?stale=${LAST}`, `${LAST_BUSINESS_COOKIE}=${LAST}`));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-rewrite")).toBe("http://localhost:3000/start");
    const cleared = res.cookies.get(LAST_BUSINESS_COOKIE);
    expect(cleared?.value).toBe("");
    expect(cleared?.maxAge).toBe(0);
    expect(cleared?.path).toBe("/");
    // The index renders without it too, so it does not pick the stale business again; the session cookie still goes along.
    const forwarded = res.headers.get("x-middleware-request-cookie") ?? "";
    expect(forwarded).toContain(`${DEV_AUTH_COOKIE}=1`);
    expect(forwarded).not.toContain(LAST_BUSINESS_COOKIE);
    // A report about another business than the cookie's leaves the cookie alone.
    const other = await proxy(signedIn(`http://localhost:3000/?stale=00000000-0000-4000-8000-0000000000ff`, `${LAST_BUSINESS_COOKIE}=${LAST}`));
    expect(other.cookies.get(LAST_BUSINESS_COOKIE)).toBeUndefined();
    expect(other.headers.get("x-middleware-request-cookie")).toContain(`${LAST_BUSINESS_COOKIE}=${LAST}`);
  });

  it("sends a signed-out visitor to sign in with the page as next", async () => {
    const res = await proxy(new NextRequest("http://localhost:3000/b/abc/home"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fb%2Fabc%2Fhome");
  });
});

describe("proxy attribution: the first `via` a visitor arrives with", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetPublicEnvCache();
  });

  it("is kept in an httpOnly cookie for 30 days, on a public page, the landing page and a person's profile", async () => {
    for (const [url, value] of [
      ["http://localhost:3000/p/maple-bakes?via=p.maple-bakes", "p.maple-bakes"],
      ["http://localhost:3000/?via=u.maya", "u.maya"],
      ["http://localhost:3000/u/maya?utm_source=x&via=u.maya", "u.maya"],
    ] as const) {
      const res = await proxy(new NextRequest(url));
      expect(res.headers.get("x-middleware-next"), url).toBe("1");
      expect(res.cookies.get(VIA_COOKIE), url).toMatchObject({ name: VIA_COOKIE, value, httpOnly: true, sameSite: "lax", path: "/", maxAge: VIA_MAX_AGE_SECONDS });
    }
    expect(VIA_MAX_AGE_SECONDS).toBe(30 * 24 * 60 * 60);
  });

  it("a shared post's code also sets fm_post (last touch, 7 days) and leaves fm_via to the first touch", async () => {
    const first = await proxy(new NextRequest("http://localhost:3000/p/maple-bakes?via=s.k3m7qa2xpw"));
    expect(first.cookies.get(VIA_COOKIE)?.value).toBe("s.k3m7qa2xpw");
    expect(first.cookies.get(VIA_POST_COOKIE)).toMatchObject({ name: VIA_POST_COOKIE, value: "k3m7qa2xpw", httpOnly: true, sameSite: "lax", path: "/", maxAge: VIA_POST_MAX_AGE_SECONDS });
    expect(VIA_POST_MAX_AGE_SECONDS).toBe(7 * 24 * 60 * 60);
    // A visitor who already carries both: fm_via stays, fm_post takes the newer code.
    const later = new NextRequest("http://localhost:3000/p/maple-bakes?via=s.abcdefgh22", { headers: { cookie: `${VIA_COOKIE}=p.maple-bakes; ${VIA_POST_COOKIE}=k3m7qa2xpw` } });
    const res = await proxy(later);
    expect(res.cookies.get(VIA_COOKIE)).toBeUndefined();
    expect(res.cookies.get(VIA_POST_COOKIE)?.value).toBe("abcdefgh22");
    // A page reference, or something that is not a code, changes no fm_post.
    for (const url of ["http://localhost:3000/p/maple-bakes?via=p.maple-bakes", "http://localhost:3000/p/maple-bakes?via=s.NOTACODE00", "http://localhost:3000/p/maple-bakes?via=s.maple-bakes"]) expect((await proxy(new NextRequest(url))).cookies.get(VIA_POST_COOKIE), url).toBeUndefined();
  });

  it("is not secure in development and test, and secure everywhere else", async () => {
    expect((await proxy(new NextRequest("http://localhost:3000/p/maple-bakes?via=p.maple-bakes"))).cookies.get(VIA_COOKIE)?.secure).toBeFalsy();
    for (const appEnv of ["staging", "production"]) {
      vi.stubEnv("NEXT_PUBLIC_APP_ENV", appEnv);
      resetPublicEnvCache();
      const res = await proxy(new NextRequest("https://foundmill.example/p/maple-bakes?via=p.maple-bakes"));
      expect(res.cookies.get(VIA_COOKIE), appEnv).toMatchObject({ value: "p.maple-bakes", secure: true, httpOnly: true, sameSite: "lax" });
    }
  });

  it("first touch wins: a visitor who already carries a reference keeps it", async () => {
    const res = await proxy(new NextRequest("http://localhost:3000/p/other-project?via=p.other-project", { headers: { cookie: `${VIA_COOKIE}=u.maya` } }));
    expect(res.cookies.get(VIA_COOKIE)).toBeUndefined();
    expect(res.headers.get("set-cookie")).toBeNull();
    // The same address again changes nothing either.
    const again = await proxy(new NextRequest("http://localhost:3000/u/maya?via=u.maya", { headers: { cookie: `${VIA_COOKIE}=u.maya` } }));
    expect(again.cookies.get(VIA_COOKIE)).toBeUndefined();
  });

  it("a value that is not a reference sets nothing and changes nothing else about the answer", async () => {
    // The last one carries two: the first `via` on an address is the one read.
    for (const bad of ["", "maple-bakes", "x.maple-bakes", "p.", "p.Maple", "p.-maple", "u.a", `p.${"a".repeat(41)}`, "p.maple%20bakes", "%3Cscript%3E", "nope&via=u.maya"]) {
      for (const path of ["/p/maple-bakes", "/", "/b/abc/home"]) {
        const plain = await proxy(new NextRequest(`http://localhost:3000${path}`));
        const res = await proxy(new NextRequest(`http://localhost:3000${path}?via=${bad}`));
        expect(res.cookies.get(VIA_COOKIE), `${path} ${bad}`).toBeUndefined();
        expect(res.status, `${path} ${bad}`).toBe(plain.status);
        expect(res.headers.get("x-middleware-next"), `${path} ${bad}`).toBe(plain.headers.get("x-middleware-next"));
        expect(res.headers.get("set-cookie"), `${path} ${bad}`).toBe(plain.headers.get("set-cookie"));
      }
    }
    // No `via` at all: no cookie.
    expect((await proxy(new NextRequest("http://localhost:3000/p/maple-bakes"))).cookies.get(VIA_COOKIE)).toBeUndefined();
  });

  it("rides along with what the proxy already does: the sign-in redirect, the signed-in index, the stale-business rewrite", async () => {
    // Signed out on an app page: still sent to sign in, with the page (and its query) as next, and the cookie set.
    const signIn = await proxy(new NextRequest("http://localhost:3000/b/abc/home?via=p.maple-bakes"));
    expect(signIn.status).toBe(307);
    expect(signIn.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fb%2Fabc%2Fhome%3Fvia%3Dp.maple-bakes");
    expect(signIn.cookies.get(VIA_COOKIE)?.value).toBe("p.maple-bakes");

    // Signed in on `/` with a last business: the same redirect as without `via`.
    const home = await proxy(signedIn("http://localhost:3000/?via=u.maya", `${LAST_BUSINESS_COOKIE}=${LAST}`));
    expect(home.status).toBe(307);
    expect(home.headers.get("location")).toBe(`http://localhost:3000/b/${LAST}/today`);
    expect(home.cookies.get(VIA_COOKIE)?.value).toBe("u.maya");

    // Signed in on `/` without one: the same rewrite to the index.
    const index = await proxy(signedIn("http://localhost:3000/?via=u.maya"));
    expect(index.headers.get("x-middleware-rewrite")).toBe("http://localhost:3000/start");
    expect(index.cookies.get(VIA_COOKIE)?.value).toBe("u.maya");

    // The stale-business rewrite still clears its cookie, beside the new one.
    const stale = await proxy(signedIn(`http://localhost:3000/?stale=${LAST}&via=p.maple-bakes`, `${LAST_BUSINESS_COOKIE}=${LAST}`));
    expect(stale.headers.get("x-middleware-rewrite")).toBe("http://localhost:3000/start");
    expect(stale.cookies.get(LAST_BUSINESS_COOKIE)).toMatchObject({ value: "", maxAge: 0 });
    expect(stale.cookies.get(VIA_COOKIE)?.value).toBe("p.maple-bakes");

    // With `via`, everything but the attribution cookie is what it is without it.
    const withVia = await proxy(signedIn("http://localhost:3000/b/abc/inbox?tab=notes&via=p.maple-bakes"));
    const without = await proxy(signedIn("http://localhost:3000/b/abc/inbox?tab=notes"));
    expect(withVia.status).toBe(without.status);
    expect(withVia.headers.get("x-middleware-next")).toBe(without.headers.get("x-middleware-next"));
    expect(withVia.headers.get("location")).toBe(without.headers.get("location"));
  });
});
