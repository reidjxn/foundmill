"use client";
/**
 * The business's logo image for the shell and Settings. `business.get` carries only the logo's metadata (its sha256);
 * the image comes from `business.logo.get`, cached under that version for good, so it is fetched once per logo rather
 * than with every `business.get`. Null while there is no logo (or while it loads): draw the initials mark.
 */
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc-react";

export function useBusinessLogoSrc(businessId: string, meta: { sha256: string } | null | undefined): string | null {
  const trpc = useTRPC();
  const q = useQuery(trpc.business.logo.get.queryOptions({ businessId, version: meta?.sha256 }, { enabled: Boolean(meta), staleTime: Infinity, gcTime: 60 * 60_000, retry: false }));
  if (!meta) return null;
  return q.data?.dataUrl ?? null;
}
