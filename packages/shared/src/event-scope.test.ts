/**
 * Event scope in the shared vocabulary (constants.ts): the account-scoped types are a subset of `EVENT_TYPES`, appended
 * at its end, and every other type is business-scoped. packages/events checks its catalog against this.
 */
import { describe, expect, it } from "vitest";
import { ACCOUNT_EVENT_TYPES, EVENT_SCOPES, EVENT_TYPES, eventScopeOf, isAccountEventType, isPersonAddressedEvent, PERSON_ADDRESSED_EVENT_TYPES, type AccountEventType, type BusinessEventType, type EventType } from "./constants";

type Assert<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export type _TheTwoScopesCoverEveryType = Assert<Equal<AccountEventType | BusinessEventType, EventType>>;
export type _AndNeverOverlap = Assert<Equal<AccountEventType & BusinessEventType, never>>;

describe("event scope", () => {
  it("names two scopes, and files every type under exactly one", () => {
    expect([...EVENT_SCOPES]).toEqual(["business", "account"]);
    for (const type of EVENT_TYPES) expect(eventScopeOf(type), type).toBe((ACCOUNT_EVENT_TYPES as readonly string[]).includes(type) ? "account" : "business");
    expect(EVENT_TYPES.filter((t) => eventScopeOf(t) === "account")).toEqual([...ACCOUNT_EVENT_TYPES]);
    expect(new Set(EVENT_TYPES).size).toBe(EVENT_TYPES.length);
  });

  it("the account-scoped types are the two profile events and the two attribution events, each in the one list", () => {
    expect([...ACCOUNT_EVENT_TYPES]).toEqual(["profile.published", "profile.unpublished", "signup.attributed", "referral.arrived", "founder_notice.sent", "account.admitted", "profile.created", "idea.kept", "idea.drafted"]);
    // Where they sit in the list is not pinned: every team appends its types at the end, of either scope.
    for (const type of ACCOUNT_EVENT_TYPES) expect(EVENT_TYPES as readonly string[]).toContain(type);
  });

  it("isAccountEventType answers for any text, and is a different rule from person-addressed", () => {
    expect(isAccountEventType("profile.published")).toBe(true);
    expect(isAccountEventType("profile.unpublished")).toBe(true);
    // A sign-up a page brought is a fact about the new person, and about the person credited: never a project's.
    expect(isAccountEventType("signup.attributed")).toBe(true);
    expect(isAccountEventType("referral.arrived")).toBe(true);
    expect(isAccountEventType("founder_notice.sent")).toBe(true);
    expect(eventScopeOf("signup.attributed")).toBe("account");
    for (const other of ["page.published", "payment.received", "signup.created", "referral.credited", "profile", "profile.published ", "PROFILE.PUBLISHED", "", null, undefined]) expect(isAccountEventType(other), String(other)).toBe(false);
    // A person-addressed type is a business-scoped type that is never written; an account-scoped type has a store of its own.
    for (const type of PERSON_ADDRESSED_EVENT_TYPES) expect(isAccountEventType(type), type).toBe(false);
    for (const type of ACCOUNT_EVENT_TYPES) expect(isPersonAddressedEvent(type), type).toBe(false);
  });
});
