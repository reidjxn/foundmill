/**
 * The logo eval's checker, offline: the mock designer's sets pass, and crafted bad sets fail for the right reason (a
 * shield, a star, a ball, a banned word, invalid SVG, the wrong count, duplicates). The live run is logo.eval.test.ts.
 */
import { MockModelClient } from "@foundmill/models";
import { describe, expect, it } from "vitest";
import { checkLogoSet, forbiddenShapes, isShield, isStar, LOGO_BRIEFS, pathVertices, runLogoEval } from "../logo";

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;
const tile = '<rect width="100" height="100" rx="22" fill="#1f6f5f"/>';
const ok = (name: string, body: string) => ({ name, concept: "A simple geometric mark.", svg: svg(tile + body) });
const GOOD = [ok("Orbit", '<circle cx="50" cy="50" r="26" fill="none" stroke="#e8c56b" stroke-width="9"/>'), ok("Bar", '<rect x="20" y="40" width="60" height="20" rx="10" fill="#fff"/>'), ok("Arch", '<path d="M24 80 L24 50 A26 26 0 0 1 76 50 L76 80 Z" fill="#fff"/>'), ok("Fold", '<polygon points="22,30 58,22 58,78 22,70" fill="#fff"/>')];

const star = (cx: number, cy: number, outer: number, inner: number, n = 5) =>
  Array.from({ length: n * 2 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / n - Math.PI / 2;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");

describe("logo eval checker", () => {
  it("passes the mock designer's sets for every brief", async () => {
    const client = new MockModelClient();
    for (const brief of LOGO_BRIEFS) {
      const r = await runLogoEval(brief, client);
      expect(r.error).toBeUndefined();
      expect(r.check.problems, brief.id).toEqual([]);
      expect(r.check).toMatchObject({ passed: true, count: brief.count, distinct: true });
      expect(r.check.marks.every((m) => m.valid && m.removed.length === 0)).toBe(true);
    }
  });

  it("passes a clean hand-made set", () => {
    expect(checkLogoSet({ marks: GOOD }, 4)).toMatchObject({ passed: true, problems: [] });
  });

  it("fails a shield, drawn as a path or as a polygon", () => {
    const pathShield = ok("Guard", '<path d="M20 15 L80 15 L80 50 C80 70 65 82 50 90 C35 82 20 70 20 50 Z" fill="#fff"/>');
    const polyShield = ok("Keep", '<polygon points="20,15 80,15 80,55 50,90 20,55" fill="#fff"/>');
    for (const m of [pathShield, polyShield]) {
      const r = checkLogoSet({ marks: [m, ...GOOD.slice(1)] }, 4);
      expect(r.passed).toBe(false);
      expect(r.problems.join(" ")).toMatch(/shape: shield/);
    }
  });

  it("fails a star and a ball, and banned words in the name or concept", () => {
    const starMark = ok("Spark", `<polygon points="${star(50, 50, 30, 12)}" fill="#fff"/>`);
    expect(checkLogoSet({ marks: [starMark, ...GOOD.slice(1)] }, 4).problems.join(" ")).toMatch(/shape: star/);
    const ball = ok("Round", `<circle cx="50" cy="50" r="35" fill="#fff"/>${[0, 1, 2].map((i) => `<polygon points="${star(30 + i * 20, 50, 6, 6, 5).split(" ").filter((_, k) => k % 2 === 0).join(" ")}" fill="#000"/>`).join("")}`);
    expect(checkLogoSet({ marks: [ball, ...GOOD.slice(1)] }, 4).problems.join(" ")).toMatch(/shape: ball/);
    const worded = { ...GOOD[0]!, concept: "A crest with a laurel." };
    expect(checkLogoSet({ marks: [worded, ...GOOD.slice(1)] }, 4).problems.join(" ")).toMatch(/word: crest/);
  });

  it("fails invalid SVG, too few shapes, the wrong count and duplicates", () => {
    expect(checkLogoSet({ marks: [{ name: "Broken", concept: "x", svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><script>alert(1)</script><g></svg>' }, ...GOOD.slice(1)] }, 4).problems.join(" ")).toMatch(/invalid after sanitising/);
    expect(checkLogoSet({ marks: [{ name: "Bare", concept: "x", svg: svg(tile) }, ...GOOD.slice(1)] }, 4).problems.join(" ")).toMatch(/a tile and a symbol need two/);
    expect(checkLogoSet({ marks: GOOD.slice(0, 3) }, 4).problems).toContain("asked for 4 marks, got 3");
    expect(checkLogoSet({ marks: [GOOD[0]!, GOOD[0]!, GOOD[1]!, GOOD[2]!] }, 4).problems).toContain("two marks are the same");
    expect(checkLogoSet({ nope: true }, 4).passed).toBe(false);
  });

  it("geometry helpers", () => {
    expect(pathVertices("M10 10 l10 0 v10 h-10 z")).toEqual([[10, 10], [20, 10], [20, 20], [10, 20]]);
    expect(isStar(star(50, 50, 30, 12).split(" ").map((p) => p.split(",").map(Number) as [number, number]))).toBe(true);
    // A regular octagon is not a star.
    expect(isStar(star(50, 50, 30, 30, 4).split(" ").map((p) => p.split(",").map(Number) as [number, number]))).toBe(false);
    expect(isShield([[20, 15], [80, 15], [80, 55], [50, 90], [20, 55]])).toBe(true);
    // An arch (flat bottom on both sides) is not.
    expect(isShield([[24, 80], [24, 50], [76, 50], [76, 80]])).toBe(false);
    expect(forbiddenShapes(svg(tile), "Orbit: a ring")).toEqual([]);
  });
});
