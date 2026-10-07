import { forwardRef, type ButtonHTMLAttributes } from "react";
import { ThumbsUp } from "lucide-react";
import { cn } from "../../lib/cn";
import { clampRating, ratingBandLabel, ratingTone, type RatingTone } from "../../lib/rating";
import { Icon } from "../foundation/Icon";
import { CHANNEL_ICONS, FORM_WORDS, channelLabel } from "./formation";
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
  className?: string;
}

/** Five 8 px cells, oldest left, newest right; each cell carries a word for assistive tech. */
export function FormGuide({ form, name = "Form", className }: FormGuideProps) {
  const cells = Array.from({ length: 5 }, (_, i) => form[form.length - 5 + i] ?? "none");
  return (
    <ol aria-label={`${name}, last five weeks: ${cells.map((c) => FORM_WORDS[c]).join(", ")}`} className={cn("flex gap-px", className)}>
      {cells.map((c, i) => (
        <li key={i} aria-hidden data-form={c} className={cn("size-2 rounded-xs", FORM_BG[c])} />
      ))}
    </ol>
  );
}

export interface ChannelTokenProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  channel: ChannelTokenData;
  /** Visual lift while dragging. */
  dragging?: boolean;
  /** Hide the name under the token (dense bench). */
  hideLabel?: boolean;
  /** Id of the keyboard-hint element for aria-describedby. */
  hintId?: string;
}

/**
 * A 56 px channel token (DESIGN §8): icon, fit badge in the rating ramp, thumbs-up when recommended, a five-cell form
 * guide underneath and the channel name. The button is the drag handle and the keyboard target.
 */
export const ChannelToken = forwardRef<HTMLButtonElement, ChannelTokenProps>(function ChannelToken({ channel, dragging, hideLabel, hintId, className, ...rest }, ref) {
  const fit = clampRating(channel.fit);
  const tone = ratingTone(fit);
  const label = channelLabel(channel.key);
  const name = `${label}, fit ${fit} of 20 (${ratingBandLabel(fit)})${channel.recommended ? ", recommended" : ""}, ${channel.enabled ? "on the pitch" : "on the bench"}${channel.paused ? ", paused" : ""}`;
  return (
    <span className={cn("flex w-18 flex-col items-center gap-1", className)} data-channel={channel.key} data-enabled={channel.enabled} data-recommended={channel.recommended || undefined}>
      <button
        ref={ref}
        type="button"
        aria-label={name}
        aria-describedby={hintId}
        aria-pressed={channel.enabled}
        data-dragging={dragging || undefined}
        className={cn(
          "relative inline-flex size-14 items-center justify-center rounded-full border-2 bg-panel-alt text-primary outline-none",
          "transition-[transform,box-shadow,border-color] duration-micro ease-dugout",
          "hover:border-secondary/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link",
          channel.enabled ? "border-kit-secondary/60" : "border-subtle",
          channel.paused && "opacity-60",
          dragging && "scale-105 cursor-grabbing shadow-overlay",
          !dragging && "cursor-grab",
        )}
        {...rest}
      >
        <Icon icon={CHANNEL_ICONS[channel.key]} size={20} />
        <span aria-hidden className={cn("absolute -bottom-0.5 -right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-panel px-1 font-display text-[11px] leading-none tabular-nums", RATING_BG[tone])}>
          {fit}
        </span>
        {channel.recommended ? (
          <span aria-hidden className="absolute -left-1 -top-0.5 inline-flex size-5 items-center justify-center rounded-full border-2 border-panel bg-kit-primary text-kit-on-primary">
            <Icon icon={ThumbsUp} size={10} strokeWidth={2.25} />
          </span>
        ) : null}
      </button>
      <FormGuide form={channel.form} name={`${label} form`} />
      {!hideLabel ? (
        <span className="max-w-full truncate text-center text-small leading-4 text-primary" aria-hidden>
          {label}
        </span>
      ) : null}
    </span>
  );
});
