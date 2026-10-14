/**
 * Settings › Members (WEB-12, MLSL-40): a co-founder is added by the account ID on their profile or by the email they
 * sign in with.
 */
import { describe, expect, it } from "vitest";
import { inviteTarget, memberLabel, shortId } from "../MembersTab";

const ID = "5a1e0000-0000-4000-8000-00000000fe01";

describe("inviteTarget (WEB-12)", () => {
  it("sends the account ID when one is typed, else the sign-in email", () => {
    expect(inviteTarget(ID, "")).toEqual({ userId: ID });
    expect(inviteTarget(` ${ID} `, "ada@northwind.example")).toEqual({ userId: ID, email: "ada@northwind.example" });
    expect(inviteTarget("", " ada@northwind.example ")).toEqual({ email: "ada@northwind.example" });
  });
  it("is null while neither is valid", () => {
    expect(inviteTarget("", "")).toBeNull();
    expect(inviteTarget("not-an-id", "ada@northwind.example")).toBeNull();
    expect(inviteTarget("", "ada@")).toBeNull();
  });
  it("shortens a long id for one line", () => {
    expect(shortId(ID)).toBe("5a1e0000…fe01");
  });
});

describe("memberLabel (MLSL-40)", () => {
  it("names the person the remove dialog asks about: their name or email, else their role and short account", () => {
    expect(memberLabel({ userId: ID, role: "admin", displayName: "Ada Lovelace", email: "ada@northwind.example" })).toBe("Ada Lovelace");
    expect(memberLabel({ userId: ID, role: "admin", email: "ada@northwind.example" })).toBe("ada@northwind.example");
    expect(memberLabel({ userId: ID, role: "admin" })).toBe("the admin with account 5a1e0000…fe01");
  });
});
