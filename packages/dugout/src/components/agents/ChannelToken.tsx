import { forwardRef, type ButtonHTMLAttributes, type CSSProperties } from "react";
import { ThumbsUp } from "lucide-react";
import { cn } from "../../lib/cn";
import { clampRating, ratingBandLabel, ratingTone, type RatingTone } from "../../lib/rating";
import { Icon } from "../foundation/Icon";
import { Tooltip } from "../foundation/Tooltip";
import { CHANNEL_ICONS, COST_TREND_LABEL, FORM_WORDS, channelLabel, costTrendKey } from "./formation";
import type { ChannelTokenData, FormCell } from "./types";

const RATING_BG: Record<RatingTone, string> = {
  "rating-1": "bg-rating-1 text-base",
  "rating-2": "bg-rating-2 text-base",
  "rating-3": "bg-rating-3 text-base",
  "rating-4": "bg-rating-4 text-base font-semibold",
};

const FORM_BG: Record<FormCell, string> = { good: "bg-status-good", warn: "bg-status-warn", bad: "bg-status-bad", none: "bg-panel-alt" };

export interface FormGuideProps {
  form: readonly FormCell[];
  /** Accessible name prefix. */
  name?: string;
  /** Show the key ("Last 5 weeks against the cost target: 4 under, 1 near") on hover and focus (default true). */
  tooltip?: boolean;
  className?: string;
}

/**
 * The cost trend: five 8 px cells, oldest left, newest right, each a week's cost per customer against the channel's
 * cost target. Each cell carries a word for assistive tech and the strip carries its key as a tooltip.
 */
// TODO(guided-layer): ScaleLabel carries the key once it lands; the Tooltip is the Phase 0 form.
export function FormGuide({ form, name = COST_TREND_LABEL, tooltip = true, className }: FormGuideProps) {
  const cells = Array.from({ length: 5 }, (_, i) => form[form.length - 5 + i] ?? "none");
  const strip = (
    <ol aria-label={`${name}, last five weeks: ${cells.map((c) => FORM_WORDS[c]).join(", ")}`} className={cn("flex gap-px", className)} data-form-guide="">
      {cells.map((c, i) => (
        <li key={i} aria-hidden data-form={c} className={cn("size-2 rounded-xs", FORM_BG[c])} />
      ))}
    </ol>
  );
  if (!tooltip) return strip;
  return <Tooltip content={costTrendKey(form)}>{strip}</Tooltip>;
}

/** Ring and fill from the family accent: a lit ring on a faint wash when running, a quiet ring when off the board. */
function tokenStyle(accent: string | undefined, enabled: boolean): CSSProperties | undefined {
  if (!accent) return undefined;
  return enabled
    ? { borderColor: `color-mix(in oklab, ${accent} 88%, var(--white))`, backgroundColor: `color-mix(in oklab, ${accent} 18%, var(--bg-ink))` }
    : { borderColor: `color-mix(in oklab, ${accent} 32%, var(--line-subtle))`, backgroundColor: "var(--bg-panel-alt)" };
}

export interface ChannelTokenProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  channel: ChannelTokenData;
  /** Visual lift while dragging. */
  dragging?: boolean;
  /** Hide the name under the token (dense bench). */
  hideLabel?: boolean;
  /** Id of the keyboard-hint element for aria-describedby. */
  hintId?: string;
  /** Family accent (a CSS colour such as `var(--dept-6)`): the ring and halo on the board, a quiet tint off it. */
  accent?: string;
  /** Show the whole name, centred under the token and wider than it (on the board, where there is room). */
  fullLabel?: boolean;
  /** Set the name on a faint ink plate so lines passing behind it never cut through the text (the map). */
  labelPlate?: boolean;
}

/**
 * A 56 px channel token (DESIGN §8): icon, fit badge in the rating ramp, thumbs-up when recommended, a five-cell
 * cost-trend strip underneath and the channel name. Running tokens wear their family accent as a ring with a
 * soft halo; tokens off the board keep a quiet tint of it. The button is the drag handle and the keyboard target.
 */
export const ChannelToken = forwardRef<HTMLButtonElement, ChannelTokenProps>(function ChannelToken({ channel, dragging, hideLabel, hintId, accent, fullLabel, labelPlate, className, style, ...rest }, ref) {
  const fit = clampRating(channel.fit);
  const scored = channel.scored !== false;
  const tone = ratingTone(fit);
  const label = channelLabel(channel.key);
  const name = `${label}, ${scored ? `fit ${fit} of 20 (${ratingBandLabel(fit)})` : "not scored yet"}${channel.recommended ? ", recommended" : ""}, ${channel.enabled ? "on the board" : "off the board"}${channel.paused ? ", paused" : ""}`;
  return (
    <span className={cn("flex w-18 flex-col items-center gap-1", className)} data-channel={channel.key} data-enabled={channel.enabled} data-recommended={channel.recommended || undefined}>
      <span className="relative inline-flex">
        {accent && channel.enabled && !channel.paused ? (
          <span aria-hidden data-token-halo className="pointer-events-none absolute -inset-4 rounded-full" style={{ background: `radial-gradient(closest-side, color-mix(in oklab, ${accent} 34%, transparent), transparent)` }} />
        ) : null}
        <button
          ref={ref}
          type="button"
          aria-label={name}
          aria-describedby={hintId}
          aria-pressed={channel.enabled}
          data-dragging={dragging || undefined}
          className={cn(
            "relative inline-flex size-14 items-center justify-center rounded-full border-2 bg-panel-alt outline-none",
            "transition-[transform,border-color,background-color,color] duration-micro ease-dugout",
            "hover:-translate-y-px focus-visible:shadow-ring",
            accent ? (channel.enabled ? "text-primary" : "text-secondary hover:text-primary") : cn("text-primary hover:border-secondary/70", channel.enabled ? "border-kit-secondary/60" : "border-subtle"),
            channel.paused && "opacity-60",
            dragging && "scale-105 cursor-grabbing shadow-overlay",
            !dragging && "cursor-grab",
          )}
          style={{ ...tokenStyle(accent, channel.enabled), ...style }}
          {...rest}
        >
          <Icon icon={CHANNEL_ICONS[channel.key]} size={20} />
        </button>
        {/* The fit badge and the recommendation mark sit on the token's rim, outside the button's box, so the button
            never spills past its own edge (they move with it: same wrapper). */}
        <span aria-hidden data-unscored={scored ? undefined : ""} className={cn("pointer-events-none absolute -bottom-0.5 -right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-surface-1 px-1 font-display text-micro leading-none tabular-nums", scored ? RATING_BG[tone] : "bg-panel text-secondary", dragging && "scale-105")}>
          {scored ? fit : "–"}
        </span>
        {channel.recommended ? (
          <span aria-hidden className="pointer-events-none absolute -left-1 -top-0.5 inline-flex size-5 items-center justify-center rounded-full border-2 border-surface-1 bg-kit-primary text-kit-on-primary">
            <Icon icon={ThumbsUp} size={10} strokeWidth={2.25} />
          </span>
        ) : null}
      </span>
      <FormGuide form={channel.form} name={`${label} ${COST_TREND_LABEL.toLowerCase()}`} tooltip={!dragging} />
      {!hideLabel ? (
        <span className={cn("text-center text-small leading-4 text-primary", fullLabel ? "w-max whitespace-nowrap" : "max-w-full truncate", labelPlate && "rounded-chip bg-ink/70 px-1")} title={fullLabel ? undefined : label} aria-hidden>
          {label}
        </span>
      ) : null}
    </span>
  );
});
