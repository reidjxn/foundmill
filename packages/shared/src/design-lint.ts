/**
 * Design check, the measured half (item 13: a visual design check on what the code agents build for founders).
 *
 * After a code agent changes the UI of a founder's project, the sandbox opens the changed pages at desktop width and at
 * 390 px, takes a screenshot of each and reads a short description of what is on the page from the browser (each
 * visible element's role, text, font size, colors, spacing, radius). `lintPageDescription` reads that description and
 * finds the problems a number can prove (text that fails WCAG AA contrast, spacing off any scale, too many type sizes,
 * a page that scrolls sideways on a phone, placeholder text). The reviewer agent sees the screenshots and these findings;
 * the mock reviewer uses only these findings, so mock mode is deterministic.
 *
 * Founders' products are their own: nothing here assumes Foundmill's design system. The rules are the general ones in
 * the Design principles skill (packages/agents/src/design-check.ts), which this file mirrors.
 */
import { z } from "zod";

/** The two widths every changed page is checked at. */
export const DESIGN_VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
} as const;
export const DESIGN_VIEWPORT_KEYS = ["desktop", "phone"] as const;
export type DesignViewport = (typeof DESIGN_VIEWPORT_KEYS)[number];

/** How a viewport reads in a sentence: "desktop" or "390 px". */
export function viewportLabel(viewport: DesignViewport): string {
  return viewport === "phone" ? `${DESIGN_VIEWPORTS.phone.width} px` : "desktop";
}

/** The principles a finding or a fix is filed under (the sections of the Design principles skill). */
export const DESIGN_PRINCIPLES = ["hierarchy", "spacing", "type_scale", "contrast", "color_restraint", "real_content", "consistency", "states", "responsive"] as const;
export const DesignPrinciple = z.enum(DESIGN_PRINCIPLES);
export type DesignPrinciple = (typeof DESIGN_PRINCIPLES)[number];

export const DESIGN_SEVERITIES = ["high", "medium", "low"] as const;
export const DesignSeverity = z.enum(DESIGN_SEVERITIES);
export type DesignSeverity = (typeof DESIGN_SEVERITIES)[number];

export const DESIGN_ELEMENT_ROLES = ["heading", "text", "button", "link", "input", "image", "container"] as const;

/** One visible element as the browser reported it (computed styles, rounded). */
export const DesignElement = z.object({
  /** A short path the capture gives the element ("main > section:nth-of-type(2) > p"). */
  ref: z.string().min(1).max(200),
  role: z.enum(DESIGN_ELEMENT_ROLES),
  /** Heading level, for headings. */
  level: z.number().int().min(1).max(6).optional(),
  /** The element's own text, trimmed and cut to 200 characters. Untrusted: the agent wrote the page. */
  text: z.string().max(200).default(""),
  fontSizePx: z.number().nonnegative().max(500).optional(),
  fontWeight: z.number().int().min(1).max(1000).optional(),
  /** Computed text color (`rgb(…)`, `rgba(…)` or hex). */
  color: z.string().max(80).optional(),
  /** The first opaque background behind the element, as computed. */
  background: z.string().max(80).optional(),
  /** Non-zero margins, paddings and gaps, in px. */
  spacingPx: z.array(z.number().nonnegative().max(2000)).max(16).default([]),
  radiusPx: z.number().nonnegative().max(2000).optional(),
  shadow: z.boolean().default(false),
  /** The element's background is a gradient. */
  gradient: z.boolean().default(false),
  /** The text itself is painted with a gradient (`background-clip: text`). */
  gradientText: z.boolean().default(false),
  widthPx: z.number().nonnegative().max(20000).optional(),
  heightPx: z.number().nonnegative().max(20000).optional(),
});
export type DesignElement = z.infer<typeof DesignElement>;
export type DesignElementInput = z.input<typeof DesignElement>;

/** A page at one width: what the screenshot shows, as numbers. */
export const PageDescription = z.object({
  /** The route as the founder's project serves it ("/", "/pricing"). */
  page: z.string().min(1).max(300),
  viewport: z.enum(DESIGN_VIEWPORT_KEYS),
  widthPx: z.number().int().positive().max(20000),
  /** The document's scroll width: wider than `widthPx` means the page scrolls sideways. */
  scrollWidthPx: z.number().int().nonnegative().max(100000),
  title: z.string().max(200).default(""),
  /** Which state was shown, when the change has one (an empty list, a loading view, an error). */
  state: z.enum(["loaded", "empty", "loading", "error"]).default("loaded"),
  elements: z.array(DesignElement).max(400).default([]),
});
export type PageDescription = z.infer<typeof PageDescription>;
export type PageDescriptionInput = z.input<typeof PageDescription>;

/** A problem the numbers prove, with where it is and what to change. */
export interface DesignFinding {
  page: string;
  viewport: DesignViewport;
  /** The element in words ("the heading “Plans for every team”"), with its ref when there is one. */
  element: string;
  problem: string;
  fix: string;
  principle: DesignPrinciple;
  severity: DesignSeverity;
}

// ---------------------------------------------------------------------------------------------------------------------
// Color and contrast (WCAG 2.2, 1.4.3)
// ---------------------------------------------------------------------------------------------------------------------

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, n));

/** `rgb(…)`, `rgba(…)` (comma or space syntax) and `#rgb` / `#rrggbb` / `#rrggbbaa`; null for anything else. */
export function parseCssColor(input: string | undefined | null): Rgba | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s);
  if (fn) {
    const alpha = fn[4] === undefined ? 1 : fn[4].endsWith("%") ? Number(fn[4].slice(0, -1)) / 100 : Number(fn[4]);
    return { r: clamp255(Number(fn[1])), g: clamp255(Number(fn[2])), b: clamp255(Number(fn[3])), a: Math.max(0, Math.min(1, alpha)) };
  }
  return null;
}

/** A color with alpha laid over an opaque one. */
function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a;
  return { r: top.r * a + bottom.r * (1 - a), g: top.g * a + bottom.g * (1 - a), b: top.b * a + bottom.b * (1 - a), a: 1 };
}

function luminance(c: Rgba): number {
  const ch = (v: number) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

/** WCAG contrast ratio of a text color on a background (white behind a background with alpha); null when unreadable. */
export function contrastRatio(foreground: string | undefined, background: string | undefined): number | null {
  const fg = parseCssColor(foreground);
  const bgRaw = parseCssColor(background ?? "#ffffff");
  if (!fg || !bgRaw) return null;
  const bg = bgRaw.a < 1 ? over(bgRaw, { r: 255, g: 255, b: 255, a: 1 }) : bgRaw;
  const text = fg.a < 1 ? over(fg, bg) : fg;
  const [hi, lo] = [luminance(text), luminance(bg)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG "large text": 24 px, or 18.66 px at bold (700) and above. */
export function isLargeText(el: Pick<DesignElement, "fontSizePx" | "fontWeight">): boolean {
  const size = el.fontSizePx ?? 16;
  return size >= 24 || (size >= 18.66 && (el.fontWeight ?? 400) >= 700);
}

// ---------------------------------------------------------------------------------------------------------------------
// The lint
// ---------------------------------------------------------------------------------------------------------------------

/** Text that stands in for real content. */
export const PLACEHOLDER_TEXT = /\blorem ipsum\b|\bdolor sit amet\b|\bconsectetur adipiscing\b|\byour (?:text|title|company|headline|tagline) here\b|\b(?:placeholder|sample) text\b|\bTODO\b|\bTBD\b|\bfoo ?bar\b|\bjohn doe\b|\bacme (?:corp|inc)\b|\{\{\s*\w+\s*\}\}/i;

/** Distinct type sizes a page carries before its scale reads as noise. */
export const MAX_TYPE_SIZES = 6;
/** Distinct corner radii before shapes stop looking like one family. */
export const MAX_RADII = 3;
/** Smallest tap target on a phone (WCAG 2.5.5 enhanced; Apple and Google both use 44 px or more). */
export const MIN_TAP_TARGET_PX = 44;
/** Smallest readable body text. */
export const MIN_TEXT_PX = 12;

const TEXT_ROLES = new Set(["heading", "text", "button", "link", "input"]);
const TAP_ROLES = new Set(["button", "link", "input"]);
const SEVERITY_RANK: Record<DesignSeverity, number> = { high: 0, medium: 1, low: 2 };

/** "the heading “Plans for every team” (main > h1)": how a finding names an element. */
export function elementLabel(el: Pick<DesignElement, "role" | "text" | "ref">): string {
  const words = el.text.replace(/\s+/g, " ").trim();
  const quoted = words ? ` “${words.length > 48 ? `${words.slice(0, 47).trimEnd()}…` : words}”` : "";
  return `the ${el.role}${quoted} (${el.ref})`;
}

const round = (n: number) => Math.round(n * 2) / 2;
const onScale = (n: number) => n % 4 === 0 || n === 2 || n === 1;
const fmt = (ns: readonly number[]) => ns.map((n) => `${n} px`).join(", ");

/**
 * The problems the description proves, most serious first. A lint, not a verdict: it only reports what it can measure,
 * and an empty list means "nothing measurable", never "the page looks good".
 */
export function lintPageDescription(input: PageDescriptionInput): DesignFinding[] {
  const d = PageDescription.parse(input);
  const out: DesignFinding[] = [];
  const at = (f: Omit<DesignFinding, "page" | "viewport">) => out.push({ page: d.page, viewport: d.viewport, ...f });
  const textual = d.elements.filter((e) => TEXT_ROLES.has(e.role) && e.text.trim().length > 0);

  // Contrast (WCAG AA): 4.5 : 1 for body text, 3 : 1 for large text.
  for (const el of textual) {
    const ratio = contrastRatio(el.color, el.background);
    if (ratio === null) continue;
    const need = isLargeText(el) ? 3 : 4.5;
    if (ratio < need) at({ element: elementLabel(el), problem: `Text contrast is ${ratio.toFixed(1)} : 1 (${el.color} on ${el.background ?? "white"}); it needs ${need} : 1 to be readable.`, fix: `Darken the text or lighten the background until the pair reaches ${need} : 1.`, principle: "contrast", severity: "high" });
  }

  // Placeholder content.
  for (const el of d.elements) {
    const m = PLACEHOLDER_TEXT.exec(el.text);
    if (m) at({ element: elementLabel(el), problem: `Placeholder text (“${m[0]}”) is on the page.`, fix: "Replace it with the project's real words: what it is, who it is for, what to do next.", principle: "real_content", severity: "high" });
  }

  // Sideways scroll on a phone.
  if (d.viewport === "phone" && d.scrollWidthPx > d.widthPx + 1) {
    const widest = [...d.elements].filter((e) => (e.widthPx ?? 0) > d.widthPx).sort((a, b) => (b.widthPx ?? 0) - (a.widthPx ?? 0))[0];
    at({ element: widest ? elementLabel(widest) : "the page", problem: `The page is ${d.scrollWidthPx} px wide at ${d.widthPx} px, so it scrolls sideways on a phone.`, fix: "Let the wide element wrap or shrink (max-width: 100%, flex-wrap, a single column below 640 px).", principle: "responsive", severity: "high" });
  }

  // Hierarchy: one clear headline, bigger than the body.
  const h1s = d.elements.filter((e) => e.role === "heading" && e.level === 1);
  const bodySizes = textual.filter((e) => e.role === "text").map((e) => e.fontSizePx ?? 16);
  const largestBody = bodySizes.length ? Math.max(...bodySizes) : 16;
  if (textual.length > 0 && h1s.length === 0) at({ element: "the page", problem: "The page has no main heading, so nothing says first what it is.", fix: "Give the page one h1 that names what it offers, larger than everything else.", principle: "hierarchy", severity: "medium" });
  if (h1s.length > 1) at({ element: elementLabel(h1s[1]!), problem: `The page has ${h1s.length} main headings competing for attention.`, fix: "Keep one h1; make the others section headings (h2).", principle: "hierarchy", severity: "medium" });
  const h1 = h1s[0];
  if (h1 && (h1.fontSizePx ?? 32) <= largestBody) at({ element: elementLabel(h1), problem: `The main heading (${h1.fontSizePx} px) is no bigger than the body text (${largestBody} px).`, fix: "Make the heading clearly larger (about 1.5–2.5 times the body) or heavier, so the eye lands on it first.", principle: "hierarchy", severity: "medium" });

  // Type scale.
  const sizes = [...new Set(textual.map((e) => round(e.fontSizePx ?? 16)))].sort((a, b) => a - b);
  if (sizes.length > MAX_TYPE_SIZES) at({ element: "the page", problem: `${sizes.length} different text sizes are used (${fmt(sizes)}).`, fix: `Pick a scale of at most ${MAX_TYPE_SIZES} sizes (for example 12, 14, 16, 20, 28, 40 px) and map every text to it.`, principle: "type_scale", severity: "medium" });
  const tiny = textual.find((e) => (e.fontSizePx ?? 16) < MIN_TEXT_PX);
  if (tiny) at({ element: elementLabel(tiny), problem: `Text is ${tiny.fontSizePx} px, too small to read comfortably.`, fix: `Use at least ${MIN_TEXT_PX} px for any text, 16 px for body text on a phone.`, principle: "type_scale", severity: "medium" });

  // Spacing scale.
  const spacing = d.elements.flatMap((e) => e.spacingPx.map((v) => ({ v: round(v), el: e })));
  const offScale = [...new Map(spacing.filter((s) => !onScale(s.v)).map((s) => [s.v, s] as const)).values()].sort((a, b) => a.v - b.v);
  if (offScale.length >= 3) at({ element: elementLabel(offScale[0]!.el), problem: `Spacing is off any scale: ${fmt(offScale.map((s) => s.v))} sit between the steps.`, fix: "Use one spacing scale (4, 8, 12, 16, 24, 32, 48, 64 px) for every margin, padding and gap.", principle: "spacing", severity: "medium" });

  // Consistency: radii and shadows.
  const radii = [...new Set(d.elements.map((e) => round(e.radiusPx ?? 0)).filter((r) => r > 0 && r < 999))].sort((a, b) => a - b);
  if (radii.length > MAX_RADII) at({ element: "the page", problem: `${radii.length} different corner radii are used (${fmt(radii)}).`, fix: `Use at most ${MAX_RADII} radii: one for small controls, one for cards, and full rounding for pills.`, principle: "consistency", severity: "low" });

  // Restraint with color and gradients.
  const gradients = d.elements.filter((e) => e.gradient);
  const gradientText = d.elements.find((e) => e.gradientText && e.text.trim().length > 0);
  if (gradientText) at({ element: elementLabel(gradientText), problem: "Text is filled with a gradient, which reads as decoration and loses contrast at one end.", fix: "Use one solid color for text; keep any gradient for a single background accent.", principle: "color_restraint", severity: "medium" });
  else if (gradients.length > 2) at({ element: elementLabel(gradients[0]!), problem: `${gradients.length} elements use gradients.`, fix: "Keep at most one gradient on the page (or none); use the brand color flat.", principle: "color_restraint", severity: "low" });

  // Tap targets on a phone.
  if (d.viewport === "phone") {
    const small = d.elements.find((e) => TAP_ROLES.has(e.role) && e.heightPx !== undefined && e.heightPx > 0 && e.heightPx < MIN_TAP_TARGET_PX);
    if (small) at({ element: elementLabel(small), problem: `The ${small.role} is ${small.heightPx} px tall, too small to tap reliably.`, fix: `Make tap targets at least ${MIN_TAP_TARGET_PX} px tall (padding counts).`, principle: "responsive", severity: "medium" });
  }

  // States: an empty or error view that says nothing.
  if ((d.state === "empty" || d.state === "error") && textual.length === 0) at({ element: "the page", problem: `The ${d.state} state shows no words.`, fix: d.state === "empty" ? "Say what will appear here and give the one action that fills it." : "Say what went wrong in plain words and how to try again.", principle: "states", severity: "medium" });

  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}
