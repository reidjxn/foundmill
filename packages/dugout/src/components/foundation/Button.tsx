"use client";
import { forwardRef, useState, type ButtonHTMLAttributes, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { Slot, Slottable } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Fan, LoaderCircle, Square } from "lucide-react";
import type { DeptColourToken } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { Icon, type IconComponent } from "./Icon";
import { FitText, FitTooltip, type FitState, type FitTextProps } from "./FitText";

/**
 * Buttons (DESIGN §8): sentence case, Inter 500, the icon before the label, 6 px radius; tactile (`pressable`: 1 px
 * down and .985 on press, a spring on release). The look of each variant lives in controls.css (btn-*), so links that
 * use `buttonVariants` directly get it too.
 */
export const buttonVariants = cva(
  [
    "relative inline-flex items-center justify-center whitespace-nowrap select-none",
    "rounded-sm border border-transparent font-body font-medium no-underline pressable",
    "disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress data-loading:opacity-50",
  ],
  {
    variants: {
      variant: {
        /** A flat fill of the brand colour: Continue at rest, Approve, Save and continue. Use sparingly (DESIGN §5). */
        primary: "btn-primary text-kit-on-primary",
        /** Secondary: a flat raised plate with a hairline ring. The default. */
        default: "btn-secondary text-primary",
        /** Alias of `default`, for call sites that name it. */
        secondary: "btn-secondary text-primary",
        ghost: "btn-ghost text-secondary hover:text-primary",
        /** A flat bright red with near-black text: the blocked Continue, destructive confirmations. */
        danger: "btn-danger text-ink",
        /** Customer Updates and milestones only. */
        gold: "btn-gold text-ink",
        /** Brand-tinted secondary: the likeliest quick reply, "More like this". */
        tinted: "btn-tinted text-primary",
        /** Brand-tinted glass pill: the marketing call to action, on the landing page and the sign-in frame only. */
        glass: "btn-glass rounded-full",
        /** Google's light-theme sign-in button: only through `GoogleSignInButton`, on the sign-in frame. */
        google: "btn-google rounded-full",
        /** The signature generate control (DESIGN §7): the only light slab in the product. See `running`, `progress`, `count`. */
        generate: "gen-slab font-semibold",
      },
      size: {
        sm: "h-control-sm gap-1.5 px-btn-sm text-action-sm",
        md: "h-control-md gap-2 px-btn-md text-action",
        lg: "h-control-lg gap-2 px-btn-lg text-action",
        xl: "h-control-xl gap-2.5 px-btn-lg text-action",
      },
    },
    compoundVariants: [
      { variant: "generate", size: "sm", className: "gap-1.5 pl-1 pr-btn-sm rounded-track" },
      { variant: "generate", size: "md", className: "gap-2 pl-1 pr-btn-md rounded-track" },
      { variant: "generate", size: "lg", className: "gap-2.5 pl-1.5 pr-btn-lg rounded-gen" },
      { variant: "generate", size: "xl", className: "gap-3 pl-2 pr-btn-lg rounded-gen text-reading" },
    ],
    defaultVariants: { variant: "default", size: "md" },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;
/** The context colour of an active toggle (its ring and glow). */
export type ButtonTone = "accent" | "kit" | "good" | "warn" | "bad" | "info" | "gold" | DeptColourToken;

const TONE_CLASS: Record<ButtonTone, string> = {
  accent: "tone-accent",
  kit: "tone-kit-lift",
  good: "tone-status-good",
  warn: "tone-status-warn",
  bad: "tone-status-bad",
  info: "tone-status-info",
  gold: "tone-gold",
  "dept-1": "tone-dept-1",
  "dept-2": "tone-dept-2",
  "dept-3": "tone-dept-3",
  "dept-4": "tone-dept-4",
  "dept-5": "tone-dept-5",
  "dept-6": "tone-dept-6",
  "dept-7": "tone-dept-7",
  "dept-8": "tone-dept-8",
};

/** Two-line buttons grow from their size's height instead of clipping. */
const MIN_HEIGHT: Record<ButtonSize, string> = {
  sm: "min-h-control-sm",
  md: "min-h-control-md",
  lg: "min-h-control-lg",
  xl: "min-h-control-xl",
};
const GEN_CORE: Record<ButtonSize, { tile: string; icon: number }> = {
  sm: { tile: "size-gen-core-sm", icon: 14 },
  md: { tile: "size-gen-core-md", icon: 16 },
  lg: { tile: "size-gen-core-lg", icon: 18 },
  xl: { tile: "size-gen-core", icon: 20 },
};

export type ButtonFitOptions = Pick<FitTextProps, "minPx" | "truncate" | "text">;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Leading Lucide icon. */
  icon?: IconComponent;
  /** Trailing Lucide icon. */
  iconRight?: IconComponent;
  /**
   * Shows a spinner in place of the leading icon, sets aria-busy and refuses clicks (generate: the running look). The
   * button stays focusable (aria-disabled, not `disabled`): a control that turns disabled under the keyboard drops focus
   * to `<body>` (WCAG 2.4.3), so a founder who pressed Save or Continue would lose their place.
   */
  loading?: boolean;
  /** Render the child element as the button (Radix Slot), e.g. a Next.js Link. `fit`, `lines` and `description` do not apply. */
  asChild?: boolean;
  children?: ReactNode;
  /**
   * Fit the label into the space the button is given (FitText): the font steps down to a floor, then (`lines={2}`)
   * the label wraps, then it truncates with a tooltip on the button. Pass options to set the floor or the tooltip text.
   */
  fit?: boolean | ButtonFitOptions;
  /** 2: the label may wrap to two lines and the button grows in height (decision options). Never truncates by itself. */
  lines?: 1 | 2;
  /** A consequence line under the label, for two-line options ("Hold a week" / "Stock-out risk in Nov"). */
  description?: ReactNode;
  /** An inline caps tag after the label ("Approve · Recommended"). */
  tag?: ReactNode;
  /** Active toggle: a tinted ring and a soft glow in `tone` (default the accent). Secondary and ghost variants. */
  active?: boolean;
  /** The context colour for `active`. */
  tone?: ButtonTone;
  /** Generate only: the running state (a dark slab, an orbiting edge, the fan turning). Clicks are ignored while running. */
  running?: boolean;
  /** Generate only: real progress 0–1 while running (a fill and a bottom rail). Omit for an indeterminate rail. */
  progress?: number;
  /** Generate only: the count chip, e.g. "2 of 12". */
  count?: ReactNode;
  /** Generate only: a key hint shown at rest, e.g. "⌘↵". */
  kbd?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    icon,
    iconRight,
    loading = false,
    asChild = false,
    disabled,
    children,
    type,
    fit,
    lines = 1,
    description,
    tag,
    active,
    tone,
    running,
    progress,
    count,
    kbd,
    onClick,
    style,
    "aria-disabled": ariaDisabled,
    ...rest
  },
  ref,
) {
  const [fitState, setFitState] = useState<FitState>("fits");
  const Comp = asChild ? Slot : "button";
  const sz: ButtonSize = size ?? "md";
  const isGen = variant === "generate";
  const genRunning = isGen && Boolean(running || loading);
  const iconSize = sz === "sm" ? "inline" : "default";
  const fitOpts: ButtonFitOptions = typeof fit === "object" ? fit : {};
  const fitting = Boolean(fit) && !asChild;
  const twoLine = !asChild && (lines === 2 || description !== undefined);

  let leading: ReactNode = null;
  if (isGen) {
    const core = GEN_CORE[sz];
    leading = (
      <span aria-hidden className={cn("gen-core", core.tile)} data-gen-core="">
        <Icon icon={Fan} size={core.icon} strokeWidth={1.9} className={genRunning ? "animate-fan" : undefined} />
      </span>
    );
  } else if (loading) leading = <Icon icon={LoaderCircle} size={iconSize} className="animate-spin" />;
  else if (icon) leading = <Icon icon={icon} size={iconSize} />;
  const trailing = iconRight ? <Icon icon={iconRight} size={iconSize} /> : null;

  const label: ReactNode = fitting ? (
    <FitText minPx={fitOpts.minPx} truncate={fitOpts.truncate} text={fitOpts.text} lines={lines} tooltip={false} onFitChange={setFitState}>
      {children}
    </FitText>
  ) : lines === 2 && !asChild ? (
    <span className="min-w-0 text-balance">{children}</span>
  ) : (
    children
  );
  const tagNode = tag ? <span className="btn-tag">{tag}</span> : null;
  const body: ReactNode = asChild ? (
    // Radix Slot wants exactly one element child; Slottable marks which child it merges into, so icons (or their
    // absence) around it never trip "Expected a single React element child". Not wrapped in a fragment: Slot looks for
    // the Slottable among its direct children.
    <Slottable>{children}</Slottable>
  ) : description !== undefined ? (
    <span className="flex min-w-0 flex-col items-start gap-0.5 text-left">
      <span className="inline-flex max-w-full items-center gap-1.5">
        {label}
        {tagNode}
      </span>
      <span className="btn-desc">{description}</span>
    </span>
  ) : isGen ? (
    <span className="gen-label">{label}</span>
  ) : (
    <>
      {label}
      {tagNode}
    </>
  );

  // Busy (not the generate control, which has its own running look): focusable, announced as unavailable, inert.
  const busy = Boolean(loading) && !isGen;
  const refuse = (e: MouseEvent<HTMLButtonElement>) => e.preventDefault();

  const pct = progress === undefined || !Number.isFinite(progress) ? undefined : Math.min(1, Math.max(0, progress));
  const genStyle = genRunning && pct !== undefined ? ({ "--gen-progress": pct } as CSSProperties) : undefined;

  const button = (
    <Comp
      ref={ref}
      type={asChild ? undefined : (type ?? "button")}
      className={cn(
        buttonVariants({ variant, size }),
        twoLine && cn("h-auto whitespace-normal py-1.5 text-left", MIN_HEIGHT[description !== undefined && (sz === "sm" || sz === "md") ? "lg" : sz]),
        description !== undefined && "justify-start",
        fitting && "min-w-0 max-w-full",
        tone && TONE_CLASS[tone],
        isGen && (genRunning ? "orbit" : "sheen"),
        className,
      )}
      style={genStyle ? { ...genStyle, ...style } : style}
      disabled={disabled}
      aria-disabled={ariaDisabled ?? (busy && !disabled ? true : undefined)}
      aria-busy={loading || genRunning || undefined}
      data-loading={loading || undefined}
      data-variant={variant ?? "default"}
      data-size={sz}
      data-active={active || undefined}
      data-running={genRunning || undefined}
      data-indeterminate={genRunning && pct === undefined ? "" : undefined}
      data-fit={fitting ? fitState : undefined}
      onClick={genRunning ? undefined : busy ? refuse : onClick}
      {...rest}
    >
      {genRunning ? <span aria-hidden className="gen-fill" /> : null}
      {genRunning ? <span aria-hidden className="gen-rail" /> : null}
      {leading}
      {body}
      {isGen && count !== undefined && count !== null ? <span className="gen-count">{count}</span> : null}
      {isGen && kbd && !genRunning ? <kbd className="gen-kbd">{kbd}</kbd> : null}
      {trailing}
    </Comp>
  );
  if (!fitting) return button;
  const tip = fitOpts.text ?? (typeof children === "string" ? children : undefined);
  return (
    <FitTooltip content={tip} enabled={fitState === "truncated"}>
      {button}
    </FitTooltip>
  );
});

export interface GenerateControlProps extends Omit<ButtonProps, "variant" | "running" | "children" | "onClick"> {
  /** The label at rest: what will be made ("Draft 12 concepts", "Draft a cover plan"). */
  label: ReactNode;
  /** The label while running ("Drafting concepts"). Defaults to `label`. */
  runningLabel?: ReactNode;
  running?: boolean;
  onGenerate?: () => void;
  /** Stop sits beside the control while it runs. Without it there is no Stop button. */
  onStop?: () => void;
  stopLabel?: string;
  /** Stop is pending (disables it). */
  stopping?: boolean;
  /** Classes for the wrapper (the control and Stop). */
  wrapperClassName?: string;
}

const STOP_SIZE: Record<ButtonSize, ButtonSize> = { sm: "sm", md: "sm", lg: "md", xl: "md" };

/**
 * The generate control with its Stop (DESIGN §7): at rest the light slab; running, the dark slab with real progress
 * and the count, and **Stop** beside it, always. A polite live region announces the running label and count.
 */
export function GenerateControl({
  label,
  runningLabel,
  running = false,
  onGenerate,
  onStop,
  stopLabel = "Stop",
  stopping,
  size = "xl",
  count,
  wrapperClassName,
  ...rest
}: GenerateControlProps) {
  const sz: ButtonSize = size ?? "xl";
  return (
    <span className={cn("inline-flex items-center gap-2", wrapperClassName)} data-generate-control="" data-running={running || undefined}>
      {running && onStop ? (
        <Button variant="default" size={STOP_SIZE[sz]} icon={Square} onClick={onStop} disabled={stopping} data-generate-stop="">
          {stopLabel}
        </Button>
      ) : null}
      <Button variant="generate" size={sz} running={running} count={running ? count : undefined} onClick={onGenerate} {...rest}>
        {running ? (runningLabel ?? label) : label}
      </Button>
      <span className="sr-only" aria-live="polite">
        {running ? (
          <>
            {runningLabel ?? label}
            {count !== undefined && count !== null ? <>, {count}</> : null}
          </>
        ) : null}
      </span>
    </span>
  );
}
