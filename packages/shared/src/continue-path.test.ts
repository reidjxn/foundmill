import { describe, expect, it } from "vitest";
import { CONTINUE_PATH_MAX, isContinuePath } from "./continue-path";

const ID = "11111111-1111-4111-8111-111111111111";

describe("the paths a 'continue on a computer' link may carry (WP-03 T3)", () => {
  it("accepts a project's pages, the studio, onboarding and home", () => {
    for (const p of [`/b/${ID}/product/page`, `/b/${ID}`, `/b/${ID}/d/finance/wage-bill`, `/new/commit/${ID}`, "/new", "/new/ideate", "/onboarding", "/home"]) expect(isContinuePath(p), p).toBe(true);
  });

  it("refuses another host, a query or hash, sign-in, the auth callback, an unknown route and an overlong path", () => {
    for (const p of ["//evil.example", "/b/x?next=", `/b/${ID}?next=/x`, `/b/${ID}#x`, "/login", "/auth/callback", "/settings", "", "https://evil.example/home", "/home/", `/b/${ID}/a/b/c/d/e`, "/b/not-a-uuid/today"]) expect(isContinuePath(p), p).toBe(false);
    const long = `/b/${ID}/${"a".repeat(CONTINUE_PATH_MAX - 39)}`;
    expect(long.length).toBe(CONTINUE_PATH_MAX + 1);
    expect(isContinuePath(long)).toBe(false);
    expect(isContinuePath(long.slice(0, CONTINUE_PATH_MAX))).toBe(true);
  });
});
