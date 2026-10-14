"use client";
/**
 * What a route error boundary renders (app/b/[bid]/error.tsx, app/(live)/error.tsx, app/global-error.tsx).
 *
 * A screen whose code could not load (a ChunkLoadError: a deploy replaced the build while the tab was open, or the
 * network dropped the chunk) reloads the page once by itself and says so in product words; re-rendering cannot help,
 * because the runtime keeps the failed module load (lib/chunk-error.ts). Any other error offers Try again, which
 * re-fetches the segment from the server and renders it again (`retry`, not `reset`, which only re-renders).
 */
import { useEffect, useState } from "react";
import { APP_NAME } from "@foundmill/config";
import { isChunkLoadError, reloadForChunkError } from "@/lib/chunk-error";
import { useShellChrome } from "./chrome";
import { ErrorPanel } from "./ErrorPanel";

export interface RouteErrorProps {
  error: Error & { digest?: string };
  /** Re-fetch and re-render the segment (Next's `retry`). */
  retry: () => void;
  /** Where the error was caught, for the console line. */
  scope: string;
}

export const ROUTE_ERROR_TITLE = "This screen could not load";
export const UPDATED_RELOADING_LINE = `${APP_NAME} was updated. Reloading to get the new version…`;
export const UPDATED_RELOAD_LINE = `${APP_NAME} was updated, or the connection dropped while this screen loaded. Reload the page to get the latest version.`;

export function RouteError({ error, retry, scope }: RouteErrorProps) {
  const chunk = isChunkLoadError(error);
  // True while the automatic reload is under way; false once one already ran moments ago and the code is still missing.
  const [reloading, setReloading] = useState(chunk);
  // The top bar names what is on screen, not the screen the founder left.
  useShellChrome({ title: chunk ? "Updating" : "Not loaded" }, [chunk]);
  useEffect(() => {
    console.error(`[web] ${scope} route error`, error);
    if (chunk) setReloading(reloadForChunkError());
  }, [error, chunk, scope]);

  if (chunk) {
    return reloading ? (
      <ErrorPanel title={ROUTE_ERROR_TITLE} label="Updating" message={UPDATED_RELOADING_LINE} detail={error.message} />
    ) : (
      <ErrorPanel title={ROUTE_ERROR_TITLE} message={UPDATED_RELOAD_LINE} detail={error.message} onRetry={() => window.location.reload()} retryLabel="Reload" />
    );
  }
  return <ErrorPanel title={ROUTE_ERROR_TITLE} message={error.message || "Something went wrong while rendering this screen."} detail={error.digest} onRetry={retry} />;
}
