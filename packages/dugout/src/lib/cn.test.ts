import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("joins and drops falsy values", () => {
    const hidden = [false, undefined, null] as const;
    expect(cn("a", hidden[0] && "b", hidden[1], hidden[2], "c")).toBe("a c");
  });
  it("lets the last conflicting Tailwind utility win", () => {
    expect(cn("px-2 py-1", "px-3")).toBe("py-1 px-3");
    expect(cn("text-primary", "text-secondary")).toBe("text-secondary");
    expect(cn("bg-panel", "bg-panel-alt")).toBe("bg-panel-alt");
  });
  it("keeps unrelated custom utilities", () => {
    expect(cn("t-label", "t-body")).toBe("t-label t-body");
  });
  it("accepts objects and arrays", () => {
    expect(cn(["a", { b: true, c: false }])).toBe("a b");
  });
});
