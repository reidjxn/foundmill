import { describe, expect, it } from "vitest";
import { alpha, apcaLc, contrastRatio, darkenHex, deptColourVar, deptTokenFor, hexToOklch, hexToRgb, kitOnPrimary, kitOnPrimaryDetail, kitRamp, oklchToHex, ON_KIT_DARK, ON_KIT_LIGHT, relativeLuminance, rgbToHex, sRGBtoY } from "./colour";

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

describe("WCAG contrast", () => {
  it("matches the reference values", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#767676", "#FFFFFF")).toBeCloseTo(4.54, 2);
    expect(contrastRatio("#2B6CB0", "#2B6CB0")).toBe(1);
  });
});

describe("OKLCH", () => {
  it("converts known colours", () => {
    const white = hexToOklch("#FFFFFF");
    expect(white.l).toBeCloseTo(1, 3);
    expect(white.c).toBeLessThan(1e-3);
    const steel = hexToOklch("#3F7FE0");
    expect(steel.l).toBeCloseTo(0.604, 2);
    expect(steel.c).toBeCloseTo(0.162, 2);
    expect(steel.h).toBeCloseTo(258.6, 0);
  });
  it("round-trips sRGB colours", () => {
    for (const c of ["#2E7D6B", "#3F7FE0", "#F5B841", "#08090C", "#EDF0F4", "#FF0000", "#00FF00", "#0000FF", "#808080"]) {
      expect(oklchToHex(hexToOklch(c))).toBe(c);
    }
  });
  it("maps out-of-gamut colours into sRGB by reducing chroma, keeping lightness and hue", () => {
    const out = oklchToHex({ l: 0.8, c: 0.4, h: 260 });
    expect(out).toMatch(/^#[0-9A-F]{6}$/);
    const back = hexToOklch(out);
    expect(back.l).toBeCloseTo(0.8, 2);
    expect(Math.abs(back.h - 260)).toBeLessThan(2);
    expect(back.c).toBeLessThan(0.4);
  });
});

describe("kitRamp: the brand ramp derived from the primary (DIRECTION #11)", () => {
  const CANVAS = "#08090C";
  it("derives Northwind's ramp close to the art direction's hand-picked teal", () => {
    const r = kitRamp("#2E7D6B");
    expect(r).toEqual({ lift: "#6FCFB7", hi: "#51B29B", lo: "#1C594B", deep: "#153A32", aura: "#02A388" });
    for (const v of Object.values(r)) expect(Math.abs(hexToOklch(v).h - hexToOklch("#2E7D6B").h)).toBeLessThan(6);
  });
  it("orders the stops by lightness: deep < lo < primary-ish < hi < lift", () => {
    for (const p of ["#2E7D6B", "#3F7FE0", "#1A237E", "#E63946", "#7B2CBF", "#808080"]) {
      const r = kitRamp(p);
      const L = (h: string) => hexToOklch(h).l;
      expect(L(r.deep)).toBeLessThan(L(r.lo));
      expect(L(r.lo)).toBeLessThan(L(r.hi));
      expect(L(r.hi)).toBeLessThan(L(r.lift));
    }
  });
  it("lights any brand colour: the lift always reads on the canvas (>= 7 : 1), even for navy, black or a pale brand", () => {
    for (const p of ["#2E7D6B", "#3F7FE0", "#1A237E", "#000000", "#FFFFFF", "#F5E050", "#E63946", "#7B2CBF", "#4A4A4A"]) {
      expect(contrastRatio(kitRamp(p).lift, CANVAS), p).toBeGreaterThanOrEqual(7);
    }
  });
  it("keeps a grey brand grey", () => {
    const r = kitRamp("#808080");
    for (const v of Object.values(r)) expect(hexToOklch(v).c).toBeLessThan(0.01);
  });
  it("is deterministic and pure", () => {
    expect(kitRamp("#2B6CB0")).toEqual(kitRamp("#2b6cb0"));
  });
});
