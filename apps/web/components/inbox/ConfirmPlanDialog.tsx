"use client";
/**
 * "Here is what will happen" (BUILD §11.3): every action of a plan with its policy outcome and cost, before
 * `plan.confirm`. Used by the Inbox's decisions and by every agent conversation's hand-off (the staged plan of
 * `agent.conversation.handOff` runs only through here).
 */
import { Check } from "lucide-react";
import { Button, Chip, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, KeyValueList, Markdown, ProvenanceChip, StatusPill, formatMoney } from "@foundmill/dugout";
import { totalCost, type ConfirmationLine } from "./logic";

export interface ConfirmPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lines: readonly ConfirmationLine[];
  summary: string;
  currency: string;
  loading?: boolean;
  onConfirm: () => void;
}

/** The dialog's description: what needs the founder's go-ahead, what is denied, what is theirs to do. */
export function confirmPlanDescription(lines: readonly ConfirmationLine[]): string {
  const asks = lines.filter((l) => l.outcome === "ask").length;
  const denied = lines.filter((l) => l.outcome === "deny").length;
  const gates = lines.filter((l) => l.hardGate).length;
  const head = asks
    ? `${asks} action${asks === 1 ? " sits" : "s sit"} outside the current policy and need${asks === 1 ? "s" : ""} your go-ahead.`
    : "Everything here is within the current policy. Nothing runs until you say go.";
  return [head, denied ? `${denied} ${denied === 1 ? "is" : "are"} denied and will be skipped.` : "", gates ? `${gates} ${gates === 1 ? "is" : "are"} hard-gated: the team prepares everything and you act.` : ""].filter(Boolean).join(" ");
}

export function ConfirmPlanDialog({ open, onOpenChange, lines, summary, currency, loading, onConfirm }: ConfirmPlanDialogProps) {
  const total = totalCost(lines, currency);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="confirm-plan">
        <DialogHeader>
          <DialogTitle>Here is what will happen</DialogTitle>
          <DialogDescription>{confirmPlanDescription(lines)}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-3">
            {summary ? <Markdown variant="body">{summary}</Markdown> : null}
            <ol className="flex flex-col divide-y divide-subtle rounded-panel border border-subtle" data-testid="confirm-plan-lines">
              {lines.map((l, i) => (
                <li key={i} className="flex items-center gap-3 px-panel-pad py-2" data-outcome={l.outcome}>
                  <StatusPill tone={l.outcome === "allow" ? "good" : l.outcome === "ask" ? "warn" : l.outcome === "deny" ? "bad" : "neutral"}>{l.outcome === "allow" ? "Within policy" : l.outcome === "ask" ? "Needs your go-ahead" : l.outcome === "deny" ? "Denied" : l.outcome}</StatusPill>
                  <span className="min-w-0 flex-1 text-body text-pretty">{l.label}</span>
                  {l.hardGate ? <Chip tone="ink">You act</Chip> : null}
                  <span className="shrink-0 text-small text-secondary tabular-nums">{l.cost ? formatMoney(l.cost) : "No cost"}</span>
                </li>
              ))}
            </ol>
            <KeyValueList items={[{ label: "Total cost", value: total ? <span className="inline-flex items-center gap-1.5">{formatMoney(total)} <ProvenanceChip kind="estimate" /></span> : "No cost", numeric: true }]} />
            {total ? <p className="text-small text-tertiary text-pretty">Budgets and caps as planned, not spend to date.</p> : null}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            Not now
          </Button>
          <Button variant="primary" icon={Check} loading={loading} onClick={onConfirm} data-testid="confirm-plan-go">
            Go ahead
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
