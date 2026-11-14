import { describe, expect, it } from "vitest";
import { admittedBy, liveChannelAdmit, parseSignupAllowlist, signupMode } from "./allowlist";

const DEV = "00000000-0000-4000-8000-0000000000de";

describe("one invite list for apps/api, apps/stream and apps/collab", () => {
  it("admits everyone without a list, the dev bypass user always, and otherwise only listed addresses and domains", () => {
    expect(admittedBy(null, { userId: "u", email: null })).toBe(true);
    const list = parseSignupAllowlist("founder@example.com, @team.example");
    expect(admittedBy(list, { userId: "u", email: "Founder@Example.com" })).toBe(true);
    expect(admittedBy(list, { userId: "u", email: "anyone@team.example" })).toBe(true);
    expect(admittedBy(list, { userId: "u", email: "someone@else.example" })).toBe(false);
    expect(admittedBy(list, { userId: "u", email: null })).toBe(false);
    expect(admittedBy(list, { userId: DEV.toUpperCase(), email: null }, DEV)).toBe(true);
    expect(admittedBy(list, { userId: "u", email: null }, DEV)).toBe(false);
  });
});

describe("signupMode and the live channels' check (THESIS_REVIEW 2.2)", () => {
  it("is decided by configuration alone", () => {
    expect(signupMode({})).toBe("unrestricted");
    expect(signupMode({ SIGNUP_ALLOWLIST: " , " })).toBe("unrestricted");
    expect(signupMode({ SIGNUP_ALLOWLIST: "a@example.com" })).toBe("invite_only");
    expect(signupMode({ SIGNUP_ALLOWLIST: "a@example.com", SIGNUP_OPEN: "1" })).toBe("open");
    expect(signupMode({ SIGNUP_OPEN: "on" })).toBe("open");
    expect(signupMode({ SIGNUP_OPEN: "off", SIGNUP_ALLOWLIST: "a@example.com" })).toBe("invite_only");
  });

  it("admits the list and the bypass without a lookup, an admitted account by its record, and refuses when the lookup fails", async () => {
    const asked: string[] = [];
    const admitted = new Set(["in"]);
    const lookup = async (id: string) => (asked.push(id), admitted.has(id));
    expect(await liveChannelAdmit({}, null, lookup)({ userId: "anyone", email: null })).toBe(true);
    const check = liveChannelAdmit({ SIGNUP_ALLOWLIST: "listed@example.com" }, DEV, lookup);
    expect(await check({ userId: "x", email: "Listed@Example.com" })).toBe(true);
    expect(await check({ userId: DEV, email: null })).toBe(true);
    expect(asked).toEqual([]);
    expect(await check({ userId: "in", email: "other@example.com" })).toBe(true);
    expect(await check({ userId: "out", email: "other@example.com" })).toBe(false);
    expect(await liveChannelAdmit({ SIGNUP_OPEN: "1" }, null, () => Promise.reject(new Error("db down")))({ userId: "in", email: null })).toBe(false);
  });
});
