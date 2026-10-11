/**
 * Mock logo designer: deterministic, decent geometric marks so the Commit screen, Settings › Business and Playwright
 * work without a key. Reads the brief the api sends (`business_name`, `pitch`, `archetype`, `brand_colours`, `count`,
 * `round`) and draws `count` marks from eight families (a dot-matrix initial, an orbit, stacked bars, a fold, an arch,
 * a split disc, waves, a corner composition), chosen by the input hash so "Generate again" (a new `round`) gives a
 * different set. A brief with a `direction` (the api's single-mark calls) draws one mark from that direction's
 * families (`MOCK_LOGO_DIRECTION_FAMILIES`). Every mark sits on a background tile in a 100 × 100 viewBox and uses the brand colours plus one
 * neutral; none is a shield, badge, star or ball. The output already passes the api's sanitiser unchanged.
 */
import type { LogoDesignOutput, LogoMarkDraft } from "../schemas";
import type { Rng } from "../hash";
import type { MockContext } from "./inputs";

const HEX = /^#[0-9a-fA-F]{6}$/;
const INK = "#0f1318";
const PAPER = "#f6f4ef";

type Rgb = [number, number, number];
const toRgb = (hex: string): Rgb => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const toHex = (c: Rgb) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
const mix = (a: string, b: string, t: number) => {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
};
function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** White or ink, whichever reads on `bg`. */
const on = (bg: string) => (luminance(bg) > 0.42 ? INK : "#ffffff");

/** 5 × 5 capitals for the dot-matrix family. */
const GLYPHS: Record<string, string[]> = {
  A: [".###.", "#...#", "#####", "#...#", "#...#"],
  B: ["####.", "#...#", "####.", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "####.", "#....", "#####"],
  F: ["#####", "#....", "####.", "#....", "#...."],
  G: [".####", "#....", "#..##", "#...#", ".###."],
  H: ["#...#", "#...#", "#####", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "#####"],
  J: ["#####", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "###..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "####.", "#....", "#...."],
  Q: [".###.", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "####.", "#..#.", "#...#"],
  S: [".####", "#....", ".###.", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
  Y: ["#...#", ".#.#.", "..#..", "..#..", "..#.."],
  Z: ["#####", "...#.", "..#..", ".#...", "#####"],
};

interface Palette {
  primary: string;
  secondary: string;
  onPrimary: string;
}

interface Family {
  key: string;
  name: string;
  concept: (name: string) => string;
  draw: (p: Palette, rng: Rng, initial: string) => string;
}

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;
const tile = (fill: string, rx = 22) => `<rect width="100" height="100" rx="${rx}" fill="${fill}"/>`;
const r1 = (n: number) => Math.round(n * 10) / 10;

const FAMILIES: Family[] = [
  {
    key: "matrix",
    name: "Dot matrix",
    concept: (n) => `The first letter of ${n} set in a five-by-five grid of rounded cells, one cell lifted in the second color.`,
    draw: (p, rng, initial) => {
      const rows = GLYPHS[initial] ?? GLYPHS.O!;
      const cells: string[] = [];
      const lit: [number, number][] = [];
      rows.forEach((row, y) => [...row].forEach((c, x) => c === "#" && lit.push([x, y])));
      const accent = lit[rng.int(0, lit.length - 1)]!;
      for (const [x, y] of lit) {
        const fill = x === accent[0] && y === accent[1] ? p.secondary : p.onPrimary;
        cells.push(`<rect x="${20 + x * 12.4}" y="${20 + y * 12.4}" width="10" height="10" rx="2.5" fill="${fill}"/>`);
      }
      return svg(tile(p.primary) + cells.join(""));
    },
  },
  {
    key: "orbit",
    name: "Orbit",
    concept: (n) => `A ring with one point traveling on it: ${n} keeping something moving in a steady loop.`,
    draw: (p, rng) => {
      const angle = (rng.int(20, 70) * Math.PI) / 180;
      const cx = 50 + 26 * Math.cos(-angle);
      const cy = 50 + 26 * Math.sin(-angle);
      return svg(tile(INK) + `<circle cx="50" cy="50" r="26" fill="none" stroke="${p.primary}" stroke-width="9"/>` + `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="9" fill="${p.secondary}" stroke="${INK}" stroke-width="3"/>`);
    },
  },
  {
    key: "stack",
    name: "Stack",
    concept: (n) => `Three bars stacked like layers of work, the middle one in the accent color: ${n} building in steps.`,
    draw: (p, rng) => {
      const widths = rng.shuffle([60, 46, 34]);
      const centred = rng.chance(0.5);
      const bar = (y: number, w: number, fill: string) => `<rect x="${centred ? 50 - w / 2 : 20}" y="${y}" width="${w}" height="13" rx="6.5" fill="${fill}"/>`;
      return svg(tile(PAPER) + bar(25, widths[0]!, p.primary) + bar(43.5, widths[1]!, p.secondary) + bar(62, widths[2]!, p.primary));
    },
  },
  {
    key: "fold",
    name: "Fold",
    concept: (n) => `Two overlapping panels folded at an angle, like a page turning: ${n} opening something up.`,
    draw: (p) => svg(tile(p.primary) + `<polygon points="22,30 58,22 58,78 22,70" fill="${p.onPrimary}" fill-opacity="0.92"/>` + `<polygon points="42,22 78,30 78,70 42,78" fill="${p.secondary}" fill-opacity="0.9"/>`),
  },
  {
    key: "arch",
    name: "Arch",
    concept: (n) => `An open arch with a smaller one inside: a doorway, ${n} as the way in.`,
    draw: (p) => {
      const light = mix(p.secondary, "#ffffff", 0.82);
      return svg(tile(light) + `<path d="M24 80 L24 50 A26 26 0 0 1 76 50 L76 80 Z" fill="${p.primary}"/>` + `<path d="M38 81 L38 52 A12 12 0 0 1 62 52 L62 81 Z" fill="${light}"/>`);
    },
  },
  {
    key: "split",
    name: "Split disc",
    concept: (n) => `A disc cut in two and offset, the halves in both brand colors: ${n} bringing two sides together.`,
    draw: (p) => svg(tile(INK) + `<path d="M47 22 A28 28 0 0 0 47 78 Z" fill="${p.primary}"/>` + `<path d="M53 22 A28 28 0 0 1 53 78 Z" fill="${p.secondary}" transform="translate(0 6)"/>`),
  },
  {
    key: "wave",
    name: "Signal",
    concept: (n) => `Two parallel waves, one in each color: a clear signal from ${n}.`,
    draw: (p) => svg(tile(p.primary) + `<path d="M18 42 C30 28 42 28 50 42 S70 56 82 42" fill="none" stroke="${p.onPrimary}" stroke-width="8" stroke-linecap="round"/>` + `<path d="M18 62 C30 48 42 48 50 62 S70 76 82 62" fill="none" stroke="${p.secondary}" stroke-width="8" stroke-linecap="round"/>`),
  },
  {
    key: "corner",
    name: "Corner",
    concept: (n) => `A quarter circle meeting a square at one corner: a compact geometric mark for ${n}.`,
    draw: (p, rng) => {
      const flip = rng.chance(0.5);
      const quarter = flip ? `<path d="M78 22 L78 70 A48 48 0 0 1 30 22 Z" fill="${p.primary}"/>` : `<path d="M22 22 L70 22 A48 48 0 0 1 22 70 Z" fill="${p.primary}"/>`;
      const square = flip ? `<rect x="22" y="56" width="22" height="22" rx="3" fill="${p.secondary}"/>` : `<rect x="56" y="56" width="22" height="22" rx="3" fill="${p.secondary}"/>`;
      return svg(tile(PAPER) + quarter + square);
    },
  },
];

export const MOCK_LOGO_FAMILIES = FAMILIES.map((f) => f.key);

/**
 * The families each direction of a single-mark call draws from (packages/agents `LOGO_DIRECTIONS`: the api draws a set as
 * four parallel calls, one per direction). Disjoint, so the four marks of a set always differ.
 */
export const MOCK_LOGO_DIRECTION_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  monogram: ["matrix"],
  geometric: ["orbit", "corner"],
  negative_space: ["arch", "split"],
  abstract: ["wave", "fold", "stack"],
};

function initialOf(name: string): string {
  const letter = name
    .normalize("NFKD")
    .toUpperCase()
    .match(/[A-Z]/)?.[0];
  return letter ?? "O";
}

export function generateLogoDesigner(ctx: MockContext): LogoDesignOutput {
  const name = (ctx.getString("business_name", "name", "businessName") ?? "Your business").trim() || "Your business";
  const colours = ctx.getRecord("brand_colours", "brandColours", "kit") ?? {};
  const primary = typeof colours.primary === "string" && HEX.test(colours.primary) ? colours.primary.toLowerCase() : "#1b4fd8";
  const secondaryRaw = typeof colours.secondary === "string" && HEX.test(colours.secondary) ? colours.secondary.toLowerCase() : "#f5c400";
  // Two colours too close to read as two: lift the second towards white so the marks keep their contrast.
  const secondary = Math.abs(luminance(primary) - luminance(secondaryRaw)) < 0.08 ? mix(secondaryRaw, "#ffffff", 0.55) : secondaryRaw;
  const palette: Palette = { primary, secondary, onPrimary: on(primary) };
  const direction = ctx.getString("direction");
  const directed = direction ? MOCK_LOGO_DIRECTION_FAMILIES[direction] : undefined;
  // A single-mark call in a direction draws one mark from that direction's families; a set call samples any families.
  const count = directed ? 1 : Math.max(1, Math.min(8, Math.round(ctx.getNumber("count", "marks", "options") ?? 4)));
  const families = directed ? [ctx.rng.pick(FAMILIES.filter((f) => directed.includes(f.key)))] : ctx.rng.sample(FAMILIES, count);
  const initial = initialOf(name);
  const marks: LogoMarkDraft[] = families.map((f) => ({ name: f.name, concept: f.concept(name), svg: f.draw(palette, ctx.rng, initial) }));
  return { marks };
}
