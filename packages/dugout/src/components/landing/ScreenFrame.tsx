/**
 * A real screen shown on the landing page as an example (DESIGN §9a; DIRECTION §7 "Imagery"): the component itself,
 * with its real props, under a hairline with an "Example" chip on the edge. It has no surface of its own, so a card is
 * never inside a card, and inside it rating cells keep their color without a glow (`screen-frame`, landing.css).
 *
 * Server-safe: plain markup and `useId` (the caption names the figure).
 */
import { useId, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface ScreenFrameProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /** The chip on the edge. Every example on the landing page says what it is: "Example", "Example project". */
  label?: string;
  children: ReactNode;
}

export const SCREEN_FRAME_WORDS = { label: "Example" } as const;

export function ScreenFrame({ label = SCREEN_FRAME_WORDS.label, children, className, ...rest }: ScreenFrameProps) {
  const captionId = useId();
  return (
    <figure data-screen-frame="" aria-labelledby={captionId} className={cn("screen-frame m-0 w-full", className)} {...rest}>
      <figcaption id={captionId} className="screen-frame-chip">
        {label}
      </figcaption>
      {children}
    </figure>
  );
}
