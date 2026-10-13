// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "../../proxy";
import { DEV_AUTH_COOKIE } from "../auth/constants";

/** A signed-in request (the development bypass cookie; vitest runs with NEXT_PUBLIC_APP_ENV=test and no Supabase). */
function signedIn(url: string): NextRequest {
  return new NextRequest(url, { headers: { cookie: `${DEV_AUTH_COOKIE}=1` } });
}

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

  it("sends a signed-out visitor to sign in with the page as next", async () => {
    const res = await proxy(new NextRequest("http://localhost:3000/b/abc/home"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fb%2Fabc%2Fhome");
  });
});
