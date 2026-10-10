import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { Calculator, TrendingUp, X } from "lucide-react";
import type { DeptColourToken } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { Icon, type IconComponent } from "./Icon";
import { FitText } from "./FitText";

export type ChipTone = "neutral" | "good" | "warn" | "bad" | "info" | "kit" | "gold" | "ink" | DeptColourToken;

/**
 * Static class map so Tailwind can see every variant. Neutral chips are a 3.5 % plate with a hairline ring; tinted
 * chips take their tone's 12 % fill and 30 % ring (chip-tone + tone-*), the text in the tone (controls.css).
 */
const TONE_CLASS: Record<ChipTone, string> = {
  neutral: "chip-plate text-secondary",
  good: "chip-tone tone-status-good text-status-good",
  warn: "chip-tone tone-status-warn text-status-warn",
  bad: "chip-tone tone-status-bad text-status-bad",
  info: "chip-tone tone-status-info text-status-info",
  // The brand as light, never as a painted fill (DESIGN §5): a kit-lift tint and ring, the word in kit-lift.
  kit: "chip-tone tone-kit-lift text-kit-lift",
  gold: "chip-tone tone-gold text-gold",
  ink: "bg-ink text-secondary border-line",
  "dept-1": "chip-tone tone-dept-1 text-dept-1",
  "dept-2": "chip-tone tone-dept-2 text-dept-2",
  "dept-3": "chip-tone tone-dept-3 text-dept-3",
  "dept-4": "chip-tone tone-dept-4 text-dept-4",
  "dept-5": "chip-tone tone-dept-5 text-dept-5",
  "dept-6": "chip-tone tone-dept-6 text-dept-6",
  "dept-7": "chip-tone tone-dept-7 text-dept-7",
  "dept-8": "chip-tone tone-dept-8 text-dept-8",
};

/** The dot's colour for a department chip (the chip itself stays neutral). */
const DOT_TONE: Record<DeptColourToken, string> = {
  "dept-1": "tone-dept-1",
  "dept-2": "tone-dept-2",
  "dept-3": "tone-dept-3",
  "dept-4": "tone-dept-4",
  "dept-5": "tone-dept-5",
  "dept-6": "tone-dept-6",
  "dept-7": "tone-dept-7",
  "dept-8": "tone-dept-8",
};

/** A caller that sets its own height (h-badge in a dense chart) keeps it; otherwise chips are at least 22 px and grow. */
export function hasFixedHeight(className: string | undefined): boolean {
  return /(^|\s)!?h-(?!auto\b)\S+/.test(className ?? "");
}

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: ChipTone;
  icon?: IconComponent;
  /** Mono text (model names, ids). */
  mono?: boolean;
  /** A 6 px dot in the chip's tone with its glow (department chips). */
  dot?: boolean;
  /**
   * Fit a tight slot (a table cell): the label steps its font down to a floor, then truncates with a tooltip. By
   * default a chip never truncates: its words wrap and the chip grows.
   */
  fit?: boolean;
  /** Shows a remove button; the chip becomes a group with a labelled control. */
  onRemove?: () => void;
  removeLabel?: string;
  /** Interactive chip (filter toggles). Renders a button. */
  onClick?: () => void;
  selected?: boolean;
  children: ReactNode;
}

/**
 * 22 px, 6 px radius, Inter 500 12, sentence case (DESIGN §8). Colour comes with a word, never alone. Server-safe: no
 * hooks, and the handlers it receives are passed through, never created here.
 */
export const Chip = forwardRef<HTMLSpanElement, ChipProps>(function Chip(
  { tone = "neutral", icon, mono, dot, fit, onRemove, removeLabel = "Remove", onClick, selected, className, children, ...rest },
  ref,
) {
  const base = cn(
    "inline-flex max-w-full items-center gap-1.5 rounded-sm border px-chip-x py-px align-middle",
    !hasFixedHeight(className) && "min-h-chip",
    mono ? "font-mono text-mono" : "font-body font-medium text-label",
    TONE_CLASS[tone],
    onClick && "cursor-pointer pressable hover:brightness-125",
    className,
  );
  const content = (
    <>
      {dot ? <span aria-hidden className="chip-dot" data-chip-dot="" /> : null}
      {icon ? <Icon icon={icon} size={12} /> : null}
      {fit ? <FitText>{children}</FitText> : <span className="min-w-0 break-words hyphens-auto">{children}</span>}
    </>
  );
  if (onClick) {
    return (
      <span ref={ref} className="inline-flex max-w-full" {...rest}>
        <button type="button" aria-pressed={selected} onClick={onClick} className={base} data-tone={tone} data-chip="">
          {content}
        </button>
      </span>
    );
  }
  return (
    <span ref={ref} className={cn(base, onRemove && "pr-0.5")} data-tone={tone} data-chip="" {...rest}>
      {content}
      {onRemove ? (
        <button
          type="button"
          aria-label={removeLabel}
          onClick={onRemove}
          className="inline-flex size-icon-inline shrink-0 items-center justify-center rounded-xs text-current opacity-75 transition-opacity hover:bg-white/8 hover:opacity-100 focus-visible:outline-1"
        >
          <Icon icon={X} size={10} strokeWidth={2.25} />
        </button>
      ) : null}
    </span>
  );
});

export type ProvenanceKind = "forecast" | "estimate";

export interface ProvenanceChipProps extends Omit<ChipProps, "children" | "tone" | "icon"> {
  kind: ProvenanceKind;
  /**
   * "chip" (default): the dashed 18 px chip, the word in full in the data style. "word": the word alone in text-3,
   * for 15 px reading prose, after the number.
   */
  appearance?: "chip" | "word";
  /** Show the kind's icon (a trend line for Forecast, a calculator for Estimate) before the word. */
  showIcon?: boolean;
}

/**
 * DESIGN §8: every non-real number carries "Forecast" or "Estimate". A dashed edge always means "not measured". Keep
 * it at least 4 px from its figure. Server-safe.
 */
export function ProvenanceChip({ kind, appearance = "chip", showIcon, className, mono: _mono, dot: _dot, fit: _fit, onRemove: _onRemove, removeLabel: _removeLabel, selected: _selected, ...rest }: ProvenanceChipProps) {
  const word = kind === "forecast" ? "Forecast" : "Estimate";
  const title = kind === "forecast" ? "A projected value, not a measurement" : "An estimated value, not a measurement";
  if (appearance === "word") {
    return (
      <span title={title} data-provenance={kind} className={cn("text-tertiary", className)} {...rest}>
        {word}
      </span>
    );
  }
  return (
    <span title={title} data-provenance={kind} className={cn("est-chip", className)} {...rest}>
      {showIcon ? <Icon icon={kind === "forecast" ? TrendingUp : Calculator} size={11} /> : null}
      <span>{word}</span>
    </span>
  );
}

/** Department chip: a neutral chip with the department's dot and its glow, the name in text-2. */
export function DeptChip({ dept, className, ...rest }: Omit<ChipProps, "tone" | "dot"> & { dept: DeptColourToken }) {
  return <Chip tone="neutral" dot data-dept={dept} className={cn(DOT_TONE[dept], className)} {...rest} />;
}
