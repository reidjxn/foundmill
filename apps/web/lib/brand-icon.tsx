"use client";
/**
 * The product mark as a sidebar icon (DESIGN §8a: the LogoMark glyph in the sidebar foot). Dugout sidebar items take a
 * Lucide-shaped icon component (`size`, `className`, aria attributes), so this adapts `LogoMark` to that contract.
 */
import type { LucideIcon, LucideProps } from "lucide-react";
import { LogoMark } from "@foundmill/dugout";

function BrandMark({ size, className, color, strokeWidth: _strokeWidth, absoluteStrokeWidth: _absolute, ref: _ref, ...rest }: LucideProps) {
  const px = typeof size === "number" ? size : Number.parseInt(String(size ?? 16), 10) || 16;
  return <LogoMark size={px} label={null} tone="duo" className={className} style={color ? { color } : undefined} {...rest} />;
}

/** Passes as a `LucideIcon` for `SidebarItem.icon`. */
export const brandMarkIcon = BrandMark as unknown as LucideIcon;
