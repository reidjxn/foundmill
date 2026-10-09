/**
 * Logo designer (Opus): draws N distinct, modern logo marks for a business as SVG (Commit screen and Settings › Business,
 * "Generate"). The brief travels as JSON in the user message; the api passes every returned SVG through the strict
 * sanitiser (@foundmill/shared/logo) before a browser sees it, so the SVG rules below keep marks from being cut down, and
 * the sanitiser, not the prompt, is the security boundary.
 */
import { z } from "zod";
import { definePrompt } from "./template";

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const LogoDesignerVariables = z.object({
  business_name: z.string().min(1).max(120),
  /** One or two sentences: what the business does and for whom. */
  pitch: z.string().min(1).max(600),
  /** Archetype display name, e.g. "B2B SaaS". */
  archetype: z.string().min(1).max(60),
  primary_colour: Hex,
  secondary_colour: Hex,
  count: z.number().int().min(1).max(8),
});

export const logoDesignerPrompt = definePrompt({
  key: "logo_designer",
  version: 1,
  route: "logoDesigner",
  description: "Draws distinct, modern, minimal logo marks for a business as SVG in its brand colours, from its name, pitch and archetype.",
  variables: LogoDesignerVariables,
  text: `You are a brand designer. Draw {count} distinct logo marks for {business_name}, a {archetype} business: {pitch}
Brand colours: primary {primary_colour}, secondary {secondary_colour}.
Return JSON {{"marks": [{{"name" (1-3 words), "concept" (one sentence, <= 25 words: what the mark shows and why it fits), "svg"}}]}} with exactly {count} marks.
Each mark:
- is modern and minimal: one idea, flat colour, two to four simple shapes, still legible at 20 px;
- is built from geometric primitives, an abstract symbol or a letterform drawn with shapes (initials drawn as paths, never <text>);
- is never a shield, heraldic emblem, badge, seal, banner, star, ball, cup, laurel, wreath, mascot or any sports imagery;
- sits on its own background tile that covers the whole 100 x 100 box (a rounded rectangle with rx between 12 and 28, or a circle), so it reads on a light page, a dark panel and on the primary colour;
- uses only the two brand colours plus at most one neutral (#FFFFFF, #F6F4EF or #0F1318), with strong contrast between the symbol and its tile.
SVG rules (anything else is removed before the founder sees it):
- one <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"> element, no width or height, no XML declaration or comments;
- only g, path, rect, circle, ellipse, line, polyline, polygon, defs, linearGradient, radialGradient, stop and clipPath;
- presentation attributes only (fill, stroke, stroke-width, opacity, transform, d, points...): no style, class, script, text, image, filter, mask, foreignObject or animation; no href or url() except url(#id) to a gradient or clip path defined in the same mark;
- at most 3,000 characters per mark, coordinates rounded to one decimal.
The marks must differ in idea, not just in colour or arrangement. Output JSON only.`,
});
