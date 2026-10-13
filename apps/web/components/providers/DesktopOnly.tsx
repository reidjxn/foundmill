"use client";
/**
 * Desktop only (BUILD §2.1 rule 10, DESIGN line 19): below 1280 px every page, the sign-in page and its notices included,
 * renders NeedsLargerWindow and nothing else. The viewport meta stays `width=device-width` (app/layout.tsx), so a phone or
 * tablet reports its real width here instead of a 1280 px layout viewport it would show as a 390 px slice (audit PAS-4).
 * Unmeasured (server render) counts as large enough, like the landing page and the business shell.
 */
import type { ReactNode } from "react";
import { NeedsLargerWindow, isViewportTooSmall, useViewportWidth } from "@foundmill/dugout";

export function DesktopOnly({ children }: { children: ReactNode }) {
  const width = useViewportWidth();
  if (isViewportTooSmall(width)) return <NeedsLargerWindow width={width} />;
  return <>{children}</>;
}
