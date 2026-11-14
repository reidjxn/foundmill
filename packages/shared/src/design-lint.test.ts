import { describe, expect, it } from "vitest";
import { contrastRatio, lintPageDescription, parseCssColor, type PageDescriptionInput } from "./design-lint";

const clean: PageDescriptionInput = {
  page: "/",
  viewport: "desktop",
  widthPx: 1440,
  scrollWidthPx: 1440,
  elements: [
    { ref: "main > h1", role: "heading", level: 1, text: "Fresh bread, delivered by 8 AM", fontSizePx: 40, fontWeight: 700, color: "rgb(17, 24, 39)", background: "rgb(255, 255, 255)", spacingPx: [24, 16] },
    { ref: "main > p", role: "text", text: "Order by 9 PM and we bake it overnight.", fontSizePx: 16, color: "rgb(55, 65, 81)", background: "rgb(255, 255, 255)", spacingPx: [16] },
    { ref: "main > a", role: "button", text: "Order now", fontSizePx: 16, fontWeight: 600, color: "#ffffff", background: "#1d4ed8", spacingPx: [12, 24], radiusPx: 8, heightPx: 48 },
  ],
};

describe("design lint", () => {
  it("reads rgb, rgba and hex colors and computes WCAG contrast", () => {
    expect(parseCssColor("rgb(255, 0, 0)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseCssColor("rgba(0 0 0 / 50%)")).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseCssColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor("oklch(0.5 0.1 200)")).toBeNull();
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#777777", "#ffffff")!).toBeLessThan(4.5);
    expect(contrastRatio("oklch(0.5 0 0)", "#fff")).toBeNull();
  });

  it("finds nothing measurable on a clean page", () => {
    expect(lintPageDescription(clean)).toEqual([]);
  });

  it("flags low contrast, placeholder text, off-scale spacing and a headline no bigger than the body", () => {
    const findings = lintPageDescription({
      ...clean,
      elements: [
        { ref: "main > h1", role: "heading", level: 1, text: "Welcome", fontSizePx: 16, color: "rgb(17, 24, 39)", background: "#fff", spacingPx: [13] },
        { ref: "main > p", role: "text", text: "Lorem ipsum dolor sit amet", fontSizePx: 16, color: "rgb(170, 170, 170)", background: "rgb(255, 255, 255)", spacingPx: [18, 7] },
      ],
    });
    const principles = findings.map((f) => f.principle);
    expect(principles).toContain("contrast");
    expect(principles).toContain("real_content");
    expect(principles).toContain("spacing");
    expect(principles).toContain("hierarchy");
    expect(findings[0]!.severity).toBe("high");
    expect(findings.find((f) => f.principle === "contrast")!.element).toContain("main > p");
  });

  it("flags sideways scroll and small tap targets only at 390 px", () => {
    const phone = lintPageDescription({ ...clean, viewport: "phone", widthPx: 390, scrollWidthPx: 520, elements: [...clean.elements!, { ref: "nav > a", role: "link", text: "Pricing", fontSizePx: 14, color: "#111", background: "#fff", heightPx: 20, widthPx: 520 }] });
    expect(phone.map((f) => f.principle)).toEqual(expect.arrayContaining(["responsive"]));
    expect(phone.some((f) => /scrolls sideways/.test(f.problem))).toBe(true);
    expect(phone.some((f) => /too small to tap/.test(f.problem))).toBe(true);
    const desktop = lintPageDescription({ ...clean, elements: [...clean.elements!, { ref: "nav > a", role: "link", text: "Pricing", fontSizePx: 14, color: "#111", background: "#fff", heightPx: 20 }] });
    expect(desktop.some((f) => f.principle === "responsive")).toBe(false);
  });

  it("flags too many type sizes, radii and gradient text", () => {
    const sizes = [11, 13, 15, 17, 19, 23, 29].map((s, i) => ({ ref: `p:nth-of-type(${i + 1})`, role: "text" as const, text: `Line ${i}`, fontSizePx: s, color: "#111", background: "#fff", radiusPx: i + 1, gradient: i === 0, gradientText: i === 0 }));
    const findings = lintPageDescription({ ...clean, elements: [clean.elements![0]!, ...sizes] });
    expect(findings.map((f) => f.principle)).toEqual(expect.arrayContaining(["type_scale", "consistency", "color_restraint"]));
  });
});
