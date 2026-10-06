import { describe, expect, it } from "vitest";
import { crestPlan, generateCrest } from "./Crest";

const spec = { seed: "northwind", kitPrimary: "#2B6CB0", kitSecondary: "#FFFFFF", monogram: "NW" };

describe("generateCrest", () => {
  it("is deterministic for the same input", () => {
    expect(generateCrest(spec)).toBe(generateCrest({ ...spec }));
  });
  it("changes with the seed", () => {
    const a = generateCrest(spec);
    const b = generateCrest({ ...spec, seed: "ledgerly" });
    expect(a).not.toBe(b);
  });
  it("uses the kit colours, the monogram and the computed on-primary text colour", () => {
    const svg = generateCrest({ ...spec, kitPrimary: "#F5B841" });
    expect(svg).toContain('fill="#F5B841"');
    expect(svg).toContain(">NW</text>");
    expect(svg).toContain('fill="#0F1318">NW');
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 96 96" width="48" height="48"/);
  });
  it("cuts the monogram to two upper-case letters and escapes markup", () => {
    expect(generateCrest({ ...spec, monogram: "northwind" })).toContain(">NO</text>");
    expect(generateCrest({ ...spec, monogram: "<&" })).toContain(">&lt;&amp;</text>");
  });
  it("covers all four shapes across seeds", () => {
    const shapes = new Set(Array.from({ length: 60 }, (_, i) => crestPlan(`seed-${i}`).shape));
    expect(shapes.size).toBe(4);
  });
  it("supports fluid sizing", () => {
    expect(generateCrest({ ...spec, fluid: true })).not.toContain('width="48"');
  });
});
