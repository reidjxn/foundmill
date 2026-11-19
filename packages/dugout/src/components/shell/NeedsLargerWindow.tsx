import type { HTMLAttributes, ReactNode } from "react";
import { MonitorUp } from "lucide-react";
import { APP_NAME } from "@foundmill/config";
import { cn } from "../../lib/cn";
import { Icon } from "../foundation/Icon";
import { MIN_VIEWPORT_WIDTH } from "./useViewportWidth";

export interface NeedsLargerWindowProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** The measured width, shown in mono only with `showWidth`. */
  width?: number;
  /** Minimum width in px (default 1280), named in the width line. */
  minWidth?: number;
  /** The heading (default `NEEDS_LARGER_WINDOW_WORDS.title`). */
  title?: string;
  /** The line under it (default `NEEDS_LARGER_WINDOW_WORDS.body`). */
  body?: ReactNode;
  /** The ways on from here (WP-03 T3: the web passes "Email me a link" and a way back). A slot, so this stays server-safe. */
  actions?: ReactNode;
  /** Show the minimum and the measured width in mono (default false: a person on a phone does not need the pixels). */
  showWidth?: boolean;
}

/** The title is the founder's line of Nov 17, 2026 (WP-14 answer A6); the page's own actions follow it, so it is never a dead end. */
export const NEEDS_LARGER_WINDOW_WORDS = {
  title: `${APP_NAME} is built for a big screen.`,
  body: "It has tables and boards that do not fit a phone yet. Open it on a computer, or go back to what works here.",
} as const;

/**
 * DESIGN §8: on the lit canvas, a monitor glyph on a soft disc, the display-md title, the body line, then the
 * `actions` the page passes (never a dead end, CLAUDE.md "Small screens"). With `showWidth`, the minimum and the
 * current width in mono. No mark: the FM monogram is reserved for the favicon. Server-safe.
 */
export function NeedsLargerWindow({ width, minWidth = MIN_VIEWPORT_WIDTH, title = NEEDS_LARGER_WINDOW_WORDS.title, body = NEEDS_LARGER_WINDOW_WORDS.body, actions, showWidth = false, className, ...rest }: NeedsLargerWindowProps) {
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
      <h1 className="t-display-md text-balance">{title}</h1>
      <p className="t-body max-w-reading text-pretty text-secondary">{body}</p>
      {actions ? <div className="mt-3 flex w-full max-w-reading flex-col items-stretch gap-3">{actions}</div> : null}
      {showWidth ? (
        <p className="t-mono text-tertiary">
          {APP_NAME} needs a window at least {minWidth} px wide.
          {typeof width === "number" ? (
            <>
              {" "}
              Current width: <span className="text-primary">{Math.round(width)} px</span>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
