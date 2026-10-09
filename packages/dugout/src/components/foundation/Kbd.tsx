import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  /** sm 18 px (default), md 20 px (quick replies). */
  size?: "sm" | "md";
}

/** A key cap: "⌘K", "Space", "G then H". Mono 11, 18 px, a strong hairline with a lit lower edge (DESIGN §8). Server-safe. */
export function Kbd({ className, children, size = "sm", ...rest }: KbdProps) {
  return (
    <kbd className={cn("kbd-cap", className)} data-size={size} {...rest}>
      {children}
    </kbd>
  );
}

/** A sequence of keys: <Keys keys={["G", "H"]} /> → G then H. */
export function Keys({ keys, separator = "then", className }: { keys: string[]; separator?: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-small text-tertiary", className)}>
      {keys.map((k, i) => (
        <span key={`${k}-${i}`} className="inline-flex items-center gap-1">
          {i > 0 ? <span aria-hidden>{separator}</span> : null}
          <Kbd>{k}</Kbd>
        </span>
      ))}
    </span>
  );
}
