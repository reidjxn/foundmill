"use client";
/**
 * The signed-out frame (login, auth errors, API unreachable): the Foundmill wordmark alone (no monogram: DESIGN §8a
 * keeps FM for the favicon) at 28 px cap height with the tagline under it, then one 480 px panel, then a footer line.
 * The page carries the landing page's atmosphere in Foundmill steel (no business exists yet): the steel light from the
 * top, the fading dotted grid, and a soft halo lifting the panel. The panel's header is the design system's Panel
 * header (title in sentence case, a rule that fades out), never a striped band.
 */
import type { ReactNode } from "react";
import { APP_NAME, APP_TAGLINE } from "@foundmill/config";
import { Panel, ToastPlacement, Wordmark } from "@foundmill/dugout";

export interface BrandFrameProps {
  /** The panel's title ("Sign in", "Not found"). */
  title?: ReactNode;
  /** Mono meta after the title. */
  meta?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

export function BrandFrame({ title, meta, children, footer }: BrandFrameProps) {
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
