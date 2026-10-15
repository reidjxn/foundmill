import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { preconnect, prefetchDNS } from "react-dom";
import { APP_NAME, APP_ORIGIN, APP_TAGLINE } from "@foundmill/config";
import { AppProviders } from "@/components/providers/AppProviders";
import { DesktopOnly } from "@/components/providers/DesktopOnly";
import { publicEnv } from "@/lib/env";
import { connectionHints } from "@/lib/same-origin-api";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(APP_ORIGIN),
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: APP_TAGLINE,
  applicationName: APP_NAME,
  openGraph: { title: APP_NAME, description: APP_TAGLINE, siteName: APP_NAME, type: "website" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0F1318",
  // Desktop only (BUILD §2.1 rule 10): DesktopOnly measures the window and renders NeedsLargerWindow under 1280 px. The
  // meta keeps Next's default `width=device-width`: forcing `width=1280` made a phone lay the page out at 1280 px (so the
  // measure never saw a small window) and show only its leftmost 390 px (audit PAS-4).
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // The first change, answer stream or event stream after load does not wait for DNS and TLS (audit WEB-2).
  const hints = connectionHints(publicEnv());
  if (hints.preconnect) preconnect(hints.preconnect, { crossOrigin: "anonymous" });
  if (hints.dnsPrefetch) prefetchDNS(hints.dnsPrefetch);
  return (
    <html lang="en" className="dark" data-theme="dark" style={{ colorScheme: "dark" }}>
      <body>
        <AppProviders>
          <DesktopOnly>{children}</DesktopOnly>
        </AppProviders>
      </body>
    </html>
  );
}
