"use client";
/**
 * The signed-out frame (login, auth errors, API unreachable): a centred 480 px panel on bg-base with the Foundmill
 * wordmark alone (no monogram: DESIGN §8a keeps FM for the favicon) and the tagline; cap height 28, the top of the 20–28 lock-up range.
 */
import type { ReactNode } from "react";
import { APP_NAME, APP_TAGLINE } from "@foundmill/config";
import { Wordmark } from "@foundmill/dugout";

export function BrandFrame({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-base p-gutter text-primary">
      <div className="w-[480px] max-w-full">
        <header className="mb-6 flex flex-col items-start gap-3">
          <Wordmark height={28} label={APP_NAME} className="text-primary" />
          <p className="text-body text-secondary">{APP_TAGLINE}</p>
        </header>
        <section className="surface-panel rounded-panel border border-subtle bg-panel">{children}</section>
        {footer ? <footer className="mt-4 text-small text-secondary">{footer}</footer> : null}
      </div>
    </main>
  );
}
