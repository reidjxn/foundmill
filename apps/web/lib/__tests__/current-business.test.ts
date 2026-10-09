import { describe, expect, it } from "vitest";
import { pickCurrentBusiness } from "../auth/current-business";

const businesses = [{ id: "newest" }, { id: "middle" }, { id: "oldest" }];

describe("pickCurrentBusiness", () => {
  it("prefers the business the founder last opened", () => {
    expect(pickCurrentBusiness("middle", businesses)).toEqual({ id: "middle" });
  });
  it("falls back to the newest business when nothing is remembered or the remembered one is gone", () => {
    expect(pickCurrentBusiness(null, businesses)).toEqual({ id: "newest" });
    expect(pickCurrentBusiness(undefined, businesses)).toEqual({ id: "newest" });
    expect(pickCurrentBusiness("archived-long-ago", businesses)).toEqual({ id: "newest" });
  });
  it("is undefined for a founder with no business", () => {
    expect(pickCurrentBusiness("anything", [])).toBeUndefined();
  });
});
