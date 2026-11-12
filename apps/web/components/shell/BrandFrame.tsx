"use client";
/**
 * The signed-out frame (login, auth errors, API unreachable): the Foundmill wordmark alone (no monogram: DESIGN §8a
 * keeps FM for the favicon) at 28 px cap height with the tagline under it, then one 480 px panel, then a footer line.
 * The page carries the landing page's atmosphere in Foundmill steel (no business exists yet): the steel light from the
 * top, the fading dotted grid, and a soft halo lifting the panel. The panel's header is the design system's Panel
 * header (title in sentence case, a rule that fades out), never a striped band.
 */
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { worksOnSmallScreens } from "@/components/providers/DesktopOnly";
import { APP_NAME, APP_TAGLINE } from "@foundmill/config";
import {
  NeedsLargerWindow,
  Panel,
  ToastPlacement,
  Wordmark,
  isViewportTooSmall,
  useViewportWidth,
} from "@foundmill/dugout";

export interface BrandFrameProps {
  /** The panel's title ("Sign in", "Not found"). */
  title?: ReactNode;
  /** Mono meta after the title. */
  meta?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * The page works from 390 px (the sign-in page: CLAUDE.md "Small screens"): the frame renders at every width instead
   * of asking for a larger window. The column is already 480 px at most and 100 % of the gutter-padded width.
   */
  smallScreen?: boolean;
}

export function BrandFrame({
  title,
  meta,
  children,
  footer,
  smallScreen = false,
}: BrandFrameProps) {
  // Desktop only: below 1280 px the window is asked to grow, as on the landing page and in the business shell, except
  // with `smallScreen` (the sign-in page) or on the small-screen routes (CLAUDE.md "Small screens": the pages an email
  // opens use this frame).
  const width = useViewportWidth();
  const pathname = usePathname();
  if (!smallScreen && !worksOnSmallScreens(pathname) && isViewportTooSmall(width))
    return <NeedsLargerWindow width={width} />;
  return (
    <main className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-canvas p-gutter text-primary">
      <div aria-hidden className="brand-backdrop -z-10" />
      {/* No sidebar: toasts go bottom right, clear of the centred panel. */}
      <ToastPlacement position="bottom-right" sidebar="none" />
      <div className="brand-column relative animate-rise-in">
        <header className="mb-8 flex flex-col items-start gap-3">
          <Wordmark height={28} label={APP_NAME} className="text-primary" />
          <p className="text-body text-secondary">{APP_TAGLINE}</p>
        </header>
        <div className="relative">
          <div aria-hidden className="brand-halo -z-10" />
          <Panel title={title ?? APP_NAME} meta={meta} glow="brand" data-testid="brand-panel">
            {children}
          </Panel>
        </div>
        {footer ? <footer className="mt-4 text-small text-secondary">{footer}</footer> : null}
      </div>
    </main>
  );
}
