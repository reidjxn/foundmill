"use client";
/**
 * "Here is what will happen" (BUILD §11.3): every action of a plan with its policy outcome and cost, before
 * `plan.confirm`. Used by the Inbox's decisions and by every agent conversation's hand-off (the staged plan of
 * `agent.conversation.handOff` runs only through here). Policy speaks in plain words here (UX plan B14): an action
 * "needs your go-ahead because it spends money", is "Allowed on its own", or is one "Only you can do"; the first
 * sentence is always "Nothing runs until you say go."
 */
import { Check } from "lucide-react";
import { Button, Chip, ConsequenceLine, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, KeyValueList, Markdown, ProvenanceChip, ReassuranceLine, StatusPill, Term, formatMoney, type ConsequenceParts } from "@foundmill/dugout";
import { totalCost, type ConfirmationLine } from "./confirmation";

export interface ConfirmPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lines: readonly ConfirmationLine[];
  summary: string;
  loading?: boolean;
  onConfirm: () => void;
}

/** The reassurance that opens the dialog (UX plan §8.1 "Reassure where it is true"). */
export const NOTHING_RUNS = "Nothing runs until you say go.";

/** The words for each policy outcome and for a hard gate (UX plan B14). */
export const OUTCOME_WORDS = { allow: "Allowed on its own", ask: "Needs your go-ahead", deny: "Not allowed" } as const;
export const HARD_GATE_WORDS = "Only you can do this";

/** Why an action asks, as a plain predicate after "because it …" (UX plan B14). */
export type PlainReason = "spends money" | "contacts someone new" | "changes a setting" | "cannot be undone" | "creates a contract";

const REASON_ORDER: readonly PlainReason[] = ["spends money", "contacts someone new", "creates a contract", "cannot be undone", "changes a setting"];

/**
 * The plain reason a policy sentence stands for, or null when it names none. The policy's own words ("Assisted mode:
 * amount is above the approval threshold", "Recipient was first seen inside untrusted content") map to one of five;
 * a sentence that could mean a spend or a contact ("external actions and spending need approval") reads from the
 * action's cost.
 */
export function plainReason(reason: string, line?: Pick<ConfirmationLine, "cost">): PlainReason | null {
  const r = reason.toLowerCase();
  const spends = /\b(spend|spending|amount|threshold|cap|allowance|budget|money|cost|pay|payment|payout)\b/.test(r);
  const contacts = /\b(recipient|contact|contacts|message|messages|email|outreach|external action|external actions|someone)\b/.test(r);
  const contract = /\b(contract|contracts|terms|signature|sign)\b/.test(r);
  const undoable = /\b(irreversible|undone|undo)\b/.test(r);
  const setting = /\b(security setting|security settings|setting|settings|permission|permissions|configuration)\b/.test(r);
  if (spends && contacts) return line?.cost ? "spends money" : "contacts someone new";
  if (spends) return "spends money";
  if (contacts) return "contacts someone new";
  if (contract) return "creates a contract";
  if (undoable) return "cannot be undone";
  if (setting) return "changes a setting";
  return null;
}

/** True for a policy's own wording (a mode name, a cap, a gate), which the plain reason replaces outright. */
const isPolicyWording = (reason: string): boolean => /^(assisted|augmented|automated) mode\b|^hard gate\b|threshold|spend cap|suppression list|untrusted content|can never initiate|offline tracking/i.test(reason.trim());

const sentence = (s: string) => {
  const t = s.trim().replace(/\s+/g, " ");
  return /[.!?…]$/.test(t) ? t : `${t}.`;
};

/** "it spends money", "it spends money and cannot be undone", "it spends money, contacts someone new and cannot be undone". */
export function becauseWords(reasons: readonly PlainReason[]): string {
  const sorted = REASON_ORDER.filter((r) => reasons.includes(r));
  if (sorted.length === 0) return "";
  if (sorted.length === 1) return `it ${sorted[0]}`;
  return `it ${sorted.slice(0, -1).join(", ")} and ${sorted[sorted.length - 1]}`;
}

/**
 * The plain reasons of an ask line (deduplicated) and the agent's own sentences kept as they are ("Please set up my
 * spend allowance" says what to do; a policy's wording is replaced, never repeated).
 */
export function lineReasons(line: Pick<ConfirmationLine, "reasons" | "cost">): { because: PlainReason[]; kept: string[] } {
  const because = new Set<PlainReason>();
  const kept: string[] = [];
  for (const raw of line.reasons) {
    const reason = raw.trim();
    if (!reason) continue;
    const plain = plainReason(reason, line);
    if (plain) because.add(plain);
    if (!plain || !isPolicyWording(reason)) kept.push(reason);
  }
  return { because: REASON_ORDER.filter((r) => because.has(r)), kept };
}

/** The line under an ask: "Needs your go-ahead because it spends money. Please set up my spend allowance." Empty without reasons. */
export function reasonSentence(line: Pick<ConfirmationLine, "reasons" | "cost">): string {
  const { because, kept } = lineReasons(line);
  const parts = [because.length ? `${OUTCOME_WORDS.ask} because ${becauseWords(because)}.` : "", ...kept.map(sentence)].filter(Boolean);
  return parts.join(" ");
}

/** Under the footer (guidance on): where to stop or change the plan once it runs (UX plan §6.2 ReassuranceLine). */
export const GO_AHEAD_REASSURANCE = "You can stop or change this from the Inbox at any time.";

/**
 * The consequence line under "Go ahead" (always shown): how many actions start, the total as an Estimate ("No cost"
 * without one), and "Not reversible" only when a reason says an action cannot be undone; reversibility is left out
 * otherwise (never "unknown").
 */
export function goAheadConsequence(lines: readonly ConfirmationLine[]): ConsequenceParts {
  const run = lines.filter((l) => l.outcome !== "deny");
  const totals = totalCost(lines);
  const irreversible = lines.some((l) => l.outcome !== "deny" && lineReasons(l).because.includes("cannot be undone"));
  return {
    consequence: run.length ? `${run.length} action${run.length === 1 ? " starts" : "s start"} when you say go.` : "Nothing starts.",
    cost: totals.length ? `${totals.map((t) => formatMoney(t)).join(" + ")} (Estimate)` : "No cost",
    reversible: irreversible ? false : undefined,
  };
}

/** The dialog's description: the reassurance first, then what needs the founder's go-ahead (and why), what is not allowed, what is theirs to do. */
export function confirmPlanDescription(lines: readonly ConfirmationLine[]): string {
  const asks = lines.filter((l) => l.outcome === "ask");
  const denied = lines.filter((l) => l.outcome === "deny").length;
  const gates = lines.filter((l) => l.hardGate).length;
  const shared = new Set<PlainReason>();
  for (const l of asks) for (const r of lineReasons(l).because) shared.add(r);
  const why = asks.length === 1 && shared.size ? ` because ${becauseWords([...shared])}` : "";
  const head = asks.length ? `${asks.length} action${asks.length === 1 ? " needs" : "s need"} your go-ahead${why}.` : "Everything here is allowed on its own.";
  return [NOTHING_RUNS, head, denied ? `${denied} ${denied === 1 ? "is" : "are"} not allowed and will be skipped.` : "", gates ? `${gates} ${gates === 1 ? "is" : "are"} yours alone to do: the team prepares everything and you act.` : ""].filter(Boolean).join(" ");
}

export function ConfirmPlanDialog({ open, onOpenChange, lines, summary, loading, onConfirm }: ConfirmPlanDialogProps) {
  // Each line keeps its own currency; the total never adds two currencies together.
  const totals = totalCost(lines);
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
              {lines.map((l, i) => {
                const reason = l.outcome === "ask" ? reasonSentence(l) : "";
                return (
                  <li key={i} className="flex items-center gap-3 px-panel-pad py-2" data-outcome={l.outcome}>
                    <StatusPill tone={l.outcome === "allow" ? "good" : l.outcome === "ask" ? "warn" : l.outcome === "deny" ? "bad" : "neutral"}>{l.outcome === "allow" ? OUTCOME_WORDS.allow : l.outcome === "ask" ? OUTCOME_WORDS.ask : l.outcome === "deny" ? OUTCOME_WORDS.deny : l.outcome}</StatusPill>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-body text-pretty">{l.label}</span>
                      {reason ? (
                        <span className="text-small text-secondary text-pretty" data-testid="confirm-plan-reason">
                          {reason}
                        </span>
                      ) : null}
                    </span>
                    {l.hardGate ? <Chip tone="ink">{HARD_GATE_WORDS}</Chip> : null}
                    <span className="shrink-0 text-small text-secondary tabular-nums">{l.cost ? <>{formatMoney(l.cost)} (<Term id="estimate" always>Estimate</Term>)</> : "No cost"}</span>
                  </li>
                );
              })}
            </ol>
            <KeyValueList items={[{ label: "Total cost", value: totals.length ? <span className="inline-flex items-center gap-1.5" data-testid="confirm-plan-total">{totals.map((t) => formatMoney(t)).join(" + ")} <ProvenanceChip kind="estimate" /></span> : "No cost", numeric: true }]} />
            {totals.length ? <p className="text-small text-tertiary text-pretty">Budgets and caps as planned, not spend to date.{totals.length > 1 ? " Amounts in different currencies are listed side by side, not converted." : ""}</p> : null}
          </div>
        </DialogBody>
        <DialogFooter className="justify-between">
          {/* What Go ahead does (information, always) and where to undo it later (tutoring, guidance on). */}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <ConsequenceLine {...goAheadConsequence(lines)} data-testid="confirm-plan-consequence" />
            <ReassuranceLine data-testid="confirm-plan-reassurance">{GO_AHEAD_REASSURANCE}</ReassuranceLine>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
              Not now
            </Button>
            <Button variant="primary" icon={Check} loading={loading} onClick={onConfirm} data-testid="confirm-plan-go">
              Go ahead
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
