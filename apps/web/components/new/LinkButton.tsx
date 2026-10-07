"use client";
/**
 * A Next.js Link dressed as a Dugout Button. Dugout's `Button asChild` renders `[icon | null, children, iconRight |
 * null]` into a Radix Slot, which throws ("Expected a single React element child") whenever an icon slot is empty, so
 * links in the first-run screens use `buttonVariants` directly instead (workaround; see docs/PROGRESS.md).
 */
import Link, { type LinkProps } from "next/link";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { Icon, buttonVariants, cn, type ButtonSize, type ButtonVariant, type IconComponent } from "@foundmill/dugout";

export interface LinkButtonProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">, Pick<LinkProps, "href" | "prefetch" | "replace" | "scroll"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconComponent;
  iconRight?: IconComponent;
  /** Plain anchor (full navigation) instead of a client transition, e.g. /auth/signout. */
  external?: boolean;
  children?: ReactNode;
}

export function LinkButton({ href, prefetch, replace, scroll, variant = "default", size = "md", icon, iconRight, external, className, children, ...rest }: LinkButtonProps) {
  const iconSize = size === "sm" ? "inline" : "default";
  const classes = cn(buttonVariants({ variant, size }), "hover:no-underline", className);
  const body = (
    <>
      {icon ? <Icon icon={icon} size={iconSize} /> : null}
      {children}
      {iconRight ? <Icon icon={iconRight} size={iconSize} /> : null}
    </>
  );
  if (external) {
    return (
      <a href={typeof href === "string" ? href : String(href)} className={classes} data-variant={variant} {...rest}>
        {body}
      </a>
    );
  }
  return (
    <Link href={href} prefetch={prefetch} replace={replace} scroll={scroll} className={classes} data-variant={variant} {...rest}>
      {body}
    </Link>
  );
}
