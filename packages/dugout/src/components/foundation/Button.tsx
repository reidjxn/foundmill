"use client";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Slot, Slottable } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { cn } from "../../lib/cn";
import { Icon, type IconComponent } from "./Icon";

export const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap select-none",
    "rounded-panel border font-display font-semibold text-small uppercase tracking-tab",
    "transition-[background-color,color,border-color,filter] duration-micro ease-dugout",
    "disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress",
  ],
  {
    variants: {
      variant: {
        /** Brand colour: Continue at rest, recommended decision options. Use sparingly (DESIGN §5). */
        primary: "bg-kit-primary text-kit-on-primary border-transparent hover:brightness-110 active:brightness-95",
        default: "bg-panel-alt text-primary border-subtle hover:border-secondary/60 active:bg-panel",
        ghost: "bg-transparent text-secondary border-transparent hover:bg-panel-alt hover:text-primary active:bg-panel",
        danger: "bg-status-bad/12 text-status-bad border-status-bad/40 hover:bg-status-bad/20 active:bg-status-bad/25",
        /** Customer Updates and milestones only. */
        gold: "bg-gold text-ink border-transparent hover:brightness-105 active:brightness-95",
      },
      size: {
        sm: "h-control-sm px-2.5",
        md: "h-control-md px-3",
        lg: "h-control-lg px-4",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Leading Lucide icon. */
  icon?: IconComponent;
  /** Trailing Lucide icon. */
  iconRight?: IconComponent;
  /** Shows a spinner in place of the leading icon, sets aria-busy and disables the button. */
  loading?: boolean;
  /** Render the child element as the button (Radix Slot), e.g. a Next.js Link. */
  asChild?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, icon, iconRight, loading = false, asChild = false, disabled, children, type, ...rest },
  ref,
) {
  const Comp = asChild ? Slot : "button";
  const iconSize = size === "sm" ? "inline" : "default";
  const leading = loading ? <Icon icon={LoaderCircle} size={iconSize} className="animate-spin" /> : icon ? <Icon icon={icon} size={iconSize} /> : null;
  const trailing = iconRight ? <Icon icon={iconRight} size={iconSize} /> : null;
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : (type ?? "button")}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      data-variant={variant ?? "default"}
      {...rest}
    >
      {leading}
      {/* Radix Slot wants exactly one element child; Slottable marks which child it merges into, so icons (or their
          absence) around it never trip "Expected a single React element child". Not wrapped in a fragment: Slot
          looks for the Slottable among its direct children. */}
      {asChild ? <Slottable>{children}</Slottable> : children}
      {trailing}
    </Comp>
  );
});
