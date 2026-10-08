import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";
import { kitOnPrimary } from "../../lib/colour";
import { createRng } from "../../lib/seed";

export interface CrestSpec {
  /** Any string or number; the same seed always draws the same crest. */
  seed: string | number;
  /** Brand colours as hex (business data, not design tokens). */
  kitPrimary: string;
  kitSecondary: string;
  /** 1–2 letters. Longer strings are cut to 2. */
  monogram: string;
  /** Pixel size for width/height attributes; the drawing is a 96×96 viewBox. Default 48. */
  size?: number;
  /** Omit width/height attributes so CSS controls the size. */
  fluid?: boolean;
  /** Accessible title. Default "Crest". */
  title?: string;
}

export type CrestShape = "pointed" | "rounded" | "heater" | "escutcheon";
export type CrestDivision = "split" | "halved" | "quartered" | "bend" | "chevron";

export const CREST_SIZES = [20, 32, 48, 96] as const;
export type CrestSize = (typeof CREST_SIZES)[number];

/** Shield silhouettes in a 96×96 box (DESIGN §8: four, chosen by seed). */
const SHAPES: Record<CrestShape, string> = {
  pointed: "M48 6 L86 16 L86 50 C86 70 68 84 48 92 C28 84 10 70 10 50 L10 16 Z",
  rounded: "M48 6 L86 14 L86 56 C86 76 68 88 48 92 C28 88 10 76 10 56 L10 14 Z",
  heater: "M12 10 L84 10 L84 48 C84 72 66 86 48 92 C30 86 12 72 12 48 Z",
  escutcheon: "M48 6 L84 20 L84 52 L48 92 L12 52 L12 20 Z",
};

const SHAPE_ORDER: CrestShape[] = ["pointed", "rounded", "heater", "escutcheon"];
const DIVISION_ORDER: CrestDivision[] = ["split", "halved", "quartered", "bend", "chevron"];

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Deterministic choices for a seed (exposed for tests and stories). */
export function crestPlan(seed: string | number): { shape: CrestShape; division: CrestDivision; stripes: boolean } {
  const rng = createRng(`crest:${seed}`);
  return { shape: rng.pick(SHAPE_ORDER), division: rng.pick(DIVISION_ORDER), stripes: rng.bool(0.35) };
}

/** Builds the crest as an SVG string. Pure and deterministic; safe to cache by seed + colours + monogram. */
export function generateCrest(spec: CrestSpec): string {
  const { shape, division, stripes } = crestPlan(spec.seed);
  const primary = spec.kitPrimary;
  const secondary = spec.kitSecondary;
  const mono = Array.from(spec.monogram.trim().toUpperCase()).slice(0, 2).join("");
  const onPrimary = kitOnPrimary(primary);
  const id = `crest-${createRng(`id:${spec.seed}`).int(100000, 999999)}`;
  const path = SHAPES[shape];
  const size = spec.size ?? 48;
  const dims = spec.fluid ? "" : ` width="${size}" height="${size}"`;

  // Secondary-colour field over the primary base, clipped to the shield.
  let field = "";
  switch (division) {
    case "split":
      field = `<rect x="48" y="0" width="48" height="96" fill="${esc(secondary)}"/>`;
      break;
    case "halved":
      field = `<rect x="0" y="0" width="96" height="46" fill="${esc(secondary)}"/>`;
      break;
    case "quartered":
      field = `<rect x="48" y="0" width="48" height="46" fill="${esc(secondary)}"/><rect x="0" y="46" width="48" height="50" fill="${esc(secondary)}"/>`;
      break;
    case "bend":
      field = `<polygon points="0,0 96,0 96,96" fill="${esc(secondary)}"/>`;
      break;
    case "chevron":
      field = `<polygon points="0,0 96,0 96,34 48,58 0,34" fill="${esc(secondary)}"/>`;
      break;
  }
  const stripeLayer = stripes
    ? `<g fill="${esc(onPrimary)}" opacity="0.07"><rect x="0" y="0" width="12" height="96"/><rect x="24" y="0" width="12" height="96"/><rect x="48" y="0" width="12" height="96"/><rect x="72" y="0" width="12" height="96"/></g>`
    : "";

  const fontSize = mono.length > 1 ? 30 : 36;
  const title = esc(spec.title ?? "Logo");

  return (
    // vocab-allow: data-crest-* are DOM attribute names, not copy (the visible label is the title, "Logo" by default)
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"${dims} role="img" aria-label="${title}" data-crest-shape="${shape}" data-crest-division="${division}">` +
    `<title>${title}</title>` +
    `<defs><clipPath id="${id}"><path d="${path}"/></clipPath></defs>` +
    `<path d="${path}" fill="${esc(primary)}"/>` +
    `<g clip-path="url(#${id})">${field}${stripeLayer}</g>` +
    // Monogram disc in kit-primary so the letters always sit on the primary colour (contrast via APCA).
    `<circle cx="48" cy="50" r="22" fill="${esc(primary)}" stroke="${esc(secondary)}" stroke-opacity="0.6" stroke-width="1.5"/>` +
    `<text x="48" y="50" text-anchor="middle" dominant-baseline="central" font-family="var(--font-display), 'Barlow Semi Condensed', system-ui, sans-serif" font-weight="600" font-size="${fontSize}" letter-spacing="-0.5" fill="${esc(onPrimary)}">${esc(mono)}</text>` +
    // 1 px inner outline in kit-secondary at 40 % (DESIGN §8) + a darker edge for separation from panels.
    `<path d="${path}" fill="none" stroke="${esc(secondary)}" stroke-opacity="0.4" stroke-width="2" clip-path="url(#${id})"/>` +
    `<path d="${path}" fill="none" stroke="var(--bg-ink)" stroke-opacity="0.5" stroke-width="1"/>` +
    `</svg>`
  );
}

export interface CrestProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children">, Omit<CrestSpec, "size" | "fluid"> {
  size?: CrestSize | number;
}

/** Renders generateCrest() inline. Sizes 20, 32, 48, 96 (DESIGN §8). */
export function Crest({ seed, kitPrimary, kitSecondary, monogram, title, size = 32, className, ...rest }: CrestProps) {
  const svg = generateCrest({ seed, kitPrimary, kitSecondary, monogram, size, title });
  return (
    <span
      className={cn("inline-flex shrink-0 align-middle [&>svg]:block", className)}
      style={{ width: size, height: size }}
      data-crest-seed={String(seed)}
      dangerouslySetInnerHTML={{ __html: svg }}
      {...rest}
    />
  );
}
