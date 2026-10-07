import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { APP_NAME, APP_ORIGIN, APP_TAGLINE } from "@foundmill/config";
import { LIMITS } from "@foundmill/config";
import { AppProviders } from "@/components/providers/AppProviders";
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
  // Desktop only (BUILD §2.1 rule 10): the shell measures the window and renders NeedsLargerWindow under 1280 px.
  width: LIMITS.minViewportWidth,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark" data-theme="dark" style={{ colorScheme: "dark" }}>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
