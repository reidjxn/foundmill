import { forwardRef, type ButtonHTMLAttributes } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "../../lib/cn";
import { buttonVariants, type ButtonSize, type ButtonVariant } from "./Button";
import { Icon, type IconComponent } from "./Icon";
import { Tooltip } from "./Tooltip";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: IconComponent;
  /** Accessible name; also the tooltip text. Required: an icon alone is never the only signal. */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Show the label as a tooltip on hover/focus (default true). */
  tooltip?: boolean;
  /** Pressed state for toggle buttons: aria-pressed plus the active-toggle look (a tinted ring and a soft glow). */
  pressed?: boolean;
}

/** A square button: the same variants and press as Button, the side equal to the height (28/32/40/48). */
const SQUARE: Record<ButtonSize, string> = {
  sm: "w-control-sm",
  md: "w-control-md",
  lg: "w-control-lg",
  xl: "w-control-xl",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = "ghost", size = "md", loading = false, tooltip = true, pressed, className, disabled, type, ...rest },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type={type ?? "button"}
      aria-label={label}
      aria-pressed={pressed}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      data-variant={variant}
      data-active={pressed || undefined}
      className={cn(buttonVariants({ variant, size }), "shrink-0 px-0", SQUARE[size], className)}
      {...rest}
    >
      <Icon icon={loading ? LoaderCircle : icon} size={size === "sm" ? "inline" : "default"} className={loading ? "animate-spin" : undefined} />
    </button>
  );
  if (!tooltip) return button;
  return <Tooltip content={label}>{button}</Tooltip>;
});
