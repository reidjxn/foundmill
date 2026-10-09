import type { HTMLAttributes } from "react";
import { APP_NAME } from "@foundmill/config";
import { cn } from "../../lib/cn";
import { MIN_VIEWPORT_WIDTH } from "./useViewportWidth";

export interface NeedsLargerWindowProps extends HTMLAttributes<HTMLDivElement> {
  /** The measured width, shown in mono. */
  width?: number;
  /** Minimum width in px (default 1280). */
  minWidth?: number;
}

/** DESIGN §8: centred display-md title, body line with the minimum width, the current width in mono. No mark: the FM monogram is reserved for the favicon. */
export function NeedsLargerWindow({ width, minWidth = MIN_VIEWPORT_WIDTH, className, ...rest }: NeedsLargerWindowProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="needs-larger-window"
      className={cn("flex min-h-screen w-full flex-col items-center justify-center gap-3 bg-base px-6 text-center text-primary", className)}
      {...rest}
    >
      <h1 className="t-display-md">This needs a larger window</h1>
      <p className="t-body text-secondary">
        {APP_NAME} is built for desktop screens at least {minWidth} px wide. Widen the window or move to a larger display.
      </p>
      {typeof width === "number" ? (
        <p className="t-mono text-secondary">
          Current width: <span className="text-primary">{Math.round(width)} px</span>
        </p>
      ) : null}
    </div>
  );
}
