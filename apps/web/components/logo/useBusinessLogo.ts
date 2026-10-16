"use client";
/**
 * The business's logo image for the shell and Settings. `business.get` carries only the logo's metadata (its sha256);
 * the image comes from `business.logo.get`, cached under that version for good, so it is fetched once per logo rather
 * than with every `business.get`. Null while there is no logo (or while it loads): draw the initials mark.
 */
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTRPC } from "@/lib/trpc-react";

export function useBusinessLogoSrc(businessId: string, meta: { sha256: string } | null | undefined): string | null {
  const trpc = useTRPC();
  const q = useQuery(trpc.business.logo.get.queryOptions({ businessId, version: meta?.sha256 }, { enabled: Boolean(meta), staleTime: Infinity, gcTime: 60 * 60_000, retry: false }));
  if (!meta) return null;
  return q.data?.dataUrl ?? null;
}

/**
 * Logos of several businesses (Switch business, Your businesses): `business.logo.get` per business with a logo, under
 * the same keys as useBusinessLogoSrc (so the open business's logo is a cache hit), fetched only while `enabled`.
 * Business id → data URL (null while loading or without a logo).
 */
export function useBusinessLogos(rows: readonly { id: string; logo: { sha256: string } | null }[] | undefined, enabled: boolean): Record<string, string | null> {
  const trpc = useTRPC();
  const withLogo = useMemo(() => (rows ?? []).filter((r): r is { id: string; logo: { sha256: string } } => r.logo !== null), [rows]);
  const results = useQueries({
    queries: withLogo.map((r) => trpc.business.logo.get.queryOptions({ businessId: r.id, version: r.logo.sha256 }, { enabled, staleTime: Infinity, gcTime: 60 * 60_000, retry: false })),
  });
  const urls = results.map((q) => q.data?.dataUrl ?? null);
  const key = withLogo.map((r, i) => `${r.id}:${urls[i] ? r.logo.sha256 : ""}`).join("|");
  // A stable object while the logos stay the same (the switcher's rows are memoized on it).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures ids and loaded logos
  return useMemo(() => Object.fromEntries(withLogo.map((r, i) => [r.id, urls[i] ?? null])), [key]);
}
