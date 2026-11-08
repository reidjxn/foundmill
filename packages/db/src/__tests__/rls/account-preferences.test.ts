/**
 * account_preferences (0022): one row per signed-in account, read and written only by that account. Cross-user checks
 * on the table itself and through `repos.preferences` under RLS (the path apps/api takes).
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { preferencesRepo } from "../../repos/preferences";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { RLS_DENIED } from "./fixtures";

let h: TestHarness;
let ada: string;
let bo: string;
let cy: string;

beforeAll(async () => {
  h = await createTestDb();
  ada = await h.createUser("ada@test.local");
  bo = await h.createUser("bo@test.local");
  cy = await h.createUser("cy@test.local");
});
afterAll(() => h?.close());

describe("account_preferences (table)", () => {
  it("a user creates and reads only their own row", async () => {
    await h.asUser(ada).run((tx) => tx.insert(s.accountPreferences).values({ userId: ada, dateFormat: "day_first", timeFormat: "24h" }));
    await h.asUser(bo).run((tx) => tx.insert(s.accountPreferences).values({ userId: bo, dateFormat: "iso" }));
    const seenByAda = await h.asUser(ada).run((tx) => tx.select().from(s.accountPreferences));
    expect(seenByAda.map((r) => [r.userId, r.dateFormat, r.timeFormat])).toEqual([[ada, "day_first", "24h"]]);
    const seenByBo = await h.asUser(bo).run((tx) => tx.select().from(s.accountPreferences));
    expect(seenByBo.map((r) => r.userId)).toEqual([bo]);
    // A third account with no row sees nothing at all, not even by naming the others.
    expect(await h.asUser(cy).run((tx) => tx.select().from(s.accountPreferences).where(eq(s.accountPreferences.userId, ada)))).toHaveLength(0);
  });

  it("a user cannot create, change or delete someone else's row", async () => {
    await expect(h.asUser(cy).run((tx) => tx.insert(s.accountPreferences).values({ userId: ada, dateFormat: "us" }))).rejects.toThrow(RLS_DENIED);
    const changed = await h.asUser(cy).run((tx) => tx.update(s.accountPreferences).set({ dateFormat: "us", timeFormat: "12h" }).where(eq(s.accountPreferences.userId, ada)).returning());
    expect(changed).toHaveLength(0);
    // Nor move their own row onto another account.
    await expect(h.asUser(bo).run((tx) => tx.update(s.accountPreferences).set({ userId: ada }).where(eq(s.accountPreferences.userId, bo)))).rejects.toThrow(RLS_DENIED);
    // There is no delete grant: the row goes only with the account.
    await expect(h.asUser(ada).run((tx) => tx.delete(s.accountPreferences).where(eq(s.accountPreferences.userId, ada)))).rejects.toThrow(/permission denied/);
    const truth = await h.service().run((tx) => tx.select().from(s.accountPreferences).where(eq(s.accountPreferences.userId, ada)));
    expect(truth.map((r) => [r.dateFormat, r.timeFormat])).toEqual([["day_first", "24h"]]);
  });

  it("signed-out visitors read and write nothing", async () => {
    await expect(h.anon().run((tx) => tx.select().from(s.accountPreferences))).rejects.toThrow(/permission denied/);
    await expect(h.anon().run((tx) => tx.insert(s.accountPreferences).values({ userId: cy }))).rejects.toThrow(/permission denied/);
  });

  it("only the known formats are stored, and a new row defaults to US and 12-hour", async () => {
    await expect(h.service().execute(sql`insert into account_preferences (user_id, date_format) values (${cy}::uuid, 'dmy')`)).rejects.toThrow(/check constraint/);
    await expect(h.service().execute(sql`insert into account_preferences (user_id, time_format) values (${cy}::uuid, '24')`)).rejects.toThrow(/check constraint/);
    const [row] = await h.asUser(cy).run((tx) => tx.insert(s.accountPreferences).values({ userId: cy }).returning());
    expect([row!.dateFormat, row!.timeFormat]).toEqual(["us", "12h"]);
    await h.db.delete(s.accountPreferences).where(eq(s.accountPreferences.userId, cy));
  });

  it("0064: only the known guidance modes and text sizes are stored; a new row is guided, standard, with nothing seen", async () => {
    await expect(h.service().execute(sql`insert into account_preferences (user_id, guidance) values (${cy}::uuid, 'quiet')`)).rejects.toThrow(/check constraint/);
    await expect(h.service().execute(sql`insert into account_preferences (user_id, text_size) values (${cy}::uuid, 'large')`)).rejects.toThrow(/check constraint/);
    const [row] = await h.asUser(cy).run((tx) => tx.insert(s.accountPreferences).values({ userId: cy }).returning());
    expect([row!.guidance, row!.textSize, row!.explainersSeen, row!.toursDone, row!.checklistDismissedAt, row!.anthropomorphicAgents, row!.agentStyle]).toEqual(["on", "standard", {}, {}, null, false, "humans"]);
    await expect(h.service().execute(sql`insert into account_preferences (user_id, agent_style) values (${cy}::uuid, 'anime')`)).rejects.toThrow(/check constraint/);
    await h.db.delete(s.accountPreferences).where(eq(s.accountPreferences.userId, cy));
  });
});

/** The defaults everyone reads until they choose. */
const NOTIFICATIONS_ON = { decision: true, approval: true, customer: true, agent_down: true, runway: true, run_finished: true, goal: true };
const DEFAULTS = { date: "us", time: "12h", guidance: "on", textSize: "standard", explainersSeen: {}, toursDone: {}, checklistDismissedAt: null, anthropomorphicAgents: false, agentStyle: "humans", notifications: NOTIFICATIONS_ON, hideAmountsOnLockScreen: false };

describe("repos.preferences under RLS", () => {
  it("reads the defaults without writing a row, then upserts only what changed", async () => {
    const dee = await h.createUser("dee@test.local");
    expect(await h.asUser(dee).run((tx) => preferencesRepo.get(tx, dee))).toEqual(DEFAULTS);
    expect(await h.service().run((tx) => tx.select().from(s.accountPreferences).where(eq(s.accountPreferences.userId, dee)))).toHaveLength(0);
    expect(await h.asUser(dee).run((tx) => preferencesRepo.update(tx, dee, { time: "24h" }))).toEqual({ ...DEFAULTS, time: "24h" });
    expect(await h.asUser(dee).run((tx) => preferencesRepo.update(tx, dee, { date: "iso" }))).toEqual({ ...DEFAULTS, date: "iso", time: "24h" });
    expect(await h.asUser(dee).run((tx) => preferencesRepo.get(tx, dee))).toEqual({ ...DEFAULTS, date: "iso", time: "24h" });
  });

  it("another account cannot read or change the first one's choice through the repo", async () => {
    // Bo asking for Ada's row sees nothing, so reads the defaults; writing it fails the policy.
    expect(await h.asUser(bo).run((tx) => preferencesRepo.get(tx, ada))).toEqual(DEFAULTS);
    await expect(h.asUser(bo).run((tx) => preferencesRepo.update(tx, ada, { date: "us", time: "12h" }))).rejects.toThrow(RLS_DENIED);
    expect(await h.asUser(ada).run((tx) => preferencesRepo.get(tx, ada))).toMatchObject({ date: "day_first", time: "24h" });
    // Bo's own change touches Bo only.
    expect(await h.asUser(bo).run((tx) => preferencesRepo.update(tx, bo, { time: "24h" }))).toMatchObject({ date: "iso", time: "24h" });
    expect(await h.asUser(ada).run((tx) => preferencesRepo.get(tx, ada))).toMatchObject({ date: "day_first", time: "24h" });
  });

  it("refuses an empty change or an unknown format with a validation error", async () => {
    await expect(h.asUser(ada).run((tx) => preferencesRepo.update(tx, ada, {}))).rejects.toThrow(/Invalid preferences/);
    await expect(h.asUser(ada).run((tx) => preferencesRepo.update(tx, ada, { date: "dmy" } as never))).rejects.toThrow(/Invalid preferences/);
    await expect(h.asUser(ada).run((tx) => preferencesRepo.update(tx, ada, { date: "us", extra: 1 } as never))).rejects.toThrow(/Invalid preferences/);
  });
});

describe("repos.preferences: the guided layer (0064)", () => {
  it("the switch and the text size save on their own, with the date format untouched", async () => {
    const eve = await h.createUser("eve@test.local");
    expect(await h.asUser(eve).run((tx) => preferencesRepo.update(tx, eve, { guidance: "off" }))).toEqual({ ...DEFAULTS, guidance: "off" });
    expect(await h.asUser(eve).run((tx) => preferencesRepo.update(tx, eve, { textSize: "comfortable" }))).toEqual({ ...DEFAULTS, guidance: "off", textSize: "comfortable" });
    expect(await h.asUser(eve).run((tx) => preferencesRepo.update(tx, eve, { guidance: "on", date: "iso" }))).toEqual({ ...DEFAULTS, date: "iso", textSize: "comfortable" });
  });

  it("marks merge into what was seen; a first mark creates the row with just that mark", async () => {
    const fay = await h.createUser("fay@test.local");
    expect(await h.asUser(fay).run((tx) => preferencesRepo.update(tx, fay, { explainersSeen: { home: true } }))).toMatchObject({ explainersSeen: { home: true }, toursDone: {} });
    expect(await h.asUser(fay).run((tx) => preferencesRepo.update(tx, fay, { explainersSeen: { inbox: true }, toursDone: { home: true } }))).toMatchObject({ explainersSeen: { home: true, inbox: true }, toursDone: { home: true } });
    // Marking a screen again changes nothing; the other marks stay.
    expect(await h.asUser(fay).run((tx) => preferencesRepo.update(tx, fay, { explainersSeen: { home: true } }))).toMatchObject({ explainersSeen: { home: true, inbox: true }, toursDone: { home: true } });
  });

  it("the checklist is dismissed now or shown again, and a reset clears everything that was seen", async () => {
    const gus = await h.createUser("gus@test.local");
    const before = Date.now();
    const dismissed = await h.asUser(gus).run((tx) => preferencesRepo.update(tx, gus, { checklistDismissed: true, toursDone: { inbox: true } }));
    expect(dismissed.checklistDismissedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Date.parse(dismissed.checklistDismissedAt!)).toBeGreaterThanOrEqual(before - 1000);
    expect(await h.asUser(gus).run((tx) => preferencesRepo.update(tx, gus, { checklistDismissed: false }))).toMatchObject({ checklistDismissedAt: null, toursDone: { inbox: true } });
    await h.asUser(gus).run((tx) => preferencesRepo.update(tx, gus, { checklistDismissed: true, explainersSeen: { home: true }, textSize: "comfortable" }));
    // The reset puts the tutoring back to the first day and keeps the choices (the switch, the text size, the dates).
    expect(await h.asUser(gus).run((tx) => preferencesRepo.update(tx, gus, { reset: true }))).toEqual({ ...DEFAULTS, textSize: "comfortable" });
    // A reset on an account with no row yet reads as the defaults too.
    const hal = await h.createUser("hal@test.local");
    expect(await h.asUser(hal).run((tx) => preferencesRepo.update(tx, hal, { reset: true }))).toEqual(DEFAULTS);
  });

  it("0073: notification kinds merge over the defaults, the lock-screen switch saves alone, a reset keeps both, unknown kinds are refused", async () => {
    const ivy = await h.createUser("ivy@test.local");
    expect(await h.asUser(ivy).run((tx) => preferencesRepo.update(tx, ivy, { notifications: { customer: false } }))).toEqual({ ...DEFAULTS, notifications: { ...NOTIFICATIONS_ON, customer: false } });
    expect(await h.asUser(ivy).run((tx) => preferencesRepo.update(tx, ivy, { notifications: { run_finished: false }, hideAmountsOnLockScreen: true }))).toEqual({ ...DEFAULTS, notifications: { ...NOTIFICATIONS_ON, customer: false, run_finished: false }, hideAmountsOnLockScreen: true });
    // Turning a kind back on overwrites the stored choice; the stored map holds only what was chosen.
    expect(await h.asUser(ivy).run((tx) => preferencesRepo.update(tx, ivy, { notifications: { customer: true } }))).toMatchObject({ notifications: { ...NOTIFICATIONS_ON, run_finished: false } });
    expect((await h.service().run((tx) => tx.select({ n: s.accountPreferences.notifications }).from(s.accountPreferences).where(eq(s.accountPreferences.userId, ivy))))[0]!.n).toEqual({ customer: true, run_finished: false });
    expect(await h.asUser(ivy).run((tx) => preferencesRepo.update(tx, ivy, { reset: true }))).toMatchObject({ notifications: { ...NOTIFICATIONS_ON, run_finished: false }, hideAmountsOnLockScreen: true });
    await expect(h.asUser(ivy).run((tx) => preferencesRepo.update(tx, ivy, { notifications: {} }))).rejects.toThrow(/Invalid preferences/);
    await expect(h.asUser(ivy).run((tx) => preferencesRepo.update(tx, ivy, { notifications: { marketing: true } } as never))).rejects.toThrow(/Invalid preferences/);
    await expect(h.asUser(ivy).run((tx) => preferencesRepo.update(tx, ivy, { notifications: { customer: "no" } } as never))).rejects.toThrow(/Invalid preferences/);
    await expect(h.asUser(ivy).run((tx) => preferencesRepo.update(tx, ivy, { hideAmountsOnLockScreen: "yes" } as never))).rejects.toThrow(/Invalid preferences/);
  });

  it("refuses unknown modes, a mark that is not true, too many marks, and a reset that also marks", async () => {
    await expect(h.asUser(ada).run((tx) => preferencesRepo.update(tx, ada, { guidance: "quiet" } as never))).rejects.toThrow(/Invalid preferences/);
    await expect(h.asUser(ada).run((tx) => preferencesRepo.update(tx, ada, { textSize: "large" } as never))).rejects.toThrow(/Invalid preferences/);
    await expect(h.asUser(ada).run((tx) => preferencesRepo.update(tx, ada, { explainersSeen: { home: false } } as never))).rejects.toThrow(/Invalid preferences/);
    await expect(h.asUser(ada).run((tx) => preferencesRepo.update(tx, ada, { toursDone: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`t${i}`, true])) }))).rejects.toThrow(/Invalid preferences/);
    await expect(h.asUser(ada).run((tx) => preferencesRepo.update(tx, ada, { reset: true, explainersSeen: { home: true } }))).rejects.toThrow(/Invalid preferences/);
    await expect(h.asUser(ada).run((tx) => preferencesRepo.update(tx, ada, { reset: false } as never))).rejects.toThrow(/Invalid preferences/);
    expect(await h.asUser(ada).run((tx) => preferencesRepo.get(tx, ada))).toMatchObject({ guidance: "on", textSize: "standard", explainersSeen: {} });
  });
});
