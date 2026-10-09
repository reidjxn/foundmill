/**
 * Colour maths for Dugout. No colour literals here except the two `kit-on-primary` candidates,
 * which mirror `--on-kit-light` / `--on-kit-dark` in tokens.css (a JS function cannot read CSS at compute time).
 */
import type { DeptColourToken } from "@foundmill/shared";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}
export interface Hsl {
  h: number;
  s: number;
  l: number;
}

/** Parse #rgb, #rrggbb or #rrggbbaa (alpha ignored). Throws on anything else. */
export function hexToRgb(hex: string): Rgb {
  const h = hex.trim().replace(/^#/, "");
  const m = h.length === 3 ? h.split("").map((c) => c + c) : h.length === 6 || h.length === 8 ? [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)] : null;
  if (!m || m.some((p) => !/^[0-9a-fA-F]{2}$/.test(p))) throw new Error(`Invalid hex colour: ${hex}`);
  const [r, g, b] = m.map((p) => parseInt(p, 16)) as [number, number, number];
  return { r, g, b };
}

export function isHexColour(value: string): boolean {
  return /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value.trim());
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((c) => clamp255(c).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hh = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  const [rp, gp, bp]: [number, number, number] =
    hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (rp + m) * 255, g: (gp + m) * 255, b: (bp + m) * 255 };
}

/** Darken by a fraction of lightness (0.14 = "darkened 14 %", used by the kit bar gradient). */
export function darkenHex(hex: string, amount: number): string {
  const hsl = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb({ ...hsl, l: Math.max(0, hsl.l * (1 - amount)) }));
}

export function lightenHex(hex: string, amount: number): string {
  const hsl = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb({ ...hsl, l: Math.min(1, hsl.l + (1 - hsl.l) * amount) }));
}

/** Rotate hue by degrees and optionally scale saturation/lightness. */
export function shiftHex(hex: string, opts: { hue?: number; saturation?: number; lightness?: number }): string {
  const hsl = rgbToHsl(hexToRgb(hex));
  return rgbToHex(
    hslToRgb({
      h: hsl.h + (opts.hue ?? 0),
      s: Math.min(1, Math.max(0, hsl.s * (opts.saturation ?? 1))),
      l: Math.min(1, Math.max(0, hsl.l * (opts.lightness ?? 1))),
    }),
  );
}

/* ---------- APCA (Accessible Perceptual Contrast Algorithm) 0.0.98G-4g / apca-w3 0.1.9 ---------- */

const SA98G = {
  mainTRC: 2.4,
  sRco: 0.2126729,
  sGco: 0.7151522,
  sBco: 0.072175,
  normBG: 0.56,
  normTXT: 0.57,
  revTXT: 0.62,
  revBG: 0.65,
  blkThrs: 0.022,
  blkClmp: 1.414,
  scaleBoW: 1.14,
  scaleWoB: 1.14,
  loBoWoffset: 0.027,
  loWoBoffset: 0.027,
  loClip: 0.1,
  deltaYmin: 0.0005,
} as const;

/** sRGB (0–255 channels) → luminance Y per APCA (simple 2.4 power curve). */
export function sRGBtoY({ r, g, b }: Rgb): number {
  const lin = (c: number) => Math.pow(c / 255, SA98G.mainTRC);
  return SA98G.sRco * lin(r) + SA98G.sGco * lin(g) + SA98G.sBco * lin(b);
}

/**
 * APCA contrast Lc from text luminance and background luminance.
 * Positive = dark text on light background, negative = light text on dark background. 0 when below the clip.
 */
export function apcaContrast(txtY: number, bgY: number): number {
  if (!(txtY >= 0 && txtY <= 1.1 && bgY >= 0 && bgY <= 1.1)) return 0;
  const clamp = (y: number) => (y > SA98G.blkThrs ? y : y + Math.pow(SA98G.blkThrs - y, SA98G.blkClmp));
  const t = clamp(txtY);
  const bg = clamp(bgY);
  if (Math.abs(bg - t) < SA98G.deltaYmin) return 0;
  let sapc: number;
  let out: number;
  if (bg > t) {
    sapc = (Math.pow(bg, SA98G.normBG) - Math.pow(t, SA98G.normTXT)) * SA98G.scaleBoW;
    out = sapc < SA98G.loClip ? 0 : sapc - SA98G.loBoWoffset;
  } else {
    sapc = (Math.pow(bg, SA98G.revBG) - Math.pow(t, SA98G.revTXT)) * SA98G.scaleWoB;
    out = sapc > -SA98G.loClip ? 0 : sapc + SA98G.loWoBoffset;
  }
  return out * 100;
}

/** APCA Lc between a text colour and a background colour, both hex. */
export function apcaLc(textHex: string, bgHex: string): number {
  return apcaContrast(sRGBtoY(hexToRgb(textHex)), sRGBtoY(hexToRgb(bgHex)));
}

/** Candidates for text on kit colour. Mirror `--on-kit-light` and `--on-kit-dark` in tokens.css. */
export const ON_KIT_LIGHT = "#FFFFFF";
export const ON_KIT_DARK = "#0F1318";
/** DESIGN §5: text on kit colour must pass APCA Lc >= 75. */
export const KIT_MIN_LC = 75;

export interface KitOnPrimaryResult {
  colour: string;
  lc: number;
  /** False when neither candidate reaches Lc 75; the better one is still returned. */
  passes: boolean;
}

/** Detailed variant of kitOnPrimary. */
export function kitOnPrimaryDetail(kitPrimaryHex: string): KitOnPrimaryResult {
  const light = Math.abs(apcaLc(ON_KIT_LIGHT, kitPrimaryHex));
  const dark = Math.abs(apcaLc(ON_KIT_DARK, kitPrimaryHex));
  if (light >= KIT_MIN_LC) return { colour: ON_KIT_LIGHT, lc: light, passes: true };
  if (dark >= KIT_MIN_LC) return { colour: ON_KIT_DARK, lc: dark, passes: true };
  return light >= dark ? { colour: ON_KIT_LIGHT, lc: light, passes: false } : { colour: ON_KIT_DARK, lc: dark, passes: false };
}

/** White or near-black for text on a kit colour, chosen by APCA (prefers white when both pass). */
export function kitOnPrimary(kitPrimaryHex: string): string {
  return kitOnPrimaryDetail(kitPrimaryHex).colour;
}

/* ---------- WCAG 2 contrast (the AA floor of DESIGN §5: text-3 must reach 4.5 : 1 on every surface it sits on) ---------- */

/** WCAG 2 relative luminance of a hex colour (sRGB, piecewise transfer). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2 contrast ratio between two hex colours, 1–21 (order does not matter). */
export function contrastRatio(aHex: string, bHex: string): number {
  const a = relativeLuminance(aHex);
  const b = relativeLuminance(bHex);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/* ---------- OKLCH (perceptual lightness, chroma, hue) for the brand ramp ---------- */

export interface Oklch {
  /** Perceptual lightness 0–1. */
  l: number;
  /** Chroma, 0 for greys; about 0.37 at most inside sRGB. */
  c: number;
  /** Hue in degrees 0–360. */
  h: number;
}

const srgbToLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const linearToSrgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255;

/** Hex → OKLCH (Björn Ottosson's OKLab, polar form). */
export function hexToOklch(hex: string): Oklch {
  const { r, g, b } = hexToRgb(hex);
  const [lr, lg, lb] = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  return { l: L, c, h: c < 1e-6 ? 0 : (Math.atan2(B, A) * 180) / Math.PI + (B < 0 ? 360 : 0) };
}

function oklchToLinear({ l: L, c, h }: Oklch): [number, number, number] {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3);
  const m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3);
  const s = Math.pow(L - 0.0894841775 * A - 1.291485548 * B, 3);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: [number, number, number]) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** OKLCH → hex. Out-of-gamut colours keep their lightness and hue and lose chroma until they fit sRGB (CSS Color 4 style). */
export function oklchToHex(colour: Oklch): string {
  const l = Math.min(1, Math.max(0, colour.l));
  let rgb = oklchToLinear({ ...colour, l });
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = Math.max(0, colour.c);
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ l, c: mid, h: colour.h }))) lo = mid;
      else hi = mid;
    }
    rgb = oklchToLinear({ l, c: lo, h: colour.h });
  }
  const [r, g, b] = rgb.map((v) => linearToSrgb(Math.min(1, Math.max(0, v)))) as [number, number, number];
  return rgbToHex({ r, g, b });
}

/** The brand ramp a business's primary colour lights the product with (DESIGN §5, DIRECTION #11). */
export interface KitRamp {
  /** The brand lifted towards text-1: lines, edges, the Today line, the active sidebar icon, carets. */
  lift: string;
  /** Active edges and lit corners. */
  hi: string;
  /** The gradient's low stop: the bottom of primary buttons, pressed brand. */
  lo: string;
  /** The deepest brand tone: wells and the slab's dark end. */
  deep: string;
  /** The glow colour: brand light cast on the canvas (aura behind the logo, Continue and Generate halos). */
  aura: string;
}

/**
 * Derive the brand ramp from the business's primary colour in OKLCH, so any brand colour lights correctly on the
 * dark canvas: lightness is set per stop (lift sits at OKLCH L 0.79–0.9, so even a navy or black brand reads on the
 * canvas and a pale brand stays pale), hue is kept, and chroma scales with the brand's own saturation (a grey brand
 * stays grey) before gamut mapping.
 * Pure and server-safe; `kitStyle` writes the result as `--kit-lift`, `--kit-hi`, `--kit-lo`, `--kit-deep`, `--kit-aura`.
 */
export function kitRamp(primaryHex: string): KitRamp {
  const { l, c, h } = hexToOklch(primaryHex);
  const stop = (lightness: number, chroma: number) => oklchToHex({ l: lightness, c: Math.min(chroma, 0.2), h });
  return {
    lift: stop(Math.min(0.9, Math.max(0.79, l + 0.2)), c * 1.2),
    hi: stop(Math.min(0.86, Math.max(0.7, l + 0.08)), c * 1.2),
    lo: stop(Math.min(0.42, l * 0.82), c * 0.8),
    deep: stop(Math.min(0.32, l * 0.62), c * 0.56),
    aura: stop(Math.min(0.8, Math.max(0.64, l + 0.06)), Math.max(c * 1.3, c > 0.02 ? 0.12 : c)),
  };
}

/** `var(--dept-n)` for a department colour token. */
export function deptColourVar(token: DeptColourToken): string {
  return `var(--${token})`;
}

/** Index 1–8 of a department token. */
export function deptIndex(token: DeptColourToken): number {
  return Number(token.slice("dept-".length));
}

/** Pick a department token for an index (wraps every 8). */
export function deptTokenFor(index: number): DeptColourToken {
  const n = ((Math.abs(Math.trunc(index)) % 8) + 8) % 8;
  return `dept-${n + 1}` as DeptColourToken;
}

/** CSS `color-mix` of a token with transparency, e.g. alpha("--status-good", 12) → 12 % tint. */
export function alpha(tokenVar: string, percent: number): string {
  const ref = tokenVar.startsWith("var(") ? tokenVar : `var(${tokenVar})`;
  return `color-mix(in oklab, ${ref} ${percent}%, transparent)`;
}

/** CSS `color-mix` of a token with white or the page ink, used to derive avatar palettes without literals. */
export function mixWith(tokenVar: string, towards: "white" | "ink", percent: number): string {
  const ref = tokenVar.startsWith("var(") ? tokenVar : `var(${tokenVar})`;
  const other = towards === "white" ? "var(--white)" : "var(--bg-ink)";
  return `color-mix(in oklab, ${ref} ${100 - percent}%, ${other})`;
}
