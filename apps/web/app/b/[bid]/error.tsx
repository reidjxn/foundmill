"use client";
import { RouteError } from "@/components/shell/RouteError";

export default function BusinessError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError error={error} retry={retry} scope="business" />;
}
