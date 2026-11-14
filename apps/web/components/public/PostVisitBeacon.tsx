"use client";
/**
 * The visit beacon of a public page (item 8): once the page has loaded in a browser, an address that carries a shared
 * post's code (`?via=s.<code>`) tells the api once (`publicPage.visited`). Crawlers run no scripts, so they never send
 * it. Nothing is shown and nothing waits on the answer; a signed-in visitor's own token goes with it, so a member opening
 * their own post's link is left out by the api. Visits are never counted or shown anywhere: the first one only lets a
 * follow that comes later be credited to the post.
 */
import { useEffect } from "react";
import { VIA_PARAM, parseVia } from "@foundmill/shared/via";
import { useUntypedApi } from "@/components/providers/AppProviders";

/** The `via` worth sending from this address, or null: only a shared post's code. */
export function postVisitVia(search: string): string | null {
  const via = new URLSearchParams(search).get(VIA_PARAM);
  return parseVia(via)?.kind === "post" ? via : null;
}

export function PostVisitBeacon() {
  const api = useUntypedApi();
  useEffect(() => {
    const via = postVisitVia(window.location.search);
    if (!via) return;
    // Fire and forget: the page never depends on it.
    api.mutation("publicPage.visited", { via }).catch(() => undefined);
  }, [api]);
  return null;
}
