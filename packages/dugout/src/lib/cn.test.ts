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
    expect(cn("t-label", "text-primary")).toBe("t-label text-primary");
  });
  it("accepts objects and arrays", () => {
    expect(cn(["a", { b: true, c: false }])).toBe("a b");
  });
});

describe("cn knows the design tokens (DIRECTION #17)", () => {
  it("keeps a token font size beside a token text colour", () => {
    expect(cn("text-body text-secondary")).toBe("text-body text-secondary");
    expect(cn("text-small", "text-tertiary")).toBe("text-small text-tertiary");
    expect(cn("text-secondary", "text-reading")).toBe("text-secondary text-reading");
    expect(cn("text-display-lg text-kit-lift")).toBe("text-display-lg text-kit-lift");
  });
  it("lets a later font size replace an earlier one, and a later colour replace an earlier one", () => {
    expect(cn("text-body text-secondary", "text-small")).toBe("text-secondary text-small");
    expect(cn("text-mono text-primary", "text-secondary")).toBe("text-mono text-secondary");
    expect(cn("text-display-md", "text-display-sm")).toBe("text-display-sm");
  });
  it("resolves token heights and widths against plain ones", () => {
    expect(cn("h-row-compact h-auto")).toBe("h-auto");
    expect(cn("h-control-md", "h-control-sm")).toBe("h-control-sm");
    expect(cn("h-8", "h-control-lg")).toBe("h-control-lg");
    expect(cn("w-80", "w-sidebar")).toBe("w-sidebar");
    expect(cn("p-panel-pad", "p-0")).toBe("p-0");
    expect(cn("max-w-reading", "max-w-none")).toBe("max-w-none");
    expect(cn("size-badge", "size-4")).toBe("size-4");
    // The 24 px target token: a later `size-target` replaces a button's own width and height (DataTable's row "…").
    expect(cn("h-control-sm w-control-sm", "size-target")).toBe("size-target");
    expect(cn("size-target", "size-6")).toBe("size-6");
  });
  it("resolves token radii", () => {
    expect(cn("rounded-panel", "rounded-md")).toBe("rounded-md");
    expect(cn("rounded-chip rounded-pill")).toBe("rounded-pill");
    expect(cn("rounded-full", "rounded-sm")).toBe("rounded-sm");
  });
  it("treats elevation and glow tokens as shadows, not shadow colours", () => {
    expect(cn("shadow-overlay", "shadow-elev-3")).toBe("shadow-elev-3");
    expect(cn("shadow-elev-1", "shadow-none")).toBe("shadow-none");
    expect(cn("shadow-glow-good shadow-status-bad/40")).toBe("shadow-glow-good shadow-status-bad/40");
    expect(cn("inset-shadow-rim", "inset-shadow-none")).toBe("inset-shadow-none");
  });
  it("resolves animations, easings, durations and tracking", () => {
    expect(cn("animate-shimmer", "animate-none")).toBe("animate-none");
    expect(cn("animate-breathe animate-ring-pulse")).toBe("animate-ring-pulse");
    expect(cn("ease-dugout", "ease-spring")).toBe("ease-spring");
    expect(cn("duration-micro", "duration-slide")).toBe("duration-slide");
    expect(cn("duration-hover", "duration-200")).toBe("duration-200");
    expect(cn("tracking-label", "tracking-data")).toBe("tracking-data");
  });
});

describe("cn knows the control tokens (controls.css)", () => {
  it("resolves the px padding, size, radius and type tokens against Tailwind's own", () => {
    expect(cn("px-btn-md", "px-1")).toBe("px-1");
    expect(cn("h-control-md", "h-field-lg")).toBe("h-field-lg");
    expect(cn("size-check", "size-4")).toBe("size-4");
    expect(cn("rounded-sm", "rounded-track")).toBe("rounded-track");
    expect(cn("rounded-track", "rounded-gen")).toBe("rounded-gen");
    expect(cn("text-body", "text-money")).toBe("text-money");
    expect(cn("text-money", "text-primary")).toBe("text-money text-primary");
  });
});
