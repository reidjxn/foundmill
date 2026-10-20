"use client";
import { CirclePause, Hourglass, Plane, Power, type LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";
import { ProvenanceChip } from "../foundation/Chip";
import { useFormatters } from "../foundation/DateFormatProvider";
import { StatusPill, type StatusTone } from "../foundation/StatusPill";
import { Tooltip } from "../foundation/Tooltip";
import { useGuided } from "../guidance/GuidanceProvider";
import { Term } from "../guidance/Term";

export type AutopilotChipState = "off" | "on" | "waiting" | "paused";

/**
 * The one sentence that tells Autopilot apart from the founder's own Continue and from a vacation (UX plan B16): what
 * it does, and what it never does. Shown beside the chip in guided mode (`guide`), its first word a defined `Term`.
 */
export const AUTOPILOT_GUIDE_LINE = "Autopilot presses Continue for you on a schedule. It never answers notes for you.";
const GUIDE_WORD = "Autopilot";
const GUIDE_REST = AUTOPILOT_GUIDE_LINE.slice(GUIDE_WORD.length);

const STATE: Record<AutopilotChipState, { tone: StatusTone; icon: LucideIcon }> = {
  off: { tone: "neutral", icon: Power },
  on: { tone: "good", icon: Plane },
  waiting: { tone: "warn", icon: Hourglass },
  paused: { tone: "bad", icon: CirclePause },
};

export interface AutopilotChipProps {
  state: AutopilotChipState;
  /** The word: On, Needs your answer, Paused: credits used up, Off. */
  label: string;
  /** One plain sentence, shown as the tooltip and read by assistive tech. */
  detail?: string;
  /** The next planned cycle. A forecast, so it carries the Estimate tag. */
  nextAt?: Date | string | number | null;
  /** Makes the chip a button (open Settings › Mode). */
  onClick?: () => void;
  /**
   * Guided mode: `AUTOPILOT_GUIDE_LINE` beside the chip, one sentence that says what Autopilot does and never does
   * (Home passes it). Nothing when guidance is off: the chip's own words are the information.
   */
  guide?: boolean;
  className?: string;
}

/**
 * Autopilot's state on Home: "Autopilot" + a status pill (icon + word, so the state never rests on color) + the next
 * planned cycle with the dashed Estimate tag. The pill is amber while it waits for the founder, red while a guard rail
 * has paused it. A button when it opens Settings › Mode; the tooltip says why in plain words. With `guide`, in guided
 * mode, one sentence sits beside it: what Autopilot presses for you and what it never answers for you.
 */
export function AutopilotChip({ state, label, detail, nextAt, onClick, guide, className }: AutopilotChipProps) {
  const { formatDateShort, formatTime } = useFormatters();
  const guided = useGuided();
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
  const chip = detail ? <Tooltip content={detail}>{body}</Tooltip> : body;
  if (!guide || !guided) return chip;
  // The sentence sits beside the chip, outside its button, so the chip's name stays its state and the line is read as
  // ordinary text; "Autopilot" is the defined word there (a Term inside the chip's own button would nest two buttons).
  // It wraps under the chip before it squeezes it (never clipped).
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1" data-autopilot-guided="">
      {chip}
      <span className="text-small text-secondary" data-autopilot-guide="">
        <Term id="autopilot">{GUIDE_WORD}</Term>
        {GUIDE_REST}
      </span>
    </span>
  );
}
