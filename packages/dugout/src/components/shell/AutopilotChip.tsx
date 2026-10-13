"use client";
import { CirclePause, Hourglass, Plane, Power, type LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";
import { ProvenanceChip } from "../foundation/Chip";
import { useFormatters } from "../foundation/DateFormatProvider";
import { StatusPill, type StatusTone } from "../foundation/StatusPill";
import { Tooltip } from "../foundation/Tooltip";

export type AutopilotChipState = "off" | "on" | "waiting" | "paused";

const STATE: Record<AutopilotChipState, { tone: StatusTone; icon: LucideIcon }> = {
  off: { tone: "neutral", icon: Power },
  on: { tone: "good", icon: Plane },
  waiting: { tone: "warn", icon: Hourglass },
  paused: { tone: "bad", icon: CirclePause },
};

export interface AutopilotChipProps {
  state: AutopilotChipState;
  /** The word: On, Waiting for you, Paused: credits used up, Off. */
  label: string;
  /** One plain sentence, shown as the tooltip and read by assistive tech. */
  detail?: string;
  /** The next planned cycle. A forecast, so it carries the Estimate tag. */
  nextAt?: Date | string | number | null;
  /** Makes the chip a button (open Settings › Mode). */
  onClick?: () => void;
  className?: string;
}

/**
 * Autopilot's state on Home: "Autopilot" + a status pill (icon + word, so the state never rests on color) + the next
 * planned cycle with the dashed Estimate tag. The pill is amber while it waits for the founder, red while a guard rail
 * has paused it. A button when it opens Settings › Mode; the tooltip says why in plain words.
 */
export function AutopilotChip({ state, label, detail, nextAt, onClick, className }: AutopilotChipProps) {
  const { formatDateShort, formatTime } = useFormatters();
  const s = STATE[state];
  const hasNext = nextAt !== null && nextAt !== undefined && (state === "on" || state === "waiting");
  const content = (
    <>
      <span className="text-label font-medium text-secondary">Autopilot</span>
      <StatusPill tone={s.tone} icon={s.icon} pulse={state === "waiting"}>
        {label}
      </StatusPill>
      {hasNext ? (
        <span className="inline-flex items-center gap-1.5 text-small text-secondary" data-autopilot-next="">
          <span>
            Next cycle <span className="tabular-nums text-primary">{formatDateShort(nextAt)}, {formatTime(nextAt)}</span>
          </span>
          <ProvenanceChip kind="estimate" />
        </span>
      ) : null}
    </>
  );
  const common = {
    "data-autopilot-state": state,
    "data-testid": "autopilot-chip",
    "aria-label": `Autopilot: ${label}${detail ? `. ${detail}` : ""}`,
    className: cn("inline-flex min-h-control-md flex-wrap items-center gap-2 rounded-sm", onClick && "cursor-pointer focus-visible:outline-none", className),
  };
  const body = onClick ? (
    <button type="button" onClick={onClick} {...common}>
      {content}
    </button>
  ) : (
    <span role="group" {...common}>
      {content}
    </span>
  );
  return detail ? <Tooltip content={detail}>{body}</Tooltip> : body;
}
