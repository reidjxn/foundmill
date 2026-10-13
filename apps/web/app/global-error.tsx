"use client";
/**
 * The last error boundary: an error in the root layout (or one no route boundary caught) replaces the whole document,
 * so this renders its own <html> and <body> with the app's styles. A chunk that failed to load reloads the page once,
 * like the route boundaries (components/shell/RouteError.tsx).
 */
import { APP_NAME } from "@foundmill/config";
import { RouteError } from "@/components/shell/RouteError";
import "./globals.css";

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en" className="dark" data-theme="dark" style={{ colorScheme: "dark" }}>
      <body>
        <title>{APP_NAME}</title>
        <main className="flex min-h-screen items-center justify-center bg-canvas text-primary">
          <div className="w-full max-w-xl">
            <RouteError error={error} retry={retry} scope="global" />
          </div>
        </main>
      </body>
    </html>
  );
}
