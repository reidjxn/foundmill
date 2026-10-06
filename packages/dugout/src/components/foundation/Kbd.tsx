import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
}

/** A key cap: "⌘K", "Space", "G then H". Mono, 11 px, raised. */
export function Kbd({ className, children, ...rest }: KbdProps) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-chip border border-subtle bg-panel-alt px-1",
        "font-mono text-label leading-none text-secondary shadow-inner-highlight",
        className,
      )}
      {...rest}
    >
      {children}
    </kbd>
  );
}

/** A sequence of keys: <Keys keys={["G", "H"]} /> → G then H. */
export function Keys({ keys, separator = "then", className }: { keys: string[]; separator?: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-small text-secondary", className)}>
      {keys.map((k, i) => (
        <span key={`${k}-${i}`} className="inline-flex items-center gap-1">
          {i > 0 ? <span aria-hidden>{separator}</span> : null}
          <Kbd>{k}</Kbd>
        </span>
      ))}
    </span>
  );
}
