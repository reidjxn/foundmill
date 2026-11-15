/**
 * founder_devices (0075): the phones a person registered for push, read, written and deleted only by that account.
 * Cross-user checks on the table itself and through `repos.devices` under RLS and with the service role (the path
 * apps/api takes for `register`, so a token follows the latest sign-in on a phone).
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { devicesRepo } from "../../repos/devices";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { RLS_DENIED } from "./fixtures";

let h: TestHarness;
let ada: string;
let bo: string;
let cy: string;

beforeAll(async () => {
  h = await createTestDb();
  ada = await h.createUser("ada-devices@test.local");
  bo = await h.createUser("bo-devices@test.local");
  cy = await h.createUser("cy-devices@test.local");
});
afterAll(() => h?.close());

const token = (who: string) => `onesignal-${who}-0123456789abcdef`;

describe("founder_devices (table)", () => {
  it("a user creates and reads only their own rows", async () => {
    await h.asUser(ada).run((tx) => tx.insert(s.founderDevices).values({ userId: ada, platform: "ios", token: token("ada-1") }));
    await h.asUser(ada).run((tx) => tx.insert(s.founderDevices).values({ userId: ada, platform: "android", token: token("ada-2"), appVersion: "1.0.0" }));
    await h.asUser(bo).run((tx) => tx.insert(s.founderDevices).values({ userId: bo, platform: "ios", token: token("bo-1") }));
    const seenByAda = await h.asUser(ada).run((tx) => tx.select().from(s.founderDevices));
    expect(seenByAda.map((r) => [r.userId, r.platform, r.provider]).sort()).toEqual([
      [ada, "android", "onesignal"],
      [ada, "ios", "onesignal"],
    ]);
    expect((await h.asUser(bo).run((tx) => tx.select().from(s.founderDevices))).map((r) => r.token)).toEqual([token("bo-1")]);
    expect(await h.asUser(cy).run((tx) => tx.select().from(s.founderDevices).where(eq(s.founderDevices.userId, ada)))).toHaveLength(0);
  });

  it("a user cannot create, change, move or delete someone else's row", async () => {
    await expect(h.asUser(cy).run((tx) => tx.insert(s.founderDevices).values({ userId: ada, platform: "ios", token: token("cy-for-ada") }))).rejects.toThrow(RLS_DENIED);
    expect(await h.asUser(cy).run((tx) => tx.update(s.founderDevices).set({ appVersion: "9.9.9" }).where(eq(s.founderDevices.userId, ada)).returning())).toHaveLength(0);
    await expect(h.asUser(bo).run((tx) => tx.update(s.founderDevices).set({ userId: ada }).where(eq(s.founderDevices.userId, bo)))).rejects.toThrow(RLS_DENIED);
    expect(await h.asUser(cy).run((tx) => tx.delete(s.founderDevices).where(eq(s.founderDevices.userId, ada)).returning())).toHaveLength(0);
    // Their own row they may delete (sign-out forgets the phone).
    expect(await h.asUser(bo).run((tx) => tx.delete(s.founderDevices).where(eq(s.founderDevices.token, token("bo-1"))).returning())).toHaveLength(1);
    const truth = await h.service().run((tx) => tx.select().from(s.founderDevices));
    expect(truth.map((r) => r.userId).sort()).toEqual([ada, ada].sort());
    expect(truth.every((r) => r.appVersion !== "9.9.9")).toBe(true);
  });

  it("signed-out visitors read and write nothing", async () => {
    await expect(h.anon().run((tx) => tx.select().from(s.founderDevices))).rejects.toThrow(/permission denied/);
    await expect(h.anon().run((tx) => tx.insert(s.founderDevices).values({ userId: cy, platform: "ios", token: token("anon") }))).rejects.toThrow(/permission denied/);
  });

  it("only the known platforms and providers are stored, a token names one phone, and a short token is refused", async () => {
    await expect(h.service().execute(sql`insert into founder_devices (user_id, platform, token) values (${cy}::uuid, 'web', ${token("cy-web")})`)).rejects.toThrow(/check constraint/);
    await expect(h.service().execute(sql`insert into founder_devices (user_id, platform, provider, token) values (${cy}::uuid, 'ios', 'fcm', ${token("cy-fcm")})`)).rejects.toThrow(/check constraint/);
    await expect(h.service().execute(sql`insert into founder_devices (user_id, platform, token) values (${cy}::uuid, 'ios', 'short')`)).rejects.toThrow(/check constraint/);
    await expect(h.service().execute(sql`insert into founder_devices (user_id, platform, token) values (${cy}::uuid, 'ios', ${token("ada-1")})`)).rejects.toThrow(/unique/);
    const [row] = await h.asUser(cy).run((tx) => tx.insert(s.founderDevices).values({ userId: cy, platform: "android", token: token("cy-1") }).returning());
    expect([row!.provider, row!.appVersion]).toEqual(["onesignal", ""]);
    expect(row!.lastSeenAt).toBeInstanceOf(Date);
    await h.db.delete(s.founderDevices).where(eq(s.founderDevices.userId, cy));
  });
});

describe("repos.devices", () => {
  it("under RLS a person registers, refreshes, lists and forgets their own phone", async () => {
    const dee = await h.createUser("dee-devices@test.local");
    const first = await h.asUser(dee).run((tx) => devicesRepo.register(tx, dee, { platform: "ios", token: token("dee-1"), appVersion: "1.0.0" }));
    expect(first.created).toBe(true);
    expect(first.device).toMatchObject({ platform: "ios", provider: "onesignal", token: token("dee-1"), appVersion: "1.0.0" });
    expect(first.device.lastSeenAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const again = await h.asUser(dee).run((tx) => devicesRepo.register(tx, dee, { platform: "ios", token: token("dee-1"), appVersion: "1.1.0" }));
    expect(again.created).toBe(false);
    expect(again.device.id).toBe(first.device.id);
    expect(again.device.appVersion).toBe("1.1.0");
    expect(Date.parse(again.device.lastSeenAt)).toBeGreaterThanOrEqual(Date.parse(first.device.lastSeenAt));
    expect((await h.asUser(dee).run((tx) => devicesRepo.list(tx, dee))).map((d) => d.token)).toEqual([token("dee-1")]);
    expect(await h.asUser(dee).run((tx) => devicesRepo.unregister(tx, dee, token("dee-1")))).toEqual({ removed: true });
    expect(await h.asUser(dee).run((tx) => devicesRepo.list(tx, dee))).toEqual([]);
    expect(await h.asUser(dee).run((tx) => devicesRepo.unregister(tx, dee, token("dee-1")))).toEqual({ removed: false });
  });

  it("another account cannot see, forget or take over the first one's phone under RLS", async () => {
    expect(await h.asUser(bo).run((tx) => devicesRepo.list(tx, ada))).toEqual([]);
    expect(await h.asUser(bo).run((tx) => devicesRepo.unregister(tx, bo, token("ada-1")))).toEqual({ removed: false });
    await expect(h.asUser(bo).run((tx) => devicesRepo.register(tx, bo, { platform: "ios", token: token("ada-1") }))).rejects.toThrow();
    const truth = await h.service().run((tx) => tx.select().from(s.founderDevices).where(eq(s.founderDevices.token, token("ada-1"))));
    expect(truth.map((r) => r.userId)).toEqual([ada]);
  });

  it("with the service role a token follows the latest sign-in on the phone (the api's register path)", async () => {
    const moved = await h.service().run((tx) => devicesRepo.register(tx, bo, { platform: "ios", token: token("ada-1"), appVersion: "1.2.0" }));
    expect(moved.created).toBe(false);
    expect((await h.asUser(bo).run((tx) => devicesRepo.list(tx, bo))).map((d) => [d.token, d.appVersion])).toEqual([[token("ada-1"), "1.2.0"]]);
    expect((await h.asUser(ada).run((tx) => devicesRepo.list(tx, ada))).map((d) => d.token)).toEqual([token("ada-2")]);
    // The fan-out's read: every phone of the named people, grouped.
    const byUser = await h.service().run((tx) => devicesRepo.forUsers(tx, [ada, bo, cy]));
    expect([...byUser.keys()].sort()).toEqual([ada, bo].sort());
    expect(byUser.get(ada)!.map((d) => d.token)).toEqual([token("ada-2")]);
    expect(await h.service().run((tx) => devicesRepo.forUsers(tx, []))).toEqual(new Map());
  });

  it("refuses an unknown platform or provider, a malformed token and an unknown field with a validation error", async () => {
    await expect(h.asUser(ada).run((tx) => devicesRepo.register(tx, ada, { platform: "web", token: token("x") } as never))).rejects.toThrow(/Invalid device/);
    await expect(h.asUser(ada).run((tx) => devicesRepo.register(tx, ada, { platform: "ios", provider: "fcm", token: token("x") } as never))).rejects.toThrow(/Invalid device/);
    await expect(h.asUser(ada).run((tx) => devicesRepo.register(tx, ada, { platform: "ios", token: "short" }))).rejects.toThrow(/Invalid device/);
    await expect(h.asUser(ada).run((tx) => devicesRepo.register(tx, ada, { platform: "ios", token: token("x"), extra: 1 } as never))).rejects.toThrow(/Invalid device/);
    await expect(h.asUser(ada).run((tx) => devicesRepo.unregister(tx, ada, "short"))).rejects.toThrow(/Invalid device/);
  });
});
