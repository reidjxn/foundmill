"use client";
import { useEffect, useId, useMemo, useState } from "react";
import { TreePalm } from "lucide-react";
import type { Money } from "@foundmill/shared";
import { DECISION_TYPES, type DecisionType } from "@foundmill/shared/constants";
import { formatDate } from "../../lib/format";
import { Button } from "../foundation/Button";
import { Checkbox } from "../foundation/Checkbox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../foundation/Dialog";
import { Input } from "../foundation/Input";
import { Field, fieldDescribedBy } from "../foundation/Label";
import { RadioGroup, RadioOption } from "../foundation/RadioGroup";
import { Textarea } from "../foundation/Textarea";

/** Plain words for the shared decision types (the Chief of Staff's authority while the founder is away). */
export const DECISION_TYPE_LABELS: Record<DecisionType, string> = {
  spend_above_threshold: "Spend above the approval threshold",
  publish_content: "Publish content",
  merge_to_main: "Merge to main",
  sign_contracts: "Sign contracts",
  message_customers: "Message customers",
  hire_agents: "Hire agents",
  change_models: "Change models",
};

/** Decision types that are hard gates (BUILD §2.2): never delegable, shown locked. */
export const GATED_DECISION_TYPES: readonly DecisionType[] = ["sign_contracts"];

/** Events that end the holiday early (BUILD §9.6). */
export const HOLIDAY_WAKE_EVENTS = ["kill_switch", "credential_failure", "legal_deadline", "runway_warning", "customer_won", "hard_gate_queued", "agent_failing"] as const;
export type HolidayWakeEvent = (typeof HOLIDAY_WAKE_EVENTS)[number];
export const HOLIDAY_WAKE_EVENT_LABELS: Record<HolidayWakeEvent, string> = {
  kill_switch: "Kill switch pressed",
  credential_failure: "A credential fails",
  legal_deadline: "A legal deadline is near",
  runway_warning: "Runway warning",
  customer_won: "A customer is won",
  hard_gate_queued: "A hard-gated item is queued",
  agent_failing: "An agent is failing",
};
/** Default wake events per BUILD §9.6. */
export const DEFAULT_WAKE_EVENTS: readonly HolidayWakeEvent[] = ["kill_switch", "credential_failure", "legal_deadline", "runway_warning"];

export type HolidayUntil = { kind: "date"; date: string } | { kind: "condition"; condition: string } | { kind: "return" };

export interface HolidaySettings {
  until: HolidayUntil;
  /** Decision types the Chief of Staff may take. Default: all non-gated (configurable, BUILD §19). */
  authority: DecisionType[];
  /** Hard spend ceiling for the whole holiday; null means the business cap applies. */
  budgetCeiling: Money | null;
  wakeEvents: HolidayWakeEvent[];
}

export interface HolidayDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Currency for the budget ceiling (the business's currency). */
  currency: string;
  /** Today, for the earliest allowed date. */
  today?: Date;
  initial?: Partial<HolidaySettings>;
  onSubmit: (settings: HolidaySettings) => void | Promise<void>;
}

/** Default authority: every decision type except the hard gates. */
export function defaultAuthority(): DecisionType[] {
  return DECISION_TYPES.filter((t) => !GATED_DECISION_TYPES.includes(t));
}

export interface HolidayValidation {
  until?: string;
  budget?: string;
}

/** Pure validation; empty object means valid. Exported for tests. */
export function validateHolidaySettings(settings: HolidaySettings, today: Date = new Date()): HolidayValidation {
  const errors: HolidayValidation = {};
  if (settings.until.kind === "date") {
    const d = new Date(settings.until.date);
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);
    if (!settings.until.date || Number.isNaN(d.getTime())) errors.until = "Choose a return date.";
    else if (d.getTime() < start.getTime()) errors.until = "The return date is in the past.";
  } else if (settings.until.kind === "condition" && settings.until.condition.trim().length < 3) {
    errors.until = "Describe the condition that ends the vacation.";
  }
  if (settings.budgetCeiling && (!Number.isFinite(settings.budgetCeiling.amountMinor) || settings.budgetCeiling.amountMinor < 0)) {
    errors.budget = "The budget ceiling must be zero or more.";
  }
  return errors;
}

/** Major-unit string ("1200.50") → minor units, or null when blank/invalid. */
export function parseMajor(input: string): number | null {
  const t = input.trim().replace(/,/g, "");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function toDateInput(d: Date): string {
  return formatDate(d, "yyyy-MM-dd");
}

/**
 * HolidayDialog (BUILD §5.4, §9.6): until (date / condition / until I return), the Chief of Staff's authority as a
 * checklist of decision types (hard gates locked), a budget ceiling, and the events that wake the founder.
 */
export function HolidayDialog({ open, onOpenChange, currency, today = new Date(), initial, onSubmit }: HolidayDialogProps) {
  const id = useId();
  const [untilKind, setUntilKind] = useState<HolidayUntil["kind"]>(initial?.until?.kind ?? "date");
  const [date, setDate] = useState(initial?.until?.kind === "date" ? initial.until.date : "");
  const [condition, setCondition] = useState(initial?.until?.kind === "condition" ? initial.until.condition : "");
  const [authority, setAuthority] = useState<DecisionType[]>(initial?.authority ?? defaultAuthority());
  const [budget, setBudget] = useState(initial?.budgetCeiling ? String(initial.budgetCeiling.amountMinor / 100) : "");
  const [wake, setWake] = useState<HolidayWakeEvent[]>(initial?.wakeEvents ?? [...DEFAULT_WAKE_EVENTS]);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) setSubmitted(false);
  }, [open]);

  const settings = useMemo<HolidaySettings>(() => {
    const until: HolidayUntil = untilKind === "date" ? { kind: "date", date } : untilKind === "condition" ? { kind: "condition", condition } : { kind: "return" };
    const minor = parseMajor(budget);
    return { until, authority, budgetCeiling: minor === null ? null : { amountMinor: minor, currency }, wakeEvents: wake };
  }, [untilKind, date, condition, authority, budget, currency, wake]);
  const errors = useMemo(() => validateHolidaySettings(settings, today), [settings, today]);
  const valid = Object.keys(errors).length === 0;

  const toggle = <T extends string>(list: T[], value: T, on: boolean): T[] => (on ? (list.includes(value) ? list : [...list, value]) : list.filter((v) => v !== value));

  const submit = async () => {
    setSubmitted(true);
    if (!valid) return;
    setBusy(true);
    try {
      await onSubmit(settings);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const untilError = submitted ? errors.until : undefined;
  const budgetError = submitted ? errors.budget : undefined;

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent size="lg" data-testid="holiday-dialog">
        <DialogHeader>
          <DialogTitle>Go on vacation</DialogTitle>
          <DialogDescription>The business runs in Automated mode and Continue runs itself every 4 agent-hours. Hard gates still wait for you.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="t-label mb-1">Until</legend>
            <RadioGroup value={untilKind} onValueChange={(v) => setUntilKind(v as HolidayUntil["kind"])} aria-label="Until" className="gap-1.5">
              <RadioOption id={`${id}-date`} value="date" label="A date" />
              {untilKind === "date" ? (
                <div className="ml-6">
                  <Input type="date" value={date} min={toDateInput(today)} onChange={(e) => setDate(e.target.value)} aria-label="Return date" aria-invalid={!!untilError} wrapperClassName="w-48" data-testid="holiday-date" />
                </div>
              ) : null}
              <RadioOption id={`${id}-condition`} value="condition" label="A condition" description="The Chief of Staff ends the vacation when it is met." />
              {untilKind === "condition" ? (
                <div className="ml-6">
                  <Textarea value={condition} onChange={(e) => setCondition(e.target.value)} rows={2} placeholder="e.g. when the launch ships or runway drops under 8 months" aria-label="Condition" aria-invalid={!!untilError} data-testid="holiday-condition" />
                </div>
              ) : null}
              <RadioOption id={`${id}-return`} value="return" label="Until I return" description="Press Come back in the top bar." />
            </RadioGroup>
            {untilError ? (
              <p role="alert" className="text-small text-status-bad">
                {untilError}
              </p>
            ) : null}
          </fieldset>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="t-label mb-1">Chief of Staff may decide</legend>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {DECISION_TYPES.map((t) => {
                const gated = GATED_DECISION_TYPES.includes(t);
                const cid = `${id}-auth-${t}`;
                return (
                  <div key={t} className="flex items-center gap-2">
                    <Checkbox id={cid} checked={!gated && authority.includes(t)} disabled={gated} onCheckedChange={(c) => setAuthority((a) => toggle(a, t, c === true))} data-decision-type={t} />
                    <label htmlFor={cid} className="text-body text-primary peer-disabled:opacity-50">
                      {DECISION_TYPE_LABELS[t]}
                      {gated ? <span className="ml-1 text-small text-secondary">(hard gate, always yours)</span> : null}
                    </label>
                  </div>
                );
              })}
            </div>
          </fieldset>

          <Field htmlFor={`${id}-budget`} label={`Budget ceiling (${currency})`} hint="Total the team may spend during the vacation. Leave empty to keep the business cap." error={budgetError}>
            <Input
              id={`${id}-budget`}
              inputMode="decimal"
              numeric
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="0.00"
              aria-describedby={fieldDescribedBy(`${id}-budget`, { hint: true, error: !!budgetError })}
              invalid={!!budgetError}
              wrapperClassName="w-48"
              data-testid="holiday-budget"
            />
          </Field>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="t-label mb-1">Wake me when</legend>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {HOLIDAY_WAKE_EVENTS.map((w) => {
                const cid = `${id}-wake-${w}`;
                return (
                  <div key={w} className="flex items-center gap-2">
                    <Checkbox id={cid} checked={wake.includes(w)} onCheckedChange={(c) => setWake((list) => toggle(list, w, c === true))} data-wake-event={w} />
                    <label htmlFor={cid} className="text-body text-primary">
                      {HOLIDAY_WAKE_EVENT_LABELS[w]}
                    </label>
                  </div>
                );
              })}
            </div>
          </fieldset>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" icon={TreePalm} onClick={submit} loading={busy} data-testid="holiday-submit">
            Start vacation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
