"use client";
/**
 * The guided layer at the root (AppProviders): what every page has before, or without, a signed-in layout's
 * GuidanceHost. Guidance reads as on with standard text, nothing can be saved (`useGuidancePreferences().signedIn` is
 * false), no signal is sent, and "Learn more" opens only absolute URLs.
 *
 * It asks the API nothing: the signed-in layouts read the account's preferences on the server and mount their own host
 * below `<Prefetched>` (perf audit item 2). It does not ship the definitions map either (perf audit item 9: 34 KB of
 * text, 10.7 KB gzipped): on a signed-out page (the landing page, an example, sign-in) the map is loaded after the page
 * has hydrated, so a defined word reads as plain text for that moment and then gains its underline; on a signed-in page
 * the layout's host carries the map, so nothing is loaded here.
 */
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { GuidanceProvider, LearnLinkProvider, type TermDefinition } from "@foundmill/dugout";
import { GuidancePreferencesProvider, SIGNED_OUT_GUIDANCE, isSignedInPath } from "./guidance-context";

type Terms = Record<string, TermDefinition>;

/** The definitions map, loaded once per tab and shared by every later mount. */
let termsLoad: Promise<Terms> | null = null;
/** Loads `TERMS` in its own chunk (never in the root bundle). Exported for tests. */
export function loadSignedOutTerms(): Promise<Terms> {
  termsLoad ??= import("@foundmill/shared/terms").then(
    (m) => m.TERMS as Terms,
    (err: unknown) => {
      termsLoad = null; // the next mount tries again
      throw err;
    },
  );
  return termsLoad;
}

const EMPTY: Terms = {};
const absoluteOnly = (learn: string) => (/^https?:\/\//.test(learn) ? learn : undefined);

export function GuidanceRoot({ children }: { children?: ReactNode }) {
  const pathname = usePathname();
  // A signed-in page's layout mounts its own host (with the map); only a signed-out page needs it from here.
  const wantsTerms = !isSignedInPath(pathname);
  const [terms, setTerms] = useState<Terms>(EMPTY);
  useEffect(() => {
    if (!wantsTerms || terms !== EMPTY) return;
    let live = true;
    loadSignedOutTerms().then(
      (loaded) => {
        if (live) setTerms(loaded);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [wantsTerms, terms]);
  return (
    <GuidancePreferencesProvider value={SIGNED_OUT_GUIDANCE}>
      <LearnLinkProvider resolve={absoluteOnly}>
        <GuidanceProvider value={{ terms }}>{children}</GuidanceProvider>
      </LearnLinkProvider>
    </GuidancePreferencesProvider>
  );
}
