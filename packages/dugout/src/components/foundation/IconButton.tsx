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
  /** Pressed state for toggle buttons. */
  pressed?: boolean;
}

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
      className={cn(
        buttonVariants({ variant, size }),
        "px-0",
        size === "sm" ? "w-control-sm" : "w-control-md",
        pressed && "bg-panel-alt text-primary",
        className,
      )}
      {...rest}
    >
      <Icon icon={loading ? LoaderCircle : icon} size={size === "sm" ? "inline" : "default"} className={loading ? "animate-spin" : undefined} />
    </button>
  );
  if (!tooltip) return button;
  return <Tooltip content={label}>{button}</Tooltip>;
});
