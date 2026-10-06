import { describe, expect, it } from "vitest";
import { alpha, apcaLc, darkenHex, deptColourVar, deptTokenFor, hexToRgb, kitOnPrimary, kitOnPrimaryDetail, ON_KIT_DARK, ON_KIT_LIGHT, rgbToHex, sRGBtoY } from "./colour";

describe("hex parsing", () => {
  it("parses short and long forms", () => {
    expect(hexToRgb("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb("2B6CB0")).toEqual({ r: 43, g: 108, b: 176 });
    expect(rgbToHex({ r: 43, g: 108, b: 176 })).toBe("#2B6CB0");
    expect(() => hexToRgb("#12345")).toThrow();
  });
  it("darkens", () => {
    const d = darkenHex("#2B6CB0", 0.14);
    expect(sRGBtoY(hexToRgb(d))).toBeLessThan(sRGBtoY(hexToRgb("#2B6CB0")));
  });
});

describe("APCA", () => {
  it("matches the reference values of the APCA 0.1.9 formula", () => {
    // Reference pairs from the apca-w3 README (text on background): Lc 106 black on white, Lc -108 white on black.
    expect(apcaLc("#000000", "#ffffff")).toBeCloseTo(106.04, 1);
    expect(apcaLc("#ffffff", "#000000")).toBeCloseTo(-107.88, 1);
    // #888 on #fff ≈ 63.06; #fff on #888 ≈ -68.54 (apca-w3 documented examples)
    expect(apcaLc("#888888", "#ffffff")).toBeCloseTo(63.06, 1);
    expect(apcaLc("#ffffff", "#888888")).toBeCloseTo(-68.54, 1);
    // #aaa on #000 ≈ -56.24; #000 on #aaa ≈ 58.15
    expect(apcaLc("#aaaaaa", "#000000")).toBeCloseTo(-56.24, 1);
    expect(apcaLc("#000000", "#aaaaaa")).toBeCloseTo(58.15, 1);
  });
  it("returns 0 for identical colours", () => {
    expect(apcaLc("#2B6CB0", "#2B6CB0")).toBe(0);
  });
});

describe("kitOnPrimary", () => {
  it("picks white on dark kits and near-black on light kits", () => {
    expect(kitOnPrimary("#2B6CB0")).toBe(ON_KIT_LIGHT);
    expect(kitOnPrimary("#0F1318")).toBe(ON_KIT_LIGHT);
    expect(kitOnPrimary("#F5B841")).toBe(ON_KIT_DARK);
    expect(kitOnPrimary("#FFFFFF")).toBe(ON_KIT_DARK);
  });
  it("reports whether Lc 75 is met and still returns the better candidate", () => {
    expect(kitOnPrimaryDetail("#2B6CB0").passes).toBe(true);
    const mid = kitOnPrimaryDetail("#8A8A8A");
    expect(mid.passes).toBe(false);
    expect([ON_KIT_LIGHT, ON_KIT_DARK]).toContain(mid.colour);
    expect(mid.lc).toBeGreaterThan(0);
  });
});

describe("department helpers", () => {
  it("builds var() references and wraps indices", () => {
    expect(deptColourVar("dept-3")).toBe("var(--dept-3)");
    expect(deptTokenFor(0)).toBe("dept-1");
    expect(deptTokenFor(8)).toBe("dept-1");
    expect(deptTokenFor(9)).toBe("dept-2");
    expect(alpha("--status-good", 12)).toBe("color-mix(in oklab, var(--status-good) 12%, transparent)");
  });
});
