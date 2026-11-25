/** The source bucket of a page or Site visit (founder, Nov 25, 2026): a post's code, a Foundmill link, UTM tags, the referrer. */
import { describe, expect, it } from "vitest";
import { pageVisitSource } from "../page-visit-source";

const APP = "https://app.example.com";

describe("pageVisitSource", () => {
  it.each([
    [{ via: "s.k3m7qa2xpw" }, "post"],
    [{ via: "p.maple-bakes" }, "foundmill"],
    [{ referrer: `${APP}/home` }, "foundmill"],
    [{ referrer: "https://www.google.com/" }, "search"],
    [{ referrer: "https://chatgpt.com/" }, "ai"],
    [{ referrer: "https://www.instagram.com/" }, "social"],
    [{ search: "?utm_source=newsletter&utm_medium=email" }, "email"],
    [{ search: "?utm_medium=cpc" }, "paid"],
    [{ referrer: "https://someblog.example/" }, "referral"],
    [{}, "direct"],
    [{ referrer: "not a url" }, "direct"],
  ])("%j is %s", (input, source) => {
    expect(pageVisitSource(input, APP)).toBe(source);
  });
});
