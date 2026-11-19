"use client";
/**
 * The app prompt on a public page (WP-12 T8; CLAUDE.md "Small screens"): once the native app has launched, a project
 * page, a person page, a card and an invitation still show their content and, on a small window, offer the store links
 * under it. One value decides it: `NEXT_PUBLIC_STORE_LINKS` (`publicEnv().storeLinks`); unset, this renders nothing, so
 * every page reads as before. The rule for "small" is the one `DesktopOnly` uses.
 */
import { GetTheApp, isViewportTooSmall, useViewportWidth } from "@foundmill/dugout";
import { publicEnv } from "@/lib/env";

export function PublicAppPrompt() {
  const links = publicEnv().storeLinks;
  const small = isViewportTooSmall(useViewportWidth());
  if (!links || !small) return null;
  return (
    <div className="mx-auto w-full max-w-prose px-4 pb-6" data-testid="public-app-prompt">
      <GetTheApp links={links} />
    </div>
  );
}
