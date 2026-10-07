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
