"use client";
import { RouteError } from "@/components/shell/RouteError";

export default function LiveError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError error={error} retry={retry} scope="LIVE" />;
}
