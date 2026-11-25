"use client";
/**
 * The visit beacon of a public page, sent once the page has loaded in a browser (crawlers run no scripts, so they never
 * send it). Nothing is shown and nothing waits on the answer; a signed-in visitor's own token goes with it, so the api
 * leaves a member of the project out. Two jobs, one request (`publicPage.visited`):
 * - Item 8: an address that carries a shared post's code (`?via=s.<code>`) stamps that post's link as visited, so a
 *   follow that comes later can be credited to the post.
 * - Visit counts (founder, Nov 25, 2026; packages/shared `page-visits.ts`): a browser that does not say it is automated
 *   sends the page's `slug`, the address's query and the referrer, once per tab and page a day. The api counts one
 *   visit for the day and source and stores nothing else. No cookie is set; the once-a-day mark is in `sessionStorage`.
 */
import { useEffect } from "react";
import { countableBrowser } from "@foundmill/shared/page-visits";
import { VIA_PARAM, parseVia } from "@foundmill/shared/via";
import { useUntypedApi } from "@/components/providers/AppProviders";

/** The `via` worth sending from this address, or null: only a shared post's code. */
export function postVisitVia(search: string): string | null {
  const via = new URLSearchParams(search).get(VIA_PARAM);
  return parseVia(via)?.kind === "post" ? via : null;
}

/** True the first time this tab asks for `slug` today; storage that throws counts every load. */
function firstLoadToday(slug: string): boolean {
  const key = `fm_visit:${slug}`;
  const today = new Date().toISOString().slice(0, 10);
  try {
    if (sessionStorage.getItem(key) === today) return false;
    sessionStorage.setItem(key, today);
  } catch {
    // shortcut: no storage (private mode) counts each load; fine for an estimate.
  }
  return true;
}

export function PostVisitBeacon({ slug }: { slug?: string }) {
  const api = useUntypedApi();
  useEffect(() => {
    const search = window.location.search;
    const via = new URLSearchParams(search).get(VIA_PARAM) ?? "";
    const count = slug !== undefined && countableBrowser(navigator) && firstLoadToday(slug);
    if (!count && !postVisitVia(search)) return;
    const input = count ? { via: via.slice(0, 84), slug, search: search.slice(0, 2000), referrer: document.referrer.slice(0, 2000) } : { via };
    // Fire and forget: the page never depends on it.
    api.mutation("publicPage.visited", input).catch(() => undefined);
  }, [api, slug]);
  return null;
}
