import type { HTMLAttributes } from "react";
import { MonitorUp } from "lucide-react";
import { APP_NAME } from "@foundmill/config";
import { cn } from "../../lib/cn";
import { Icon } from "../foundation/Icon";
import { MIN_VIEWPORT_WIDTH } from "./useViewportWidth";

export interface NeedsLargerWindowProps extends HTMLAttributes<HTMLDivElement> {
  /** The measured width, shown in mono. */
  width?: number;
  /** Minimum width in px (default 1280). */
  minWidth?: number;
}

/**
 * DESIGN §8: on the lit canvas, a monitor glyph on a soft disc, the display-md title, the body line with the minimum
 * width and the current width in mono. No mark: the FM monogram is reserved for the favicon. Server-safe.
 */
export function NeedsLargerWindow({ width, minWidth = MIN_VIEWPORT_WIDTH, className, ...rest }: NeedsLargerWindowProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="needs-larger-window"
      className={cn("canvas-lit flex min-h-screen w-full flex-col items-center justify-center gap-3 px-6 text-center text-primary", className)}
      {...rest}
    >
      <span aria-hidden className="icon-halo tone-kit-lift mb-2 size-control-xl">
        <Icon icon={MonitorUp} size="empty" />
      </span>
      <h1 className="t-display-md text-balance">This needs a larger window</h1>
      <p className="t-body max-w-reading text-pretty text-secondary">
        {APP_NAME} is built for desktop screens at least {minWidth} px wide. Widen the window or move to a larger display.
      </p>
      {typeof width === "number" ? (
        <p className="t-mono text-tertiary">
          Current width: <span className="text-primary">{Math.round(width)} px</span>
        </p>
      ) : null}
    </div>
  );
}
