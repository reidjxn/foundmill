import type { HTMLAttributes, ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "./Button";
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
}

/** DESIGN §8: a status-bad pill + one line. Optional retry. */
export function ErrorState({ label = "Error", children, onRetry, retryLabel = "Try again", detail, className, ...rest }: ErrorStateProps) {
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-2 px-4 py-8 text-center", className)} {...rest}>
      <StatusPill tone="bad">{label}</StatusPill>
      <p className="max-w-sm text-body text-primary">{children}</p>
      {detail ? (
        <details className="max-w-md text-left">
          <summary className="cursor-pointer text-small text-secondary">Details</summary>
          <pre className="mt-1 max-h-40 overflow-auto rounded-chip bg-ink p-2 font-mono text-mono text-secondary">{detail}</pre>
        </details>
      ) : null}
      {onRetry ? (
        <Button size="sm" icon={RotateCw} onClick={onRetry} className="mt-1">
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
