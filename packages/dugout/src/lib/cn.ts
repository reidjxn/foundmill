import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The design tokens tailwind-merge has to know about (DIRECTION #17). Without them it reads `text-body` as a text
 * colour (so `text-body text-secondary` lost the size), and does not recognise `h-row-compact`, `rounded-panel`,
 * `shadow-elev-1` or `animate-shimmer`, so a later `h-auto` could not replace them. Keep in step with dugout.css
 * `@theme inline`.
 */
export const DUGOUT_FONT_SIZES = [
  "display-hero",
  "display-xl",
  "display-lg",
  "display-md",
  "display-sm",
  "title",
  "action",
  "action-sm",
  "tab",
  "label",
  "data",
  "body",
  "reading",
  "chat",
  "small",
  "mono",
  "micro",
  "money",
  "money-symbol",
] as const;

export const DUGOUT_SPACING = [
  "row-compact",
  "row-comfortable",
  "control-xs",
  "control-sm",
  "control-md",
  "control-lg",
  "control-xl",
  "field",
  "field-lg",
  "badge",
  "chip",
  "sidebar",
  "sidebar-collapsed",
  "kitbar",
  "tabbar",
  "rail",
  "inbox-list",
  "panel-header",
  "panel-pad",
  "gutter",
  "reading",
  "icon",
  "icon-inline",
  "icon-empty",
  // The smallest pointer target (`--target-size`, WCAG 2.5.8): `size-target` on info badges and row "…" buttons, so a
  // later `size-target` replaces a button's own width and height.
  "target",
  // Controls (controls.css): side padding, toggles, sliders, the generate core tile.
  "chip-x",
  "btn-sm",
  "btn-md",
  "btn-lg",
  "check",
  "switch-sm-w",
  "switch-sm-h",
  "switch-md-w",
  "switch-md-h",
  "slider-track",
  "slider-thumb",
  "skill-thumb",
  "gen-core",
  "gen-core-sm",
  "gen-core-md",
  "gen-core-lg",
  // Shell (shell.css): glass chips on the brand slab, the search, Continue, the active edge, the palette, ProfileHeader.
  "kitbar-chip",
  "kitbar-search",
  "continue-min",
  "active-edge",
  "decision-bar",
  "palette",
  "profile-header",
  "profile-avatar",
] as const;

export const DUGOUT_RADII = ["pill", "panel", "chip", "track", "gen"] as const;

export const DUGOUT_SHADOWS = [
  "elev-0",
  "elev-1",
  "elev-2",
  "elev-3",
  "ring",
  "glow-good",
  "glow-warn",
  "glow-bad",
  "glow-info",
  "glow-accent",
  "glow-gold",
  "glow-kit",
  "glow-tone",
  "overlay",
  "inner-highlight",
] as const;

export const DUGOUT_ANIMATIONS = [
  "shimmer",
  "sweep",
  "ring-pulse",
  "rise-in",
  "fade-in",
  "fade-out",
  "signal",
  "orbit",
  "marquee",
  "progress",
  "breathe",
  "typing",
  "caret",
  "landed",
  "pop",
  "overlay-in",
  "overlay-out",
  "fan",
  "head",
  "draw",
] as const;

export const DUGOUT_DURATIONS = [
  "press",
  "hover",
  "overlay",
  "slide",
  "view",
  "pulse",
  "draw",
  "shimmer",
  "breathe",
  "micro",
  "hover-card",
  "panel",
  "ribbon",
] as const;

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [...DUGOUT_FONT_SIZES],
      spacing: [...DUGOUT_SPACING],
      radius: [...DUGOUT_RADII],
      shadow: [...DUGOUT_SHADOWS],
      "inset-shadow": ["rim"],
      animate: [...DUGOUT_ANIMATIONS],
      ease: ["dugout", "spring", "inout"],
      tracking: ["tab", "label", "data"],
      blur: ["dialog", "glass"],
    },
    classGroups: {
      duration: [{ duration: [...DUGOUT_DURATIONS] }],
    },
  },
});

/** Merge class names: clsx for conditionals, tailwind-merge (taught the Dugout tokens) so the last conflicting utility wins. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
