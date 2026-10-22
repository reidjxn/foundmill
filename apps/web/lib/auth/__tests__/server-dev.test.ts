// @vitest-environment node
/**
 * getServerAuth and the dev bypass: the dev cookie alone is the dev user (`dev`); with the dev-as cookie the bearer
 * names that account (`dev:<uuid>`); a malformed dev-as value falls back to the dev user; outside development and test
 * neither cookie counts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let devLike = true;
let jar: Record<string, string> = {};
vi.mock("@/lib/env", () => ({ isDevLike: () => devLike }));
vi.mock("@/lib/supabase/server", () => ({ getServerSession: vi.fn(async () => null) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (name in jar ? { name, value: jar[name] } : undefined) }) }));

const { getServerAuth } = await import("../server");
const { DEV_AS_COOKIE, DEV_AUTH_COOKIE } = await import("../constants");

const VIEWER = "e2e0e2e0-0000-4000-8000-00000000e5a1";

beforeEach(() => {
  devLike = true;
  jar = {};
});

describe("getServerAuth, dev bypass", () => {
  it("the dev cookie alone sends `dev`", async () => {
    jar = { [DEV_AUTH_COOKIE]: "1" };
    expect(await getServerAuth()).toEqual({ token: "dev", userId: null, email: null, via: "dev" });
  });

  it("with the dev-as cookie the bearer is `dev:<uuid>` for that account", async () => {
    jar = { [DEV_AUTH_COOKIE]: "1", [DEV_AS_COOKIE]: VIEWER };
    expect(await getServerAuth()).toEqual({ token: `dev:${VIEWER}`, userId: VIEWER, email: null, via: "dev" });
  });

  it("a malformed dev-as value is the dev user; the dev-as cookie without the dev cookie signs nobody in", async () => {
    jar = { [DEV_AUTH_COOKIE]: "1", [DEV_AS_COOKIE]: "nope" };
    expect((await getServerAuth())?.token).toBe("dev");
    jar = { [DEV_AS_COOKIE]: VIEWER };
    expect(await getServerAuth()).toBeNull();
  });

  it("outside development and test neither cookie counts", async () => {
    devLike = false;
    jar = { [DEV_AUTH_COOKIE]: "1", [DEV_AS_COOKIE]: VIEWER };
    expect(await getServerAuth()).toBeNull();
  });
});
