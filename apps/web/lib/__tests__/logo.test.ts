import { describe, expect, it } from "vitest";
import { checkLogoFile, dataUrlBytes, formatCostEstimate, kitFromColours, LogoFileError } from "../logo";

describe("lib/logo", () => {
  it("measures the bytes a base64 data URL carries", () => {
    expect(dataUrlBytes(`data:image/png;base64,${btoa("abc")}`)).toBe(3);
    expect(dataUrlBytes(`data:image/png;base64,${btoa("abcd")}`)).toBe(4);
    expect(dataUrlBytes(`data:image/png;base64,${btoa("abcde")}`)).toBe(5);
  });

  it("accepts PNG, JPEG, WebP and SVG up to 2 MB, and nothing else", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp", "image/svg+xml"]) expect(() => checkLogoFile(new File(["x"], "f", { type }))).not.toThrow();
    expect(() => checkLogoFile(new File(["<svg/>"], "mark.svg", { type: "" }))).not.toThrow();
    expect(() => checkLogoFile(new File(["x"], "f.gif", { type: "image/gif" }))).toThrow(LogoFileError);
    expect(() => checkLogoFile(new File(["x"], "f.html", { type: "text/html" }))).toThrow(/PNG, JPEG, WebP or SVG/);
    expect(() => checkLogoFile(new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.png", { type: "image/png" }))).toThrow(/2 MB/);
    expect(() => checkLogoFile(new File([], "empty.png", { type: "image/png" }))).toThrow(/empty/);
  });

  it("suggests two brand colours from a logo's colours in order of use, ignoring black, white and greys", () => {
    expect(kitFromColours(["#1f6f5f", "#e8c56b"])).toEqual({ primary: "#1f6f5f", secondary: "#e8c56b" });
    expect(kitFromColours(["#ffffff", "#0f1318", "#2b6cb0", "#f5b841"])).toEqual({ primary: "#2b6cb0", secondary: "#f5b841" });
    expect(kitFromColours(["#ffffff", "#000000", "#808080"])).toBeNull();
    expect(kitFromColours([])).toBeNull();
    // One colour: a partner is derived.
    const one = kitFromColours(["#7a3b8f"]);
    expect(one?.primary).toBe("#7a3b8f");
    expect(one?.secondary).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("formats a cost Estimate in US dollars", () => {
    expect(formatCostEstimate({ amountMinor: 7, currency: "USD" })).toBe("US$0.07");
    expect(formatCostEstimate({ amountMinor: 0.3, currency: "USD" })).toBe("under US$0.01");
    expect(formatCostEstimate({ amountMinor: 125, currency: "USD" })).toBe("US$1.25");
  });
});
