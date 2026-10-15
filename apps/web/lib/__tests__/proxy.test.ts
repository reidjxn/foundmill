// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "../../proxy";
import { DEV_AUTH_COOKIE, LAST_BUSINESS_COOKIE } from "../auth/constants";

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

  it("answers a signed-in `/` with the last business's Home itself, with no render and no API call (audit WEB-4)", async () => {
    const res = await proxy(signedIn("http://localhost:3000/", `${LAST_BUSINESS_COOKIE}=${LAST}`));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`http://localhost:3000/b/${LAST}/home`);
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
  });

  it("sends a signed-out visitor to sign in with the page as next", async () => {
    const res = await proxy(new NextRequest("http://localhost:3000/b/abc/home"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fb%2Fabc%2Fhome");
  });
});
