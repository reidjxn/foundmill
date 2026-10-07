"use client";
/**
 * The frame for the signed-in screens outside a business (/onboarding, /new/*): a 56 px top bar with the Foundmill
 * marks (DESIGN §8a), the first-run steps as a trail, the viewer and Sign out; content on bg-base within a 1440 px
 * measure. No sidebar, no kit bar: there is no business yet, so no kit colours either.
 */
import { Check } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { APP_NAME } from "@foundmill/config";
import { Icon, LogoMark, Wordmark, cn } from "@foundmill/dugout";
import { LinkButton } from "./LinkButton";

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
  step: StudioStep;
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
  const activeIndex = steps.findIndex((s) => s.id === step);
  return (
    <div className="flex min-h-screen flex-col bg-base text-primary" data-testid="studio-frame" data-step={step}>
      <header className="flex h-14 shrink-0 items-center gap-6 border-b border-subtle bg-panel px-gutter">
        <Link href="/" className="flex items-center gap-3 text-primary hover:no-underline" aria-label={`${APP_NAME} home`}>
          <LogoMark size={24} variant="tile" label={null} />
          <Wordmark height={16} label={APP_NAME} />
        </Link>
        <nav aria-label="First-run steps" className="flex min-w-0 items-center gap-1">
          <ol className="flex items-center gap-1">
            {steps.map((s, i) => {
              const done = i < activeIndex;
              const active = i === activeIndex;
              const content = (
                <span className={cn("inline-flex h-7 items-center gap-1.5 rounded-chip px-2 t-tab", active ? "bg-panel-alt text-primary" : done ? "text-secondary hover:text-primary" : "text-secondary/60")}>
                  <span className={cn("inline-flex size-4 items-center justify-center rounded-full border text-label tabular-nums", active ? "border-link text-link" : done ? "border-status-good text-status-good" : "border-subtle")} aria-hidden>
                    {done ? <Icon icon={Check} size={10} /> : i + 1}
                  </span>
                  {s.label}
                </span>
              );
              return (
                <li key={s.id} aria-current={active ? "step" : undefined} data-step-item={s.id} data-state={active ? "active" : done ? "done" : "upcoming"}>
                  {done && s.href && s.id !== "compare" && s.id !== "commit" ? (
                    <Link href={s.href} className="hover:no-underline">
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
        <div className="ml-auto flex items-center gap-3">
          {viewer?.email ? <span className="text-small text-secondary">{viewer.email}</span> : null}
          <LinkButton variant="ghost" size="sm" href="/auth/signout" external>
            Sign out
          </LinkButton>
        </div>
      </header>
      <main className={cn("mx-auto w-full flex-1 px-gutter py-6", width === "wide" ? "max-w-[1440px]" : "max-w-[960px]")}>
        <div className="mb-5 flex items-end justify-between gap-6">
          <div className="min-w-0">
            <h1 className="t-display-md">{title}</h1>
            {lede ? <p className="mt-1 max-w-[720px] text-body text-secondary">{lede}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
        {children}
      </main>
    </div>
  );
}
