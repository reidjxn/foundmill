"use client";
/**
 * DecisionLead (WP-10 T10; s1 §3.10): the ask before the evidence. At the top of a note that holds a decision, in
 * reading type: what the agent suggests, what it does, what it costs (an Estimate) and whether it can be undone, then
 * the suggested option as the one filled button and the others as quiet ones. It calls the same `onChoose` the sticky
 * DecisionBar does, so the plan dialog and every policy check are unchanged. Nothing when no option is recommended.
 */
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";
import { Button } from "../foundation/Button";
import { costText, type DecisionOption } from "./DecisionBar";

export interface DecisionLeadProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  agentName: string;
  /** The option tagged Recommended; without one the component renders nothing. */
  recommended?: DecisionOption | null;
  others: readonly DecisionOption[];
  onChoose: (option: DecisionOption) => void;
  /** "Not sure? Ask <name>": omit to leave it out. */
  onAsk?: () => void;
  disabled?: boolean;
}

/** "Juno suggests: Run the sale. A 20% discount for a week. Costs $40.00 (Estimate). Can be undone." Exported for tests. */
export function decisionLeadSentence(agentName: string, o: DecisionOption): string {
  const trim = (s: string) => s.trim().replace(/\.$/, "");
  const parts = [`${agentName} suggests: ${trim(o.label)}`];
  if (o.consequence) parts.push(trim(o.consequence));
  if (o.cost !== undefined) parts.push(o.cost === null || o.cost.amountMinor === 0 ? "No cost" : `Costs ${costText(o.cost)}`);
  if (o.reversible !== undefined) parts.push(o.reversible ? "Can be undone" : "Cannot be undone");
  return `${parts.join(". ")}.`;
}

export function DecisionLead({ agentName, recommended, others, onChoose, onAsk, disabled, className, ...rest }: DecisionLeadProps) {
  if (!recommended) return null;
  return (
    <section aria-label={`${agentName}'s suggestion`} className={cn("flex max-w-reading flex-col gap-3", className)} data-testid="decision-lead" {...rest}>
      <p className="t-reading text-pretty text-primary" data-testid="decision-lead-sentence">
        {decisionLeadSentence(agentName, recommended)}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={disabled || recommended.disabled} onClick={() => onChoose(recommended)} data-testid="decision-lead-recommended">
          {recommended.label}
        </Button>
        {others.map((o) => (
          <Button key={o.id} variant="secondary" disabled={disabled || o.disabled} onClick={() => onChoose(o)}>
            {o.label}
          </Button>
        ))}
        {onAsk ? (
          <Button variant="ghost" onClick={onAsk} data-testid="decision-lead-ask">
            Not sure? Ask {agentName}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
