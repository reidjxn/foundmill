import { describe, expect, it } from "vitest";
import { admittedBy, parseSignupAllowlist } from "./allowlist";

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
