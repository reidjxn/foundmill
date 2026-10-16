import { afterEach, describe, expect, it } from "vitest";
import { rememberLastBusiness } from "../auth/last-business";

const ID = "b1e5e5e5-0000-4000-8000-000000000002";

afterEach(() => {
  document.cookie = "fm_last_business=; path=/; max-age=0";
});

describe("rememberLastBusiness", () => {
  it("writes the last-business cookie for a business id", () => {
    rememberLastBusiness(ID);
    expect(document.cookie).toContain(`fm_last_business=${ID}`);
  });
  it("ignores anything that is not a business id", () => {
    rememberLastBusiness("not-a-uuid; path=/evil");
    expect(document.cookie).not.toContain("fm_last_business");
  });
});
