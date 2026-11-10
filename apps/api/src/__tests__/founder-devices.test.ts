/**
 * founder.devices.list/register/unregister (founder_devices, 0074; docs/mobile): the phones a signed-in person
 * registered for push. Any signed-in account calls them (a member of any business, a viewer, or someone with no business
 * yet); a second account never sees or forgets the first one's phone; a token follows the latest sign-in on a phone;
 * the input is validated.
 */
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { founderDevices } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "founder-devices" });
}, 120_000);
afterAll(() => hz.close());

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (err) {
    return err instanceof TRPCError ? err.code : `other:${String(err)}`;
  }
};

const token = (who: string) => `onesignal-${who}-0123456789abcdef`;

describe("founder.devices", () => {
  it("registers a phone after sign-in, refreshes it on the next launch and lists it, newest first", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    expect(await owner.founder.devices.list()).toEqual([]);
    const first = await owner.founder.devices.register({ platform: "ios", provider: "onesignal", token: token("owner-ios"), appVersion: "1.0.0" });
    expect(first.created).toBe(true);
    expect(first.device).toMatchObject({ platform: "ios", provider: "onesignal", token: token("owner-ios"), appVersion: "1.0.0" });
    const again = await owner.founder.devices.register({ platform: "ios", token: token("owner-ios"), appVersion: "1.0.1" });
    expect(again.created).toBe(false);
    expect(again.device.id).toBe(first.device.id);
    expect(again.device.appVersion).toBe("1.0.1");
    await owner.founder.devices.register({ platform: "android", token: token("owner-android") });
    expect((await owner.founder.devices.list()).map((d) => [d.platform, d.token])).toEqual([
      ["android", token("owner-android")],
      ["ios", token("owner-ios")],
    ]);
  });

  it("a second account cannot see or forget the first one's phone, and there is no way to name another account", async () => {
    const other = hz.caller({ userId: hz.B.ownerId });
    expect(await other.founder.devices.list()).toEqual([]);
    expect(await other.founder.devices.unregister({ token: token("owner-ios") })).toEqual({ removed: false });
    expect(await code(other.founder.devices.register({ platform: "ios", token: token("owner-x"), userId: hz.A.ownerId } as never))).toBe("BAD_REQUEST");
    const rows = await hz.db.select().from(founderDevices).where(eq(founderDevices.token, token("owner-ios")));
    expect(rows.map((r) => r.userId)).toEqual([hz.A.ownerId]);
  });

  it("a token follows the latest sign-in on the phone: registering it from another account moves it", async () => {
    const other = hz.caller({ userId: hz.B.ownerId });
    const moved = await other.founder.devices.register({ platform: "ios", token: token("owner-ios"), appVersion: "1.1.0" });
    expect(moved.created).toBe(false);
    expect((await other.founder.devices.list()).map((d) => [d.token, d.appVersion])).toEqual([[token("owner-ios"), "1.1.0"]]);
    expect((await hz.caller({ userId: hz.A.ownerId }).founder.devices.list()).map((d) => d.token)).toEqual([token("owner-android")]);
  });

  it("sign-out forgets the phone, once", async () => {
    const other = hz.caller({ userId: hz.B.ownerId });
    expect(await other.founder.devices.unregister({ token: token("owner-ios") })).toEqual({ removed: true });
    expect(await other.founder.devices.unregister({ token: token("owner-ios") })).toEqual({ removed: false });
    expect(await other.founder.devices.list()).toEqual([]);
  });

  it("is personal, not a business permission: a viewer and an account with no business can both register", async () => {
    const viewer = hz.caller({ userId: hz.A.viewerId });
    expect((await viewer.founder.devices.register({ platform: "android", token: token("viewer") })).created).toBe(true);
    const fresh = await hz.h.createUser("fresh-devices@test.local");
    const newcomer = hz.caller({ userId: fresh });
    expect((await newcomer.founder.devices.register({ platform: "ios", token: token("newcomer") })).created).toBe(true);
    expect((await newcomer.founder.devices.list()).map((d) => d.token)).toEqual([token("newcomer")]);
    expect((await viewer.founder.devices.list()).map((d) => d.token)).toEqual([token("viewer")]);
  });

  it("refuses signed-out callers, an unknown platform or provider, a malformed token and an empty change", async () => {
    expect(await code(hz.caller(null).founder.devices.list())).toBe("UNAUTHORIZED");
    expect(await code(hz.caller(null).founder.devices.register({ platform: "ios", token: token("nobody") }))).toBe("UNAUTHORIZED");
    expect(await code(hz.caller(null).founder.devices.unregister({ token: token("nobody") }))).toBe("UNAUTHORIZED");
    const owner = hz.caller({ userId: hz.A.memberId });
    expect(await code(owner.founder.devices.register({ platform: "web", token: token("web") } as never))).toBe("BAD_REQUEST");
    expect(await code(owner.founder.devices.register({ platform: "ios", provider: "fcm", token: token("fcm") } as never))).toBe("BAD_REQUEST");
    expect(await code(owner.founder.devices.register({ platform: "ios", token: "short" }))).toBe("BAD_REQUEST");
    expect(await code(owner.founder.devices.register({ platform: "ios", token: token("long"), appVersion: "x".repeat(41) }))).toBe("BAD_REQUEST");
    expect(await code(owner.founder.devices.register({} as never))).toBe("BAD_REQUEST");
    expect(await code(owner.founder.devices.unregister({ token: "short" }))).toBe("BAD_REQUEST");
    expect(await owner.founder.devices.list()).toEqual([]);
  });
});
