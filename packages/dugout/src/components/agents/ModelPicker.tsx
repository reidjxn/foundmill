"use client";
import { useId } from "react";
import { Lock, TriangleAlert } from "lucide-react";
import type { ModelKey } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { formatDelta, formatMoneyDelta } from "../../lib/format";
import { ProvenanceChip } from "../foundation/Chip";
import { Icon } from "../foundation/Icon";
import { ModelChip } from "./SquadCells";
import type { ModelOption } from "./types";

export interface ModelPickerProps {
  options: readonly ModelOption[];
  value: ModelKey;
  /** Called with the candidate; the app opens ApplyScopeDialog and runs the preview tests. */
  onChange: (model: ModelKey) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Model selection (BUILD §11.10 Training "Model" tab): Opus / Sonnet / Haiku with the predicted skill change and the
 * change in cost per month (estimates), locked options with the reason, and warnings (Chief of Staff downgrade). A
 * radio group.
 */
export function ModelPicker({ options, value, onChange, disabled, className }: ModelPickerProps) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label="Model" className={cn("flex flex-col gap-1.5", className)}>
      {options.map((o) => {
        const checked = o.key === value;
        const locked = !!o.lockedReason;
        return (
          <label
            key={o.key}
            htmlFor={`${id}-${o.key}`}
            data-checked={checked || undefined}
            data-state={checked ? "checked" : "unchecked"}
            data-disabled={locked || disabled ? "" : undefined}
            className={cn("radio-card flex cursor-pointer items-start gap-3 rounded-md p-3 focus-within-ring", (locked || disabled) && "cursor-not-allowed opacity-60")}
          >
            <input
              id={`${id}-${o.key}`}
              type="radio"
              name={id}
              value={o.key}
              checked={checked}
              disabled={disabled || locked}
              onChange={() => onChange(o.key)}
              className="mt-1 size-4 shrink-0 accent-accent"
              aria-describedby={`${id}-${o.key}-desc`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <ModelChip model={o.key} locked={locked} />
                <span className="font-medium text-primary">{o.label}</span>
                {checked ? <span className="rounded-pill bg-accent/12 px-1.5 text-small font-medium text-accent">Current</span> : null}
              </div>
              <p id={`${id}-${o.key}-desc`} className="text-small text-secondary">
                {o.description}
                {locked ? ` ${o.lockedReason}` : ""}
              </p>
              {o.warning ? (
                <p className="mt-1 flex items-center gap-1 text-small text-status-warn">
                  <Icon icon={TriangleAlert} size="inline" />
                  {o.warning}
                </p>
              ) : null}
            </div>
            <dl className="grid shrink-0 grid-cols-2 items-baseline gap-x-2 gap-y-0.5 text-right text-small tabular-nums">
              <dt className="t-data">Skills</dt>
              <dd className={cn(o.skillDelta !== null && o.skillDelta > 0 ? "text-status-good" : o.skillDelta !== null && o.skillDelta < 0 ? "text-status-bad" : "text-secondary")} title={o.skillDelta === null && !checked ? "Measured when its skills are re-tested on the new model" : undefined}>
                {checked || o.skillDelta === null ? "—" : formatDelta(o.skillDelta)}
              </dd>
              <dt className="t-data">Cost per month</dt>
              <dd className={cn(o.wageDelta.amountMinor < 0 ? "text-status-good" : o.wageDelta.amountMinor > 0 ? "text-status-warn" : "text-secondary")}>{checked ? "—" : `${formatMoneyDelta(o.wageDelta)}/mo`}</dd>
              <dd className="col-span-2 justify-self-end pt-1">{checked ? null : <ProvenanceChip kind="estimate" />}</dd>
            </dl>
            {locked ? <Icon icon={Lock} size="inline" className="sr-only" label="Locked" /> : null}
          </label>
        );
      })}
    </div>
  );
}
