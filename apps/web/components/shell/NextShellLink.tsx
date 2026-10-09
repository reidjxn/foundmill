"use client";
/**
 * Dugout's shell links (Sidebar, TabBar, Breadcrumbs) rendered through next/link (docs/DECISIONS.md "Links are injected").
 *
 * Prefetch on intent: a link switches to Next's default prefetching (`prefetch={null}`) the moment the pointer enters
 * it, it takes focus or it is touched, so by the click its route is ready down to the loading skeleton and the screen
 * changes at once (Next.js guide "Prefetching" › "Hover-triggered prefetch"). Not on mere visibility: every prefetch is
 * a request through the proxy's session check and the business layout's metadata, and the sidebar alone shows about
 * fifteen links on every screen.
 *
 * The link navigates by itself. While its click handler runs, `isShellLinkClick()` is true so the shell's `onNavigate`
 * (which the Sidebar also calls on click, and which keyboard chords and the logo button use) does not push the same
 * route a second time, and a modified click (new tab) leaves the current tab where it is.
 */
import Link from "next/link";
import { useState, type Ref } from "react";
import type { ShellLinkProps, ShellLinkRenderer } from "@foundmill/dugout";

let clicking = 0;

/** True while a shell link's own click handler is running. */
export function isShellLinkClick(): boolean {
  return clicking > 0;
}

export function IntentPrefetchLink({ href, children, linkRef, onClick, ...rest }: ShellLinkProps & { linkRef?: Ref<HTMLAnchorElement> }) {
  const [intent, setIntent] = useState(false);
  const arm = () => {
    if (!intent) setIntent(true);
  };
  return (
    <Link
      href={href}
      ref={linkRef}
      prefetch={intent ? null : false}
      onMouseEnter={arm}
      onFocus={arm}
      onTouchStart={arm}
      {...rest}
      onClick={(event) => {
        clicking += 1;
        try {
          onClick?.(event);
        } finally {
          clicking -= 1;
        }
      }}
    >
      {children}
    </Link>
  );
}

export const renderNextShellLink: ShellLinkRenderer = ({ ref, ...props }) => <IntentPrefetchLink {...props} linkRef={ref} />;
