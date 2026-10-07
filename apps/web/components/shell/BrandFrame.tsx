"use client";
/**
 * The signed-out frame (login, auth errors, API unreachable): a centred 480 px panel on bg-base with the Foundmill
 * wordmark and the tagline (DESIGN §8a: cap height 20–28 on the login lock-up).
 */
import type { ReactNode } from "react";
import { APP_NAME, APP_TAGLINE } from "@foundmill/config";
import { LogoMark, Wordmark } from "@foundmill/dugout";

export function BrandFrame({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-base p-gutter text-primary">
      <div className="w-[480px] max-w-full">
        <header className="mb-6 flex flex-col items-start gap-3">
          <LogoMark size={40} variant="tile" label={null} />
          <Wordmark height={24} label={APP_NAME} className="text-primary" />
          <p className="text-body text-secondary">{APP_TAGLINE}</p>
        </header>
        <section className="surface-panel rounded-panel border border-subtle bg-panel">{children}</section>
        {footer ? <footer className="mt-4 text-small text-secondary">{footer}</footer> : null}
      </div>
    </main>
  );
}
