import { describe, expect, it } from "vitest";
import { postUrlProblem, postedLine } from "./post-published";

describe("postUrlProblem", () => {
  it("takes an https link on the network's own host", () => {
    expect(postUrlProblem("x", "https://x.com/maple/status/123")).toBeNull();
    expect(postUrlProblem("linkedin", "https://linkedin.com/posts/maple-1")).toBeNull();
  });
  it("refuses the wrong host, http, credentials, a long link, a non-address and a network with no window", () => {
    expect(postUrlProblem("x", "https://evil.example/x.com")).toMatch(/must be on X/);
    expect(postUrlProblem("x", "https://x.com.evil.example/a")).toMatch(/must be on X/);
    expect(postUrlProblem("x", "http://x.com/a")).toMatch(/https/);
    expect(postUrlProblem("x", "https://me:pw@x.com/a")).toMatch(/password/);
    expect(postUrlProblem("x", `https://x.com/${"a".repeat(500)}`)).toMatch(/too long/);
    expect(postUrlProblem("x", "not a link")).toMatch(/web address/);
    expect(postUrlProblem(null, "https://x.com/a")).toMatch(/needs a network/);
  });
});

describe("postedLine", () => {
  it("names the network and the day", () => {
    expect(postedLine("x", new Date("2026-11-16T15:00:00Z"))).toBe("Posted on X, Nov 16");
    expect(postedLine(null, new Date("2026-11-16T15:00:00Z"))).toBe("Posted, Nov 16");
  });
});
