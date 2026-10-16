"use client";
/**
 * The frame for the signed-in screens outside a business (/onboarding, /new/*, /businesses): a 56 px glass top bar with
 * the Foundmill wordmark (DESIGN §8a), the first-run steps as a numbered trail joined by hairlines (none on account
 * pages such as Your businesses, which are not a first-run step), the viewer and Sign out; content on the canvas within a 1440 px measure, under the landing page's light in Foundmill steel. No sidebar,
 * no kit bar: there is no business yet, so no brand colours of its own.
 */
import { Check, LogOut } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { APP_NAME } from "@foundmill/config";
import { Icon, NeedsLargerWindow, ToastPlacement, Wordmark, cn, isViewportTooSmall, useViewportWidth } from "@foundmill/dugout";
import { SignOutButton } from "../shell/SignOutButton";

export type StudioStep = "profile" | "new" | "ideate" | "import" | "compare" | "commit";

export interface StudioStepItem {
  id: StudioStep;
  label: string;
  href: string;
}

export const STUDIO_STEPS: readonly StudioStepItem[] = [
  { id: "profile", label: "Profile", href: "/onboarding" },
  { id: "new", label: "New business", href: "/new" },
  { id: "ideate", label: "Ideate", href: "/new/ideate" },
  { id: "compare", label: "Compare", href: "/new/compare" },
  { id: "commit", label: "Commit", href: "/new/commit" },
];

/** Door B replaces Ideate + Compare in the trail. */
export const IMPORT_STEPS: readonly StudioStepItem[] = [
  { id: "profile", label: "Profile", href: "/onboarding" },
  { id: "new", label: "New business", href: "/new" },
  { id: "import", label: "Import", href: "/new/import" },
  { id: "commit", label: "Commit", href: "/new/commit" },
];

export interface StudioFrameProps {
  /** The first-run step on view; absent on account pages (Your businesses): no step trail. */
  step?: StudioStep;
  /** Which trail to draw (default the ideation trail; import pages pass IMPORT_STEPS). */
  steps?: readonly StudioStepItem[];
  /** Screen title (display-md) and one line under it. */
  title: ReactNode;
  lede?: ReactNode;
  /** Right side of the title row (primary action, chips). */
  actions?: ReactNode;
  viewer?: { email: string | null };
  /** Content width: "wide" (1440) or "measure" (960, forms). */
  width?: "wide" | "measure";
  children: ReactNode;
}

export function StudioFrame({ step, steps = STUDIO_STEPS, title, lede, actions, viewer, width = "wide", children }: StudioFrameProps) {
  // Desktop only (BUILD §5.3): under 1280 px the window is asked to grow instead of drawing a top bar that overflows.
  const viewportWidth = useViewportWidth();
  if (isViewportTooSmall(viewportWidth)) return <NeedsLargerWindow width={viewportWidth} />;
  const activeIndex = steps.findIndex((s) => s.id === step);
  return (
    <div className="relative isolate flex min-h-screen flex-col bg-canvas text-primary" data-testid="studio-frame" data-step={step || undefined}>
      {/* The landing page's light in Foundmill steel: there is no business yet, so no brand colour of its own. */}
      <div aria-hidden className="brand-backdrop -z-10" />
      {/* No sidebar here: toasts go bottom right, never onto the first column of cards. */}
      <ToastPlacement position="bottom-right" sidebar="none" />
      <header className="first-run-bar sticky top-0 z-20 flex h-kitbar shrink-0 items-center gap-8 px-gutter">
        <Link href="/" className="flex items-center text-primary hover:no-underline" aria-label={`${APP_NAME} home`}>
          <Wordmark height={20} label={APP_NAME} />
        </Link>
        {step ? (
          <nav aria-label="First-run steps" className="flex min-w-0 items-center">
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {steps.map((s, i) => {
                const done = i < activeIndex;
                const active = i === activeIndex;
                const content = (
                  <span className={cn("inline-flex h-control-md items-center gap-2 rounded-sm px-1.5 t-action transition-colors duration-hover", active ? "text-primary" : done ? "text-secondary hover:text-primary" : "text-tertiary")}>
                    <span
                      className={cn(
                        "inline-flex size-badge items-center justify-center rounded-pill font-mono text-micro tabular-nums",
                        active ? "bg-accent text-ink shadow-glow-accent" : done ? "bg-status-good/12 text-status-good ring-1 ring-status-good/40" : "ring-1 ring-line-strong",
                      )}
                      aria-hidden
                    >
                      {done ? <Icon icon={Check} size={12} strokeWidth={2.5} /> : i + 1}
                    </span>
                    {s.label}
                  </span>
                );
                return (
                  <li key={s.id} aria-current={active ? "step" : undefined} data-step-item={s.id} data-state={active ? "active" : done ? "done" : "upcoming"} className="flex items-center gap-2">
                    {i > 0 ? <span aria-hidden className={cn("h-px w-6", done || active ? "bg-line-strong" : "bg-line")} /> : null}
                    {done && s.href && s.id !== "compare" && s.id !== "commit" ? (
                      <Link href={s.href} className="rounded-sm hover:no-underline focus-visible:shadow-ring">
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {viewer?.email ? <span className="font-mono text-mono text-tertiary">{viewer.email}</span> : null}
          <SignOutButton icon={LogOut} />
        </div>
      </header>
      <main className={cn("mx-auto w-full flex-1 px-gutter pb-10 pt-8", width === "wide" ? "first-run-wide" : "first-run-measure")}>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="t-display-md text-balance">{title}</h1>
            {lede ? <p className="mt-1.5 max-w-reading text-body text-pretty text-secondary">{lede}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
        {children}
      </main>
    </div>
  );
}
