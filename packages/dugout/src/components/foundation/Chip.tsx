import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { Calculator, TrendingUp, X } from "lucide-react";
import type { DeptColourToken } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { ProvenanceTip } from "../guidance/ProvenanceTip";
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
        <button type="button" aria-pressed={selected} onClick={onClick} className={cn(base, "min-h-target")} data-tone={tone} data-chip="">
          {content}
        </button>
      </span>
    );
  }
  return (
    <span ref={ref} className={cn(base, onRemove && "min-h-target pr-0.5")} data-tone={tone} data-chip="" {...rest}>
      {content}
      {onRemove ? (
        <button
          type="button"
          aria-label={removeLabel}
          onClick={onRemove}
          className="hit-target inline-flex size-icon-inline shrink-0 items-center justify-center rounded-xs text-current opacity-75 transition-opacity hover:bg-white/8 hover:opacity-100 focus-visible:outline-1"
        >
          <Icon icon={X} size={10} strokeWidth={2.25} />
        </button>
      ) : null}
    </span>
  );
});

export type ProvenanceKind = "forecast" | "estimate";

export interface ProvenanceChipProps extends Omit<ChipProps, "children" | "tone" | "icon" | "onClick"> {
  kind: ProvenanceKind;
  /**
   * The figure that is an estimate or a forecast. It renders in the estimate style (`est-fig`: its own size and
   * color, a dashed underline); the word is its tooltip and the end of its accessible name. Without a figure the
   * word itself is shown: for a chart, a panel or a sentence, where no one figure carries it.
   */
  children?: ReactNode;
  /**
   * For the word alone. "chip" (default): the word in full in the data style. "word": the word in text-3, for 15 px
   * reading prose, after the number.
   */
  appearance?: "chip" | "word";
  /** Show the kind's icon (a trend line for Forecast, a calculator for Estimate) before the word. */
  showIcon?: boolean;
  /** For a figure on something clickable (a metric tile): a click on the figure does what a click beside it does. */
  onClick?: () => void;
}

export const PROVENANCE_WORD: Record<ProvenanceKind, string> = { forecast: "Forecast", estimate: "Estimate" };

/** The one-sentence meaning, opening on the word, when the definitions map has no entry for it. */
export const PROVENANCE_SENTENCE: Record<ProvenanceKind, string> = {
  forecast: "Forecast: a projected value, not a measurement.",
  estimate: "Estimate: an estimated value, not a measurement.",
};

/**
 * DESIGN §8 and §10 (founder, Nov 17, 2026): every non-real number renders in one style, a dashed underline under
 * the figure, and its screen carries the one legend line (EstimateLegend). Pass the figure as children. The word
 * "Estimate" or "Forecast" opens as a real tooltip on hover and focus, or as the definition card when the definitions
 * map holds `estimate` / `forecast` (ProvenanceTip, the client piece), and is read after the figure by a screen
 * reader. With no figure, the word is shown in the same style. The component itself is server-safe.
 */
export function ProvenanceChip({ kind, children, appearance = "chip", showIcon, className, mono: _mono, dot: _dot, fit: _fit, onRemove: _onRemove, removeLabel: _removeLabel, selected: _selected, ...rest }: ProvenanceChipProps) {
  // plain-allow: this is the definition; ProvenanceTip opens the word's meaning on hover and focus.
  const word = PROVENANCE_WORD[kind];
  const hasFigure = children !== undefined && children !== null && children !== false && children !== "";
  const chip = hasFigure ? (
    <button type="button" data-provenance={kind} data-appearance="figure" className={cn("est-fig rounded-xs in-data-[phone]:tap-reach", className)} {...rest}>
      {children}
      {/* Read after the figure by a screen reader, and copied with it: "$1,200 Estimate". */}{" "}
      <span className="sr-only">{word}</span>
    </button>
  ) : appearance === "word" ? (
    <button type="button" data-provenance={kind} data-appearance="word" className={cn("est-fig inline rounded-xs text-tertiary in-data-[phone]:tap-reach", className)} {...rest}>
      {word}
    </button>
  ) : (
    <button type="button" data-provenance={kind} data-appearance="chip" className={cn("est-chip in-data-[phone]:tap-reach", className)} {...rest}>
      {showIcon ? <Icon icon={kind === "forecast" ? TrendingUp : Calculator} size={11} /> : null}
      <span>{word}</span>
    </button>
  );
  return (
    <ProvenanceTip kind={kind} sentence={PROVENANCE_SENTENCE[kind]}>
      {chip}
    </ProvenanceTip>
  );
}

/** The legend's sentence, exactly (founder, Nov 17, 2026). */
export const ESTIMATE_LEGEND = "Numbers in this style are your team's estimates. Everything else is measured.";
const LEGEND_SAMPLE = "Numbers in this style";

export type EstimateLegendProps = HTMLAttributes<HTMLParagraphElement>;

/**
 * The single legend line of a screen that shows any estimate: its first words are drawn in the estimate style, so
 * the line is its own key. AppShell renders one for every console screen, in a footer that shows only while the page
 * holds an estimate (`est-legend-auto`); a screen outside the shell that shows an estimate renders one itself, inside
 * a landmark. One per screen.
 */
export function EstimateLegend({ className, ...rest }: EstimateLegendProps) {
  return (
    <p data-estimate-legend="" className={cn("text-small text-tertiary", className)} {...rest}>
      <span className="est-fig cursor-default">{LEGEND_SAMPLE}</span>
      {ESTIMATE_LEGEND.slice(LEGEND_SAMPLE.length)}
    </p>
  );
}

/** Department chip: a neutral chip with the department's dot and its glow, the name in text-2. */
export function DeptChip({ dept, className, ...rest }: Omit<ChipProps, "tone" | "dot"> & { dept: DeptColourToken }) {
  return <Chip tone="neutral" dot data-dept={dept} className={cn(DOT_TONE[dept], className)} {...rest} />;
}
