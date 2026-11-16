import { describe, expect, it } from "vitest";
import { addressKey, COMMON_MAIL_DOMAINS, domainOfKey } from "./address-key";

describe("addressKey (WP-03 T8)", () => {
  it("folds case, a +tag, and Gmail's dots (googlemail.com is gmail.com)", () => {
    expect(addressKey("A.b+x@GMail.com")).toBe("ab@gmail.com");
    expect(addressKey(" a.b@googlemail.com ")).toBe("ab@gmail.com");
    expect(addressKey("a+1@corp.example")).toBe("a@corp.example");
    // Dots matter outside Gmail.
    expect(addressKey("a.b@corp.example")).toBe("a.b@corp.example");
  });

  it("is null for anything that is not an address", () => {
    for (const bad of ["", "nobody", "a@", "@corp.example", "a@b", "a b@corp.example", "a@@corp.example", "+x@corp.example", "...@gmail.com"]) expect(addressKey(bad), bad).toBeNull();
  });

  it("names the domain of a key, and the large mailbox providers", () => {
    expect(domainOfKey("ab@gmail.com")).toBe("gmail.com");
    expect(COMMON_MAIL_DOMAINS.has("gmail.com")).toBe(true);
    expect(COMMON_MAIL_DOMAINS.has("outlook.com")).toBe(true);
    expect(COMMON_MAIL_DOMAINS.has("corp.example")).toBe(false);
    expect(COMMON_MAIL_DOMAINS.size).toBe(15);
  });
});
