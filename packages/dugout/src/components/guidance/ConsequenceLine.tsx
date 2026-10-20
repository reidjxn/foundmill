/**
 * The line under any action that spends or commits (docs/UX_AUDIT_AND_PLAN.md §6.2 `ConsequenceLine`, principle 6):
 * small secondary text with the consequence sentence, the cost (formatted by the caller: "€500.00 (Estimate)",
 * "No cost") and whether it can be undone, a warning triangle inline when it cannot. Unknown parts are left out,
 * never written as "unknown". Always shown: a consequence is information, not tutoring. It generalizes the
 * DecisionBar's option subline; `consequenceText` is the string form for a button's `description`. Server-safe.
 */
import type { HTMLAttributes, ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { cn } from "../../lib/cn";
import { Icon } from "../foundation/Icon";

export interface ConsequenceParts {
  /** The cost as text, already formatted and labeled by the caller ("€500.00 (Estimate)", "No cost"). */
  cost?: string | null;
  /** True: "Reversible"; false: "Not reversible" with the warning; undefined: left out. */
  reversible?: boolean | null;
  /** The business consequence in one sentence ("Stock-out risk in November."). */
  consequence?: string | null;
}

export const REVERSIBLE_WORDS = { true: "Reversible", false: "Not reversible" } as const;

/** The known parts in reading order: consequence, cost, reversibility. */
export function consequenceParts({ cost, reversible, consequence }: ConsequenceParts): string[] {
  const out: string[] = [];
  if (consequence) out.push(consequence);
  if (cost) out.push(cost);
  if (reversible === true) out.push(REVERSIBLE_WORDS.true);
  else if (reversible === false) out.push(REVERSIBLE_WORDS.false);
  return out;
}

/** "Stock-out risk in November. · €500.00 (Estimate) · Not reversible", or undefined when nothing is known. */
export function consequenceText(parts: ConsequenceParts): string | undefined {
  const p = consequenceParts(parts);
  return p.length ? p.join(" · ") : undefined;
}

export interface ConsequenceLineProps extends ConsequenceParts, Omit<HTMLAttributes<HTMLParagraphElement>, "children"> {}

export function ConsequenceLine({ cost, reversible, consequence, className, ...rest }: ConsequenceLineProps) {
  const parts = consequenceParts({ cost, reversible, consequence });
  if (!parts.length) return null;
  const sep = (key: string) => (
    <span key={key} aria-hidden className="text-tertiary">
      ·
    </span>
  );
  const items: ReactNode[] = [];
  if (consequence) items.push(<span key="consequence">{consequence}</span>);
  if (cost) {
    if (items.length) items.push(sep("s1"));
    items.push(
      <span key="cost" className="tabular" data-consequence-cost="">
        {cost}
      </span>,
    );
  }
  if (reversible === true || reversible === false) {
    if (items.length) items.push(sep("s2"));
    items.push(
      <span key="reversible" className="inline-flex items-center gap-1" data-consequence-reversible={reversible}>
        {reversible ? null : <Icon icon={TriangleAlert} size="inline" className="text-status-warn" />}
        {reversible ? REVERSIBLE_WORDS.true : REVERSIBLE_WORDS.false}
      </span>,
    );
  }
  return (
    <p className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-small text-secondary text-pretty", className)} data-consequence="" {...rest}>
      {items}
    </p>
  );
}
