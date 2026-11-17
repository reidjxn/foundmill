/**
 * One section of the landing page (DESIGN §9a): its heading, an optional lede, the words, and an optional real screen
 * beside them from 1024 px (under them before). One idea per section. The heading's id is `<id>-title`, focusable from
 * script, so a link that takes a visitor to the section can move focus to it.
 *
 * Server-safe: plain markup.
 */
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface LandingSectionProps extends Omit<HTMLAttributes<HTMLElement>, "title" | "children"> {
  id: string;
  title: ReactNode;
  lede?: ReactNode;
  /** The words of the section, under the lede. */
  children?: ReactNode;
  /** A real screen (a `ScreenFrame`), beside the words from 1024 px. */
  screen?: ReactNode;
}

export function LandingSection({ id, title, lede, children, screen, className, ...rest }: LandingSectionProps) {
  const words = (
    <div className="landing-measure flex flex-col gap-5">
      <h2 id={`${id}-title`} tabIndex={-1} className="t-landing-h2 text-primary outline-none">
        {title}
      </h2>
      {lede ? <p className="t-landing-lede">{lede}</p> : null}
      {children}
    </div>
  );
  return (
    <section id={id} aria-labelledby={`${id}-title`} data-landing-section={id} className={cn("landing-section", className)} {...rest}>
      <div className="landing-col">
        {screen ? (
          <div className="landing-split">
            {words}
            {screen}
          </div>
        ) : (
          words
        )}
      </div>
    </section>
  );
}
