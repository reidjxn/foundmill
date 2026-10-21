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
  it("never falls back to an example business, but keeps it when it is the one last opened", () => {
    const withExample = [{ id: "example", isExample: true }, { id: "own", isExample: false }];
    expect(pickCurrentBusiness(null, withExample)).toEqual({ id: "own", isExample: false });
    expect(pickCurrentBusiness("gone", withExample)).toEqual({ id: "own", isExample: false });
    expect(pickCurrentBusiness("example", withExample)).toEqual({ id: "example", isExample: true });
    // Only the example: no current business, so /start sends the founder to /new.
    expect(pickCurrentBusiness(null, [{ id: "example", isExample: true }])).toBeUndefined();
  });
});
