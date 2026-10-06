import type { LucideIcon, LucideProps } from "lucide-react";
import { cn } from "../../lib/cn";

export type IconComponent = LucideIcon;

/** DESIGN §2: 16 px default, 14 px inline in text, 20 px in empty states, stroke 1.75. */
export const ICON_SIZES = { inline: 14, default: 16, empty: 20, lg: 24 } as const;
export type IconSize = keyof typeof ICON_SIZES | number;
export const ICON_STROKE = 1.75;

export interface IconProps extends Omit<LucideProps, "size" | "ref"> {
  icon: IconComponent;
  size?: IconSize;
  /** Accessible name. Without it the icon is decorative (aria-hidden). */
  label?: string;
}

/** Renders a Lucide icon with Dugout defaults. Decorative unless `label` is given. */
export function Icon({ icon: Cmp, size = "default", label, className, ...rest }: IconProps) {
  const px = typeof size === "number" ? size : ICON_SIZES[size];
  return (
    <Cmp
      size={px}
      strokeWidth={ICON_STROKE}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      focusable="false"
      className={cn("shrink-0", className)}
      {...rest}
    />
  );
}
