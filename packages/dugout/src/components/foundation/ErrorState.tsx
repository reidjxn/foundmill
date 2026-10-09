import type { HTMLAttributes, ReactNode } from "react";
import { ChevronRight, RotateCw } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { StatusPill } from "./StatusPill";

export interface ErrorStateProps extends HTMLAttributes<HTMLDivElement> {
  /** Word in the pill. Default "Error". */
  label?: string;
  /** One plain line saying what failed. */
  children: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  /** Technical detail in mono, collapsed by default. */
  detail?: string;
  /** Tighter spacing for small panels and table bodies. */
  compact?: boolean;
}

/**
 * DESIGN §8: a status-bad pill (icon + word) and one plain line; optional technical detail behind a disclosure (mono on
 * ink) and a retry. Server-safe.
 */
export function ErrorState({ label = "Error", children, onRetry, retryLabel = "Try again", detail, compact, className, ...rest }: ErrorStateProps) {
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center text-center", compact ? "gap-2 px-4 py-5" : "gap-3 px-4 py-8", className)} {...rest}>
      <StatusPill tone="bad">{label}</StatusPill>
      <p className="max-w-sm text-body text-pretty text-primary">{children}</p>
      {detail ? (
        <details className="group/detail w-full max-w-md text-left">
          <summary className="mx-auto flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm px-1.5 text-small text-secondary transition-colors duration-hover ease-out hover:text-primary [&::-webkit-details-marker]:hidden">
            <Icon icon={ChevronRight} size="inline" className="transition-transform duration-overlay ease-out group-open/detail:rotate-90" />
            Details
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto rounded-sm border border-line-faint bg-ink p-3 font-mono text-mono whitespace-pre-wrap text-secondary">{detail}</pre>
        </details>
      ) : null}
      {onRetry ? (
        <Button size="sm" icon={RotateCw} onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
