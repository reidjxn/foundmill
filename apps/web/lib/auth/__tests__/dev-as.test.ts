// @vitest-environment node
/**
 * The second dev account: /auth/dev?as=<uuid> (development and test only) stores the account in the dev-as cookie
 * beside the dev cookie, plain /auth/dev clears it, a malformed id is refused, and in staging or production the route
 * is a 404 that sets nothing. The bearer helpers turn the cookie into `dev:<uuid>` (and nothing outside dev/test).
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let devLike = true;
vi.mock("@/lib/env", () => ({ isDevLike: () => devLike }));

const { GET, POST } = await import("../../../app/auth/dev/route");
const { DEV_AS_COOKIE, DEV_AUTH_COOKIE } = await import("../constants");
const { devBearerFor, devBearerToken, parseDevAsUserId, readDevAsCookie } = await import("../dev-as");

const VIEWER = "e2e0e2e0-0000-4000-8000-00000000e5a1";

/** The Set-Cookie lines of a response, by cookie name. */
function setCookies(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of res.headers.getSetCookie()) out[line.slice(0, line.indexOf("="))] = line;
  return out;
}

beforeEach(() => {
  devLike = true;
});

describe("/auth/dev", () => {
  it("signs in as the dev user and clears any earlier account choice", async () => {
    const res = await GET(new NextRequest("http://localhost:3000/auth/dev?next=%2Fnew"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3000/new");
    const cookies = setCookies(res);
    expect(cookies[DEV_AUTH_COOKIE]).toMatch(new RegExp(`^${DEV_AUTH_COOKIE}=1;`));
    expect(cookies[DEV_AUTH_COOKIE]).toMatch(/HttpOnly/i);
    expect(cookies[DEV_AS_COOKIE]).toMatch(/Max-Age=0/i);
  });

  it("?as=<uuid> stores that account (readable by the page) beside the dev cookie", async () => {
    const res = await GET(new NextRequest(`http://localhost:3000/auth/dev?as=${VIEWER.toUpperCase()}&next=%2Fnew`));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3000/new");
    const cookies = setCookies(res);
    expect(cookies[DEV_AUTH_COOKIE]).toMatch(new RegExp(`^${DEV_AUTH_COOKIE}=1;`));
    expect(cookies[DEV_AS_COOKIE]).toMatch(new RegExp(`^${DEV_AS_COOKIE}=${VIEWER};`));
    expect(cookies[DEV_AS_COOKIE]).not.toMatch(/HttpOnly/i);
    expect(cookies[DEV_AS_COOKIE]).toMatch(/SameSite=lax/i);
  });

  it("takes the account from a form post too", async () => {
    const body = new FormData();
    body.set("as", VIEWER);
    body.set("next", "/businesses");
    const res = await POST(new NextRequest("http://localhost:3000/auth/dev", { method: "POST", body }));
    expect(res.headers.get("location")).toBe("http://localhost:3000/businesses");
    expect(setCookies(res)[DEV_AS_COOKIE]).toMatch(new RegExp(`^${DEV_AS_COOKIE}=${VIEWER};`));
  });

  it("refuses an account id that is not a UUID, and sets nothing", async () => {
    for (const as of ["dev", "not-a-uuid", `${VIEWER}x`, "' or 1=1"]) {
      const res = await GET(new NextRequest(`http://localhost:3000/auth/dev?as=${encodeURIComponent(as)}`));
      expect(res.status).toBe(400);
      expect(res.headers.getSetCookie()).toEqual([]);
    }
  });

  it("is a 404 that sets nothing outside development and test, with or without an account", async () => {
    devLike = false;
    for (const url of ["http://localhost:3000/auth/dev", `http://localhost:3000/auth/dev?as=${VIEWER}`]) {
      const res = await GET(new NextRequest(url));
      expect(res.status).toBe(404);
      expect(res.headers.getSetCookie()).toEqual([]);
    }
    const body = new FormData();
    body.set("as", VIEWER);
    const post = await POST(new NextRequest("http://localhost:3000/auth/dev", { method: "POST", body }));
    expect(post.status).toBe(404);
  });
});

describe("dev bearer helpers", () => {
  it("parseDevAsUserId: a UUID (lowercased), else null", () => {
    expect(parseDevAsUserId(VIEWER.toUpperCase())).toBe(VIEWER);
    expect(parseDevAsUserId(` ${VIEWER} `)).toBe(VIEWER);
    expect(parseDevAsUserId("dev")).toBeNull();
    expect(parseDevAsUserId("")).toBeNull();
    expect(parseDevAsUserId(undefined)).toBeNull();
  });

  it("devBearerFor: `dev` for the dev user, `dev:<uuid>` for another account", () => {
    expect(devBearerFor(null)).toBe("dev");
    expect(devBearerFor("nope")).toBe("dev");
    expect(devBearerFor(VIEWER)).toBe(`dev:${VIEWER}`);
  });

  it("readDevAsCookie: the account in a cookie string, or null", () => {
    expect(readDevAsCookie(`a=1; ${DEV_AS_COOKIE}=${VIEWER}; b=2`)).toBe(VIEWER);
    expect(readDevAsCookie(`${DEV_AS_COOKIE}=${encodeURIComponent(VIEWER)}`)).toBe(VIEWER);
    expect(readDevAsCookie(`x${DEV_AS_COOKIE}=${VIEWER}`)).toBeNull();
    expect(readDevAsCookie(`${DEV_AS_COOKIE}=nope`)).toBeNull();
    expect(readDevAsCookie(`${DEV_AS_COOKIE}=%E0%A4%A`)).toBeNull();
    expect(readDevAsCookie("")).toBeNull();
  });

  it("devBearerToken: the browser's dev bearer from its cookies in development and test, nothing elsewhere", () => {
    expect(devBearerToken("")).toBe("dev");
    expect(devBearerToken(`${DEV_AS_COOKIE}=${VIEWER}`)).toBe(`dev:${VIEWER}`);
    devLike = false;
    expect(devBearerToken(`${DEV_AS_COOKIE}=${VIEWER}`)).toBeNull();
    expect(devBearerToken("")).toBeNull();
  });
});
