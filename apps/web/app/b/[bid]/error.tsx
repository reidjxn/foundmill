"use client";
import { useEffect } from "react";
import { ErrorPanel } from "@/components/shell/ErrorPanel";

export default function BusinessError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[web] business route error", error);
  }, [error]);
  return <ErrorPanel title="This screen could not load" message={error.message || "Something went wrong while rendering this screen."} detail={error.digest} onRetry={reset} />;
}
