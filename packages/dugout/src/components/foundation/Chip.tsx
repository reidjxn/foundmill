import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { X, TrendingUp, Calculator } from "lucide-react";
import type { DeptColourToken } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { Icon, type IconComponent } from "./Icon";

export type ChipTone = "neutral" | "good" | "warn" | "bad" | "info" | "kit" | "gold" | "ink" | DeptColourToken;

/** Static class map so Tailwind can see every variant. */
const TONE_CLASS: Record<ChipTone, string> = {
  neutral: "bg-panel-alt text-secondary border-subtle",
  good: "bg-status-good/12 text-status-good border-transparent",
  warn: "bg-status-warn/12 text-status-warn border-transparent",
  bad: "bg-status-bad/12 text-status-bad border-transparent",
  info: "bg-status-info/12 text-status-info border-transparent",
  kit: "bg-kit-primary text-kit-on-primary border-transparent",
  gold: "bg-gold/15 text-gold border-transparent",
  ink: "bg-ink text-secondary border-subtle",
  "dept-1": "bg-dept-1/15 text-dept-1 border-transparent",
  "dept-2": "bg-dept-2/15 text-dept-2 border-transparent",
  "dept-3": "bg-dept-3/15 text-dept-3 border-transparent",
  "dept-4": "bg-dept-4/15 text-dept-4 border-transparent",
  "dept-5": "bg-dept-5/15 text-dept-5 border-transparent",
  "dept-6": "bg-dept-6/15 text-dept-6 border-transparent",
  "dept-7": "bg-dept-7/15 text-dept-7 border-transparent",
  "dept-8": "bg-dept-8/15 text-dept-8 border-transparent",
};

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: ChipTone;
  icon?: IconComponent;
  /** Mono text (model names, ids). */
  mono?: boolean;
  /** Shows a remove button; the chip becomes a group with a labelled control. */
  onRemove?: () => void;
  removeLabel?: string;
  /** Interactive chip (filter toggles). Renders a button. */
  onClick?: () => void;
  selected?: boolean;
  children: ReactNode;
}

/** 20 px tall, 3 px radius, label style (DESIGN §6). Colour comes with a word, never alone. */
export const Chip = forwardRef<HTMLSpanElement, ChipProps>(function Chip(
  { tone = "neutral", icon, mono, onRemove, removeLabel = "Remove", onClick, selected, className, children, ...rest },
  ref,
) {
  const base = cn(
    "inline-flex h-chip max-w-full items-center gap-1 rounded-chip border px-1.5 whitespace-nowrap align-middle",
    mono ? "font-mono text-mono normal-case tracking-normal" : "font-display font-semibold text-label uppercase tracking-label",
    TONE_CLASS[tone],
    onClick && "cursor-pointer transition-colors duration-micro ease-dugout hover:brightness-110",
    selected && "ring-1 ring-link",
    className,
  );
  const content = (
    <>
      {icon ? <Icon icon={icon} size={12} /> : null}
      <span className="truncate">{children}</span>
    </>
  );
  if (onClick) {
    return (
      <span ref={ref} className="inline-flex" {...rest}>
        <button type="button" aria-pressed={selected} onClick={onClick} className={base}>
          {content}
        </button>
      </span>
    );
  }
  return (
    <span ref={ref} className={cn(base, onRemove && "pr-0.5")} data-tone={tone} {...rest}>
      {content}
      {onRemove ? (
        <button
          type="button"
          aria-label={removeLabel}
          onClick={onRemove}
          className="inline-flex size-4 items-center justify-center rounded-chip hover:bg-white/8 focus-visible:outline-1"
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
}

/** DESIGN §10: every non-real number carries "Forecast" or "Estimate" in a label chip next to it. */
export function ProvenanceChip({ kind, ...rest }: ProvenanceChipProps) {
  return (
    <Chip tone="neutral" icon={kind === "forecast" ? TrendingUp : Calculator} title={kind === "forecast" ? "A projected value, not a measurement" : "An estimated value, not a measurement"} {...rest}>
      {kind === "forecast" ? "Forecast" : "Estimate"}
    </Chip>
  );
}

/** Department dot + name chip. */
export function DeptChip({ dept, children, ...rest }: Omit<ChipProps, "tone"> & { dept: DeptColourToken }) {
  return (
    <Chip tone={dept} {...rest}>
      <span className="inline-flex items-center gap-1">
        <span aria-hidden className="inline-block size-1.5 rounded-full bg-current" />
        {children}
      </span>
    </Chip>
  );
}
