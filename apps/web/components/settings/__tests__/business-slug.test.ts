import { describe, expect, it } from "vitest";
import { slugFieldError } from "../BusinessTab";

describe("Settings › Business slug", () => {
  it("shows the API's 'That slug is taken' under the Slug field only while the field still holds the refused slug", () => {
    const taken = { slug: "ledgerly", message: "That slug is taken" };
    expect(slugFieldError("ledgerly", taken)).toBe("That slug is taken");
    expect(slugFieldError("ledgerly-2", taken)).toBeUndefined();
    expect(slugFieldError("ledgerly", null)).toBeUndefined();
  });
});
