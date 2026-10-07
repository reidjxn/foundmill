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
 * Model selection (BUILD §11.10 Training "Model" tab): Opus / Sonnet / Haiku with the predicted skill and wage deltas
 * (estimates), locked options with the reason, and warnings (Chief of Staff downgrade). A radio group.
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
            className={cn(
              "grid cursor-pointer grid-cols-[auto_1fr_auto] items-start gap-x-3 gap-y-1 rounded-panel border border-subtle bg-panel-alt p-3 transition-colors duration-micro ease-dugout",
              checked && "border-kit-primary/70",
              (locked || disabled) && "cursor-not-allowed opacity-60",
            )}
          >
            <input
              id={`${id}-${o.key}`}
              type="radio"
              name={id}
              value={o.key}
              checked={checked}
              disabled={disabled || locked}
              onChange={() => onChange(o.key)}
              className="mt-1 size-3.5 accent-kit-primary"
              aria-describedby={`${id}-${o.key}-desc`}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <ModelChip model={o.key} locked={locked} />
                <span className="text-body-strong text-primary">{o.label}</span>
                {checked ? <span className="t-label">Current</span> : null}
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
            <dl className="grid grid-cols-[auto_auto] gap-x-2 text-right text-small tabular-nums">
              <dt className="t-label">Skills</dt>
              <dd className={cn(o.skillDelta > 0 ? "text-status-good" : o.skillDelta < 0 ? "text-status-bad" : "text-secondary")}>{checked ? "—" : formatDelta(o.skillDelta)}</dd>
              <dt className="t-label">Wage</dt>
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
