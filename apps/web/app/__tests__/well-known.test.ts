import { afterEach, describe, expect, it, vi } from "vitest";
import { isPublicPath } from "@/lib/auth/redirects";
import { APP_LINK_PATHS, appLinks } from "@/lib/app-links.server";
import { GET as aasa } from "../.well-known/apple-app-site-association/route";
import { GET as assetlinks } from "../.well-known/assetlinks.json/route";

const SHA = Array.from({ length: 32 }, (_, i) => (i * 7).toString(16).padStart(2, "0").toUpperCase()).join(":");
afterEach(() => vi.unstubAllEnvs());

describe("the universal-link files", () => {
  it("answer 404 while their ids are unset or malformed", async () => {
    expect((await aasa()).status).toBe(404);
    expect((await assetlinks()).status).toBe(404);
    vi.stubEnv("APP_LINKS_IOS_APP_ID", "not an id");
    vi.stubEnv("APP_LINKS_ANDROID_PACKAGE", "com.foundmill.app");
    expect((await aasa()).status).toBe(404);
    expect((await assetlinks()).status).toBe(404);
  });

  it("apple-app-site-association names the app and the six paths, never sign-in", async () => {
    vi.stubEnv("APP_LINKS_IOS_APP_ID", "ABCDE12345.com.foundmill.app");
    const res = await aasa();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { applinks: { details: { appID: string; paths: string[] }[] } };
    expect(body.applinks.details).toEqual([{ appID: "ABCDE12345.com.foundmill.app", paths: ["/b/*", "/p/*", "/u/*", "/m/*", "/i/*", "/a/*"] }]);
    expect(JSON.stringify(body)).not.toMatch(/login|\/auth/);
    expect([...APP_LINK_PATHS]).toHaveLength(6);
  });

  it("assetlinks.json names the package and fingerprints", async () => {
    vi.stubEnv("APP_LINKS_ANDROID_PACKAGE", "com.foundmill.app");
    vi.stubEnv("APP_LINKS_ANDROID_SHA256", SHA);
    const res = await assetlinks();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual([{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: "com.foundmill.app", sha256_cert_fingerprints: [SHA] } }]);
    expect(appLinks({ APP_LINKS_ANDROID_PACKAGE: "com.foundmill.app", APP_LINKS_ANDROID_SHA256: `${SHA},nope` }).android).toBeNull();
  });

  it("are reachable signed out: the proxy does not send them to sign-in", () => {
    expect(isPublicPath("/.well-known/assetlinks.json")).toBe(true);
    expect(isPublicPath("/.well-known/apple-app-site-association")).toBe(true);
    expect(isPublicPath("/.well-known")).toBe(false);
  });
});
