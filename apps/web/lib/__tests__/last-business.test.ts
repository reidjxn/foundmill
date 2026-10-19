import { afterEach, describe, expect, it } from "vitest";
import { rememberLastBusiness } from "../auth/last-business";

const ID = "b1e5e5e5-0000-4000-8000-000000000002";

afterEach(() => {
  // A date in the past, not `max-age=0`: happy-dom keeps a cookie that expires this very millisecond, so on a fast
  // runner the next test could still see "fm_last_business=".
  document.cookie = "fm_last_business=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
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
