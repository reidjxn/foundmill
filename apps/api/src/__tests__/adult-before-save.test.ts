/**
 * The save that creates a profile records "I am 18 or older" BEFORE the profile exists (security review, 2026-11-14):
 * the steps that run after it (`onPersonCreated`) run in their own try/catch, so a confirmation written only there
 * could be lost and leave a profile without one. Here no step runs at all, and the record is still there; and a save
 * whose confirmation cannot be recorded creates no profile.
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

// No step after the save runs: whatever the step would have written is not written.
vi.mock("../services/person-created", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/person-created")>();
  return { ...real, onPersonCreated: vi.fn(async () => undefined) };
});

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "adult-before-save" });
}, 120_000);
afterAll(() => hz?.close());

const answer = { displayName: "Newcomer", experience: "first_time", skills: { marketing: 8 }, targetMarkets: ["US"], riskAppetite: "medium" };

describe("founder.profile.update records 18 or older before the profile", () => {
  it("with no step running after the save, the new profile's confirmation is on record", async () => {
    const userId = await hz.h.createUser("adult-before-save-1@test.local");
    const me = hz.caller({ userId, email: "adult-before-save-1@test.local" });
    await me.founder.profile.update({ ...answer, confirmAdult: true });
    expect(await repos.founders.get(hz.db, userId)).not.toBeNull();
    expect(await repos.adults.confirmedAt(hz.db, userId)).not.toBeNull();
    expect(await me.founder.profile.get()).toMatchObject({ complete: true, adultConfirmed: true });
  });

  it("a confirmation that cannot be recorded creates no profile", async () => {
    const userId = await hz.h.createUser("adult-before-save-2@test.local");
    const me = hz.caller({ userId, email: "adult-before-save-2@test.local" });
    const confirm = vi.spyOn(repos.adults, "confirm").mockRejectedValueOnce(new Error("database went away"));
    await expect(me.founder.profile.update({ ...answer, confirmAdult: true })).rejects.toThrow();
    expect(await repos.founders.get(hz.db, userId)).toBeNull();
    expect(await repos.adults.confirmedAt(hz.db, userId)).toBeNull();
    confirm.mockRestore();
  });
});
