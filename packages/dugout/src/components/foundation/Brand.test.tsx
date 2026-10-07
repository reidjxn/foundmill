import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { APP_NAME } from "@foundmill/config";
import { LogoMark } from "./LogoMark";
import { Wordmark, WORDMARK_ASPECT } from "./Wordmark";
import {
  ICON_FRAME,
  MONOGRAM_F_PATH,
  MONOGRAM_HEIGHT,
  MONOGRAM_M_PATH,
  MONOGRAM_WIDTH,
  WORDMARK_HEIGHT,
  WORDMARK_PATH,
  WORDMARK_WIDTH,
  iconSvg,
  iconTransform,
  monogramSvg,
  wordmarkSvg,
} from "../../brand/marks";

// Bounds over every coordinate in the path. Bezier control points may overshoot the drawn outline
// by a few units, so callers compare with a tolerance rather than exact equality.
const bounds = (d: string) => {
  const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

describe("brand path data", () => {
  it("wordmark path fills its declared box", () => {
    const b = bounds(WORDMARK_PATH);
    expect(b.minX).toBeGreaterThan(-30);
    expect(b.minY).toBeGreaterThan(-30);
    expect(Math.abs(b.maxX - WORDMARK_WIDTH)).toBeLessThan(30);
    expect(Math.abs(b.maxY - WORDMARK_HEIGHT)).toBeLessThan(30);
    expect(WORDMARK_PATH).toMatch(/^M/);
    expect(WORDMARK_PATH).toMatch(/Z$/);
    expect(WORDMARK_PATH).not.toContain("NaN");
  });
  it("monogram is the F followed by the M inside its box", () => {
    const f = bounds(MONOGRAM_F_PATH);
    const m = bounds(MONOGRAM_M_PATH);
    expect(f.minX).toBeGreaterThan(-30);
    expect(f.maxX).toBeLessThan(m.minX);
    expect(Math.abs(m.maxX - MONOGRAM_WIDTH)).toBeLessThan(30);
    expect(Math.abs(Math.max(f.maxY, m.maxY) - MONOGRAM_HEIGHT)).toBeLessThan(30);
  });
  it("centres the monogram in the square icon frame", () => {
    const t = iconTransform(ICON_FRAME, 0.1);
    expect(t.x).toBeCloseTo(ICON_FRAME * 0.1, 5);
    expect(t.x + MONOGRAM_WIDTH * t.scale).toBeCloseTo(ICON_FRAME * 0.9, 5);
    const top = t.y;
    const bottom = ICON_FRAME - (t.y + MONOGRAM_HEIGHT * t.scale);
    expect(top).toBeCloseTo(bottom, 5);
  });
});

describe("standalone SVG builders", () => {
  it("wordmark and monogram markup are self-contained SVG documents", () => {
    for (const svg of [wordmarkSvg(), monogramSvg({ fill: "#fff", title: "x" })]) {
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ')).toBe(true);
      expect(svg.endsWith("</svg>")).toBe(true);
      expect(svg).toContain("<path fill=");
    }
    expect(wordmarkSvg()).toContain('aria-hidden="true"');
    expect(monogramSvg({ title: 'a "quoted" <name>' })).toContain('aria-label="a &quot;quoted&quot; &lt;name>"');
  });
  it("icon markup is transparent by default and scheme-aware when asked", () => {
    const plain = iconSvg({ fill: "#000" });
    expect(plain).not.toContain("<rect");
    expect(plain).not.toContain("<style");
    const adaptive = iconSvg({ fill: "#0f1318", darkFill: "#e8ecf1" });
    expect(adaptive).toContain("prefers-color-scheme:dark");
    expect(adaptive).toContain('class="l"');
    const tile = iconSvg({ tile: "#0b0e12", fill: "#e8ecf1" });
    expect(tile).toContain('<rect width="160" height="160" rx="35.2" fill="#0b0e12"/>');
  });
});

describe("<LogoMark>", () => {
  it("is named after the product by default and keeps the letter proportions", () => {
    const { container } = render(<LogoMark size={32} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe(APP_NAME);
    expect(svg.getAttribute("height")).toBe("32");
    expect(Number(svg.getAttribute("width"))).toBe(Math.round((32 * MONOGRAM_WIDTH) / MONOGRAM_HEIGHT));
    expect(svg.querySelectorAll("path")).toHaveLength(2);
  });
  it("is decorative when label is null and two-tone when asked", () => {
    const { container } = render(<LogoMark label={null} tone="duo" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBeNull();
    const [f, m] = Array.from(svg.querySelectorAll("path")) as [SVGPathElement, SVGPathElement];
    expect(f.getAttribute("fill")).toBe("currentColor");
    expect(m.getAttribute("fill")).toContain("--kit-primary");
  });
  it("tile variant is square on an ink tile with light letters", () => {
    const { container } = render(<LogoMark size={48} variant="tile" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("48");
    expect(svg.getAttribute("height")).toBe("48");
    expect(svg.querySelector("rect")?.getAttribute("fill")).toBe("var(--bg-ink)");
    expect(svg.querySelector("path")?.getAttribute("fill")).toBe("var(--text-primary)");
  });
});

describe("<Wordmark>", () => {
  it("scales from its cap height and uses currentColor", () => {
    const { container } = render(<Wordmark height={20} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("height")).toBe("20");
    expect(svg.getAttribute("width")).toBe(String(Math.round(20 * WORDMARK_ASPECT)));
    expect(svg.getAttribute("aria-label")).toBe(APP_NAME);
    expect(svg.querySelector("path")?.getAttribute("fill")).toBe("currentColor");
  });
});
