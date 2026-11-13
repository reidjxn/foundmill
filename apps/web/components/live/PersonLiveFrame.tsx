"use client";
/**
 * The frame for the people pages (/network, /communities, /profiles) of a signed-in person with no project yet
 * (docs/THESIS_REVIEW.md 2.4). A person with a project sees these pages in the business shell; here there is no
 * business, so the same screens sit in the plain person frame (StudioFrame): a way back to Home, and Network and
 * Communities side by side. The screens declare their title with `useShellChrome`; the provider here hands it to the frame.
 */
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@foundmill/dugout";
import { StudioFrame } from "@/components/new/StudioFrame";
import { ShellChromeProvider, useShellChromeValue } from "@/components/shell/chrome";

const LINKS = [
  { href: "/network", label: "Network" },
  { href: "/communities", label: "Communities" },
] as const;

export function PersonLiveFrame({ viewer, children }: { viewer?: { email: string | null }; children: ReactNode }) {
  return (
    <ShellChromeProvider>
      <FrameWithTitle viewer={viewer}>{children}</FrameWithTitle>
    </ShellChromeProvider>
  );
}

function FrameWithTitle({ viewer, children }: { viewer?: { email: string | null }; children: ReactNode }) {
  const chrome = useShellChromeValue();
  const pathname = usePathname() ?? "";
  return (
    <StudioFrame
      title={chrome.title ?? "People"}
      viewer={viewer}
      actions={
        <nav aria-label="People" className="flex items-center gap-1" data-testid="person-live-nav">
          <Link href="/home" className="inline-flex h-control-md items-center gap-1.5 rounded-sm px-2 t-action text-secondary hover:text-primary hover:no-underline focus-visible:shadow-ring" data-testid="person-live-home">
            <ArrowLeft aria-hidden className="size-icon-inline" />
            Home
          </Link>
          {LINKS.map((l) => {
            const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
            return (
              <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined} className={cn("inline-flex h-control-md items-center rounded-sm px-2 t-action hover:no-underline focus-visible:shadow-ring", active ? "text-primary" : "text-secondary hover:text-primary")}>
                {l.label}
              </Link>
            );
          })}
        </nav>
      }
    >
      <div className="-mx-gutter flex min-h-0 flex-1 flex-col" data-testid="person-live-frame">{children}</div>
    </StudioFrame>
  );
}
